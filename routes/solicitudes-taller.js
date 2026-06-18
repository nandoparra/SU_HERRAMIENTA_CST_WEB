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
                s.uid_orden_creada, o.ord_consecutivo,
                c.cli_razon_social, c.cli_contacto, c.cli_telefono, c.cli_identificacion
         FROM b2c_solicitud_recogida s
         LEFT JOIN b2c_cliente c ON c.uid_cliente = s.uid_cliente
         LEFT JOIN b2c_orden o ON o.uid_orden = s.uid_orden_creada
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

// ── Crear orden de servicio desde solicitud confirmada ───────────────────────
router.post('/taller/solicitudes-recogida/:id/crear-orden', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[sol]] = await conn.execute(
        `SELECT uid_solicitud, estado, uid_cliente, uid_orden_creada
         FROM b2c_solicitud_recogida
         WHERE uid_solicitud = ? AND tenant_id = ?`,
        [req.params.id, tenantId]
      );
      if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
      if (sol.uid_orden_creada) {
        const [[ord]] = await conn.execute(
          `SELECT ord_consecutivo FROM b2c_orden WHERE uid_orden = ?`, [sol.uid_orden_creada]
        );
        return res.status(409).json({ error: 'Ya tiene una orden creada', uid_orden: sol.uid_orden_creada, consecutivo: ord?.ord_consecutivo });
      }
      if (sol.estado !== 'confirmada') {
        return res.status(409).json({ error: `Solo se puede convertir desde estado "confirmada" (actual: "${sol.estado}")` });
      }

      const [items] = await conn.execute(
        `SELECT uid_herramienta, her_nombre FROM b2c_solicitud_recogida_item
         WHERE uid_solicitud = ? AND tenant_id = ? ORDER BY uid_item`,
        [sol.uid_solicitud, tenantId]
      );
      if (!items.length) return res.status(400).json({ error: 'La solicitud no tiene máquinas' });
      const sinUid = items.filter(i => !i.uid_herramienta);
      if (sinUid.length) {
        return res.status(400).json({ error: `Máquina(s) sin uid_herramienta: ${sinUid.map(i => i.her_nombre).join(', ')}` });
      }

      await conn.beginTransaction();
      try {
        const [[maxRow]] = await conn.execute(`SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden`);
        const consecutivo = maxRow.next;
        const d = new Date();
        const fechaHoy = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

        const [ordRes] = await conn.execute(
          `INSERT INTO b2c_orden (ord_consecutivo, uid_cliente, ord_estado, ord_total, ord_impuestos, ord_valor_total, ord_fecha, ord_tipo, tenant_id)
           VALUES (?, ?, 'A', 0, 0, 0, ?, 'normal', ?)`,
          [consecutivo, sol.uid_cliente, fechaHoy, tenantId]
        );
        const uid_orden = ordRes.insertId;

        for (const item of items) {
          await conn.execute(
            `INSERT INTO b2c_herramienta_orden (uid_orden, uid_herramienta, her_estado, tenant_id)
             VALUES (?, ?, 'pendiente_revision', ?)`,
            [uid_orden, item.uid_herramienta, tenantId]
          );
        }

        await conn.execute(
          `UPDATE b2c_solicitud_recogida SET estado = 'completada', uid_orden_creada = ? WHERE uid_solicitud = ?`,
          [uid_orden, sol.uid_solicitud]
        );

        await conn.commit();
        res.json({ success: true, uid_orden, consecutivo });
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error creando orden desde solicitud:');
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
