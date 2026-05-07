'use strict';
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
  const tenantId = req.tenant?.uid_tenant ?? 1;
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
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const {
    cf_utilidad_objetivo_min,
    cf_utilidad_objetivo_opt,
    cf_margen_objetivo_rep,
    cf_meta_total_mes,
  } = req.body;

  if (cf_utilidad_objetivo_min == null || cf_meta_total_mes == null)
    return res.status(400).json({ error: 'cf_utilidad_objetivo_min y cf_meta_total_mes son requeridos' });

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
         (tenant_id, cf_utilidad_objetivo_min, cf_utilidad_objetivo_opt,
          cf_margen_objetivo_rep, cf_meta_total_mes, cf_vigente_desde)
       VALUES (?, ?, ?, ?, ?, CURDATE())`,
      [
        tenantId,
        Number(cf_utilidad_objetivo_min),
        Number(cf_utilidad_objetivo_opt ?? cf_utilidad_objetivo_min),
        Number(cf_margen_objetivo_rep ?? 0.5),
        Number(cf_meta_total_mes),
      ]
    );

    await conn.commit();
    await logAudit(req, 'config_financiera_actualizada', 'b2c_config_financiera',
      String(result.insertId), { cf_utilidad_objetivo_min, cf_meta_total_mes });
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
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT * FROM b2c_config_financiera
       WHERE tenant_id = ?
       ORDER BY cf_vigente_desde DESC`,
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

module.exports = router;
