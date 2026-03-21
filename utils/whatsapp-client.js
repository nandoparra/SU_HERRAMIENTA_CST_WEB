'use strict';
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs   = require('fs');
const path = require('path');

const WA_AUTH_BASE = process.env.WA_AUTH_PATH || path.join(__dirname, '..', '.wwebjs_auth');

// ── Eliminar lock files de Chromium — evita "profile in use" tras reinicios ─
function removeChromeLocksRecursive(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeChromeLocksRecursive(full);
      } else if (['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(entry.name)) {
        try { fs.unlinkSync(full); console.log('🔓 Lock Chromium eliminado:', full); } catch {}
      }
    }
  } catch {}
}
// Limpiar en el directorio base cubre a todos los tenants (recursivo)
removeChromeLocksRecursive(WA_AUTH_BASE);

// ── Pool: tenantId (number) → { client, ready, lastQR } ─────────────────────
const pool = new Map();

// Callback global registrado por wa-handler.js
let _messageHandler = null;

/** Registra el handler que recibe (tenantId, msg) para cada mensaje entrante */
function registerMessageHandler(fn) {
  _messageHandler = fn;
}

// ── Parche LID ────────────────────────────────────────────────────────────────
async function applyLidPatch(client, tenantId) {
  try {
    await client.pupPage.evaluate(() => {
      const originalGetChat = window.WWebJS.getChat;
      window.WWebJS.getChat = async (chatId, opts = {}) => {
        try { return await originalGetChat(chatId, opts); } catch (e) {
          if (!String(e.message).includes('LID')) throw e;
        }
        const phoneNum = String(chatId).replace(/@[a-z.]+$/, '');
        try {
          const result = await window.WWebJS.enforceLidAndPnRetrieval(String(chatId));
          if (result?.lid) {
            const lidId = result.lid._serialized || String(result.lid);
            return await originalGetChat(lidId, opts);
          }
        } catch (_) {}
        try {
          const chats = window.Store.Chat.getModelsArray();
          const found = chats.find(c => {
            const jid = String(c.id?._serialized || '');
            return jid.startsWith(phoneNum + '@') || jid.includes(phoneNum);
          });
          if (found) {
            if (opts.getAsModel === false) return found;
            return await window.WWebJS.getChatModel(found);
          }
        } catch (_) {}
        throw new Error('No LID for user - no se pudo resolver: ' + chatId);
      };
    });
    console.log(`✅ Parche LID aplicado [tenant ${tenantId}]`);
  } catch (e) {
    console.warn(`⚠️ No se pudo aplicar parche LID [tenant ${tenantId}]:`, e.message);
  }
}

// ── Crear cliente para un tenant ──────────────────────────────────────────────
function createTenantClient(tenantId) {
  const tid = Number(tenantId);

  // Tenant 1: usa WA_AUTH_BASE directamente — mantiene sesión existente en Railway.
  // Otros tenants: clientId distinto → LocalAuth crea session-tenant_N/ dentro del mismo base.
  const authOpts = tid === 1
    ? { dataPath: WA_AUTH_BASE }
    : { dataPath: WA_AUTH_BASE, clientId: `tenant_${tid}` };

  const client = new Client({
    authStrategy: new LocalAuth(authOpts),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });

  const info = { client, ready: false, lastQR: null };
  pool.set(tid, info);

  client.on('qr', (qr) => {
    info.lastQR = qr;
    console.log(`📱 [tenant ${tid}] ESCANEA ESTE CÓDIGO QR (o visita /api/whatsapp/qr):`);
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    console.log(`✅ WhatsApp Web [tenant ${tid}] CONECTADO y listo`);
    info.ready = true;
    info.lastQR = null;
    await applyLidPatch(client, tid);
  });

  client.on('auth_failure', (msg) =>
    console.log(`❌ [tenant ${tid}] Error de autenticación:`, msg));

  client.on('disconnected', (reason) => {
    console.log(`⚠️ WhatsApp Web [tenant ${tid}] desconectado:`, reason);
    info.ready = false;
  });

  client.on('message', async (msg) => {
    if (_messageHandler) _messageHandler(tid, msg);
  });

  return info;
}

/**
 * Inicializa el cliente WA para el tenant dado.
 * Crea la entrada en el pool si no existe y llama client.initialize().
 * Llamar en server.js al arrancar para el tenant por defecto (1).
 */
function initTenantClient(tenantId = 1) {
  const tid = Number(tenantId);
  if (!pool.has(tid)) createTenantClient(tid);
  pool.get(tid).client.initialize().catch(e => {
    console.warn(`⚠️ WhatsApp [tenant ${tid}] no disponible:`, e.message);
  });
}

/** true si el cliente del tenant está conectado y listo */
function isReady(tenantId = 1) {
  return pool.get(Number(tenantId))?.ready ?? false;
}

/**
 * Envía un mensaje WA usando el cliente del tenant indicado.
 * @param {number} tenantId
 * @param {string} phoneOrChatId  "573104650437" o "573104650437@c.us"
 * @param {string|import('whatsapp-web.js').MessageMedia} content
 */
async function sendWAMessage(tenantId, phoneOrChatId, content) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (!info?.ready) throw new Error('WhatsApp no está listo para este taller');

  const phone = String(phoneOrChatId).replace(/@[a-z.]+$/, '');

  let resolvedId;
  try {
    const numberId = await info.client.getNumberId(phone);
    if (!numberId) throw new Error(`El número ${phone} no tiene WhatsApp registrado.`);
    resolvedId = numberId._serialized;
  } catch (e) {
    if (String(e.message).includes('no tiene WhatsApp')) throw e;
    resolvedId = `${phone}@c.us`;
  }

  return await info.client.sendMessage(resolvedId, content);
}

/** Retorna el último QR raw del tenant (null si ya conectado o aún no generado) */
function getLastQR(tenantId = 1) {
  return pool.get(Number(tenantId))?.lastQR ?? null;
}

module.exports = { initTenantClient, isReady, sendWAMessage, getLastQR, registerMessageHandler };
