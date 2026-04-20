'use strict';

/**
 * saveMachineQuote — guarda cotización de una máquina dentro de una transacción.
 *
 * @param {object} params
 *   orderId, equipmentOrderId, technicianId, laborCost, workDescription, items[]
 * @param {{ conn, tenantId }} ctx
 *   conn — conexión MySQL ya obtenida por el caller (se liberará allá también)
 *   tenantId — del tenant activo en la request
 * @returns {{ subtotal, orderSubtotal, total }}
 * @throws {Error} con .status = 403 si la máquina no pertenece a la orden/tenant
 */
async function saveMachineQuote(
  { orderId, equipmentOrderId, technicianId, laborCost, workDescription, items },
  { conn, tenantId }
) {
  const [[machineInOrder]] = await conn.execute(
    `SELECT uid_herramienta_orden FROM b2c_herramienta_orden
     WHERE uid_herramienta_orden = ? AND uid_orden = ? AND tenant_id = ?`,
    [String(equipmentOrderId), String(orderId), tenantId]
  );
  if (!machineInOrder) {
    const err = new Error('Máquina no pertenece a esta orden');
    err.status = 403;
    throw err;
  }

  const manoObra = Number(laborCost) || 0;
  const itemsSubtotal = (items || []).reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0
  );
  const subtotal = manoObra + itemsSubtotal;

  await conn.beginTransaction();
  try {
    await conn.execute(
      `INSERT INTO b2c_cotizacion_maquina
         (uid_orden, uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         tecnico_id = VALUES(tecnico_id),
         mano_obra = VALUES(mano_obra),
         descripcion_trabajo = VALUES(descripcion_trabajo),
         subtotal = VALUES(subtotal),
         updated_at = CURRENT_TIMESTAMP`,
      [
        String(orderId), String(equipmentOrderId),
        technicianId ? String(technicianId) : null,
        manoObra, workDescription || null, subtotal, tenantId,
      ]
    );

    await conn.execute(
      `DELETE FROM b2c_cotizacion_item
       WHERE uid_orden = ? AND uid_herramienta_orden = ? AND tenant_id = ?`,
      [String(orderId), String(equipmentOrderId), tenantId]
    );

    for (const it of (items || [])) {
      const nombre       = String(it.name || '').trim() || 'Item';
      const cantidad     = Math.max(1, parseInt(it.quantity || '1', 10));
      const precio       = Number(it.price) || 0;
      const lineSubtotal = cantidad * precio;
      await conn.execute(
        `INSERT INTO b2c_cotizacion_item
           (uid_orden, uid_herramienta_orden, nombre, cantidad, precio, subtotal, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [String(orderId), String(equipmentOrderId), nombre, cantidad, precio, lineSubtotal, tenantId]
      );
    }

    const [[sumRow]] = await conn.execute(
      `SELECT COALESCE(SUM(subtotal),0) AS s FROM b2c_cotizacion_maquina
       WHERE uid_orden = ? AND tenant_id = ?`,
      [String(orderId), tenantId]
    );
    const orderSubtotal = Number(sumRow?.s || 0);
    const IVA_RATE      = parseFloat(process.env.IVA_RATE || '0');
    const iva           = orderSubtotal * IVA_RATE;
    const total         = orderSubtotal + iva;

    await conn.execute(
      `INSERT INTO b2c_cotizacion_orden (uid_orden, subtotal, iva, total, tenant_id)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subtotal = VALUES(subtotal),
         iva = VALUES(iva),
         total = VALUES(total),
         updated_at = CURRENT_TIMESTAMP`,
      [String(orderId), orderSubtotal, iva, total, tenantId]
    );

    // Avanzar estado a 'cotizada' si no está en estado más avanzado
    const ESTADOS_NO_RETROCEDER = ['autorizada', 'no_autorizada', 'reparada', 'entregada'];
    const [[maqRow]] = await conn.execute(
      `SELECT her_estado FROM b2c_herramienta_orden
       WHERE uid_herramienta_orden = ? AND uid_orden = ? AND tenant_id = ?`,
      [String(equipmentOrderId), String(orderId), tenantId]
    );
    if (maqRow && !ESTADOS_NO_RETROCEDER.includes(maqRow.her_estado)) {
      await conn.execute(
        `UPDATE b2c_herramienta_orden SET her_estado = 'cotizada'
         WHERE uid_herramienta_orden = ? AND uid_orden = ? AND tenant_id = ?`,
        [String(equipmentOrderId), String(orderId), tenantId]
      );
      await conn.execute(
        `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado) VALUES (?, 'cotizada')`,
        [String(equipmentOrderId)]
      );
    }

    await conn.commit();
    return { subtotal, orderSubtotal, total };
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

module.exports = { saveMachineQuote };
