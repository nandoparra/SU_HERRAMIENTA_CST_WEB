const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { waClient, isReady } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');

// Enviar WhatsApp usando el mensaje guardado de la orden
router.post('/quotes/order/:orderId/send-whatsapp', async (req, res) => {
  try {
    if (!isReady()) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp Web no está conectado. Escanea el QR en la terminal.',
      });
    }

    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) {
      conn.release();
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    const [[hdr]] = await conn.execute(
      `SELECT mensaje_whatsapp FROM b2c_cotizacion_orden WHERE uid_orden = ?`,
      [order.uid_orden]
    );

    const msg = hdr?.mensaje_whatsapp ? String(hdr.mensaje_whatsapp) : '';
    if (!msg) {
      conn.release();
      return res.status(400).json({ success: false, error: 'Primero genera el mensaje final.' });
    }

    const chatIds = parseColombianPhones(order.cli_telefono);
    if (!chatIds.length) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' });
    }
    for (const chatId of chatIds) await waClient.sendMessage(chatId, msg);

    await conn.execute(
      `UPDATE b2c_cotizacion_orden SET whatsapp_enviado = 1, whatsapp_enviado_at = NOW() WHERE uid_orden = ?`,
      [order.uid_orden]
    );

    conn.release();
    res.json({ success: true, destinatarios: chatIds.length, status: 'Enviado' });
  } catch (e) {
    console.error('Error enviando WhatsApp final:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Envío genérico de WhatsApp
router.post('/whatsapp/send', async (req, res) => {
  try {
    const { orderId, message } = req.body;

    if (!isReady()) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp Web no está conectado. Escanea el QR en la terminal.',
      });
    }

    const conn = await db.getConnection();
    const order = await resolveOrder(conn, orderId);
    if (!order) {
      conn.release();
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    const chatIds = parseColombianPhones(order.cli_telefono);
    if (!chatIds.length) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' });
    }
    for (const chatId of chatIds) await waClient.sendMessage(chatId, String(message || ''));

    conn.release();
    res.json({ success: true, destinatarios: chatIds.length, status: 'Enviado' });
  } catch (e) {
    console.error('Error enviando WhatsApp:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
