'use strict';
const { isReady, sendWAMessage } = require('./whatsapp-client');

/**
 * Envía la lista de repuestos autorizados al encargado (PARTS_WHATSAPP_NUMBER).
 *
 * @param {object}        conn         Conexión mysql2 ya obtenida — el llamador la libera
 * @param {number}        tenantId     Tenant activo
 * @param {number}        uidOrden     uid_orden de la orden
 * @param {string|number} consecutivo  ord_consecutivo para el encabezado del mensaje
 * @returns {Promise<{ sent: boolean, maquinas: number, reason?: string }>}
 */
async function enviarListaRepuestos(conn, tenantId, uidOrden, consecutivo) {
  const partsNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  if (!partsNumber) return { sent: false, maquinas: 0, reason: 'PARTS_WHATSAPP_NUMBER no configurado en .env' };
  if (!isReady(tenantId)) return { sent: false, maquinas: 0, reason: 'WhatsApp no está conectado' };

  const [maquinas] = await conn.execute(
    `SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca, h.her_serial
     FROM b2c_herramienta_orden ho
     JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
     WHERE ho.uid_orden = ? AND ho.her_estado = 'autorizada'
     ORDER BY ho.uid_herramienta_orden`,
    [uidOrden]
  );
  if (!maquinas.length) return { sent: false, maquinas: 0, reason: 'No hay máquinas con estado "autorizada" en esta orden' };

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
    `Orden #${consecutivo}\n\n` +
    bloques.join('\n\n') +
    `\n\n— SU HERRAMIENTA CST`;

  let phone = partsNumber;
  if (!phone.startsWith('57')) phone = '57' + phone.slice(-10);
  await sendWAMessage(tenantId, `${phone}@c.us`, msg);

  return { sent: true, maquinas: maquinas.length };
}

module.exports = { enviarListaRepuestos };
