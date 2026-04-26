'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../utils/db');
const { requireInterno } = require('../middleware/auth');
const { generateReciboPDF } = require('../utils/pdf-generator');
const log = require('../utils/logger');

router.use(requireInterno);

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

    const [result] = await conn.execute(
      `INSERT INTO b2c_recibo_caja
         (tenant_id, uid_orden, uid_cliente, rc_nombre_paga, rc_consecutivo,
          rc_fecha, rc_concepto, rc_valor, rc_metodo_pago, rc_referencia, rc_creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, uid_orden || null, uid_cliente || null, rc_nombre_paga || null,
       next_consec, rc_fecha, rc_concepto, Number(rc_valor),
       rc_metodo_pago, rc_referencia || null, userId]
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

    const pdf = await generateReciboPDF({ recibo, tenant: req.tenant });
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
