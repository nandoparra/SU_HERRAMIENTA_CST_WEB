'use strict';
const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const db         = require('../utils/db');
const { getTenantId }             = require('../utils/tenant-id');
const { requireAdminFuncionario }  = require('../middleware/auth');
const { maskPhone, makeConversacionToken, resolveConversacionToken } = require('../utils/wa-conversaciones');

router.use(requireAdminFuncionario);

const keyByUser = (req) => String(req.session?.user?.id || req.ip);
const waConvLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  keyGenerator: keyByUser,
  message: { error: 'Demasiadas solicitudes. Espere un momento.' },
  standardHeaders: true, legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
});

// ── GET /wa/conversaciones?q= ─────────────────────────────────────────────────
// Lista de conversaciones activas (una fila por número de teléfono).
// El teléfono se envía ENMASCARADO — el backend nunca devuelve el número completo.
// Límite: 50 conversaciones. Ver CLAUDE.md — "Límites conocidos: wa/conversaciones".
router.get('/wa/conversaciones', waConvLimiter, async (req, res) => {
  const q        = String(req.query.q || '').trim();
  const tenantId = getTenantId(req);
  const secret   = process.env.SESSION_SECRET || 'cst-dev-insecure';
  const conn     = await db.getConnection();
  try {
    let rows;
    if (q) {
      const digits = q.replace(/\D/g, '');
      const likeQ  = `%${q}%`;
      const likeD  = digits ? `%${digits}%` : null;
      // Búsqueda por nombre del cliente o por número de teléfono (texto parcial o solo dígitos)
      const params = likeD
        ? [tenantId, tenantId, tenantId, tenantId, likeD, likeQ]
        : [tenantId, tenantId, tenantId, tenantId, likeQ];
      [rows] = await conn.execute(`
        SELECT c.wa_phone,
               LEFT(c.contenido, 80)  AS ultimo_mensaje,
               c.rol                  AS ultimo_mensaje_rol,
               c.created_at           AS ultimo_at,
               totales.total_mensajes,
               cl.cli_razon_social    AS nombre_cliente
        FROM b2c_wa_conversacion c
        INNER JOIN (
          SELECT wa_phone,
                 MAX(uid_mensaje) AS max_uid,
                 COUNT(*)         AS total_mensajes
          FROM b2c_wa_conversacion
          WHERE tenant_id = ?
          GROUP BY wa_phone
        ) totales ON totales.wa_phone = c.wa_phone AND c.uid_mensaje = totales.max_uid
        LEFT JOIN b2c_wa_lid_mapping m  ON m.wa_phone  = c.wa_phone AND m.tenant_id = ?
        LEFT JOIN b2c_cliente cl        ON cl.uid_cliente = m.uid_cliente AND cl.tenant_id = ?
        WHERE c.tenant_id = ?
          AND (c.wa_phone LIKE ${likeD ? '?' : "'%%'"} OR cl.cli_razon_social LIKE ?)
        ORDER BY c.created_at DESC
        LIMIT 50
      `, params);
    } else {
      [rows] = await conn.execute(`
        SELECT c.wa_phone,
               LEFT(c.contenido, 80)  AS ultimo_mensaje,
               c.rol                  AS ultimo_mensaje_rol,
               c.created_at           AS ultimo_at,
               totales.total_mensajes,
               cl.cli_razon_social    AS nombre_cliente
        FROM b2c_wa_conversacion c
        INNER JOIN (
          SELECT wa_phone,
                 MAX(uid_mensaje) AS max_uid,
                 COUNT(*)         AS total_mensajes
          FROM b2c_wa_conversacion
          WHERE tenant_id = ?
          GROUP BY wa_phone
        ) totales ON totales.wa_phone = c.wa_phone AND c.uid_mensaje = totales.max_uid
        LEFT JOIN b2c_wa_lid_mapping m  ON m.wa_phone  = c.wa_phone AND m.tenant_id = ?
        LEFT JOIN b2c_cliente cl        ON cl.uid_cliente = m.uid_cliente AND cl.tenant_id = ?
        WHERE c.tenant_id = ?
        ORDER BY c.created_at DESC
        LIMIT 50
      `, [tenantId, tenantId, tenantId, tenantId]);
    }

    // Nunca exponer el teléfono completo en la lista
    const result = rows.map(r => ({
      token:              makeConversacionToken(tenantId, r.wa_phone, secret),
      wa_phone_masked:    maskPhone(r.wa_phone),
      nombre_cliente:     r.nombre_cliente || null,
      ultimo_mensaje:     r.ultimo_mensaje,
      ultimo_mensaje_rol: r.ultimo_mensaje_rol,
      ultimo_at:          r.ultimo_at,
      total_mensajes:     r.total_mensajes,
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ── GET /wa/conversaciones/detalle/:token ─────────────────────────────────────
// Detalle de una conversación — aquí SÍ se muestra el teléfono completo.
// El token se resuelve a teléfono via HMAC server-side.
router.get('/wa/conversaciones/detalle/:token', waConvLimiter, async (req, res) => {
  const tenantId = getTenantId(req);
  const secret   = process.env.SESSION_SECRET || 'cst-dev-insecure';
  const conn     = await db.getConnection();
  try {
    const phone = await resolveConversacionToken(req.params.token, conn, tenantId, secret);
    if (!phone) return res.status(404).json({ error: 'Conversación no encontrada' });

    const [[clienteInfo]] = await conn.execute(`
      SELECT cl.cli_razon_social AS nombre_cliente,
             cl.cli_identificacion,
             cl.uid_cliente
      FROM b2c_wa_lid_mapping m
      JOIN b2c_cliente cl ON cl.uid_cliente = m.uid_cliente AND cl.tenant_id = ?
      WHERE m.wa_phone = ? AND m.tenant_id = ?
      LIMIT 1
    `, [tenantId, phone, tenantId]);

    const [mensajes] = await conn.execute(`
      SELECT rol, contenido, created_at
      FROM b2c_wa_conversacion
      WHERE tenant_id = ? AND wa_phone = ?
      ORDER BY uid_mensaje ASC
    `, [tenantId, phone]);

    res.json({
      wa_phone:         phone,
      wa_phone_masked:  maskPhone(phone),
      nombre_cliente:   clienteInfo?.nombre_cliente || null,
      cli_identificacion: clienteInfo?.cli_identificacion || null,
      uid_cliente:      clienteInfo?.uid_cliente || null,
      mensajes,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

module.exports = router;
