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

// Capturar logs del browser para diagnóstico LID
waClient.on('ready', () => {
  waClient.pupPage.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[LID]')) console.log('[WA-Browser]', text);
  });
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
 * Parche para window.WWebJS.getChat con diagnóstico detallado.
 * Estrategia en 3 niveles:
 *   1. Intento normal (getChat original)
 *   2. Resolver LID via enforceLidAndPnRetrieval + reintentar
 *   3. Buscar chat existente en el store por número de teléfono
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
          console.log('[LID] getChat falló con LID para:', chatId);
        }

        // Nivel 2: resolver LID y reintentar
        try {
          const result = await window.WWebJS.enforceLidAndPnRetrieval(String(chatId));
          console.log('[LID] enforceLidAndPnRetrieval retornó lid:', result?.lid?._serialized || 'null');
          if (result?.lid) {
            const lidId = result.lid._serialized || String(result.lid);
            return await originalGetChat(lidId, opts);
          }
        } catch (e2) {
          console.log('[LID] enforceLidAndPnRetrieval también falló:', e2.message);
        }

        // Nivel 3: buscar chat existente en el store por número
        try {
          const phoneNum = String(chatId).replace(/@[a-z.]+$/, '');
          const chats = window.Store.Chat.getModelsArray();
          const found = chats.find(c => {
            const jid = String(c.id?._serialized || '');
            return jid.startsWith(phoneNum + '@') || jid.includes(phoneNum);
          });
          if (found) {
            console.log('[LID] Chat encontrado en store:', found.id?._serialized);
            if (opts.getAsModel === false) return found;
            return await window.WWebJS.getChatModel(found);
          }
          console.log('[LID] No se encontró chat en store para:', phoneNum);
        } catch (e3) {
          console.log('[LID] Búsqueda en store falló:', e3.message);
        }

        throw new Error('No LID for user - no se pudo resolver el contacto: ' + chatId);
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

  let resolvedId = `${phone}@c.us`;
  try {
    const numberId = await waClient.getNumberId(phone);
    console.log(`[WA] getNumberId(${phone}) →`, numberId?._serialized || 'null');
    if (numberId) resolvedId = numberId._serialized;
  } catch (e) {
    console.log(`[WA] getNumberId falló:`, e.message);
  }

  console.log(`[WA] Enviando a: ${resolvedId}`);
  return await waClient.sendMessage(resolvedId, content);
}

module.exports = { waClient, isReady, sendWAMessage };
