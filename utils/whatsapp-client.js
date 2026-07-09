'use strict';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  USyncQuery,
  USyncUser,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const WA_AUTH_BASE = process.env.WA_AUTH_PATH || path.join(__dirname, '..', '.wwebjs_auth');
log.info(`[WA] Auth base: ${WA_AUTH_BASE}`);

// Logger silencioso para Baileys — evita flood de debug/info en producción
const baileysLogger = P({ level: 'silent' });

// Pool: tenantId (number) → { sock, ready, lastQR }
const pool = new Map();

let _messageHandler = null;

function registerMessageHandler(fn) {
  _messageHandler = fn;
}

function getAuthFolder(tenantId) {
  return tenantId === 1
    ? path.join(WA_AUTH_BASE, 'baileys-session')
    : path.join(WA_AUTH_BASE, `baileys-session-tenant_${tenantId}`);
}

async function createTenantClient(tenantId) {
  const tid = Number(tenantId);
  const authFolder = getAuthFolder(tid);
  fs.mkdirSync(authFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  let waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
  } catch (_) {
    log.warn(`[WA][tenant ${tid}] No se pudo obtener versión WA — usando default de Baileys`);
  }

  const sock = makeWASocket({
    version: waVersion,
    auth: state,
    printQRInTerminal: false,
    logger: baileysLogger,
    browser: ['Su Herramienta CST', 'Chrome', '120.0.0'],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 30_000,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  const info = { sock, ready: false, lastQR: null, _lidToPhone: new Map(), _pendingSends: new Map() };
  pool.set(tid, info);

  // Escuchar sync de contactos de Baileys para construir el mapa LID → teléfono.
  // WA usa LIDs (Linked Identity) como identificador en cuentas migradas.
  // Al conectarse, WA sincroniza contactos con id (phone@s.whatsapp.net) y lid (lid@lid).
  function upsertContacts(contacts) {
    let withLid = 0, withoutLid = 0;
    for (const c of contacts) {
      if (!c.id) continue;
      if (c.lid) {
        withLid++;
        const lidJid   = c.id.endsWith('@lid') ? c.id  : c.lid;
        const phoneJid = c.id.endsWith('@lid') ? c.lid : c.id;
        if (!phoneJid.endsWith('@lid')) {
          const phone = phoneJid.replace(/@[a-z.]+$/, '');
          info._lidToPhone.set(lidJid, phone);
          info._lidToPhone.set(lidJid.split('@')[0], phone);
          log.info(`[WA] contacts LID: ****${lidJid.split('@')[0].slice(-4)} → ****${phone.slice(-4)}`);
        }
      } else {
        withoutLid++;
      }
    }
    if (contacts.length > 0) {
      log.info(`[WA] contacts.upsert: total=${contacts.length} con_lid=${withLid} sin_lid=${withoutLid}`);
    }
  }
  sock.ev.on('contacts.upsert', upsertContacts);
  sock.ev.on('contacts.update', upsertContacts);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      info.lastQR = qr;
      log.info(`[WA][tenant ${tid}] ESCANEA ESTE CÓDIGO QR (o visita /api/whatsapp/qr)`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      log.info(`[WA][tenant ${tid}] CONECTADO y listo`);
      info.ready = true;
      info.lastQR = null;
    }

    if (connection === 'close') {
      info.ready = false;
      const err = lastDisconnect?.error;
      const statusCode = err instanceof Boom ? err.output?.statusCode : undefined;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      log.warn(`[WA][tenant ${tid}] Conexión cerrada — código: ${statusCode}, reconectar: ${shouldReconnect}`);

      pool.delete(tid);

      // Si resetTenantClient inició este cierre, él se encarga de crear el nuevo cliente.
      // Sin este guard, el close handler y resetTenantClient crean dos sockets simultáneos
      // que se dan 440 mutuamente en un ciclo infinito.
      if (info._skipReconnect) return;

      if (shouldReconnect) {
        setTimeout(() => {
          log.info(`[WA][tenant ${tid}] Reconectando...`);
          createTenantClient(tid).catch(e =>
            log.warn(`[WA] Error reconectando tenant ${tid}: ${e.message}`)
          );
        }, 5000);
      } else {
        // Logged out — borrar sesión local y pedir nuevo QR
        const folder = getAuthFolder(tid);
        try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) {}
        log.warn(`[WA][tenant ${tid}] Sesión cerrada por WhatsApp — sesión eliminada, reiniciando...`);
        setTimeout(() => {
          createTenantClient(tid).catch(e =>
            log.warn(`[WA] Error post-logout tenant ${tid}: ${e.message}`)
          );
        }, 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // 'append' = historial al conectarse — ignorar para no saturar logs en arranque
    if (type === 'append') return;
    for (const msg of messages) {
      // Log mensajes enviados por nosotros: revela si WA usa LID como remoteJid al entregar
      if (msg.key?.fromMe && msg.key?.remoteJid && !msg.key.remoteJid.endsWith('@g.us')) {
        const rjid = msg.key.remoteJid;
        const domain = rjid.split('@')[1];
        const bare   = rjid.split('@')[0].slice(-4);
        if (domain === 'lid') {
          // WA confirmó entrega a JID LID — capturar en _pendingSends para resolver después
          const msgId = msg.key.id;
          const pending = info._pendingSends?.get(msgId);
          if (pending) {
            info._lidToPhone.set(rjid, pending);
            info._lidToPhone.set(rjid.split('@')[0], pending);
            info._pendingSends.delete(msgId);
            log.info(`[WA] fromMe LID capturado: ****${bare}@lid → ****${pending.slice(-4)}`);
          } else {
            log.info(`[WA] fromMe LID: ****${bare}@lid (sin tracking — ${msgId?.slice(-6)})`);
          }
        } else {
          log.info(`[WA] fromMe: ****${bare}@${domain} type=${type}`);
        }
      }

      if (type !== 'notify' || !_messageHandler) continue;
      if (!msg.message) continue;
      _messageHandler(tid, msg);
    }
  });

  return info;
}

function initTenantClient(tenantId = 1) {
  const tid = Number(tenantId);
  if (!pool.has(tid)) {
    createTenantClient(tid).catch(e =>
      log.warn(`[WA] No se pudo inicializar tenant ${tid}: ${e.message}`)
    );
  }
}

function isReady(tenantId = 1) {
  return pool.get(Number(tenantId))?.ready ?? false;
}

/**
 * Envía un mensaje de texto por WhatsApp.
 * @param {number} tenantId
 * @param {string} phoneOrJid  Número ("573104650437"), JID completo ("57...@s.whatsapp.net"),
 *                             "@c.us" (normalizado a @s.whatsapp.net), o "@lid" (LID, usado tal cual)
 * @param {string|object} content  Texto a enviar o contenido multimedia de Baileys
 */
async function sendWAMessage(tenantId, phoneOrJid, content) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (!info?.ready) throw new Error('WhatsApp no está listo para este taller');

  const str = String(phoneOrJid);
  let jid;
  if (str.includes('@')) {
    // JID completo — normalizar @c.us a @s.whatsapp.net, conservar @lid y @g.us
    jid = str.replace('@c.us', '@s.whatsapp.net');
  } else {
    // Solo número — construir JID @s.whatsapp.net
    jid = `${str.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  const msgContent = typeof content === 'string' ? { text: content } : content;
  const originalPhone = jid.replace(/@[a-z.]+$/, '');

  // Registrar el ID del mensaje antes de enviarlo para capturar LID en messages.upsert fromMe
  // (el evento puede llegar con remoteJid=@lid si WA enruta internamente al LID del usuario)
  const result = await info.sock.sendMessage(jid, msgContent);
  const msgId = result?.key?.id;
  if (msgId && !jid.endsWith('@lid')) {
    info._pendingSends.set(msgId, originalPhone);
    setTimeout(() => info._pendingSends.delete(msgId), 15_000);
  }

  // Verificar si sendMessage reveló el LID en su respuesta
  const deliveryJid = result?.key?.remoteJid;
  if (deliveryJid && deliveryJid !== jid && deliveryJid.endsWith('@lid')) {
    const deliveryBare = deliveryJid.split('@')[0];
    if (!jid.endsWith('@lid')) {
      // Caso 1: enviamos a @s.whatsapp.net y WA reveló el LID del destinatario
      info._lidToPhone.set(deliveryJid, originalPhone);
      info._lidToPhone.set(deliveryBare, originalPhone);
      info._pendingSends.delete(msgId);
      log.info(`[WA] LID capturado (phone→lid): ****${deliveryBare.slice(-4)} → ****${originalPhone.slice(-4)}`);
    } else {
      // Caso 2: enviamos a @lid y WA confirmó con un LID DISTINTO (el LID de entrega).
      // El LID de entrega puede ser el número de teléfono con dominio @lid.
      // Mapeamos: LID entrante → bare del LID de entrega (probablemente el teléfono).
      const jidBare = jid.split('@')[0];
      info._lidToPhone.set(jid, deliveryBare);
      info._lidToPhone.set(jidBare, deliveryBare);
      log.info(`[WA] LID→LID capturado: ****${jidBare.slice(-4)} → ****${deliveryBare.slice(-4)} (buscaré pendiente con este valor)`);
    }
  } else {
    const domain = deliveryJid?.split('@')[1] || '?';
    const bare   = deliveryJid?.split('@')[0]?.slice(-4) || '?';
    log.info(`[WA] sendMessage → ****${bare}@${domain} (destino ****${originalPhone.slice(-4)}@${jid.split('@')[1]})`);
  }

  return result;
}

/**
 * Dado un JID LID ("81186212806850@lid" o el número bare "81186212806850"),
 * devuelve el número de teléfono colombiano ("573022754949") si Baileys lo conoce.
 * El mapa se puebla en contacts.upsert al conectarse (sync de contactos WA).
 * @returns {string|null}
 */
function getLidPhone(tenantId, jidOrBare) {
  const info = pool.get(Number(tenantId));
  if (!info) return null;
  return info._lidToPhone.get(jidOrBare) || info._lidToPhone.get(jidOrBare.split('@')[0]) || null;
}

/**
 * Resuelve un número de teléfono vía sock.onWhatsApp().
 * NOTA: devuelve el JID de teléfono (@s.whatsapp.net), NO el LID.
 * Útil para verificar que un número tiene WA antes de enviar.
 * @returns {string|null}
 */
async function resolveWAJid(tenantId, phone) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (!info?.ready) return null;
  const cleanPhone = String(phone).replace(/\D/g, '');
  try {
    const results = await info.sock.onWhatsApp(cleanPhone);
    const result = Array.isArray(results) ? results[0] : null;
    return (result?.exists && result.jid) ? result.jid : null;
  } catch (e) {
    log.warn(`[WA] resolveWAJid: no se pudo verificar ${cleanPhone.slice(-4)}: ${e.message}`);
    return null;
  }
}

function getLastQR(tenantId = 1) {
  return pool.get(Number(tenantId))?.lastQR ?? null;
}

/**
 * Consulta a WA el LID (Linked Identity) asociado a un número de teléfono.
 * Usa executeUSyncQuery con los protocolos Contact + LID — la misma vía
 * que Baileys usa internamente para establecer sesiones Signal con cuentas LID.
 *
 * Retorna el número bare del LID (ej: "81106212806850") o null si WA no tiene LID para ese teléfono.
 */
async function getLidForPhone(tenantId, phone) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (!info?.ready || !info.sock?.executeUSyncQuery) {
    log.info(`[WA] getLidForPhone(****${String(phone).slice(-4)}): WA no listo o executeUSyncQuery no disponible`);
    return null;
  }

  const cleanPhone = String(phone).replace(/\D/g, '');
  const phoneJid = `${cleanPhone}@s.whatsapp.net`;

  log.info(`[WA] getLidForPhone: consultando LID para ****${cleanPhone.slice(-4)}`);
  try {
    // Mismo patrón que pnFromLIDUSync interno de Baileys:
    // withLIDProtocol() + withContext('background') + withId(phoneJid)
    const query = new USyncQuery()
      .withLIDProtocol()
      .withContext('background')
      .withUser(new USyncUser().withId(phoneJid));

    const results = await info.sock.executeUSyncQuery(query);

    if (!results?.list?.length) {
      log.info(`[WA] getLidForPhone(****${cleanPhone.slice(-4)}): sin resultados de WA`);
      return null;
    }

    const item = results.list.find(r => r.id === phoneJid) || results.list[0];
    log.info(`[WA] getLidForPhone(****${cleanPhone.slice(-4)}): campos=[${Object.keys(item || {}).join(',')}] lid=${item?.lid ?? 'null'}`);

    if (!item?.lid) return null;

    // item.lid viene del parser de USyncLIDProtocol: node.attrs.val
    // puede ser "81106212806850@lid" o "81106212806850" — normalizamos
    const lidBare = String(item.lid).replace(/@[a-z.]+$/, '');
    if (!lidBare) return null;

    // Actualizar mapa en memoria: LID → teléfono
    info._lidToPhone.set(`${lidBare}@lid`, cleanPhone);
    info._lidToPhone.set(lidBare, cleanPhone);

    log.info(`[WA] LID resuelto (USync): ****${cleanPhone.slice(-4)} → LID ****${lidBare.slice(-4)}`);
    return lidBare;
  } catch (e) {
    log.warn(`[WA] getLidForPhone(****${cleanPhone.slice(-4)}): ${e.message}`);
    return null;
  }
}

/**
 * Destruye la sesión actual del tenant, borra archivos de auth del disco
 * e inicia un cliente nuevo que emitirá QR.
 */
async function resetTenantClient(tenantId = 1) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (info) {
    // Marcar antes de cerrar para que el handler connection.update 'close'
    // no programe un segundo createTenantClient en paralelo con el nuestro.
    info._skipReconnect = true;
    try { info.sock.ws.close(); } catch (_) {}
    pool.delete(tid);
  }
  const folder = getAuthFolder(tid);
  try {
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    log.info(`[WA] Sesión tenant ${tid} eliminada: ${folder}`);
  } catch (e) {
    log.warn(`[WA] No se pudo borrar sesión: ${e.message}`);
  }
  createTenantClient(tid).catch(e => log.warn(`[WA] Error reset tenant ${tid}: ${e.message}`));
}

async function shutdownAllClients() {
  for (const [, info] of pool.entries()) {
    try { info.sock.ws.close(); } catch (_) {}
  }
  pool.clear();
}

// Railway envía SIGTERM antes de matar el proceso — cerrar WebSockets limpiamente
// evita que la sesión quede corrupta en el Volume.
process.on('SIGTERM', async () => {
  log.info('[WA] SIGTERM — cerrando conexiones Baileys antes de salir...');
  await shutdownAllClients();
  process.exit(0);
});

module.exports = {
  initTenantClient,
  isReady,
  sendWAMessage,
  getLidPhone,
  getLidForPhone,
  resolveWAJid,
  getLastQR,
  resetTenantClient,
  registerMessageHandler,
  shutdownAllClients,
};
