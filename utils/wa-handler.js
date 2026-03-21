/**
 * wa-handler.js — Listener de mensajes entrantes de WhatsApp
 * Maneja el flujo de autorización de cotizaciones por WhatsApp.
 *
 * Se importa en server.js. Registra el listener en waClient inmediatamente
 * (el evento 'message' solo dispara cuando WA está conectado).
 */

const db = require('./db');
const { registerMessageHandler, sendWAMessage } = require('./whatsapp-client');

function formatCOP(amount) {
  return `$${Number(amount || 0).toLocaleString('es-CO')}`;
}

/** "573104650437@c.us" → "573104650437" */
function normalizePhone(raw) {
  return String(raw).replace(/@[a-z.]+$/, '');
}

console.log('✅ wa-handler: listener de mensajes entrantes registrado');

registerMessageHandler(async (tenantId, msg) => {
  // Solo chats individuales con texto
  if (msg.from.endsWith('@g.us')) return;
  const text = String(msg.body || '').trim();

  let senderPhone = normalizePhone(msg.from);

  // Si no es un número colombiano estándar (57 + 10 dígitos), es un LID —
  // resolverlo al número real via getContact()
  if (!/^57\d{10}$/.test(senderPhone)) {
    try {
      const contact = await msg.getContact();
      let resolved = String(contact.number || '').replace(/[^0-9]/g, '');
      if (resolved.length === 10 && resolved.startsWith('3')) resolved = '57' + resolved;
      if (/^57\d{10}$/.test(resolved)) {
        console.log(`📨 wa-handler: LID ${senderPhone} → resuelto a ${resolved}`);
        senderPhone = resolved;
      } else {
        console.log(`📨 wa-handler: no se pudo resolver LID ${senderPhone} a número colombiano`);
        return;
      }
    } catch (e) {
      console.warn('⚠️ wa-handler: error resolviendo LID:', e.message);
      return;
    }
  }

  console.log(`📨 wa-handler: mensaje de ${senderPhone} → "${text || '(sin texto / audio/media)'}"`);

  let conn;
  try {
    conn = await db.getConnection();

    const [[pendiente]] = await conn.execute(
      `SELECT uid_autorizacion, uid_orden, estado, COALESCE(tenant_id, 1) AS tenant_id
       FROM b2c_wa_autorizacion_pendiente
       WHERE wa_phone = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [senderPhone]
    );

    if (!pendiente) {
      console.log(`📨 wa-handler: ${senderPhone} no tiene conversación activa — ignorando`);
      return;
    }

    console.log(`📨 wa-handler: pendiente encontrado uid_orden=${pendiente.uid_orden} estado=${pendiente.estado}`);

    // Audio, imagen u otro mensaje sin texto — responder con aviso
    if (!text) {
      await sendWAMessage(tenantId, senderPhone,
        'Este número es exclusivo para notificaciones automáticas y no permite conversación.\n\n' +
        'Si desea responder a su cotización, por favor indique únicamente *1*, *2*, *3* o *4*.\n\n' +
        'Para cualquier otra consulta comuníquese con nosotros al *3104650437*. — SU HERRAMIENTA CST'
      );
      return;
    }

    if (pendiente.estado === 'esperando_opcion') {
      await handleOpcion(conn, pendiente, text, senderPhone, tenantId);
    } else if (pendiente.estado === 'esperando_maquinas') {
      await handleSeleccionMaquinas(conn, pendiente, text, senderPhone, tenantId);
    }
  } catch (e) {
    console.error('❌ wa-handler error:', e.message, e.stack);
  } finally {
    if (conn) conn.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Opción inicial: 1 / 2 / 3 / 4
// ─────────────────────────────────────────────────────────────────────────────
async function handleOpcion(conn, pendiente, text, senderPhone, tenantId = 1) {
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
    await sendWAMessage(tenantId, senderPhone,
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
    await sendWAMessage(tenantId, senderPhone,
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

    await sendWAMessage(tenantId, senderPhone,
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
    await sendWAMessage(tenantId, senderPhone,
      `Le comunicamos con nuestro asesor: *${advisorNumber}* — SU HERRAMIENTA CST`
    );

  } else {
    // Opción no reconocida
    await sendWAMessage(tenantId, senderPhone,
      'Este número es exclusivo para notificaciones automáticas y no permite conversación.\n\n' +
      'Si desea responder a su cotización, por favor indique únicamente *1*, *2*, *3* o *4*.\n\n' +
      'Para cualquier otra consulta comuníquese con nosotros al *3104650437*. — SU HERRAMIENTA CST'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Selección parcial: cliente envía los números de las máquinas que autoriza
// ─────────────────────────────────────────────────────────────────────────────
async function handleSeleccionMaquinas(conn, pendiente, text, senderPhone, tenantId = 1) {
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
    await sendWAMessage(senderPhone,
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
    console.error('⚠️ wa-handler: error enviando repuestos:', e.message);
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

  await sendWAMessage(tenantId, senderPhone, confirmacion);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar lista de repuestos al encargado (máquinas con her_estado='autorizada')
// Misma lógica que POST /api/orders/:orderId/notify-parts
// ─────────────────────────────────────────────────────────────────────────────
async function enviarListaRepuestos(conn, uid_orden, tenantId = 1) {
  const partsNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  if (!partsNumber) {
    console.warn('⚠️ wa-handler: PARTS_WHATSAPP_NUMBER no configurado, se omite envío al encargado');
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

module.exports = {};
