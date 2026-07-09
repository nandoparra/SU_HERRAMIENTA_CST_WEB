/**
 * wa-handler.js — Listener de mensajes entrantes de WhatsApp
 * Maneja el flujo de autorización de cotizaciones por WhatsApp.
 *
 * Se importa en server.js. Registra el listener en waClient inmediatamente
 * (el evento 'message' solo dispara cuando WA está conectado).
 */

const db = require('./db');
const { registerMessageHandler, sendWAMessage, isReady, getLidPhone } = require('./whatsapp-client');
const log = require('./logger');
const { responderConIA } = require('../services/wa-agente');

function formatCOP(amount) {
  return `$${Number(amount || 0).toLocaleString('es-CO')}`;
}

log.info('✅ wa-handler: listener de mensajes entrantes registrado');

registerMessageHandler(async (tenantId, msg) => {
  // Solo chats individuales — Baileys: remoteJid termina en @s.whatsapp.net
  const jid = msg.key?.remoteJid || '';
  if (!jid || jid.endsWith('@g.us') || msg.key?.fromMe) return;

  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  // El JID de Baileys ya es el número puro: "573104650437@s.whatsapp.net"
  const senderPhone = jid.split('@')[0];

  // Stickers, audio, imágenes y reacciones no tienen texto — ignorar completamente
  if (!text) return;

  log.debug(`📨 wa-handler: mensaje de ****${senderPhone.slice(-4)} — [contenido omitido]`);

  let conn;
  try {
    conn = await db.getConnection();

    // Para usuarios con JID LID (ej: "81186212806850@lid"), el wa_phone en BD puede
    // estar guardado como número de teléfono ("573022754949") porque cuando enviamos
    // la cotización no sabíamos el LID. Intentamos resolver LID→teléfono via el mapa
    // de contactos que Baileys construye en contacts.upsert al conectarse.
    let phoneForLookup = senderPhone;
    if (jid.endsWith('@lid')) {
      const resolvedPhone = getLidPhone(tenantId, jid);
      if (resolvedPhone) {
        log.debug(`📨 wa-handler: LID ****${senderPhone.slice(-4)} resuelto a teléfono ****${resolvedPhone.slice(-4)}`);
        phoneForLookup = resolvedPhone;
      }
    }

    // Búsqueda en dos fases:
    // 1. Por senderPhone exacto (funciona si el pendiente ya tiene el LID guardado)
    // 2. Por teléfono resuelto (funciona para pendientes guardados antes del fix LID)
    let [[pendiente]] = await conn.execute(
      `SELECT uid_autorizacion, uid_orden, estado, wa_phone, created_at, COALESCE(tenant_id, 1) AS tenant_id
       FROM b2c_wa_autorizacion_pendiente
       WHERE wa_phone = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [senderPhone]
    );

    if (!pendiente && phoneForLookup !== senderPhone) {
      [[pendiente]] = await conn.execute(
        `SELECT uid_autorizacion, uid_orden, estado, wa_phone, created_at, COALESCE(tenant_id, 1) AS tenant_id
         FROM b2c_wa_autorizacion_pendiente
         WHERE wa_phone = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [phoneForLookup]
      );
      if (pendiente && jid.endsWith('@lid')) {
        await conn.execute(
          `UPDATE b2c_wa_autorizacion_pendiente SET wa_phone = ? WHERE uid_autorizacion = ?`,
          [senderPhone, pendiente.uid_autorizacion]
        );
        log.debug(`📨 wa-handler: migración LID — wa_phone actualizado a ****${senderPhone.slice(-4)}`);
      }
    }

    if (!pendiente) {
      await handleAgente(conn, phoneForLookup, tenantId, text, jid);
      return;
    }

    // Conversaciones de autorización vencen a los 7 días — suficiente margen para que
    // el cliente decida sobre la cotización, pero evita que un mensaje no relacionado
    // (sticker, saludo, reacción) semanas/meses después reabra una cotización vieja
    // y el cliente reciba el aviso "1,2,3,4" fuera de contexto.
    const PENDIENTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(pendiente.created_at).getTime() > PENDIENTE_TTL_MS) {
      log.debug(`📨 wa-handler: pendiente de ****${senderPhone.slice(-4)} venció (>7 días) — descartando sin responder`);
      await conn.execute(
        `DELETE FROM b2c_wa_autorizacion_pendiente WHERE uid_autorizacion = ?`,
        [pendiente.uid_autorizacion]
      );
      return;
    }

    log.debug(`📨 wa-handler: pendiente encontrado uid_orden=${pendiente.uid_orden} estado=${pendiente.estado}`);

    if (pendiente.estado === 'esperando_opcion') {
      if (['1', '2', '3', '4'].includes(text)) {
        await handleOpcion(conn, pendiente, text, jid, tenantId);
      } else {
        await handleAgente(conn, phoneForLookup, tenantId, text, jid);
      }
    } else if (pendiente.estado === 'esperando_maquinas') {
      await handleSeleccionMaquinas(conn, pendiente, text, jid, tenantId);
    }
  } catch (e) {
    log.error({ err: e }, '❌ wa-handler error');
  } finally {
    if (conn) conn.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Opción inicial: 1 / 2 / 3 / 4
// ─────────────────────────────────────────────────────────────────────────────
// senderJid: JID completo entrante ("81186212806850@lid" o "573...@s.whatsapp.net")
// Usado para enviar la respuesta al canal correcto (LID o @s.whatsapp.net).
async function handleOpcion(conn, pendiente, text, senderJid, tenantId = 1) {
  const { uid_autorizacion, uid_orden } = pendiente;

  if (text === '1') {
    // Autorizar todas las máquinas
    const [maquinas] = await conn.execute(
      `SELECT uid_herramienta_orden FROM b2c_herramienta_orden WHERE uid_orden = ?`,
      [uid_orden]
    );
    for (const m of maquinas) {
      await conn.execute(
        `UPDATE b2c_herramienta_orden SET her_estado = 'autorizada' WHERE uid_herramienta_orden = ?`,
        [m.uid_herramienta_orden]
      );
      await conn.execute(
        `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, 'autorizada', ?)`,
        [m.uid_herramienta_orden, tenantId]
      );
    }
    await conn.execute(
      `DELETE FROM b2c_wa_autorizacion_pendiente WHERE uid_autorizacion = ?`,
      [uid_autorizacion]
    );
    await enviarListaRepuestos(conn, uid_orden, tenantId);
    await sendWAMessage(tenantId, senderJid,
      '✅ *¡Cotización autorizada!* Gracias, procederemos con la reparación de todas sus herramientas. Le avisaremos cuando estén listas. — SU HERRAMIENTA CST'
    );

  } else if (text === '2') {
    // No autorizar
    const [maquinas] = await conn.execute(
      `SELECT uid_herramienta_orden FROM b2c_herramienta_orden WHERE uid_orden = ?`,
      [uid_orden]
    );
    for (const m of maquinas) {
      await conn.execute(
        `UPDATE b2c_herramienta_orden SET her_estado = 'no_autorizada' WHERE uid_herramienta_orden = ?`,
        [m.uid_herramienta_orden]
      );
      await conn.execute(
        `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, 'no_autorizada', ?)`,
        [m.uid_herramienta_orden, tenantId]
      );
    }
    await conn.execute(
      `DELETE FROM b2c_wa_autorizacion_pendiente WHERE uid_autorizacion = ?`,
      [uid_autorizacion]
    );
    await sendWAMessage(tenantId, senderJid,
      'Entendido, hemos registrado que *no autoriza* la reparación en este momento. Si cambia de opinión no dude en contactarnos. — SU HERRAMIENTA CST'
    );

  } else if (text === '3') {
    // Autorización parcial: enviar lista numerada de máquinas
    const [maquinas] = await conn.execute(
      `SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca, h.her_serial,
              cm.subtotal
       FROM b2c_herramienta_orden ho
       JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       LEFT JOIN b2c_cotizacion_maquina cm
              ON CAST(cm.uid_herramienta_orden AS CHAR) = CAST(ho.uid_herramienta_orden AS CHAR)
       WHERE ho.uid_orden = ?
       ORDER BY ho.uid_herramienta_orden`,
      [uid_orden]
    );

    const lista = maquinas.map((m, i) => {
      const nombre = [m.her_nombre, m.her_marca].filter(Boolean).join(' ');
      const serial = m.her_serial ? ` (S/N: ${m.her_serial})` : '';
      const precio = m.subtotal != null ? ` — ${formatCOP(m.subtotal)}` : '';
      return `${i + 1}. ${nombre}${serial}${precio}`;
    }).join('\n');

    await sendWAMessage(tenantId, senderJid,
      `Seleccione las máquinas a *autorizar* enviando sus números separados por coma (ej: 1,3):\n\n${lista}`
    );
    await conn.execute(
      `UPDATE b2c_wa_autorizacion_pendiente SET estado = 'esperando_maquinas' WHERE uid_autorizacion = ?`,
      [uid_autorizacion]
    );

  } else if (text === '4') {
    // Comunicar con asesor
    const advisorNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
    await conn.execute(
      `DELETE FROM b2c_wa_autorizacion_pendiente WHERE uid_autorizacion = ?`,
      [uid_autorizacion]
    );
    // Notificar al asesor
    if (advisorNumber) {
      const [[orderRow]] = await conn.execute(
        `SELECT o.ord_consecutivo, c.cli_razon_social, c.cli_contacto
         FROM b2c_orden o
         JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
         WHERE o.uid_orden = ?`,
        [uid_orden]
      );
      const nombre = orderRow?.cli_razon_social || orderRow?.cli_contacto || 'Cliente';
      let phone = advisorNumber;
      if (!phone.startsWith('57')) phone = '57' + phone.slice(-10);
      await sendWAMessage(tenantId, `${phone}@c.us`,
        `📞 *ATENCIÓN REQUERIDA*\nEl cliente *${nombre}* (Orden #${orderRow?.ord_consecutivo || uid_orden}) solicita hablar con un asesor sobre su cotización.`
      );
    }
    // Confirmar al cliente
    await sendWAMessage(tenantId, senderJid,
      `Le comunicamos con nuestro asesor: *${advisorNumber}* — SU HERRAMIENTA CST`
    );

  } else {
    // Opción no reconocida
    await sendWAMessage(tenantId, senderJid,
      'Este número es exclusivo para notificaciones automáticas y no permite conversación.\n\n' +
      'Si desea responder a su cotización, por favor indique únicamente *1*, *2*, *3* o *4*.\n\n' +
      'Para cualquier otra consulta comuníquese con nosotros al *3104650437*. — SU HERRAMIENTA CST'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Selección parcial: cliente envía los números de las máquinas que autoriza
// ─────────────────────────────────────────────────────────────────────────────
async function handleSeleccionMaquinas(conn, pendiente, text, senderJid, tenantId = 1) {
  const { uid_autorizacion, uid_orden } = pendiente;

  const [maquinas] = await conn.execute(
    `SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca
     FROM b2c_herramienta_orden ho
     JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
     WHERE ho.uid_orden = ?
     ORDER BY ho.uid_herramienta_orden`,
    [uid_orden]
  );

  // Parsear dígitos únicos en rango válido
  const numerosRaw = [...new Set((text.match(/\d+/g) || []).map(Number))];
  const validos = numerosRaw.filter(n => n >= 1 && n <= maquinas.length);

  if (!validos.length) {
    await sendWAMessage(tenantId, senderJid,
      `No entendí su selección. Por favor envíe los números separados por coma (ej: 1,3). Los números deben estar entre 1 y ${maquinas.length}.`
    );
    return; // Mantiene el pendiente activo para reintentar
  }

  // Actualizar estados + historial
  for (let i = 0; i < maquinas.length; i++) {
    const estado = validos.includes(i + 1) ? 'autorizada' : 'no_autorizada';
    await conn.execute(
      `UPDATE b2c_herramienta_orden SET her_estado = ? WHERE uid_herramienta_orden = ?`,
      [estado, maquinas[i].uid_herramienta_orden]
    );
    await conn.execute(
      `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, ?, ?)`,
      [maquinas[i].uid_herramienta_orden, estado, tenantId]
    );
  }

  await conn.execute(
    `DELETE FROM b2c_wa_autorizacion_pendiente WHERE uid_autorizacion = ?`,
    [uid_autorizacion]
  );

  try {
    await enviarListaRepuestos(conn, uid_orden, tenantId);
  } catch (e) {
    log.error({ err: e.message }, '⚠️ wa-handler: error enviando repuestos:');
  }

  // Confirmación al cliente
  const autorizadas = validos
    .map(n => `  • ${[maquinas[n - 1].her_nombre, maquinas[n - 1].her_marca].filter(Boolean).join(' ')}`)
    .join('\n');
  const noAutorizadas = maquinas
    .filter((_, i) => !validos.includes(i + 1))
    .map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`)
    .join('\n');

  let confirmacion = '✅ *Autorización parcial registrada.*\n\n*Autorizadas:*\n' + autorizadas;
  if (noAutorizadas) confirmacion += '\n\n*No autorizadas:*\n' + noAutorizadas;
  confirmacion += '\n\nProcederemos con las herramientas autorizadas. Le avisaremos cuando estén listas. — SU HERRAMIENTA CST';

  await sendWAMessage(tenantId, senderJid, confirmacion);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar lista de repuestos al encargado (máquinas con her_estado='autorizada')
// Misma lógica que POST /api/orders/:orderId/notify-parts
// ─────────────────────────────────────────────────────────────────────────────
async function enviarListaRepuestos(conn, uid_orden, tenantId = 1) {
  const partsNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  if (!partsNumber) {
    log.warn('⚠️ wa-handler: PARTS_WHATSAPP_NUMBER no configurado, se omite envío al encargado');
    return;
  }

  const [[orderRow]] = await conn.execute(
    `SELECT ord_consecutivo FROM b2c_orden WHERE uid_orden = ?`,
    [uid_orden]
  );

  const [maquinas] = await conn.execute(
    `SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca, h.her_serial
     FROM b2c_herramienta_orden ho
     JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
     WHERE ho.uid_orden = ? AND ho.her_estado = 'autorizada'
     ORDER BY ho.uid_herramienta_orden`,
    [uid_orden]
  );

  if (!maquinas.length) return;

  const bloques = await Promise.all(maquinas.map(async (maq) => {
    const [items] = await conn.execute(
      `SELECT nombre, cantidad FROM b2c_cotizacion_item WHERE uid_herramienta_orden = ? ORDER BY id`,
      [maq.uid_herramienta_orden]
    );
    const nombre = [maq.her_nombre, maq.her_marca].filter(Boolean).join(' ');
    const serial = maq.her_serial ? ` / S/N: ${maq.her_serial}` : '';
    const lineas = items.length
      ? items.map(i => `  • ${i.cantidad}x ${i.nombre}`).join('\n')
      : '  (solo mano de obra)';
    return `*${nombre}*${serial}\n${lineas}`;
  }));

  const msg =
    `🔧 *REPUESTOS AUTORIZADOS*\n` +
    `Orden #${orderRow?.ord_consecutivo || uid_orden}\n\n` +
    bloques.join('\n\n') +
    `\n\n— SU HERRAMIENTA CST`;

  let phone = partsNumber;
  if (!phone.startsWith('57')) phone = '57' + phone.slice(-10);
  await sendWAMessage(tenantId, `${phone}@c.us`, msg);
}

// senderPhone: número JID sin @domain — clave para historial en BD
// senderJid: JID completo ("...@lid" o "...@s.whatsapp.net") — usado para enviar
async function handleAgente(conn, senderPhone, tenantId, text, senderJid) {
  try {
    log.info(`🤖 wa-agente: procesando mensaje de ****${senderPhone.slice(-4)}`);
    const respuesta = await responderConIA(conn, senderPhone, tenantId, text);
    log.info(`🤖 wa-agente: respuesta lista (${respuesta.length} chars), enviando...`);

    // Si WA se desconectó brevemente mientras Claude procesaba (ej. 440 transitorio),
    // esperar hasta 10s para que reconecte antes de intentar enviar.
    if (!isReady(tenantId)) {
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (isReady(tenantId)) break;
        log.info(`🤖 wa-agente: WA no listo, esperando... (${(i + 1) * 2}s/10s)`);
      }
    }

    await sendWAMessage(tenantId, senderJid, respuesta);
    log.info(`🤖 wa-agente: mensaje enviado a ****${senderPhone.slice(-4)}`);
  } catch (e) {
    log.error({ err: e }, `❌ wa-agente: error procesando mensaje de ****${senderPhone.slice(-4)}`);
  }
}

module.exports = {};
