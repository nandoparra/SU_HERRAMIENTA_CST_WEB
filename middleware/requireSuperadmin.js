'use strict';

/**
 * requireSuperadmin — guarda para rutas /superadmin/api/*.
 * La sesión del superadmin es independiente de la de los tenants.
 * Se autentica con POST /superadmin/api/login usando SUPERADMIN_SECRET.
 */
function requireSuperadmin(req, res, next) {
  if (!req.session.superadmin) {
    return res.status(401).json({ error: 'No autenticado como superadmin' });
  }
  next();
}

module.exports = { requireSuperadmin };
