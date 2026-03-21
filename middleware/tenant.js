'use strict';

const db = require('../utils/db');

// Cache en memoria para evitar hit a BD en cada request
// Estructura: Map<cacheKey, { tenant, expiresAt }>
const tenantCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

async function resolveTenant(hostname) {
  const now = Date.now();
  const cached = tenantCache.get(hostname);
  if (cached && cached.expiresAt > now) return cached.tenant;

  const conn = await db.getConnection();
  try {
    // Extraer slug del subdominio (ej: "suherramienta.sistemataller.com" → "suherramienta")
    const slug = hostname.split('.')[0];

    const [rows] = await conn.execute(
      `SELECT uid_tenant, ten_nombre, ten_slug, ten_slug_locked,
              ten_color_primary, ten_color_accent, ten_logo,
              ten_wa_number, ten_wa_parts_number, ten_estado
       FROM b2c_tenant
       WHERE (ten_slug = ? OR ten_dominio_custom = ?)
         AND ten_estado != 'suspendido'
       LIMIT 1`,
      [slug, hostname]
    );

    const tenant = rows[0] || null;
    tenantCache.set(hostname, { tenant, expiresAt: now + CACHE_TTL_MS });
    return tenant;
  } finally {
    conn.release();
  }
}

/**
 * tenantMiddleware — asigna req.tenant en cada request.
 *
 * - En localhost / desarrollo: usa tenant por defecto (uid=1) para no romper el flujo local.
 * - En producción: resuelve por ten_slug (subdominio) o ten_dominio_custom.
 * - Si no encuentra tenant → 404.
 * - Rutas /superadmin no pasan por este middleware.
 */
async function tenantMiddleware(req, res, next) {
  const hostname = req.hostname || '';

  // Desarrollo local — usar tenant por defecto sin hit a BD
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');
  if (isLocal) {
    req.tenant = {
      uid_tenant:         1,
      ten_nombre:         'SU HERRAMIENTA CST',
      ten_slug:           'suherramienta',
      ten_slug_locked:    1,
      ten_color_primary:  '#1d3557',
      ten_color_accent:   '#e63946',
      ten_logo:           null,
      ten_wa_number:      process.env.PARTS_WHATSAPP_NUMBER || null,
      ten_wa_parts_number: process.env.PARTS_WHATSAPP_NUMBER || null,
      ten_estado:         'activo',
    };
    return next();
  }

  try {
    const tenant = await resolveTenant(hostname);

    if (!tenant) {
      return res.status(404).send(
        '<h1>404 — Taller no encontrado</h1>' +
        '<p>El dominio <strong>' + hostname + '</strong> no está registrado en el sistema.</p>'
      );
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('[tenantMiddleware] Error resolviendo tenant:', err.message);
    next(err);
  }
}

/** Invalida la caché para un hostname específico (usar al actualizar un tenant) */
function invalidateTenantCache(hostname) {
  tenantCache.delete(hostname);
}

module.exports = { tenantMiddleware, invalidateTenantCache };
