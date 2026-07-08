'use strict';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
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

  const info = { sock, ready: false, lastQR: null };
  pool.set(tid, info);

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
    if (type !== 'notify' || !_messageHandler) return;
    for (const msg of messages) {
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
 * @param {string} phoneOrChatId  "573104650437" o "573104650437@c.us" o "@s.whatsapp.net"
 * @param {string} content  Texto a enviar
 */
async function sendWAMessage(tenantId, phoneOrChatId, content) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (!info?.ready) throw new Error('WhatsApp no está listo para este taller');

  // Normalizar a dígitos puros y convertir al JID de Baileys
  const phone = String(phoneOrChatId).replace(/@[a-z.]+$/, '').replace(/\D/g, '');
  const jid = `${phone}@s.whatsapp.net`;

  return await info.sock.sendMessage(jid, { text: String(content) });
}

function getLastQR(tenantId = 1) {
  return pool.get(Number(tenantId))?.lastQR ?? null;
}

/**
 * Destruye la sesión actual del tenant, borra archivos de auth del disco
 * e inicia un cliente nuevo que emitirá QR.
 */
async function resetTenantClient(tenantId = 1) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (info) {
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
  getLastQR,
  resetTenantClient,
  registerMessageHandler,
  shutdownAllClients,
};
