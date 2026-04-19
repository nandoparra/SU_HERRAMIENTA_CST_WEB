'use strict';
const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcrypt');
const rateLimit  = require('express-rate-limit');
const db         = require('../utils/db');
const { invalidateTenantCache } = require('../middleware/tenant');

// Máximo 10 intentos de login por IP en 15 minutos
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  message:         { success: false, error: 'Demasiados intentos fallidos. Espere 15 minutos.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const ROLES = { A: 'admin', F: 'funcionario', T: 'tecnico', C: 'cliente' };

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(require('path').join(__dirname, '..', 'public', 'login.html'));
});

// POST /login — protegido con rate limiting
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos' });
    }

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    let userResult;
    try {
      const [[user]] = await conn.execute(
        `SELECT uid_usuario, usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado
         FROM b2c_usuario
         WHERE usu_login = ? AND tenant_id = ? LIMIT 1`,
        [username.trim(), tenantId]
      );

      if (!user) return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
      if (user.usu_estado !== 'A') return res.status(401).json({ success: false, error: 'Usuario inactivo' });

      // Verificar contraseña — bcrypt o texto plano (migración lazy)
      let passwordOk = false;
      const storedClave = String(user.usu_clave || '');

      if (storedClave.startsWith('$2b$') || storedClave.startsWith('$2a$')) {
        passwordOk = await bcrypt.compare(password, storedClave);
      } else {
        passwordOk = storedClave === password;
        if (passwordOk) {
          const hash = await bcrypt.hash(password, 10);
          await conn.execute(
            `UPDATE b2c_usuario SET usu_clave = ? WHERE uid_usuario = ?`,
            [hash, user.uid_usuario]
          );
        }
      }

      if (!passwordOk) return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });

      // Lock del slug tras el primer login exitoso del tenant
      if (req.tenant && !req.tenant.ten_slug_locked) {
        await conn.execute(
          `UPDATE b2c_tenant SET ten_slug_locked = 1 WHERE uid_tenant = ?`,
          [tenantId]
        );
        invalidateTenantCache(req.hostname);
      }

      userResult = user;
    } finally {
      conn.release();
    }

    const user = userResult;
    const tipo = String(user.usu_tipo || '').toUpperCase();
    req.session.user = {
      id:        user.uid_usuario,
      nombre:    user.usu_nombre,
      login:     user.usu_login,
      tipo,
      rol:       ROLES[tipo] || 'funcionario',
      tenant_id: tenantId,
    };

    const redirect = tipo === 'C' ? '/seguimiento.html' : '/dashboard.html';
    res.json({ success: true, rol: req.session.user.rol, redirect });
  } catch (e) {
    console.error('Error en login:', e);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /me — datos del usuario logueado (para el frontend)
router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false });
  // Verificar que la sesión pertenece al tenant activo (cross-tenant protection)
  const sessionTenant = req.session.user.tenant_id ?? 1;
  const reqTenant     = req.tenant?.uid_tenant ?? 1;
  if (sessionTenant !== reqTenant) {
    req.session.destroy(() => {});
    return res.status(401).json({ authenticated: false, redirect: '/login' });
  }
  res.json({ authenticated: true, user: req.session.user });
});

module.exports = router;
