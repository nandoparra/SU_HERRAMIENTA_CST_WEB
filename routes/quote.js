const { getTenantId } = require('../utils/tenant-id');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { requireInterno, requireAdminFuncionario } = require('../middleware/auth');
const log = require('../utils/logger');
const { saveMachineQuote } = require('../services/quote-machine');

// requireInterno permite que técnicos pasen al siguiente router (whatsapp.js);
// las rutas de cotización aplican requireAdminFuncionario inline.
router.use(requireInterno);

// Máximo 60 guardados de cotización por usuario por minuto — bloquea automatización abusiva
const quoteSaveLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  keyGenerator:    (req) => String(req.session?.user?.uid_usuario || req.ip),
  message:         { success: false, error: 'Demasiadas cotizaciones en poco tiempo. Espere un momento.' },
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { keyGeneratorIpFallback: false },
});

// Catálogo de repuestos
router.get('/quote/catalog', requireAdminFuncionario, async (req, res) => {
  try {
    const type = req.query.type || 'R';
    const tenantId = getTenantId(req);
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
    log.error({ err: e }, 'Error cargando catálogo:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET cotización de una máquina
router.get('/quotes/machine', requireAdminFuncionario, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    const equipmentOrderId = String(req.query.equipmentOrderId || '').trim();
    if (!orderId || !equipmentOrderId)
      return res.status(400).json({ error: 'orderId y equipmentOrderId son requeridos' });

    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[machineInOrder]] = await conn.execute(
        `SELECT uid_herramienta_orden FROM b2c_herramienta_orden
         WHERE uid_herramienta_orden = ? AND uid_orden = ? AND tenant_id = ?`,
        [equipmentOrderId, orderId, tenantId]
      );
      if (!machineInOrder) return res.status(403).json({ error: 'Máquina no pertenece a esta orden' });

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
    log.error({ err: e }, 'Error consultando cotización máquina:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST guardar cotización de una máquina
router.post('/quotes/machine', requireAdminFuncionario, quoteSaveLimiter, async (req, res) => {
  const { orderId, equipmentOrderId, technicianId, laborCost, workDescription, items } = req.body;

  if (!orderId || !equipmentOrderId)
    return res.status(400).json({ success: false, error: 'orderId y equipmentOrderId son requeridos' });
  if (!Array.isArray(items))
    return res.status(400).json({ success: false, error: 'items debe ser un arreglo' });

  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const result = await saveMachineQuote(
      { orderId, equipmentOrderId, technicianId, laborCost, workDescription, items },
      { conn, tenantId }
    );
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ success: false, error: e.message });
    log.error({ err: e }, 'Error guardando cotización máquina:');
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// GET cotización completa de la orden
router.get('/quotes/order/:orderId', requireAdminFuncionario, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const tenantId = getTenantId(req);
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
    log.error({ err: e }, 'Error consultando cotización orden:');
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST generar mensaje final con IA
router.post('/quotes/order/:orderId/generate-message', requireAdminFuncionario, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();

    const tenantId = getTenantId(req);
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
    log.error({ err: e }, 'Error generando mensaje final:');
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
