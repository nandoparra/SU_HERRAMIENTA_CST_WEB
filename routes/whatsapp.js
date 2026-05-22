const { getTenantId } = require('../utils/tenant-id');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { isReady, sendWAMessage, getLastQR, resetTenantClient } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');
const QRCode = require('qrcode');
const { requireInterno } = require('../middleware/auth');
const log = require('../utils/logger');

// Máximo 10 envíos WA por usuario cada 5 minutos — evita spam masivo a clientes
const waLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,
  max:             10,
  keyGenerator:    (req) => String(req.session?.user?.uid_usuario || req.ip),
  message:         { success: false, error: 'Demasiados envíos de WhatsApp. Espere unos minutos.' },
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { keyGeneratorIpFallback: false },
});

// Estado de conexión WA (para banner en dashboard)
router.get('/whatsapp/status', requireInterno, (req, res) => {
  const tenantId = getTenantId(req);
  res.json({ connected: isReady(tenantId) });
});

// Forzar reset de sesión WA — útil cuando no genera QR por sesión expirada
router.post('/whatsapp/reset', requireInterno, async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    await resetTenantClient(tenantId);
    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>🔄 Sesión reiniciada</h2><p>Espera 15 segundos y luego ve a <a href="/api/whatsapp/qr">/api/whatsapp/qr</a> para escanear el QR nuevo.</p></body></html>');
  } catch (e) {
    res.status(500).send('<html><body><h2>Error: ' + e.message + '</h2></body></html>');
  }
});

// Mostrar QR para escanear desde el navegador (solo internos)
router.get('/whatsapp/qr', requireInterno, async (req, res) => {
  const tenantId = getTenantId(req);
  if (isReady(tenantId)) {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2 style="color:green">✅ WhatsApp ya está conectado</h2></body></html>');
  }
  const qr = getLastQR(tenantId);
  if (!qr) {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>⏳ Esperando QR...</h2>
      <p>El cliente WhatsApp está inicializando. Recarga en unos segundos.</p>
      <p style="margin-top:24px;color:#888;font-size:13px;">¿Lleva más de 30 segundos sin aparecer el QR?</p>
      <form method="POST" action="/api/whatsapp/reset" style="margin-top:8px;">
        <button type="submit" style="padding:10px 20px;background:#c0392b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">🔄 Resetear sesión y generar QR nuevo</button>
      </form>
      <script>setTimeout(()=>location.reload(),4000)</script>
    </body></html>`);
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
router.post('/quotes/order/:orderId/send-whatsapp', requireInterno, waLimiter, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
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
    log.error({ err: e }, 'Error enviando WhatsApp final:');
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Envío genérico de WhatsApp
router.post('/whatsapp/send', requireInterno, waLimiter, async (req, res) => {
  try {
    const { orderId, message } = req.body;

    const tenantId = getTenantId(req);
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
    log.error({ err: e }, 'Error enviando WhatsApp:');
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
