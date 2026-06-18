'use strict';
const { getTenantId } = require('../utils/tenant-id');
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { requireInterno } = require('../middleware/auth');
const { isReady, sendWAMessage } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');
const log = require('../utils/logger');

router.use(requireInterno);

// ── Listar solicitudes de recogida ────────────────────────────────────────────
router.get('/taller/solicitudes-recogida', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { estado } = req.query;
    const estadoFiltro = ['pendiente','confirmada','completada','cancelada'].includes(estado)
      ? estado : null;
    const conn = await db.getConnection();
    try {
      const params = [tenantId];
      let where = 'WHERE s.tenant_id = ?';
      if (estadoFiltro) { where += ' AND s.estado = ?'; params.push(estadoFiltro); }

      const [rows] = await conn.execute(
        `SELECT s.uid_solicitud, s.uid_cliente,
                s.direccion, s.fecha_sugerida, s.fecha_confirmada,
                s.nota_confirmacion, s.fotos, s.estado, s.created_at,
                c.cli_razon_social, c.cli_contacto, c.cli_telefono, c.cli_identificacion
         FROM b2c_solicitud_recogida s
         LEFT JOIN b2c_cliente c ON c.uid_cliente = s.uid_cliente
         ${where}
         ORDER BY s.created_at DESC LIMIT 100`,
        params
      );
      if (!rows.length) return res.json([]);

      const ids = rows.map(r => r.uid_solicitud);
      const ph  = ids.map(() => '?').join(',');
      const [items] = await conn.execute(
        `SELECT uid_item, uid_solicitud, uid_herramienta, her_nombre, her_marca, her_serial, tipo_servicio, descripcion
         FROM b2c_solicitud_recogida_item
         WHERE uid_solicitud IN (${ph}) AND tenant_id = ?
         ORDER BY uid_item`,
        [...ids, tenantId]
      );
      const itemsMap = {};
      items.forEach(i => {
        const k = String(i.uid_solicitud);
        if (!itemsMap[k]) itemsMap[k] = [];
        itemsMap[k].push(i);
      });
      rows.forEach(r => { r.maquinas = itemsMap[String(r.uid_solicitud)] || []; });
      res.json(rows);
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error listando solicitudes taller:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Confirmar solicitud con fecha + hora + WA ─────────────────────────────────
router.patch('/taller/solicitudes-recogida/:id/confirmar', async (req, res) => {
  const { fecha_confirmada, nota_confirmacion } = req.body;
  if (!fecha_confirmada) return res.status(400).json({ error: 'fecha_confirmada es requerida (ISO datetime)' });

  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[sol]] = await conn.execute(
        `SELECT s.uid_solicitud, s.estado, s.direccion,
                c.cli_telefono, c.cli_razon_social, c.cli_contacto
         FROM b2c_solicitud_recogida s
         LEFT JOIN b2c_cliente c ON c.uid_cliente = s.uid_cliente
         WHERE s.uid_solicitud = ? AND s.tenant_id = ?`,
        [req.params.id, tenantId]
      );
      if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
      if (sol.estado !== 'pendiente') return res.status(409).json({ error: `La solicitud ya está en estado "${sol.estado}"` });

      await conn.execute(
        `UPDATE b2c_solicitud_recogida
         SET estado = 'confirmada', fecha_confirmada = ?, nota_confirmacion = ?
         WHERE uid_solicitud = ?`,
        [fecha_confirmada, nota_confirmacion || null, sol.uid_solicitud]
      );

      // Notificación WA al cliente
      try {
        if (isReady(tenantId) && sol.cli_telefono) {
          const chatIds = parseColombianPhones(sol.cli_telefono);
          const fecha = new Date(fecha_confirmada);
          const fechaStr = isNaN(fecha) ? fecha_confirmada : fecha.toLocaleDateString('es-CO', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
          }) + ' a las ' + fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

          // Obtener equipos de la solicitud
          const [solItems] = await conn.execute(
            `SELECT her_nombre FROM b2c_solicitud_recogida_item WHERE uid_solicitud = ? ORDER BY uid_item`,
            [sol.uid_solicitud]
          );
          const equiposStr = solItems.length
            ? solItems.map(i => `• ${i.her_nombre}`).join('\n')
            : '• su(s) equipo(s)';

          const clienteNombre = sol.cli_razon_social || sol.cli_contacto || 'cliente';
          const msg = `Hola ${clienteNombre}, le saluda *Su Herramienta CST* 🔧\n\n` +
            `✅ *Su solicitud de recogida ha sido confirmada.*\n\n` +
            `🔧 Equipos:\n${equiposStr}\n` +
            `📅 Fecha y hora: *${fechaStr}*\n` +
            `📍 Dirección: ${sol.direccion}` +
            (nota_confirmacion ? `\n\n${nota_confirmacion}` : '') +
            `\n\nGracias por confiar en nosotros. — SU HERRAMIENTA CST`;

          for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, msg);
        }
      } catch (waErr) {
        log.warn({ err: waErr.message }, '⚠️ WA no enviado al confirmar solicitud (confirmación guardada):');
      }

      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error confirmando solicitud:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Cambiar estado (completada / cancelada) ───────────────────────────────────
router.patch('/taller/solicitudes-recogida/:id/estado', async (req, res) => {
  const { estado } = req.body;
  if (!['completada','cancelada'].includes(estado)) {
    return res.status(400).json({ error: 'estado debe ser "completada" o "cancelada"' });
  }
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[sol]] = await conn.execute(
        `SELECT uid_solicitud FROM b2c_solicitud_recogida WHERE uid_solicitud = ? AND tenant_id = ?`,
        [req.params.id, tenantId]
      );
      if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
      await conn.execute(
        `UPDATE b2c_solicitud_recogida SET estado = ? WHERE uid_solicitud = ?`,
        [estado, sol.uid_solicitud]
      );
      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error actualizando estado solicitud:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
