'use strict';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs     = require('fs');
const path   = require('path');
const pino   = require('pino');

const WA_AUTH_BASE = process.env.WA_AUTH_PATH || path.join(__dirname, '..', '.wwebjs_auth');
console.log(`[WA] Auth path: ${WA_AUTH_BASE}`);

// Logger silencioso para Baileys (suprime su output interno)
const baileysLogger = pino({ level: 'silent' });

// Pool: tenantId (number) → { sock, ready, lastQR }
const pool = new Map();

// Flag para evitar reconexión durante apagado ordenado
let _shuttingDown = false;

// Callback global registrado por wa-handler.js
let _messageHandler = null;

/** Registra el handler que recibe (tenantId, msg) para cada mensaje entrante */
function registerMessageHandler(fn) {
  _messageHandler = fn;
}

/** Directorio de sesión por tenant */
function sessionDir(tenantId) {
  return tenantId === 1
    ? path.join(WA_AUTH_BASE, 'baileys_session')
    : path.join(WA_AUTH_BASE, `baileys_session_${tenantId}`);
}

// ── Crear y conectar cliente Baileys para un tenant ──────────────────────────
async function createTenantClient(tenantId) {
  const tid = Number(tenantId);
  const dir = sessionDir(tid);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (_) {
    version = [2, 3000, 1023166576]; // fallback si no hay internet al arrancar
  }

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: baileysLogger,
    browser: ['Su Herramienta CST', 'Chrome', '120.0.0.0'],
    markOnlineOnConnect: false,
  });

  const info = { sock, ready: false, lastQR: null };
  pool.set(tid, info);

  // Persistir credenciales cada vez que cambian
  sock.ev.on('creds.update', saveCreds);

  // ── Estado de conexión ─────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      info.lastQR = qr;
      console.log(`📱 [tenant ${tid}] ESCANEA ESTE CÓDIGO QR (o visita /api/whatsapp/qr):`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp [tenant ${tid}] CONECTADO y listo`);
      info.ready  = true;
      info.lastQR = null;
    }

    if (connection === 'close') {
      info.ready = false;
      if (_shuttingDown) return; // no reconectar durante SIGTERM

      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        // WhatsApp invalidó la sesión (se cerró sesión desde el teléfono)
        console.log(`🚪 [tenant ${tid}] Sesión cerrada — borrando sesión local y generando QR nuevo...`);
        pool.delete(tid);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        setTimeout(() => createTenantClient(tid), 2000);
      } else {
        // Error de red u otro — reconectar con sesión existente
        console.log(`🔄 [tenant ${tid}] Desconectado (código: ${statusCode}) — reconectando...`);
        pool.delete(tid);
        setTimeout(() => createTenantClient(tid), 5000);
      }
    }
  });

  // ── Mensajes entrantes ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (_messageHandler) {
        try { await _messageHandler(tid, msg); } catch (_) {}
      }
    }
  });

  return info;
}

/**
 * Inicializa el cliente WA para el tenant dado.
 * Firma síncrona compatible con la llamada actual en server.js.
 */
function initTenantClient(tenantId = 1) {
  const tid = Number(tenantId);
  if (!pool.has(tid)) {
    createTenantClient(tid).catch(e =>
      console.warn(`⚠️ WhatsApp [tenant ${tid}] no disponible:`, e.message)
    );
  }
}

/** true si el cliente del tenant está conectado y listo */
function isReady(tenantId = 1) {
  return pool.get(Number(tenantId))?.ready ?? false;
}

/**
 * Envía un mensaje de texto WA usando el cliente del tenant indicado.
 * @param {number} tenantId
 * @param {string} phoneOrChatId  "573104650437", "573104650437@c.us" o "573104650437@s.whatsapp.net"
 * @param {string} content
 */
async function sendWAMessage(tenantId, phoneOrChatId, content) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (!info?.ready) throw new Error('WhatsApp no está listo para este taller');

  // Normalizar a número puro, luego construir JID Baileys
  const phone = String(phoneOrChatId)
    .replace(/@[a-z.]+$/, '')   // quitar @c.us / @s.whatsapp.net
    .replace(/^\+/, '');        // quitar + inicial
  const jid = `${phone}@s.whatsapp.net`;

  await info.sock.sendMessage(jid, { text: String(content) });
}

/** Retorna el último QR raw del tenant (null si ya conectado o aún no generado) */
function getLastQR(tenantId = 1) {
  return pool.get(Number(tenantId))?.lastQR ?? null;
}

/**
 * Borra la sesión guardada en disco y crea un cliente nuevo (emite QR).
 */
async function resetTenantClient(tenantId = 1) {
  const tid = Number(tenantId);
  const info = pool.get(tid);
  if (info) {
    try {
      info.sock.ev.removeAllListeners();
      info.sock.ws?.close?.();
    } catch (_) {}
    pool.delete(tid);
  }

  const dir = sessionDir(tid);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    console.log(`🗑️  Sesión WA [tenant ${tid}] eliminada:`, dir);
  } catch (e) {
    console.warn('No se pudo borrar sesión:', e.message);
  }

  await createTenantClient(tid);
}

// ── Cierre ordenado — Railway envía SIGTERM antes de matar el proceso ─────────
// Con Baileys no hay Chromium — el WebSocket cierra en milisegundos.
async function shutdownAllClients() {
  _shuttingDown = true;
  for (const [, info] of pool.entries()) {
    try {
      info.sock.ev.removeAllListeners();
      info.sock.ws?.close?.();
    } catch (_) {}
  }
  pool.clear();
}

process.on('SIGTERM', async () => {
  console.log('[WA] SIGTERM — cerrando conexiones Baileys...');
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
