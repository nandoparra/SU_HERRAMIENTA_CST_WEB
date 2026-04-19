const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { isReady, sendWAMessage, getLastQR } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');
const QRCode = require('qrcode');
const { requireInterno } = require('../middleware/auth');

// Mostrar QR para escanear desde el navegador (solo internos)
router.get('/whatsapp/qr', requireInterno, async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  if (isReady(tenantId)) {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2 style="color:green">✅ WhatsApp ya está conectado</h2></body></html>');
  }
  const qr = getLastQR(tenantId);
  if (!qr) {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>⏳ Esperando QR...</h2><p>Recarga en unos segundos.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>');
  }
  const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5">
    <h2>📱 Escanea este QR en WhatsApp</h2>
    <p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
    <img src="${dataUrl}" style="border:4px solid #1d3557;border-radius:8px">
    <p style="color:#666">Esta página se recarga automáticamente cada 10s</p>
    <script>setTimeout(()=>location.reload(),10000)</script>
  </body></html>`);
});

// Enviar WhatsApp usando el mensaje guardado de la orden
router.post('/quotes/order/:orderId/send-whatsapp', requireInterno, async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    if (!isReady(tenantId)) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp Web no está conectado. Escanea el QR en la terminal.',
      });
    }

    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

      const [[hdr]] = await conn.execute(
        `SELECT mensaje_whatsapp FROM b2c_cotizacion_orden WHERE uid_orden = ? AND tenant_id = ?`,
        [order.uid_orden, tenantId]
      );

      const msg = hdr?.mensaje_whatsapp ? String(hdr.mensaje_whatsapp) : '';
      if (!msg) return res.status(400).json({ success: false, error: 'Primero genera el mensaje final.' });

      const chatIds = parseColombianPhones(order.cli_telefono);
      if (!chatIds.length) return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' });
      for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, msg);

      await conn.execute(
        `UPDATE b2c_cotizacion_orden SET whatsapp_enviado = 1, whatsapp_enviado_at = NOW() WHERE uid_orden = ?`,
        [order.uid_orden]
      );

      // Registrar conversación de autorización pendiente por cada número del cliente
      // UNIQUE(wa_phone): si ya había un pendiente anterior de este número, se reemplaza con esta orden
      for (const chatId of chatIds) {
        const phone = chatId.replace(/@[a-z.]+$/, '');
        await conn.execute(
          `INSERT INTO b2c_wa_autorizacion_pendiente (uid_orden, wa_phone, estado, tenant_id)
           VALUES (?, ?, 'esperando_opcion', ?)
           ON DUPLICATE KEY UPDATE
             uid_orden = VALUES(uid_orden),
             estado    = 'esperando_opcion',
             created_at = CURRENT_TIMESTAMP`,
          [order.uid_orden, phone, tenantId]
        );
      }

      res.json({ success: true, destinatarios: chatIds.length, cliente: order.cli_razon_social || order.cli_contacto || '', status: 'Enviado' });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error enviando WhatsApp final:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Envío genérico de WhatsApp
router.post('/whatsapp/send', requireInterno, async (req, res) => {
  try {
    const { orderId, message } = req.body;

    const tenantId = req.tenant?.uid_tenant ?? 1;
    if (!isReady(tenantId)) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp Web no está conectado. Escanea el QR en la terminal.',
      });
    }

    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, orderId, tenantId);
      if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

      const chatIds = parseColombianPhones(order.cli_telefono);
      if (!chatIds.length) return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' });
      for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, String(message || ''));

      res.json({ success: true, destinatarios: chatIds.length, status: 'Enviado' });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error enviando WhatsApp:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
