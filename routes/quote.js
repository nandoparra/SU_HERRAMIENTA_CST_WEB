const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { generateText } = require('../utils/ia');

// Catálogo de repuestos
router.get('/quote/catalog', async (req, res) => {
  try {
    const type = req.query.type || 'R';
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT uid_concepto_costo, cco_descripcion, cco_valor, cco_impuesto
       FROM b2c_concepto_costos
       WHERE cco_tipo = ? AND cco_estado = 'A'
       ORDER BY cco_descripcion`,
      [type]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error cargando catálogo:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET cotización de una máquina
router.get('/quotes/machine', async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    const equipmentOrderId = String(req.query.equipmentOrderId || '').trim();
    if (!orderId || !equipmentOrderId)
      return res.status(400).json({ error: 'orderId y equipmentOrderId son requeridos' });

    const conn = await db.getConnection();

    const [mq] = await conn.execute(
      `SELECT uid_orden, uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal
       FROM b2c_cotizacion_maquina
       WHERE uid_orden = ? AND uid_herramienta_orden = ?`,
      [orderId, equipmentOrderId]
    );

    const [items] = await conn.execute(
      `SELECT id, nombre, cantidad, precio, subtotal
       FROM b2c_cotizacion_item
       WHERE uid_orden = ? AND uid_herramienta_orden = ?
       ORDER BY id`,
      [orderId, equipmentOrderId]
    );

    conn.release();
    res.json({ exists: mq.length > 0, machineQuote: mq[0] || null, items: items || [] });
  } catch (e) {
    console.error('Error consultando cotización máquina:', e);
    res.status(500).json({ error: e.message });
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

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `INSERT INTO b2c_cotizacion_maquina (uid_orden, uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           tecnico_id = VALUES(tecnico_id),
           mano_obra = VALUES(mano_obra),
           descripcion_trabajo = VALUES(descripcion_trabajo),
           subtotal = VALUES(subtotal),
           updated_at = CURRENT_TIMESTAMP`,
        [String(orderId), String(equipmentOrderId), technicianId ? String(technicianId) : null, manoObra, workDescription || null, subtotal]
      );

      await conn.execute(
        `DELETE FROM b2c_cotizacion_item WHERE uid_orden = ? AND uid_herramienta_orden = ?`,
        [String(orderId), String(equipmentOrderId)]
      );

      for (const it of items) {
        const nombre = String(it.name || '').trim() || 'Item';
        const cantidad = Math.max(1, parseInt(it.quantity || '1', 10));
        const precio = Number(it.price) || 0;
        const lineSubtotal = cantidad * precio;
        await conn.execute(
          `INSERT INTO b2c_cotizacion_item (uid_orden, uid_herramienta_orden, nombre, cantidad, precio, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [String(orderId), String(equipmentOrderId), nombre, cantidad, precio, lineSubtotal]
        );
      }

      const [[sumRow]] = await conn.execute(
        `SELECT COALESCE(SUM(subtotal),0) AS s FROM b2c_cotizacion_maquina WHERE uid_orden = ?`,
        [String(orderId)]
      );
      const orderSubtotal = Number(sumRow?.s || 0);
      const IVA_RATE = parseFloat(process.env.IVA_RATE || '0');
      const iva = orderSubtotal * IVA_RATE;
      const total = orderSubtotal + iva;

      await conn.execute(
        `INSERT INTO b2c_cotizacion_orden (uid_orden, subtotal, iva, total)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           subtotal = VALUES(subtotal),
           iva = VALUES(iva),
           total = VALUES(total),
           updated_at = CURRENT_TIMESTAMP`,
        [String(orderId), orderSubtotal, iva, total]
      );

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
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET cotización completa de la orden
router.get('/quotes/order/:orderId', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const conn = await db.getConnection();

    const [machines] = await conn.execute(
      `SELECT uid_herramienta_orden, tecnico_id, mano_obra, descripcion_trabajo, subtotal, updated_at
       FROM b2c_cotizacion_maquina
       WHERE uid_orden = ?
       ORDER BY uid_herramienta_orden`,
      [orderId]
    );

    const [[hdr]] = await conn.execute(
      `SELECT uid_orden, subtotal, iva, total, whatsapp_enviado, whatsapp_enviado_at
       FROM b2c_cotizacion_orden
       WHERE uid_orden = ?`,
      [orderId]
    );

    conn.release();
    res.json({
      success: true,
      header: hdr || { uid_orden: orderId, subtotal: 0, iva: 0, total: 0 },
      machines,
      savedCount: machines.length,
    });
  } catch (e) {
    console.error('Error consultando cotización orden:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST generar mensaje final con IA
router.post('/quotes/order/:orderId/generate-message', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();

    const conn = await db.getConnection();
    const order = await resolveOrder(conn, orderId);
    if (!order) {
      conn.release();
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
      conn.release();
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

    const machineBlocks = machines.map((m, idx) => {
      const key = String(m.uid_herramienta_orden);
      const list = itemsByMachine.get(key) || [];
      const rep = list.length
        ? list.map((x) => `- ${x.nombre} x${x.cantidad} @ $${Number(x.precio || 0).toLocaleString('es-CO')}`).join('\n')
        : '- (Sin repuestos)';
      const title = `${idx + 1}) ${m.her_nombre || 'Máquina'} (${m.her_marca || '-'})${m.her_serial ? ' / ' + m.her_serial : ''}`;
      return `${title}
Mano de obra: $${Number(m.mano_obra || 0).toLocaleString('es-CO')}
Trabajo: ${m.descripcion_trabajo || '(Sin descripción)'}
Repuestos:
${rep}
Subtotal máquina: $${Number(m.subtotal || 0).toLocaleString('es-CO')}`;
    }).join('\n\n');

    const prompt = `Eres un agente especializado en generar cotizaciones para una empresa de reparación de herramientas en Colombia.

INFORMACIÓN DE LA ORDEN:
- Número: #${order.ord_consecutivo}
- Cliente: ${order.cli_razon_social}
- Contacto: ${order.cli_contacto || 'No especificado'}
- Teléfono: ${order.cli_telefono}

COTIZACIÓN (POR MÁQUINA):
${machineBlocks}

RESUMEN:
Subtotal: $${machineSubtotal.toLocaleString('es-CO')}
IVA: No aplica
TOTAL: $${total.toLocaleString('es-CO')}

INSTRUCCIONES:
1) Redacta UN SOLO mensaje de WhatsApp, profesional y cercano.
2) El mensaje DEBE comenzar con una presentación: "Hola, le saluda *Su Herramienta CST*" (o variación natural).
3) Debe incluir TODAS las máquinas (lista corta y clara).
4) Incluye total final SIN IVA.
5) CTA: "¿Autorizas proceder con la reparación de todas las máquinas?"
6) Máximo 650 caracteres (para que quepa bien en WhatsApp).
7) Usa emojis moderadamente (máximo 3).
8) No inventes datos que no estén arriba.

Genera SOLO el mensaje, sin explicaciones adicionales.`;

    const generated = await generateText(prompt, 450);

    await conn.execute(
      `INSERT INTO b2c_cotizacion_orden (uid_orden, subtotal, iva, total, mensaje_whatsapp)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subtotal = VALUES(subtotal),
         iva = VALUES(iva),
         total = VALUES(total),
         mensaje_whatsapp = VALUES(mensaje_whatsapp),
         updated_at = CURRENT_TIMESTAMP`,
      [order.uid_orden, machineSubtotal, iva, total, generated]
    );

    conn.release();
    res.json({ success: true, message: generated, totals: { subtotal: machineSubtotal, iva, total }, machinesCount: machines.length });
  } catch (e) {
    console.error('Error generando mensaje final:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
