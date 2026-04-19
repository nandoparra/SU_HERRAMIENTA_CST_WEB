'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { isReady, sendWAMessage } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');
const { requireInterno } = require('../middleware/auth');
const { enviarListaRepuestos } = require('../utils/repuestos-notifier');

router.use(requireInterno);

// Máximo 20 notificaciones WA por usuario por minuto — cubre trabajo normal con múltiples órdenes
const notifyLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             20,
  keyGenerator:    (req) => String(req.session?.user?.uid_usuario || req.ip),
  message:         { success: false, error: 'Demasiadas notificaciones. Espere un momento.' },
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { keyGeneratorIpFallback: false },
});

// Enviar lista consolidada de repuestos (máquinas autorizadas) al encargado
router.post('/orders/:orderId/notify-parts', notifyLimiter, async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

      const result = await enviarListaRepuestos(conn, tenantId, order.uid_orden, order.ord_consecutivo);
      if (!result.sent) return res.status(400).json({ success: false, error: result.reason });
      res.json({ success: true, maquinas: result.maquinas });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error enviando lista de repuestos:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Notificar al cliente que sus máquinas están reparadas
router.post('/orders/:orderId/notify-ready', notifyLimiter, async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
      if (!isReady(tenantId)) return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });

      const [[cliente]] = await conn.execute(
        `SELECT c.cli_razon_social, c.cli_telefono FROM b2c_orden o JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente WHERE o.uid_orden = ?`,
        [order.uid_orden]
      );
      const [maquinas] = await conn.execute(`
        SELECT h.her_nombre, h.her_marca
        FROM b2c_herramienta_orden ho
        JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
        WHERE ho.uid_orden = ? AND ho.her_estado = 'reparada'
        ORDER BY ho.uid_herramienta_orden
      `, [order.uid_orden]);

      if (!maquinas.length) return res.status(400).json({ success: false, error: 'No hay máquinas con estado "reparada" en esta orden' });

      const nombre = cliente?.cli_razon_social || 'cliente';
      const lista = maquinas.map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`).join('\n');
      const msg =
        `Hola ${nombre}, le informamos que las siguientes herramientas están *reparadas y listas para recoger*:\n\n` +
        `${lista}\n\n` +
        `📍 Calle 21 No 10 02, Pereira\n📞 3104650437\n— SU HERRAMIENTA CST`;

      const chatIds = parseColombianPhones(cliente?.cli_telefono);
      if (!chatIds.length) return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' });
      for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, msg);

      res.json({ success: true, maquinas: maquinas.length, destinatarios: chatIds.length });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error notificando reparadas:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Confirmar entrega al cliente
router.post('/orders/:orderId/notify-delivered', notifyLimiter, async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
      if (!isReady(tenantId)) return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });

      const [[cliente]] = await conn.execute(
        `SELECT c.cli_razon_social, c.cli_telefono FROM b2c_orden o JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente WHERE o.uid_orden = ?`,
        [order.uid_orden]
      );
      const [maquinas] = await conn.execute(`
        SELECT h.her_nombre, h.her_marca
        FROM b2c_herramienta_orden ho
        JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
        WHERE ho.uid_orden = ? AND ho.her_estado = 'entregada'
        ORDER BY ho.uid_herramienta_orden
      `, [order.uid_orden]);

      if (!maquinas.length) return res.status(400).json({ success: false, error: 'No hay máquinas con estado "entregada" en esta orden' });

      const nombre = cliente?.cli_razon_social || 'cliente';
      const lista = maquinas.map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`).join('\n');
      const msg =
        `Hola ${nombre}, confirmamos la entrega de las siguientes herramientas:\n\n` +
        `${lista}\n\n` +
        `¡Gracias por confiar en nosotros!\n— SU HERRAMIENTA CST`;

      const chatIds = parseColombianPhones(cliente?.cli_telefono);
      if (!chatIds.length) return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' });
      for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, msg);

      res.json({ success: true, maquinas: maquinas.length, destinatarios: chatIds.length });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error confirmando entregas:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
