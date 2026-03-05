const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const waClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WA_AUTH_PATH || './.wwebjs_auth',
  }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
});

let waReady = false;
let _lastQR = null;  // raw QR string para exponer vía /api/whatsapp/qr

waClient.on('qr', (qr) => {
  _lastQR = qr;
  console.log('📱 ESCANEA ESTE CÓDIGO QR EN TU WHATSAPP WEB (o visita /api/whatsapp/qr):');
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
 * Parche LID — contactos migrados al sistema LID de WhatsApp.
 * Estrategia en 3 niveles:
 *   1. Intento normal (getChat original)
 *   2. Resolver LID via enforceLidAndPnRetrieval + reintentar
 *   3. Buscar chat existente en el store por número (funciona si alguna vez
 *      se ha chateado con el contacto desde este teléfono)
 *
 * Si los 3 fallan: el contacto requiere que se le abra un chat manualmente
 * desde el teléfono al menos una vez para que WA cachee su LID.
 */
async function applyLidPatch() {
  try {
    await waClient.pupPage.evaluate(() => {
      const originalGetChat = window.WWebJS.getChat;

      window.WWebJS.getChat = async (chatId, opts = {}) => {
        // Nivel 1: intento normal
        try {
          return await originalGetChat(chatId, opts);
        } catch (e) {
          if (!String(e.message).includes('LID')) throw e;
        }

        const phoneNum = String(chatId).replace(/@[a-z.]+$/, '');

        // Nivel 2: resolver LID via enforceLidAndPnRetrieval
        try {
          const result = await window.WWebJS.enforceLidAndPnRetrieval(String(chatId));
          if (result?.lid) {
            const lidId = result.lid._serialized || String(result.lid);
            return await originalGetChat(lidId, opts);
          }
        } catch (_) {}

        // Nivel 3: buscar chat existente en el store por número
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
    console.log('✅ Parche LID aplicado correctamente');
  } catch (e) {
    console.warn('⚠️ No se pudo aplicar parche LID:', e.message);
  }
}

/**
 * @param {string} phoneOrChatId  "573104650437" o "573104650437@c.us"
 * @param {string|MessageMedia} content
 */
async function sendWAMessage(phoneOrChatId, content) {
  const phone = String(phoneOrChatId).replace(/@[a-z.]+$/, '');

  // Verificar que el número tenga WhatsApp registrado antes de intentar enviar
  let resolvedId;
  try {
    const numberId = await waClient.getNumberId(phone);
    if (!numberId) {
      throw new Error(`El número ${phone} no tiene WhatsApp registrado.`);
    }
    resolvedId = numberId._serialized;
  } catch (e) {
    // Re-lanzar errores propios; para errores de red usar @c.us como fallback
    if (String(e.message).includes('no tiene WhatsApp')) throw e;
    resolvedId = `${phone}@c.us`;
  }

  return await waClient.sendMessage(resolvedId, content);
}

function getLastQR() { return _lastQR; }

module.exports = { waClient, isReady, sendWAMessage, getLastQR };
