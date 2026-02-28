'use strict';

// Roles que tienen acceso al sistema interno
const ROLES_INTERNOS = ['A', 'F', 'T'];

function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.xhr || req.headers['content-type'] === 'application/json' || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'No autenticado', redirect: '/login' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireInterno(req, res, next) {
  const isApi = req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/');
  if (!req.session.user) {
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
