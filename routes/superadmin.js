'use strict';
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcrypt');
const rateLimit  = require('express-rate-limit');
const db         = require('../utils/db');
const { requireSuperadmin } = require('../middleware/requireSuperadmin');
const { invalidateTenantCache } = require('../middleware/tenant');
const { initTenantClient }      = require('../utils/whatsapp-client');

// Máx 5 intentos de login cada 15 minutos por IP
const superadminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Espere 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Almacenamiento de logos de tenant ─────────────────────────────────────────
const LOGOS_DIR = path.join(__dirname, '..', 'public', 'assets', 'tenant-logos');
fs.mkdirSync(LOGOS_DIR, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, LOGOS_DIR),
  filename: (req, _file, cb) => cb(null, `tenant-${req.params.id}.png`),
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
}).single('logo');

// ── Auth superadmin ────────────────────────────────────────────────────────────

router.post('/login', superadminLoginLimiter, (req, res) => {
  const secret = process.env.SUPERADMIN_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'SUPERADMIN_SECRET no configurado' });
  }
  const { password } = req.body;
  if (!password || password !== secret) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  req.session.superadmin = true;
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session.superadmin) return res.status(401).json({ error: 'No autenticado' });
  res.json({ superadmin: true });
});

// ── Tenants CRUD ──────────────────────────────────────────────────────────────

router.get('/tenants', requireSuperadmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT uid_tenant, ten_nombre, ten_slug, ten_slug_locked,
              ten_dominio_custom, ten_logo, ten_color_primary, ten_color_accent,
              ten_wa_number, ten_wa_parts_number, ten_estado, ten_plan,
              ten_vence, ten_created_at
       FROM b2c_tenant
       ORDER BY uid_tenant`
    );
    res.json(rows);
  } finally {
    conn.release();
  }
});

router.post('/tenants', requireSuperadmin, async (req, res) => {
  const {
    ten_nombre, ten_slug, ten_dominio_custom,
    ten_color_primary, ten_color_accent,
    ten_wa_number, ten_wa_parts_number,
    ten_estado, ten_plan, ten_vence,
  } = req.body;

  if (!ten_nombre || !ten_slug) {
    return res.status(400).json({ error: 'ten_nombre y ten_slug son obligatorios' });
  }
  const conn = await db.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO b2c_tenant
         (ten_nombre, ten_slug, ten_dominio_custom,
          ten_color_primary, ten_color_accent,
          ten_wa_number, ten_wa_parts_number,
          ten_estado, ten_plan, ten_vence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ten_nombre,
        ten_slug,
        ten_dominio_custom  || null,
        ten_color_primary   || '#1d3557',
        ten_color_accent    || '#e63946',
        ten_wa_number       || null,
        ten_wa_parts_number || null,
        ten_estado          || 'prueba',
        ten_plan            || 'mensual',
        ten_vence           || null,
      ]
    );
    res.status(201).json({ success: true, uid_tenant: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug o dominio ya existe' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

router.patch('/tenants/:id', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const allowed = [
    'ten_nombre', 'ten_slug', 'ten_dominio_custom',
    'ten_color_primary', 'ten_color_accent',
    'ten_wa_number', 'ten_wa_parts_number',
    'ten_estado', 'ten_plan', 'ten_vence',
  ];

  const conn = await db.getConnection();
  try {
    // No permitir cambiar slug si está bloqueado (tenant 1 tiene slug bloqueado)
    if ('ten_slug' in req.body) {
      const [[row]] = await conn.execute(
        `SELECT ten_slug_locked FROM b2c_tenant WHERE uid_tenant = ?`, [id]
      );
      if (!row) { conn.release(); return res.status(404).json({ error: 'Tenant no encontrado' }); }
      if (row.ten_slug_locked) {
        delete req.body.ten_slug;
      }
    }

    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

    const set    = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f] ?? null);

    await conn.execute(
      `UPDATE b2c_tenant SET ${set} WHERE uid_tenant = ?`,
      [...values, id]
    );

    // Invalida caché de tenant para que se recargue
    // (invalidamos por slug y dominio si los conocemos)
    invalidateTenantCache(req.body.ten_slug    || '');
    invalidateTenantCache(req.body.ten_dominio_custom || '');

    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug o dominio ya existe' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

// ── Logo upload ───────────────────────────────────────────────────────────────

router.post('/tenants/:id/logo', requireSuperadmin, (req, res, next) => {
  uploadLogo(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const id  = Number(req.params.id);
    const filename = req.file.filename;
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `UPDATE b2c_tenant SET ten_logo = ? WHERE uid_tenant = ?`,
        [filename, id]
      );
      invalidateTenantCache('');
      res.json({ success: true, logo: `/assets/tenant-logos/${filename}` });
    } catch (e) {
      next(e);
    } finally {
      conn.release();
    }
  });
});

// ── Usuarios por tenant ───────────────────────────────────────────────────────

router.get('/tenants/:id/usuarios', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT uid_usuario, usu_nombre, usu_login, usu_tipo, usu_estado
       FROM b2c_usuario WHERE tenant_id = ? ORDER BY uid_usuario`,
      [id]
    );
    res.json(rows);
  } finally {
    conn.release();
  }
});

router.post('/tenants/:id/usuarios', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const { usu_nombre, usu_login, usu_clave, usu_tipo } = req.body;

  if (!usu_nombre || !usu_login || !usu_clave) {
    return res.status(400).json({ error: 'nombre, login y clave son obligatorios' });
  }
  if (!['A', 'F', 'T'].includes(usu_tipo)) {
    return res.status(400).json({ error: 'Tipo inválido — usar A, F o T' });
  }

  const hash = await bcrypt.hash(usu_clave, 10);
  const conn = await db.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id)
       VALUES (?, ?, ?, ?, 'A', ?)`,
      [usu_nombre, usu_login, hash, usu_tipo, id]
    );
    res.status(201).json({ success: true, uid_usuario: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese login ya existe' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

router.patch('/usuarios/:uid', requireSuperadmin, async (req, res) => {
  const uid = Number(req.params.uid);
  const allowed = ['usu_nombre', 'usu_tipo', 'usu_estado'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

  const conn = await db.getConnection();
  try {
    const set    = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f]);
    await conn.execute(
      `UPDATE b2c_usuario SET ${set} WHERE uid_usuario = ?`,
      [...values, uid]
    );
    res.json({ success: true });
  } finally {
    conn.release();
  }
});

// ── Inicializar WhatsApp del tenant ───────────────────────────────────────────

router.post('/tenants/:id/init-wa', requireSuperadmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    initTenantClient(id);
    res.json({ success: true, message: `Cliente WA del tenant ${id} inicializado. Escanea el QR en la terminal.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
