'use strict';
const { getTenantId } = require('../utils/tenant-id');
const express    = require('express');
const router     = express.Router();
const db         = require('../utils/db');
const { requireInterno } = require('../middleware/auth');
const { logAudit }       = require('../utils/audit');
const { calcularRentabilidad, generarSugerencias } = require('../services/financiero');
const { generateVentaPDF } = require('../utils/pdf-generator');
const log = require('../utils/logger');

router.use(requireInterno);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getConfigActiva(conn, tenantId) {
  const [[cfg]] = await conn.execute(
    `SELECT * FROM b2c_config_financiera
     WHERE tenant_id = ? AND cf_vigente_hasta IS NULL
     ORDER BY cf_vigente_desde DESC LIMIT 1`,
    [tenantId]
  );
  return cfg || null;
}

/** Calcula vi_subtotal y vi_total para cada ítem según IVA del tenant */
function calcularItem(item, ivaResponsable) {
  const precio    = Number(item.vi_precio_unitario) || 0;
  const cantidad  = Number(item.vi_cantidad)        || 1;
  const descPct   = Number(item.vi_descuento_pct)   || 0;
  const ivaPct    = ivaResponsable ? (Number(item.vi_iva_pct) || 0) : 0;

  const subtotal       = precio * cantidad;
  const baseDescontada = subtotal * (1 - descPct / 100);
  const total          = baseDescontada * (1 + ivaPct / 100);

  return {
    ...item,
    vi_precio_unitario: precio,
    vi_cantidad:        cantidad,
    vi_descuento_pct:   descPct,
    vi_iva_pct:         ivaPct,
    vi_subtotal:        Math.round(subtotal   * 100) / 100,
    vi_total:           Math.round(total      * 100) / 100,
  };
}

/** Agrega totales de cabecera a partir de ítems ya calculados */
function calcularTotalesCabecera(itemsCalc) {
  let subtotal  = 0, descuento = 0, iva = 0, total = 0;
  for (const i of itemsCalc) {
    subtotal  += i.vi_subtotal;
    descuento += i.vi_subtotal * (i.vi_descuento_pct / 100);
    const base = i.vi_subtotal * (1 - i.vi_descuento_pct / 100);
    iva       += base * (i.vi_iva_pct / 100);
    total     += i.vi_total;
  }
  return {
    ven_subtotal:  Math.round(subtotal  * 100) / 100,
    ven_descuento: Math.round(descuento * 100) / 100,
    ven_iva:       Math.round(iva       * 100) / 100,
    ven_total:     Math.round(total     * 100) / 100,
  };
}

// ─── GET /api/ventas/caja-dia — resumen de hoy ───────────────────────────────
router.get('/ventas/caja-dia', async (req, res) => {
  const tenantId = getTenantId(req);
  const hoy = new Date().toISOString().slice(0, 10);
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT ven_metodo_pago, COUNT(*) AS cantidad, SUM(ven_total) AS total
       FROM b2c_venta
       WHERE tenant_id = ? AND ven_fecha = ? AND ven_estado != 'anulada'
       GROUP BY ven_metodo_pago`,
      [tenantId, hoy]
    );
    const totalDia    = rows.reduce((s, r) => s + Number(r.total), 0);
    const cantidadDia = rows.reduce((s, r) => s + Number(r.cantidad), 0);
    res.json({ fecha: hoy, total: Math.round(totalDia * 100) / 100, cantidad: cantidadDia, desglose: rows });
  } catch (e) {
    log.error({ err: e }, 'Error caja-dia');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/ventas — lista con filtros ──────────────────────────────────────
router.get('/ventas', async (req, res) => {
  const tenantId = getTenantId(req);
  const { estado, fecha_desde, fecha_hasta, uid_cliente, uid_orden, page = 1 } = req.query;
  const limit  = 50;
  const offset = (Math.max(1, parseInt(page) || 1) - 1) * limit;

  let where  = 'WHERE v.tenant_id = ?';
  const params = [tenantId];

  if (estado)      { where += ' AND v.ven_estado = ?';     params.push(estado); }
  if (fecha_desde) { where += ' AND v.ven_fecha >= ?';     params.push(fecha_desde); }
  if (fecha_hasta) { where += ' AND v.ven_fecha <= ?';     params.push(fecha_hasta); }
  if (uid_cliente) { where += ' AND v.uid_cliente = ?';    params.push(uid_cliente); }
  if (uid_orden)   { where += ' AND v.uid_orden = ?';      params.push(uid_orden); }

  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT v.uid_venta, v.ven_consecutivo, v.ven_fecha, v.ven_estado,
              v.ven_total, v.ven_metodo_pago, v.ven_utilidad_total,
              v.ven_es_rentable, v.created_at,
              c.cli_razon_social, c.cli_contacto,
              o.ord_consecutivo,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_venta v
       LEFT JOIN b2c_cliente c ON c.uid_cliente = v.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = v.uid_orden
       LEFT JOIN b2c_usuario u ON u.uid_usuario = v.ven_creado_por
       ${where}
       ORDER BY v.ven_consecutivo DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json(rows);
  } catch (e) {
    log.error({ err: e }, 'Error listando ventas');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/ventas/:id — detalle completo ───────────────────────────────────
router.get('/ventas/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  const isAdmin  = req.session?.user?.tipo === 'A';
  const conn = await db.getConnection();
  try {
    const [[venta]] = await conn.execute(
      `SELECT v.*,
              c.cli_razon_social, c.cli_contacto, c.cli_identificacion,
              c.cli_direccion, c.cli_telefono,
              o.ord_consecutivo,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_venta v
       LEFT JOIN b2c_cliente c ON c.uid_cliente = v.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = v.uid_orden
       LEFT JOIN b2c_usuario u ON u.uid_usuario = v.ven_creado_por
       WHERE v.uid_venta = ? AND v.tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const [items] = await conn.execute(
      `SELECT * FROM b2c_venta_item WHERE uid_venta = ? ORDER BY uid_item`,
      [venta.uid_venta]
    );

    const result = { ...venta, items };

    // Panel financiero solo para admin
    if (isAdmin) {
      const cfg = await getConfigActiva(conn, tenantId);
      const rentabilidad = calcularRentabilidad({
        manoObra: venta.ven_mano_obra,
        items,
        configFinanciera: cfg,
      });
      const sugerencias = generarSugerencias({ resultado: rentabilidad, config: cfg });
      result.financiero  = rentabilidad;
      result.sugerencias = sugerencias;
      result.config      = cfg;
    }

    res.json(result);
  } catch (e) {
    log.error({ err: e }, 'Error obteniendo venta');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

/**
 * Lógica compartida de creación de venta — usada por POST /ventas y POST /ventas/desde-orden.
 * Requiere conexión con transacción ya iniciada por el caller.
 * @returns {{ uid_venta, ven_consecutivo }}
 */
async function crearVentaInterna(conn, { tenantId, userId, ivaResp, body }) {
  const {
    uid_cliente, uid_orden,
    ven_fecha, ven_metodo_pago = 'efectivo',
    ven_referencia, ven_notas,
    items = [],
  } = body;

  const [[{ next_consec }]] = await conn.execute(
    `SELECT COALESCE(MAX(ven_consecutivo), 0) + 1 AS next_consec
     FROM b2c_venta WHERE tenant_id = ?`,
    [tenantId]
  );

  const itemsCalc    = items.map(i => calcularItem(i, ivaResp));
  const totales      = calcularTotalesCabecera(itemsCalc);
  const cfg          = await getConfigActiva(conn, tenantId);
  const rentabilidad = calcularRentabilidad({ items: itemsCalc, configFinanciera: cfg });

  const [result] = await conn.execute(
    `INSERT INTO b2c_venta
       (tenant_id, uid_orden, uid_cliente, ven_consecutivo, ven_fecha,
        ven_subtotal, ven_descuento, ven_iva, ven_total,
        ven_metodo_pago, ven_referencia, ven_notas,
        ven_mano_obra, ven_costo_repuestos, ven_utilidad_repuestos,
        ven_margen_repuestos, ven_utilidad_total, ven_margen_total,
        ven_es_rentable, ven_utilidad_objetivo, ven_diferencia_utilidad,
        ven_creado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      tenantId, uid_orden || null, uid_cliente || null, next_consec, ven_fecha,
      totales.ven_subtotal, totales.ven_descuento, totales.ven_iva, totales.ven_total,
      ven_metodo_pago, ven_referencia || null, ven_notas || null,
      rentabilidad.ven_mano_obra, rentabilidad.ven_costo_repuestos,
      rentabilidad.ven_utilidad_repuestos, rentabilidad.ven_margen_repuestos,
      rentabilidad.ven_utilidad_total, rentabilidad.ven_margen_total,
      rentabilidad.ven_es_rentable, rentabilidad.ven_utilidad_objetivo,
      rentabilidad.ven_diferencia_utilidad, userId,
    ]
  );
  const uid_venta = result.insertId;

  for (const i of itemsCalc) {
    await conn.execute(
      `INSERT INTO b2c_venta_item
         (uid_venta, tenant_id, vi_descripcion, vi_tipo, vi_cantidad,
          vi_precio_unitario, vi_costo_unitario, vi_descuento_pct,
          vi_iva_pct, vi_subtotal, vi_total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uid_venta, tenantId,
        i.vi_descripcion, i.vi_tipo || 'repuesto', i.vi_cantidad,
        i.vi_precio_unitario, Number(i.vi_costo_unitario) || 0,
        i.vi_descuento_pct, i.vi_iva_pct, i.vi_subtotal, i.vi_total,
      ]
    );
  }

  return { uid_venta, ven_consecutivo: next_consec, ven_total: totales.ven_total };
}

// ─── POST /api/ventas — crear venta ──────────────────────────────────────────
router.post('/ventas', async (req, res) => {
  const tenantId = getTenantId(req);
  const userId   = req.session?.user?.id ?? null;
  const ivaResp  = !!(req.tenant?.ten_iva_responsable);
  const { ven_fecha, items = [] } = req.body;

  if (!ven_fecha) return res.status(400).json({ error: 'ven_fecha es requerido' });
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Se requiere al menos un ítem' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { uid_venta, ven_consecutivo, ven_total } = await crearVentaInterna(
      conn, { tenantId, userId, ivaResp, body: req.body }
    );
    await conn.commit();
    await logAudit(req, 'venta_creada', 'b2c_venta', String(uid_venta), {
      ven_consecutivo, ven_total,
    });
    res.status(201).json({ uid_venta, ven_consecutivo });
  } catch (e) {
    await conn.rollback();
    log.error({ err: e }, 'Error creando venta');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── PATCH /api/ventas/:id/pagar ─────────────────────────────────────────────
router.patch('/ventas/:id/pagar', async (req, res) => {
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.execute(
      `SELECT uid_venta, ven_estado FROM b2c_venta WHERE uid_venta = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!row) return res.status(404).json({ error: 'Venta no encontrada' });
    if (row.ven_estado === 'pagada')  return res.status(409).json({ error: 'La venta ya está pagada' });
    if (row.ven_estado === 'anulada') return res.status(409).json({ error: 'No se puede pagar una venta anulada' });

    await conn.execute(
      `UPDATE b2c_venta SET ven_estado = 'pagada' WHERE uid_venta = ?`,
      [req.params.id]
    );
    await logAudit(req, 'venta_pagada', 'b2c_venta', req.params.id, {});
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, 'Error marcando venta como pagada');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── PATCH /api/ventas/:id/anular ────────────────────────────────────────────
router.patch('/ventas/:id/anular', async (req, res) => {
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.execute(
      `SELECT uid_venta, ven_estado FROM b2c_venta WHERE uid_venta = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!row) return res.status(404).json({ error: 'Venta no encontrada' });
    if (row.ven_estado === 'anulada') return res.status(409).json({ error: 'La venta ya está anulada' });

    await conn.execute(
      `UPDATE b2c_venta SET ven_estado = 'anulada' WHERE uid_venta = ?`,
      [req.params.id]
    );
    await logAudit(req, 'venta_anulada', 'b2c_venta', req.params.id, {});
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, 'Error anulando venta');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/ventas/desde-orden/:orderId ────────────────────────────────────
// Pre-carga ítems desde la cotización aprobada y crea la venta en una transacción.
router.post('/ventas/desde-orden/:orderId', async (req, res) => {
  const tenantId = getTenantId(req);
  const userId   = req.session?.user?.id ?? null;
  const ivaResp  = !!(req.tenant?.ten_iva_responsable);
  const conn = await db.getConnection();
  try {
    const [[orden]] = await conn.execute(
      `SELECT uid_orden, ord_consecutivo, uid_cliente
       FROM b2c_orden WHERE uid_orden = ? AND tenant_id = ?`,
      [req.params.orderId, tenantId]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const [machines] = await conn.execute(
      `SELECT cm.uid_herramienta_orden, cm.mano_obra,
              h.her_nombre, h.her_marca
       FROM b2c_cotizacion_maquina cm
       LEFT JOIN b2c_herramienta_orden ho ON ho.uid_herramienta_orden = cm.uid_herramienta_orden
       LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE cm.uid_orden = ?
       ORDER BY cm.uid_herramienta_orden`,
      [orden.uid_orden]
    );
    if (!machines.length)
      return res.status(422).json({ error: 'La orden no tiene cotización registrada' });

    const [cotItems] = await conn.execute(
      `SELECT uid_herramienta_orden, nombre, cantidad, precio
       FROM b2c_cotizacion_item WHERE uid_orden = ?
       ORDER BY uid_herramienta_orden, id`,
      [orden.uid_orden]
    );

    const items = [];
    for (const m of machines) {
      const label = [m.her_nombre, m.her_marca].filter(Boolean).join(' ');
      if (Number(m.mano_obra) > 0) {
        items.push({
          vi_descripcion:     `Mano de obra — ${label}`,
          vi_tipo:            'mano_obra',
          vi_cantidad:        1,
          vi_precio_unitario: Number(m.mano_obra),
          vi_costo_unitario:  0,
          vi_descuento_pct:   0,
          vi_iva_pct:         0,
        });
      }
      for (const it of cotItems.filter(i => String(i.uid_herramienta_orden) === String(m.uid_herramienta_orden))) {
        items.push({
          vi_descripcion:     it.nombre,
          vi_tipo:            'repuesto',
          vi_cantidad:        Number(it.cantidad),
          vi_precio_unitario: Number(it.precio),
          vi_costo_unitario:  0,
          vi_descuento_pct:   0,
          vi_iva_pct:         0,
        });
      }
    }

    const body = {
      uid_orden:       orden.uid_orden,
      uid_cliente:     orden.uid_cliente,
      ven_fecha:       new Date().toISOString().slice(0, 10),
      ven_metodo_pago: req.body?.ven_metodo_pago || 'efectivo',
      ven_notas:       `Generada desde orden #${orden.ord_consecutivo}`,
      items,
    };

    await conn.beginTransaction();
    const { uid_venta, ven_consecutivo, ven_total } = await crearVentaInterna(
      conn, { tenantId, userId, ivaResp, body }
    );
    await conn.commit();
    await logAudit(req, 'venta_creada', 'b2c_venta', String(uid_venta), {
      ven_consecutivo, ven_total, desde_orden: orden.uid_orden,
    });
    res.status(201).json({ uid_venta, ven_consecutivo });
  } catch (e) {
    await conn.rollback().catch(() => {});
    log.error({ err: e }, 'Error creando venta desde orden');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/ventas/:id/pdf ──────────────────────────────────────────────────
router.get('/ventas/:id/pdf', async (req, res) => {
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const [[venta]] = await conn.execute(
      `SELECT v.*,
              c.cli_razon_social, c.cli_contacto, c.cli_identificacion,
              o.ord_consecutivo,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_venta v
       LEFT JOIN b2c_cliente c ON c.uid_cliente = v.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = v.uid_orden
       LEFT JOIN b2c_usuario u ON u.uid_usuario = v.ven_creado_por
       WHERE v.uid_venta = ? AND v.tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const [items] = await conn.execute(
      `SELECT * FROM b2c_venta_item WHERE uid_venta = ? ORDER BY uid_item`,
      [venta.uid_venta]
    );

    const pdf = await generateVentaPDF({ venta, items, tenant: req.tenant });
    const filename = `venta-${venta.ven_consecutivo}.pdf`;
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length':      pdf.length,
    });
    res.send(pdf);
  } catch (e) {
    log.error({ err: e }, 'Error generando PDF de venta');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/ventas/:id/print — ticket HTML con auto-print ──────────────────
router.get('/ventas/:id/print', async (req, res) => {
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const [[venta]] = await conn.execute(
      `SELECT v.*,
              c.cli_razon_social, c.cli_contacto, c.cli_identificacion,
              o.ord_consecutivo,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_venta v
       LEFT JOIN b2c_cliente c ON c.uid_cliente = v.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = v.uid_orden
       LEFT JOIN b2c_usuario u ON u.uid_usuario = v.ven_creado_por
       WHERE v.uid_venta = ? AND v.tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!venta) return res.status(404).send('Venta no encontrada');

    const [items] = await conn.execute(
      `SELECT * FROM b2c_venta_item WHERE uid_venta = ? ORDER BY uid_item`,
      [venta.uid_venta]
    );

    const money = n => '$' + Math.round(Number(n)).toLocaleString('es-CO');
    const cliente = venta.cli_razon_social || venta.cli_contacto || 'Mostrador';
    const metodos = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', cheque:'Cheque', otro:'Otro' };
    const itemsHtml = items.map(it => `
      <tr>
        <td style="padding:3px 0;font-size:12px;">${it.vi_descripcion || ''}</td>
        <td style="padding:3px 4px;text-align:center;font-size:12px;">${it.vi_cantidad}</td>
        <td style="padding:3px 0;text-align:right;font-size:12px;">${money(it.vi_total)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Ticket #${venta.ven_consecutivo}</title>
  <style>
    @media print { body { margin:0; } .no-print { display:none; } }
    body { font-family: 'Courier New', monospace; max-width:300px; margin:0 auto; padding:12px; color:#111; }
    h2 { text-align:center; font-size:15px; margin:0 0 2px; }
    .sub { text-align:center; font-size:11px; color:#555; margin:0 0 10px; }
    .sep { border:none; border-top:1px dashed #999; margin:8px 0; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:11px; text-align:left; border-bottom:1px solid #ccc; padding-bottom:3px; }
    .total-row td { font-size:14px; font-weight:700; padding-top:6px; }
    .footer { text-align:center; font-size:10px; color:#888; margin-top:12px; }
  </style>
</head>
<body>
  <h2>SU HERRAMIENTA CST</h2>
  <div class="sub">NIT 9862087-1 · Pereira</div>
  <hr class="sep">
  <div style="font-size:12px;"><strong>Ticket #${venta.ven_consecutivo}</strong></div>
  <div style="font-size:11px;color:#555;">${new Date(venta.ven_fecha).toLocaleDateString('es-CO',{timeZone:'America/Bogota'})}</div>
  <div style="font-size:11px;color:#555;">Cliente: ${cliente}</div>
  ${venta.ord_consecutivo ? `<div style="font-size:11px;color:#555;">Orden #${venta.ord_consecutivo}</div>` : ''}
  <div style="font-size:11px;color:#555;">Pago: ${metodos[venta.ven_metodo_pago] || venta.ven_metodo_pago}</div>
  <hr class="sep">
  <table>
    <thead><tr>
      <th>Descripción</th>
      <th style="text-align:center;width:30px;">Cant</th>
      <th style="text-align:right;width:70px;">Total</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
    <tfoot>
      <tr><td colspan="3"><hr class="sep" style="margin:4px 0;"></td></tr>
      ${venta.ven_iva > 0 ? `<tr><td>IVA</td><td></td><td style="text-align:right;font-size:12px;">${money(venta.ven_iva)}</td></tr>` : ''}
      <tr class="total-row"><td>TOTAL</td><td></td><td style="text-align:right;">${money(venta.ven_total)}</td></tr>
    </tfoot>
  </table>
  <div class="footer">¡Gracias por su preferencia!<br>www.suherramienta.com</div>
  <div class="no-print" style="text-align:center;margin-top:16px;">
    <button onclick="window.print()" style="padding:8px 20px;font-size:14px;cursor:pointer;">🖨️ Imprimir</button>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    log.error({ err: e }, 'Error generando ticket de venta');
    res.status(500).send('Error interno del servidor');
  } finally {
    conn.release();
  }
});

module.exports = router;
