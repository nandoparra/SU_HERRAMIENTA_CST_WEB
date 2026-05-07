'use strict';
const express    = require('express');
const router     = express.Router();
const db         = require('../utils/db');
const { requireInterno } = require('../middleware/auth');
const { logAudit }       = require('../utils/audit');
const { calcularRentabilidad, generarSugerencias } = require('../services/financiero');
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

// ─── GET /api/ventas — lista con filtros ──────────────────────────────────────
router.get('/ventas', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
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
  const tenantId = req.tenant?.uid_tenant ?? 1;
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

module.exports = router;
