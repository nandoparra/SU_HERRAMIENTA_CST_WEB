'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../utils/db');
const { requireInterno } = require('../middleware/auth');
const { generateReciboPDF } = require('../utils/pdf-generator');
const log = require('../utils/logger');

router.use(requireInterno);

// ─── GET /api/recibos/cotizacion-orden/:uidOrden — datos de cotización para modal ──
// Debe ir ANTES de /recibos/:id para que Express no confunda la ruta
router.get('/recibos/cotizacion-orden/:uidOrden', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [machines] = await conn.execute(
      `SELECT cm.uid_herramienta_orden, cm.mano_obra, cm.subtotal,
              cm.descripcion_trabajo,
              h.her_nombre, h.her_marca, h.her_serial
       FROM b2c_cotizacion_maquina cm
       LEFT JOIN b2c_herramienta_orden ho
             ON CAST(ho.uid_herramienta_orden AS CHAR) = CAST(cm.uid_herramienta_orden AS CHAR)
       LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE cm.uid_orden = ? AND cm.tenant_id = ?
       ORDER BY cm.uid_herramienta_orden`,
      [req.params.uidOrden, tenantId]
    );
    const [items] = await conn.execute(
      `SELECT uid_herramienta_orden, nombre, cantidad, precio, subtotal
       FROM b2c_cotizacion_item
       WHERE uid_orden = ?
       ORDER BY uid_herramienta_orden, id`,
      [req.params.uidOrden]
    );
    res.json({ machines, items, hasCotizacion: machines.length > 0 });
  } catch (e) {
    log.error({ err: e }, 'Error obteniendo cotización de orden');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/recibos — lista con filtros opcionales ─────────────────────────
router.get('/recibos', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const { estado, fecha_desde, fecha_hasta, uid_cliente, uid_orden } = req.query;

  let where = 'WHERE r.tenant_id = ?';
  const params = [tenantId];

  if (estado)       { where += ' AND r.rc_estado = ?';      params.push(estado); }
  if (fecha_desde)  { where += ' AND r.rc_fecha >= ?';      params.push(fecha_desde); }
  if (fecha_hasta)  { where += ' AND r.rc_fecha <= ?';      params.push(fecha_hasta); }
  if (uid_cliente)  { where += ' AND r.uid_cliente = ?';    params.push(uid_cliente); }
  if (uid_orden)    { where += ' AND r.uid_orden = ?';      params.push(uid_orden); }

  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT r.*,
              c.cli_razon_social, c.cli_contacto,
              o.ord_consecutivo,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_recibo_caja r
       LEFT JOIN b2c_cliente c ON c.uid_cliente = r.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = r.uid_orden
       LEFT JOIN b2c_usuario u ON u.uid_usuario = r.rc_creado_por
       ${where}
       ORDER BY r.rc_consecutivo DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    log.error({ err: e }, 'Error listando recibos');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/recibos — crear recibo ────────────────────────────────────────
router.post('/recibos', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const userId   = req.session?.user?.id ?? null;
  const {
    uid_orden, uid_cliente, rc_nombre_paga,
    rc_fecha, rc_concepto, rc_valor,
    rc_metodo_pago = 'efectivo', rc_referencia,
    rc_items,
  } = req.body;

  if (!rc_fecha)    return res.status(400).json({ error: 'rc_fecha es requerido' });
  if (!rc_concepto) return res.status(400).json({ error: 'rc_concepto es requerido' });
  if (!rc_valor || isNaN(Number(rc_valor)) || Number(rc_valor) <= 0)
    return res.status(400).json({ error: 'rc_valor debe ser un número positivo' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Consecutivo por tenant (dentro de la transacción para evitar colisiones)
    const [[{ next_consec }]] = await conn.execute(
      `SELECT COALESCE(MAX(rc_consecutivo), 0) + 1 AS next_consec
       FROM b2c_recibo_caja WHERE tenant_id = ?`,
      [tenantId]
    );

    const itemsJson = (Array.isArray(rc_items) && rc_items.length)
      ? JSON.stringify(rc_items) : null;

    const [result] = await conn.execute(
      `INSERT INTO b2c_recibo_caja
         (tenant_id, uid_orden, uid_cliente, rc_nombre_paga, rc_consecutivo,
          rc_fecha, rc_concepto, rc_valor, rc_metodo_pago, rc_referencia, rc_creado_por,
          rc_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, uid_orden || null, uid_cliente || null, rc_nombre_paga || null,
       next_consec, rc_fecha, rc_concepto, Number(rc_valor),
       rc_metodo_pago, rc_referencia || null, userId, itemsJson]
    );

    await conn.commit();
    res.status(201).json({ uid_recibo: result.insertId, rc_consecutivo: next_consec });
  } catch (e) {
    await conn.rollback();
    log.error({ err: e }, 'Error creando recibo');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/recibos/:id — detalle ──────────────────────────────────────────
router.get('/recibos/:id', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.execute(
      `SELECT r.*,
              c.cli_razon_social, c.cli_contacto, c.cli_direccion, c.cli_telefono,
              o.ord_consecutivo,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_recibo_caja r
       LEFT JOIN b2c_cliente c ON c.uid_cliente = r.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = r.uid_orden
       LEFT JOIN b2c_usuario u ON u.uid_usuario = r.rc_creado_por
       WHERE r.uid_recibo = ? AND r.tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!row) return res.status(404).json({ error: 'Recibo no encontrado' });
    res.json(row);
  } catch (e) {
    log.error({ err: e }, 'Error obteniendo recibo');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── PATCH /api/recibos/:id/anular ───────────────────────────────────────────
router.patch('/recibos/:id/anular', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.execute(
      `SELECT uid_recibo, rc_estado FROM b2c_recibo_caja WHERE uid_recibo = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!row) return res.status(404).json({ error: 'Recibo no encontrado' });
    if (row.rc_estado === 'anulado') return res.status(409).json({ error: 'El recibo ya está anulado' });

    await conn.execute(
      `UPDATE b2c_recibo_caja SET rc_estado = 'anulado' WHERE uid_recibo = ?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, 'Error anulando recibo');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/recibos/:id/pdf ─────────────────────────────────────────────────
router.get('/recibos/:id/pdf', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [[recibo]] = await conn.execute(
      `SELECT r.*,
              c.cli_razon_social, c.cli_contacto, c.cli_direccion, c.cli_telefono,
              o.ord_consecutivo
       FROM b2c_recibo_caja r
       LEFT JOIN b2c_cliente c ON c.uid_cliente = r.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = r.uid_orden
       WHERE r.uid_recibo = ? AND r.tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!recibo) return res.status(404).json({ error: 'Recibo no encontrado' });

    // Si hay orden vinculada, intentar traer la cotización para el PDF
    let cotizacion = null;
    if (recibo.uid_orden) {
      const [machines] = await conn.execute(
        `SELECT cm.uid_herramienta_orden, cm.mano_obra, cm.subtotal,
                cm.descripcion_trabajo,
                h.her_nombre, h.her_marca, h.her_serial
         FROM b2c_cotizacion_maquina cm
         LEFT JOIN b2c_herramienta_orden ho
               ON CAST(ho.uid_herramienta_orden AS CHAR) = CAST(cm.uid_herramienta_orden AS CHAR)
         LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         WHERE cm.uid_orden = ?
         ORDER BY cm.uid_herramienta_orden`,
        [recibo.uid_orden]
      );
      const [items] = await conn.execute(
        `SELECT uid_herramienta_orden, nombre, cantidad, precio, subtotal
         FROM b2c_cotizacion_item WHERE uid_orden = ?
         ORDER BY uid_herramienta_orden, id`,
        [recibo.uid_orden]
      );
      if (machines.length) cotizacion = { machines, items };
    }

    const pdf = await generateReciboPDF({ recibo, tenant: req.tenant, cotizacion });
    const fname = `recibo-${recibo.rc_consecutivo}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` });
    res.send(pdf);
  } catch (e) {
    log.error({ err: e }, 'Error generando PDF recibo');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

module.exports = router;
