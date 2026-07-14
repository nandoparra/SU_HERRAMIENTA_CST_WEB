'use strict';
const express = require('express');
const router  = express.Router();
const { requireInterno } = require('../middleware/auth');
const { alegraGet }      = require('../utils/alegra-client');
const { generarFactura } = require('../services/alegra-factura');
const { resolveOrder }   = require('../utils/schema');
const { getTenantId }    = require('../utils/tenant-id');
const db  = require('../utils/db');
const log = require('../utils/logger');

router.use(requireInterno);

function requireAdmin(req, res, next) {
  if (req.session.user.tipo !== 'A') {
    return res.status(403).json({ error: 'Solo administradores pueden acceder a esta función' });
  }
  next();
}

// Verifica que las credenciales de Alegra estén configuradas y funcionando
router.get('/internal/alegra/test-connection', requireAdmin, async (req, res) => {
  if (!process.env.ALEGRA_USER || !process.env.ALEGRA_TOKEN) {
    return res.status(400).json({
      connected: false,
      error: 'Variables ALEGRA_USER y ALEGRA_TOKEN no están configuradas en el servidor',
    });
  }
  try {
    const company = await alegraGet('/company');
    res.json({
      connected: true,
      company: {
        name:           company.name,
        identification: company.identification,
        email:          company.email,
        regime:         company.regime,
      },
    });
  } catch (e) {
    log.warn({ err: e.message }, '⚠️ Alegra test-connection falló');
    res.status(e.status === 401 ? 401 : 502).json({
      connected: false,
      error: e.status === 401
        ? 'Credenciales inválidas — verifica ALEGRA_USER y ALEGRA_TOKEN'
        : `Error conectando con Alegra: ${e.message}`,
    });
  }
});

// Genera factura electrónica en Alegra para una orden de servicio
router.post('/alegra/invoices/:orderId', async (req, res) => {
  if (!process.env.ALEGRA_USER || !process.env.ALEGRA_TOKEN) {
    return res.status(503).json({ error: 'Integración Alegra no configurada en el servidor (ALEGRA_USER / ALEGRA_TOKEN)' });
  }
  const tenantId = getTenantId(req);
  let uid_orden = null;
  try {
    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
      uid_orden = order.uid_orden;

      const [[estadoRow]] = await conn.execute(
        `SELECT ord_alegra_id, ord_alegra_url FROM b2c_orden WHERE uid_orden = ?`,
        [uid_orden]
      );
      if (estadoRow?.ord_alegra_id) {
        return res.status(409).json({
          error: 'La orden ya tiene una factura electrónica',
          alegraId: estadoRow.ord_alegra_id,
          url: estadoRow.ord_alegra_url,
        });
      }

      const [maquinas] = await conn.execute(
        `SELECT h.her_nombre, h.her_marca, cm.subtotal, cm.descripcion_trabajo
         FROM b2c_herramienta_orden ho
         JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         JOIN b2c_cotizacion_maquina cm
              ON CAST(cm.uid_herramienta_orden AS CHAR) = CAST(ho.uid_herramienta_orden AS CHAR)
         WHERE ho.uid_orden = ? AND COALESCE(cm.subtotal, 0) > 0
         ORDER BY ho.uid_herramienta_orden`,
        [uid_orden]
      );
      if (!maquinas.length) {
        return res.status(400).json({ error: 'No hay máquinas con cotización para facturar' });
      }

      const { paymentForm = 'CASH', paymentMethod = 'CASH', date } = req.body || {};
      const { alegraId, url } = await generarFactura({ orden: order, cliente: order, maquinas, paymentForm, paymentMethod, date });

      await conn.execute(
        `UPDATE b2c_orden SET ord_alegra_id = ?, ord_alegra_url = ?, ord_factura_estado = 'emitida'
         WHERE uid_orden = ? AND tenant_id = ?`,
        [alegraId, url, uid_orden, tenantId]
      );

      res.json({ success: true, alegraId, url });
    } catch (e) {
      if (uid_orden) {
        conn.execute(
          `UPDATE b2c_orden SET ord_factura_estado = 'error' WHERE uid_orden = ?`,
          [uid_orden]
        ).catch(() => {});
      }
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error generando factura Alegra');
    if (!res.headersSent) {
      res.status(e.status || 500).json({ error: e.message || 'Error interno del servidor' });
    }
  }
});

module.exports = router;
