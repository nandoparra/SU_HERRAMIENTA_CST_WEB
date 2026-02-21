const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
});

let waReady = false;

waClient.on('qr', (qr) => {
  console.log('📱 ESCANEA ESTE CÓDIGO QR EN TU WHATSAPP WEB:');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  console.log('✅ WhatsApp Web CONECTADO y listo para enviar mensajes');
  waReady = true;
});

waClient.on('auth_failure', (msg) => console.log('❌ Error de autenticación:', msg));

waClient.on('disconnected', (reason) => {
  console.log('⚠️ WhatsApp Web desconectado:', reason);
  waReady = false;
});

function isReady() {
  return waReady;
}

/**
 * Resuelve el chatId correcto para un número antes de enviar.
 * Necesario porque WhatsApp migró algunos contactos al sistema LID
 * (Linked ID Device). Construir "57XXXXXXXX@c.us" a mano falla con
 * "No LID for user" en esos contactos.
 * Usa getNumberId() para obtener el ID real (@c.us o @lid según corresponda).
 */
async function resolveWAId(phoneOrChatId) {
  const phone = String(phoneOrChatId).replace(/@c\.us$/, '').replace(/@lid$/, '');
  try {
    const result = await waClient.getNumberId(phone);
    if (result) return result._serialized;
  } catch {}
  return phoneOrChatId; // fallback al formato original si falla
}

module.exports = { waClient, isReady, resolveWAId };
