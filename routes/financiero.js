'use strict';
const { getTenantId } = require('../utils/tenant-id');
const express  = require('express');
const router   = express.Router();
const db       = require('../utils/db');
const { requireInterno } = require('../middleware/auth');
const { logAudit }       = require('../utils/audit');
const { calcularDashboardMensual, calcularRentabilidad, generarSugerencias } = require('../services/financiero');
const log = require('../utils/logger');

router.use(requireInterno);

// ── Helpers ──────────────────────────────────────────────────────────────────
function isAdmin(req) { return req.session?.user?.tipo === 'A'; }

async function getConfigActiva(conn, tenantId) {
  const [[cfg]] = await conn.execute(
    `SELECT * FROM b2c_config_financiera
     WHERE tenant_id = ? AND cf_vigente_hasta IS NULL
     ORDER BY cf_vigente_desde DESC LIMIT 1`,
    [tenantId]
  );
  return cfg || null;
}

// ─── 1. GET /api/financiero/config ─────────────────────────────────────────
router.get('/financiero/config', async (req, res) => {
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const cfg = await getConfigActiva(conn, tenantId);
    if (!cfg) return res.status(404).json({ error: 'Sin configuración financiera activa' });
    res.json(cfg);
  } catch (e) {
    log.error({ err: e }, 'Error obteniendo config financiera');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── 2. PUT /api/financiero/config ─────────────────────────────────────────
// Crea nueva versión cerrando la anterior. Solo admin.
router.put('/financiero/config', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
  const tenantId = getTenantId(req);
  const {
    cf_utilidad_objetivo_min, cf_utilidad_objetivo_opt,
    cf_margen_objetivo_rep, cf_meta_total_mes,
    cf_arriendo = 0, cf_energia = 0, cf_agua = 0, cf_internet = 0, cf_telefono = 0,
    cf_salarios = 0, cf_seguridad_social = 0, cf_parafiscales = 0,
    cf_mantenimiento = 0, cf_otros = 0, cf_descripcion_otros = null,
    cf_meta_ahorro_mes = 2500000, cf_mano_obra_base = 35000,
  } = req.body;

  if (cf_utilidad_objetivo_min == null || cf_meta_total_mes == null)
    return res.status(400).json({ error: 'cf_utilidad_objetivo_min y cf_meta_total_mes son requeridos' });

  const totalFijos = [cf_arriendo, cf_energia, cf_agua, cf_internet, cf_telefono,
    cf_salarios, cf_seguridad_social, cf_parafiscales, cf_mantenimiento, cf_otros]
    .reduce((s, v) => s + Number(v || 0), 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE b2c_config_financiera
       SET cf_vigente_hasta = NOW()
       WHERE tenant_id = ? AND cf_vigente_hasta IS NULL`,
      [tenantId]
    );

    const [result] = await conn.execute(
      `INSERT INTO b2c_config_financiera
         (tenant_id,
          cf_arriendo, cf_energia, cf_agua, cf_internet, cf_telefono,
          cf_salarios, cf_seguridad_social, cf_parafiscales, cf_mantenimiento, cf_otros,
          cf_descripcion_otros, cf_total_costos_fijos,
          cf_meta_ahorro_mes, cf_meta_total_mes, cf_mano_obra_base,
          cf_margen_objetivo_rep, cf_utilidad_objetivo_min, cf_utilidad_objetivo_opt,
          cf_vigente_desde, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
      [
        tenantId,
        Number(cf_arriendo),        Number(cf_energia),          Number(cf_agua),
        Number(cf_internet),        Number(cf_telefono),
        Number(cf_salarios),        Number(cf_seguridad_social), Number(cf_parafiscales),
        Number(cf_mantenimiento),   Number(cf_otros),
        cf_descripcion_otros || null,
        totalFijos,
        Number(cf_meta_ahorro_mes), Number(cf_meta_total_mes),   Number(cf_mano_obra_base),
        Number(cf_margen_objetivo_rep ?? 0.5),
        Number(cf_utilidad_objetivo_min),
        Number(cf_utilidad_objetivo_opt ?? cf_utilidad_objetivo_min),
        req.session?.user?.id || null,
      ]
    );

    await conn.commit();
    await logAudit(req, 'config_financiera_actualizada', 'b2c_config_financiera',
      String(result.insertId), { cf_utilidad_objetivo_min, cf_meta_total_mes, cf_total_costos_fijos: totalFijos });
    res.status(201).json({ uid_config: result.insertId });
  } catch (e) {
    await conn.rollback();
    log.error({ err: e }, 'Error actualizando config financiera');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── 3. GET /api/financiero/config/historial ───────────────────────────────
// Solo admin.
router.get('/financiero/config/historial', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT * FROM b2c_config_financiera
       WHERE tenant_id = ?
       ORDER BY cf_vigente_desde DESC, uid_config DESC`,
      [tenantId]
    );
    res.json(rows);
  } catch (e) {
    log.error({ err: e }, 'Error obteniendo historial config financiera');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── 4. GET /api/financiero/dashboard?mes=YYYY-MM ──────────────────────────
router.get('/financiero/dashboard', async (req, res) => {
  const tenantId = getTenantId(req);
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes) || Number(mes.slice(5)) < 1 || Number(mes.slice(5)) > 12)
    return res.status(400).json({ error: 'mes debe tener formato YYYY-MM' });

  const conn = await db.getConnection();
  try {
    const kpis = await calcularDashboardMensual({ tenantId, mes, conn });
    res.json({ mes, ...kpis });
  } catch (e) {
    log.error({ err: e }, 'Error calculando dashboard financiero');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── 5. GET /api/financiero/ventas?mes=YYYY-MM ─────────────────────────────
// Lista ventas del mes con indicadores de rentabilidad. Solo admin.
router.get('/financiero/ventas', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
  const tenantId = getTenantId(req);
  const mes      = req.query.mes || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes) || Number(mes.slice(5)) < 1 || Number(mes.slice(5)) > 12)
    return res.status(400).json({ error: 'mes debe tener formato YYYY-MM' });

  const fechaInicio = `${mes}-01`;
  const conn = await db.getConnection();
  try {
    const [ventas] = await conn.execute(
      `SELECT v.uid_venta, v.ven_consecutivo, v.ven_fecha, v.ven_estado,
              v.ven_total, v.ven_mano_obra, v.ven_costo_repuestos,
              v.ven_utilidad_total, v.ven_utilidad_objetivo, v.ven_diferencia_utilidad,
              v.ven_margen_repuestos, v.ven_margen_total, v.ven_es_rentable,
              v.ven_metodo_pago,
              c.cli_razon_social, c.cli_contacto,
              o.ord_consecutivo
       FROM b2c_venta v
       LEFT JOIN b2c_cliente c ON c.uid_cliente = v.uid_cliente
       LEFT JOIN b2c_orden   o ON o.uid_orden   = v.uid_orden
       WHERE v.tenant_id = ?
         AND v.ven_fecha >= ?
         AND v.ven_fecha <= LAST_DAY(?)
         AND v.ven_estado != 'anulada'
       ORDER BY v.ven_fecha ASC, v.ven_consecutivo ASC`,
      [tenantId, fechaInicio, fechaInicio]
    );

    const cfg = await getConfigActiva(conn, tenantId);

    const rows = ventas.map(v => ({
      ...v,
      ven_es_rentable:         Number(v.ven_es_rentable) === 1,
      ven_utilidad_total:      Number(v.ven_utilidad_total),
      ven_utilidad_objetivo:   Number(v.ven_utilidad_objetivo),
      ven_diferencia_utilidad: Number(v.ven_diferencia_utilidad),
      ven_margen_repuestos:    Number(v.ven_margen_repuestos),
      ven_margen_total:        Number(v.ven_margen_total),
      cliente: v.cli_razon_social || v.cli_contacto || null,
    }));

    res.json({ mes, config: cfg, ventas: rows });
  } catch (e) {
    log.error({ err: e }, 'Error listando ventas financiero');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── 6. GET /api/financiero/ventas/:id/sugerencias ─────────────────────────
// Sugerencias de precio para ventas no rentables. Solo admin.
router.get('/financiero/ventas/:id/sugerencias', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo administradores' });
  const tenantId = getTenantId(req);
  const conn = await db.getConnection();
  try {
    const [[venta]] = await conn.execute(
      `SELECT * FROM b2c_venta WHERE uid_venta = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const [items] = await conn.execute(
      `SELECT * FROM b2c_venta_item WHERE uid_venta = ? ORDER BY uid_item`,
      [venta.uid_venta]
    );

    const cfg          = await getConfigActiva(conn, tenantId);
    const rentabilidad = calcularRentabilidad({
      manoObra: venta.ven_mano_obra,
      items,
      configFinanciera: cfg,
    });
    const sugerencias = generarSugerencias({ resultado: rentabilidad, config: cfg });

    res.json({
      uid_venta:   venta.uid_venta,
      es_rentable: rentabilidad.ven_es_rentable === 1,
      financiero:  rentabilidad,
      sugerencias,
      config:      cfg,
    });
  } catch (e) {
    log.error({ err: e }, 'Error calculando sugerencias');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

module.exports = router;
