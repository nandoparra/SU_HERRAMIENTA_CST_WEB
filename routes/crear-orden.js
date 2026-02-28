'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../utils/db');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireInterno } = require('../middleware/auth');

// Todas las rutas de crear-orden requieren rol interno
router.use(requireInterno);

// ── Multer — almacenamiento de fotos ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'fotos-recepcion');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `foto_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fechaHoy() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// ── Buscar cliente ─────────────────────────────────────────────────────────────
router.get('/crear-orden/cliente/buscar', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const conn = await db.getConnection();
    const like = `%${q}%`;
    const [rows] = await conn.execute(
      `SELECT uid_cliente, cli_identificacion, cli_razon_social, cli_telefono, cli_direccion, cli_contacto
       FROM b2c_cliente
       WHERE cli_identificacion LIKE ? OR cli_razon_social LIKE ? OR cli_telefono LIKE ?
       ORDER BY cli_razon_social
       LIMIT 15`,
      [like, like, like]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Crear cliente ──────────────────────────────────────────────────────────────
router.post('/crear-orden/cliente', async (req, res) => {
  try {
    const { cli_identificacion, cli_razon_social, cli_direccion, cli_telefono, cli_contacto, cli_tel_contacto, clave } = req.body;

    if (!cli_identificacion || !cli_razon_social || !cli_telefono) {
      return res.status(400).json({ success: false, error: 'Identificación, Razón Social y Teléfono son obligatorios' });
    }

    const conn = await db.getConnection();

    // Verificar que no exista ya
    const [[existe]] = await conn.execute(
      `SELECT uid_cliente FROM b2c_cliente WHERE cli_identificacion = ? LIMIT 1`,
      [cli_identificacion]
    );
    if (existe) {
      conn.release();
      return res.status(400).json({ success: false, error: `Ya existe un cliente con identificación ${cli_identificacion}` });
    }

    const claveRaw = clave || String(cli_identificacion).slice(-4);
    const hash = await bcrypt.hash(claveRaw, 10);

    // Crear usuario
    const [uRes] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado)
       VALUES (?, ?, ?, 'C', 'A')`,
      [cli_razon_social, cli_identificacion, hash]
    );
    const uid_usuario = uRes.insertId;

    // Crear cliente
    const [cRes] = await conn.execute(
      `INSERT INTO b2c_cliente (uid_usuario, cli_identificacion, cli_razon_social, cli_direccion, cli_telefono, cli_contacto, cli_tel_contacto, cli_estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'A')`,
      [uid_usuario, cli_identificacion, cli_razon_social, cli_direccion || null, cli_telefono, cli_contacto || null, cli_tel_contacto || null]
    );

    conn.release();
    res.json({
      success: true,
      cliente: {
        uid_cliente: cRes.insertId,
        cli_identificacion,
        cli_razon_social,
        cli_telefono,
        cli_direccion: cli_direccion || null,
        cli_contacto: cli_contacto || null,
      },
    });
  } catch (e) {
    console.error('Error creando cliente:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Historial de máquinas del cliente ─────────────────────────────────────────
router.get('/crear-orden/herramientas/:clienteId', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT uid_herramienta, her_nombre, her_marca, her_serial, her_referencia
       FROM b2c_herramienta
       WHERE uid_cliente = ?
       ORDER BY her_nombre`,
      [req.params.clienteId]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Crear herramienta ──────────────────────────────────────────────────────────
router.post('/crear-orden/herramienta', async (req, res) => {
  try {
    const { uid_cliente, her_nombre, her_marca, her_serial, her_referencia } = req.body;
    if (!uid_cliente || !her_nombre) {
      return res.status(400).json({ success: false, error: 'Cliente y nombre de herramienta son obligatorios' });
    }
    const conn = await db.getConnection();
    const [r] = await conn.execute(
      `INSERT INTO b2c_herramienta (uid_cliente, her_nombre, her_marca, her_serial, her_referencia, her_estado)
       VALUES (?, ?, ?, ?, ?, 'A')`,
      [uid_cliente, her_nombre, her_marca || null, her_serial || null, her_referencia || null]
    );
    conn.release();
    res.json({
      success: true,
      herramienta: { uid_herramienta: r.insertId, her_nombre, her_marca, her_serial, her_referencia },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Crear orden completa ───────────────────────────────────────────────────────
// Body: { uid_cliente, maquinas: [{ uid_herramienta, observaciones }] }
router.post('/crear-orden/orden', async (req, res) => {
  try {
    const { uid_cliente, maquinas } = req.body;
    if (!uid_cliente || !Array.isArray(maquinas) || !maquinas.length) {
      return res.status(400).json({ success: false, error: 'Cliente y al menos una máquina son requeridos' });
    }

    const conn = await db.getConnection();

    // Consecutivo siguiente
    const [[maxRow]] = await conn.execute(`SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden`);
    const consecutivo = maxRow.next;

    // Insertar orden
    const [ordRes] = await conn.execute(
      `INSERT INTO b2c_orden (ord_consecutivo, uid_cliente, ord_estado, ord_total, ord_impuestos, ord_valor_total, ord_fecha)
       VALUES (?, ?, 'A', 0, 0, 0, ?)`,
      [consecutivo, uid_cliente, fechaHoy()]
    );
    const uid_orden = ordRes.insertId;

    // Insertar máquinas en la orden
    const herramientasCreadas = [];
    for (const maq of maquinas) {
      const [hRes] = await conn.execute(
        `INSERT INTO b2c_herramienta_orden (uid_orden, uid_herramienta, hor_observaciones, her_estado)
         VALUES (?, ?, ?, 'pendiente_revision')`,
        [uid_orden, maq.uid_herramienta, maq.observaciones || null]
      );
      herramientasCreadas.push({
        uid_herramienta_orden: hRes.insertId,
        uid_herramienta: maq.uid_herramienta,
      });
    }

    conn.release();
    res.json({ success: true, uid_orden, ord_consecutivo: consecutivo, herramientas: herramientasCreadas });
  } catch (e) {
    console.error('Error creando orden:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Subir foto de recepción ────────────────────────────────────────────────────
router.post('/crear-orden/foto/:herramientaOrdenId', upload.single('foto'), async (req, res) => {
  try {
    const { herramientaOrdenId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen' });

    const conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre)
       VALUES (?, ?, ?)`,
      [herramientaOrdenId, req.file.filename, req.file.originalname]
    );
    conn.release();
    res.json({ success: true, filename: req.file.filename, url: `/uploads/fotos-recepcion/${req.file.filename}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
