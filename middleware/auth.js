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
  if (!req.session.user) return res.redirect('/login');
  if (!ROLES_INTERNOS.includes(req.session.user.tipo)) {
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
