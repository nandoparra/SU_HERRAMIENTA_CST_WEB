const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { requireInterno } = require('../middleware/auth');

// Todos los endpoints de cotización son exclusivamente internos (admin/F/T).
// El portal cliente recibe datos de cotización a través de /api/cliente/mis-ordenes.
router.use(requireInterno);

// Catálogo de repuestos
router.get('/quote/catalog', async (req, res) => {
  try {
    const type = req.query.type || 'R';
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT uid_concepto_costo, cco_descripcion, cco_valor, cco_impuesto
         FROM b2c_concepto_costos
         WHERE cco_tipo = ? AND cco_estado = 'A' AND tenant_id = ?
         ORDER BY cco_descripcion`,
        [type, tenantId]
      );
      res.json(rows);
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error cargando catálogo:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET cotización de una máquina
router.get('/quotes/machine', async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    const equipmentOrderId = String(req.query.equipmentOrderId || '').trim();
    if (!orderId || !equipmentOrderId)
      return res.status(400).json({ error: 'orderId y equipmentOrderId son requeridos' });

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const [mq] = await conn.execute(
        `SELECT uid_orden, uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal
         FROM b2c_cotizacion_maquina
         WHERE uid_orden = ? AND uid_herramienta_orden = ? AND tenant_id = ?`,
        [orderId, equipmentOrderId, tenantId]
      );

      const [items] = await conn.execute(
        `SELECT id, nombre, cantidad, precio, subtotal
         FROM b2c_cotizacion_item
         WHERE uid_orden = ? AND uid_herramienta_orden = ? AND tenant_id = ?
         ORDER BY id`,
        [orderId, equipmentOrderId, tenantId]
      );

      res.json({ exists: mq.length > 0, machineQuote: mq[0] || null, items: items || [] });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error consultando cotización máquina:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST guardar cotización de una máquina
router.post('/quotes/machine', async (req, res) => {
  try {
    const { orderId, equipmentOrderId, technicianId, laborCost, workDescription, items } = req.body;

    if (!orderId || !equipmentOrderId)
      return res.status(400).json({ success: false, error: 'orderId y equipmentOrderId son requeridos' });
    if (!Array.isArray(items))
      return res.status(400).json({ success: false, error: 'items debe ser un arreglo' });

    const manoObra = Number(laborCost) || 0;
    const itemsSubtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
    const subtotal = manoObra + itemsSubtotal;

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `INSERT INTO b2c_cotizacion_maquina (uid_orden, uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           tecnico_id = VALUES(tecnico_id),
           mano_obra = VALUES(mano_obra),
           descripcion_trabajo = VALUES(descripcion_trabajo),
           subtotal = VALUES(subtotal),
           updated_at = CURRENT_TIMESTAMP`,
        [String(orderId), String(equipmentOrderId), technicianId ? String(technicianId) : null, manoObra, workDescription || null, subtotal, tenantId]
      );

      await conn.execute(
        `DELETE FROM b2c_cotizacion_item WHERE uid_orden = ? AND uid_herramienta_orden = ? AND tenant_id = ?`,
        [String(orderId), String(equipmentOrderId), tenantId]
      );

      for (const it of items) {
        const nombre = String(it.name || '').trim() || 'Item';
        const cantidad = Math.max(1, parseInt(it.quantity || '1', 10));
        const precio = Number(it.price) || 0;
        const lineSubtotal = cantidad * precio;
        await conn.execute(
          `INSERT INTO b2c_cotizacion_item (uid_orden, uid_herramienta_orden, nombre, cantidad, precio, subtotal, tenant_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [String(orderId), String(equipmentOrderId), nombre, cantidad, precio, lineSubtotal, tenantId]
        );
      }

      const [[sumRow]] = await conn.execute(
        `SELECT COALESCE(SUM(subtotal),0) AS s FROM b2c_cotizacion_maquina WHERE uid_orden = ? AND tenant_id = ?`,
        [String(orderId), tenantId]
      );
      const orderSubtotal = Number(sumRow?.s || 0);
      const IVA_RATE = parseFloat(process.env.IVA_RATE || '0');
      const iva = orderSubtotal * IVA_RATE;
      const total = orderSubtotal + iva;

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

      // Cambiar estado a 'cotizada' automáticamente si no está ya más avanzado
      const ESTADOS_NO_RETROCEDER = ['autorizada', 'no_autorizada', 'reparada', 'entregada'];
      const [[maqRow]] = await conn.execute(
        `SELECT her_estado FROM b2c_herramienta_orden WHERE uid_herramienta_orden = ?`,
        [String(equipmentOrderId)]
      );
      if (maqRow && !ESTADOS_NO_RETROCEDER.includes(maqRow.her_estado)) {
        await conn.execute(
          `UPDATE b2c_herramienta_orden SET her_estado = 'cotizada' WHERE uid_herramienta_orden = ?`,
          [String(equipmentOrderId)]
        );
        await conn.execute(
          `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado) VALUES (?, 'cotizada')`,
          [String(equipmentOrderId)]
        );
      }

      await conn.commit();
      conn.release();
      res.json({ success: true, subtotal, orderSubtotal, total });
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (e) {
    console.error('Error guardando cotización máquina:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET cotización completa de la orden
router.get('/quotes/order/:orderId', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const [machines] = await conn.execute(
        `SELECT uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal, updated_at
         FROM b2c_cotizacion_maquina
         WHERE uid_orden = ? AND tenant_id = ?
         ORDER BY uid_herramienta_orden`,
        [orderId, tenantId]
      );

      const [[hdr]] = await conn.execute(
        `SELECT uid_orden, subtotal, iva, total, whatsapp_enviado, whatsapp_enviado_at
         FROM b2c_cotizacion_orden
         WHERE uid_orden = ? AND tenant_id = ?`,
        [orderId, tenantId]
      );

      res.json({
        success: true,
        header: hdr || { uid_orden: orderId, subtotal: 0, iva: 0, total: 0 },
        machines,
        savedCount: machines.length,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error consultando cotización orden:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST generar mensaje final con IA
router.post('/quotes/order/:orderId/generate-message', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
    const order = await resolveOrder(conn, orderId, tenantId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    const [machines] = await conn.execute(
      `SELECT cm.uid_herramienta_orden, cm.tecnico_id, cm.mano_obra, cm.descripcion_trabajo, cm.subtotal,
              h.her_nombre, h.her_marca, h.her_serial
       FROM b2c_cotizacion_maquina cm
       LEFT JOIN b2c_herramienta_orden ho ON CAST(ho.uid_herramienta_orden AS CHAR) = CAST(cm.uid_herramienta_orden AS CHAR)
       LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE cm.uid_orden = ?
       ORDER BY cm.uid_herramienta_orden`,
      [order.uid_orden]
    );

    if (!machines.length) {
      return res.status(400).json({ success: false, error: 'No hay cotizaciones guardadas para esta orden.' });
    }

    const [items] = await conn.execute(
      `SELECT uid_herramienta_orden, nombre, cantidad, precio, subtotal
       FROM b2c_cotizacion_item
       WHERE uid_orden = ?
       ORDER BY uid_herramienta_orden, id`,
      [order.uid_orden]
    );

    const machineSubtotal = machines.reduce((s, m) => s + Number(m.subtotal || 0), 0);
    const IVA_RATE = parseFloat(process.env.IVA_RATE || '0');
    const iva = machineSubtotal * IVA_RATE;
    const total = machineSubtotal + iva;

    const itemsByMachine = new Map();
    for (const it of items) {
      const key = String(it.uid_herramienta_orden);
      if (!itemsByMachine.has(key)) itemsByMachine.set(key, []);
      itemsByMachine.get(key).push(it);
    }

    const clientName = order.cli_razon_social || order.cli_contacto || 'Cliente';
    const machineLines = machines.map(m => {
      const nombre = `*${m.her_nombre || 'Máquina'}${m.her_marca ? ' (' + m.her_marca + ')' : ''}*`;
      const manoObra = Number(m.mano_obra || 0);
      const repuestos = itemsByMachine.get(String(m.uid_herramienta_orden)) || [];
      const repuestosTotal = repuestos.reduce((s, it) => s + Number(it.subtotal || 0), 0);
      const lines = [`  • Mano de obra: $${manoObra.toLocaleString('es-CO')}`];
      if (repuestos.length) {
        lines.push(`  • Repuestos: $${repuestosTotal.toLocaleString('es-CO')}`);
        for (const it of repuestos) {
          lines.push(`    - ${it.nombre} x${it.cantidad} = $${Number(it.subtotal || 0).toLocaleString('es-CO')}`);
        }
      }
      lines.push(`  Subtotal: $${Number(m.subtotal || 0).toLocaleString('es-CO')}`);
      return `${nombre}\n${lines.join('\n')}`;
    }).join('\n\n');

    const generated = `Hola, le saluda *Su Herramienta CST* 🔧\n\nCotización orden #${order.ord_consecutivo} para ${clientName}:\n\n${machineLines}\n\n*Total: $${total.toLocaleString('es-CO')}*\n\nPor favor indíquenos su decisión:`;

    // Agregar menú de autorización de forma determinista
    const advisorNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
    const menu =
      '\n\nResponda con el número de su elección:\n' +
      '1️⃣ Autorizar toda la cotización\n' +
      '2️⃣ No autorizar la cotización\n' +
      '3️⃣ Autorización parcial (seleccionar máquinas)\n' +
      `4️⃣ Hablar con un asesor → ${advisorNumber}`;
    const fullMessage = generated + menu;

    await conn.execute(
      `INSERT INTO b2c_cotizacion_orden (uid_orden, subtotal, iva, total, mensaje_whatsapp, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subtotal = VALUES(subtotal),
         iva = VALUES(iva),
         total = VALUES(total),
         mensaje_whatsapp = VALUES(mensaje_whatsapp),
         updated_at = CURRENT_TIMESTAMP`,
      [order.uid_orden, machineSubtotal, iva, total, fullMessage, tenantId]
    );

      res.json({ success: true, message: fullMessage, totals: { subtotal: machineSubtotal, iva, total }, machinesCount: machines.length });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error generando mensaje final:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
