'use strict';

// Roles que tienen acceso al sistema interno
const ROLES_INTERNOS = ['A', 'F', 'T'];

/**
 * Verifica que la sesión pertenece al tenant activo en req.tenant.
 * Retorna true si la sesión es válida para este tenant.
 */
function sessionMatchesTenant(req) {
  if (!req.session.user) return false;
  // tenant_id en sesión debe coincidir con el tenant resuelto por hostname
  // Si la sesión no tiene tenant_id (sesiones antiguas) se acepta solo en tenant 1
  const sessionTenant = req.session.user.tenant_id ?? 1;
  const reqTenant     = req.tenant?.uid_tenant ?? 1;
  return sessionTenant === reqTenant;
}

function requireLogin(req, res, next) {
  const isApi = req.xhr || req.headers['content-type'] === 'application/json' || req.path.startsWith('/api/');

  if (!req.session.user || !sessionMatchesTenant(req)) {
    // Destruir sesión si pertenece a otro tenant (evita cross-tenant session hijacking)
    if (req.session.user) req.session.destroy(() => {});
    if (isApi) return res.status(401).json({ error: 'No autenticado', redirect: '/login' });
    return res.redirect('/login');
  }
  next();
}

function requireInterno(req, res, next) {
  const isApi = req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/');

  if (!req.session.user || !sessionMatchesTenant(req)) {
    if (req.session.user) req.session.destroy(() => {});
    if (isApi || req.xhr || req.headers['content-type'] === 'application/json') {
      return res.status(401).json({ error: 'No autenticado', redirect: '/login' });
    }
    return res.redirect('/login');
  }
  if (!ROLES_INTERNOS.includes(req.session.user.tipo)) {
    if (isApi || req.xhr || req.headers['content-type'] === 'application/json') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    return res.redirect('/seguimiento.html');
  }
  next();
}

function requireCliente(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.tipo !== 'C') return res.redirect('/generador-cotizaciones.html');
  next();
}

module.exports = { requireLogin, requireInterno, requireCliente };
