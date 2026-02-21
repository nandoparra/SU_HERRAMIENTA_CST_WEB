'use strict';
const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcrypt');
const rateLimit  = require('express-rate-limit');
const db         = require('../utils/db');

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

    const conn = await db.getConnection();
    const [[user]] = await conn.execute(
      `SELECT uid_usuario, usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado
       FROM b2c_usuario
       WHERE usu_login = ? LIMIT 1`,
      [username.trim()]
    );

    if (!user) {
      conn.release();
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }

    if (user.usu_estado !== 'A') {
      conn.release();
      return res.status(401).json({ success: false, error: 'Usuario inactivo' });
    }

    // Verificar contraseña — bcrypt o texto plano (migración lazy)
    let passwordOk = false;
    const storedClave = String(user.usu_clave || '');

    if (storedClave.startsWith('$2b$') || storedClave.startsWith('$2a$')) {
      // Ya está hasheada
      passwordOk = await bcrypt.compare(password, storedClave);
    } else {
      // Texto plano → comparar y migrar
      passwordOk = storedClave === password;
      if (passwordOk) {
        const hash = await bcrypt.hash(password, 10);
        await conn.execute(
          `UPDATE b2c_usuario SET usu_clave = ? WHERE uid_usuario = ?`,
          [hash, user.uid_usuario]
        );
      }
    }

    conn.release();

    if (!passwordOk) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }

    const tipo = String(user.usu_tipo || '').toUpperCase();
    req.session.user = {
      id:     user.uid_usuario,
      nombre: user.usu_nombre,
      login:  user.usu_login,
      tipo,
      rol:    ROLES[tipo] || 'funcionario',
    };

    const redirect = tipo === 'C' ? '/seguimiento.html' : '/generador-cotizaciones.html';
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
  res.json({ authenticated: true, user: req.session.user });
});

module.exports = router;
