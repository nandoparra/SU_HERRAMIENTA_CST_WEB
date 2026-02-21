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
 * Envía un mensaje de WhatsApp con manejo del sistema LID.
 *
 * WhatsApp migró contactos al sistema LID (Linked ID Device). Enviar
 * directamente con "57XXX@c.us" o con client.sendMessage() puede lanzar
 * "No LID for user" en esos contactos. Estrategia en 3 pasos:
 *   1. Resolver el ID real con getNumberId() (@c.us o @lid)
 *   2. Intentar envío con client.sendMessage()
 *   3. Si falla por LID, obtener el chat y enviar por chat.sendMessage()
 *
 * @param {string} phoneOrChatId  Número con o sin @c.us  (ej: "573104650437" o "573104650437@c.us")
 * @param {string|MessageMedia} content  Texto o archivo a enviar
 */
async function sendWAMessage(phoneOrChatId, content) {
  const phone = String(phoneOrChatId).replace(/@[a-z.]+$/, '');

  // Paso 1 — resolver ID real (puede devolver @c.us o @lid según el contacto)
  let resolvedId = `${phone}@c.us`;
  try {
    const numberId = await waClient.getNumberId(phone);
    if (numberId) resolvedId = numberId._serialized;
  } catch {}

  // Paso 2 — intento directo
  try {
    return await waClient.sendMessage(resolvedId, content);
  } catch (e) {
    if (!String(e.message).includes('LID')) throw e; // otro error → propagar
  }

  // Paso 3 — fallback: enviar desde el objeto Chat
  const chat = await waClient.getChatById(resolvedId);
  return await chat.sendMessage(content);
}

module.exports = { waClient, isReady, sendWAMessage };
