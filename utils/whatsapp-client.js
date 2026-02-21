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

waClient.on('ready', async () => {
  console.log('✅ WhatsApp Web CONECTADO y listo para enviar mensajes');
  waReady = true;
  await applyLidPatch();
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
 * Parche para window.WWebJS.getChat — workaround para "No LID for user"
 * en whatsapp-web.js 1.34.6 con contactos que usan el sistema LID.
 *
 * El problema: window.WWebJS.getChat llama a FindOrCreateLatestChat con
 * un WID @c.us, pero WhatsApp ahora requiere el WID @lid para esos contactos.
 * La función enforceLidAndPnRetrieval ya existe en WWebJS y resuelve el LID
 * consultando los servidores de WhatsApp si es necesario.
 *
 * Este parche reemplaza getChat para que al fallar con LID, resuelva el LID
 * y reintente automáticamente. Se aplica una vez al conectar.
 */
async function applyLidPatch() {
  try {
    await waClient.pupPage.evaluate(() => {
      const originalGetChat = window.WWebJS.getChat;
      window.WWebJS.getChat = async (chatId, opts = {}) => {
        try {
          return await originalGetChat(chatId, opts);
        } catch (e) {
          if (!String(e.message).includes('LID')) throw e;

          // Resolver LID consultando servidores de WA si no está en caché
          const { lid } = await window.WWebJS.enforceLidAndPnRetrieval(String(chatId));
          if (!lid) throw e; // LID no disponible → propagar error original

          const lidId = lid._serialized || String(lid);
          return await originalGetChat(lidId, opts);
        }
      };
    });
    console.log('✅ Parche LID aplicado correctamente');
  } catch (e) {
    console.warn('⚠️ No se pudo aplicar parche LID:', e.message);
  }
}

/**
 * Envía un mensaje de WhatsApp resolviendo el ID correcto antes de enviar.
 * Con el parche LID activo, client.sendMessage() ya maneja LID internamente.
 *
 * @param {string} phoneOrChatId  "573104650437" o "573104650437@c.us"
 * @param {string|MessageMedia} content  Texto o archivo a enviar
 */
async function sendWAMessage(phoneOrChatId, content) {
  const phone = String(phoneOrChatId).replace(/@[a-z.]+$/, '');

  // Resolver ID real con getNumberId (devuelve @c.us o @lid según el contacto)
  let resolvedId = `${phone}@c.us`;
  try {
    const numberId = await waClient.getNumberId(phone);
    if (numberId) resolvedId = numberId._serialized;
  } catch {}

  return await waClient.sendMessage(resolvedId, content);
}

module.exports = { waClient, isReady, sendWAMessage };
