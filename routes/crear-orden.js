'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../utils/db');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireInterno } = require('../middleware/auth');
const { addDiasHabiles, toISODate } = require('../utils/dias-habiles');

// Todas las rutas de crear-orden requieren rol interno
router.use(requireInterno);

// ── Multer — almacenamiento de fotos de recepción ────────────────────────────
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

// ── Multer — almacenamiento de facturas de garantía (PDF) ────────────────────
const storageFactura = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'facturas-garantia');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `factura_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  },
});
const uploadFactura = multer({
  storage: storageFactura,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se permiten archivos PDF'));
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

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const like = `%${q}%`;
    const [rows] = await conn.execute(
      `SELECT uid_cliente, cli_identificacion, cli_razon_social, cli_telefono, cli_direccion, cli_contacto
       FROM b2c_cliente
       WHERE tenant_id = ? AND (cli_identificacion LIKE ? OR cli_razon_social LIKE ? OR cli_telefono LIKE ?)
       ORDER BY cli_razon_social
       LIMIT 15`,
      [tenantId, like, like, like]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
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

    const tenantId = req.tenant?.uid_tenant ?? 1;
    // Verificar que no exista ya en este tenant
    const [[existe]] = await conn.execute(
      `SELECT uid_cliente FROM b2c_cliente WHERE cli_identificacion = ? AND tenant_id = ? LIMIT 1`,
      [cli_identificacion, tenantId]
    );
    if (existe) {
      conn.release();
      return res.status(400).json({ success: false, error: `Ya existe un cliente con identificación ${cli_identificacion}` });
    }

    const claveRaw = clave || String(cli_identificacion).slice(-4);
    const hash = await bcrypt.hash(claveRaw, 10);

    // Crear usuario
    const [uRes] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id)
       VALUES (?, ?, ?, 'C', 'A', ?)`,
      [cli_razon_social, cli_identificacion, hash, tenantId]
    );
    const uid_usuario = uRes.insertId;

    // Crear cliente
    const [cRes] = await conn.execute(
      `INSERT INTO b2c_cliente (uid_usuario, cli_identificacion, cli_razon_social, cli_direccion, cli_telefono, cli_contacto, cli_tel_contacto, cli_estado, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'A', ?)`,
      [uid_usuario, cli_identificacion, cli_razon_social, cli_direccion || null, cli_telefono, cli_contacto || null, cli_tel_contacto || null, tenantId]
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
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Historial de máquinas del cliente ─────────────────────────────────────────
router.get('/crear-orden/herramientas/:clienteId', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT uid_herramienta, her_nombre, her_marca, her_serial, her_referencia
       FROM b2c_herramienta
       WHERE uid_cliente = ? AND tenant_id = ?
       ORDER BY her_nombre`,
      [req.params.clienteId, tenantId]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Crear herramienta ──────────────────────────────────────────────────────────
router.post('/crear-orden/herramienta', async (req, res) => {
  try {
    const { uid_cliente, her_nombre, her_marca, her_serial, her_referencia } = req.body;
    if (!uid_cliente || !her_nombre) {
      return res.status(400).json({ success: false, error: 'Cliente y nombre de herramienta son obligatorios' });
    }
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const [r] = await conn.execute(
      `INSERT INTO b2c_herramienta (uid_cliente, her_nombre, her_marca, her_serial, her_referencia, her_estado, tenant_id)
       VALUES (?, ?, ?, ?, ?, 'A', ?)`,
      [uid_cliente, her_nombre, her_marca || null, her_serial || null, her_referencia || null, tenantId]
    );
    conn.release();
    res.json({
      success: true,
      herramienta: { uid_herramienta: r.insertId, her_nombre, her_marca, her_serial, her_referencia },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Crear orden completa ───────────────────────────────────────────────────────
// Body: { uid_cliente, maquinas: [{ uid_herramienta, observaciones }], es_garantia, ord_garantia_vence }
router.post('/crear-orden/orden', async (req, res) => {
  try {
    const { uid_cliente, maquinas, es_garantia, ord_garantia_vence } = req.body;
    if (!uid_cliente || !Array.isArray(maquinas) || !maquinas.length) {
      return res.status(400).json({ success: false, error: 'Cliente y al menos una máquina son requeridos' });
    }
    if (es_garantia && !ord_garantia_vence) {
      return res.status(400).json({ success: false, error: 'La fecha de vencimiento es obligatoria para órdenes de garantía' });
    }

    const tipo = es_garantia ? 'garantia' : 'normal';
    const revisionLimite = es_garantia ? toISODate(addDiasHabiles(new Date(), 2)) : null;
    const conn = await db.getConnection();

    const tenantId = req.tenant?.uid_tenant ?? 1;
    // Consecutivo siguiente (global — los consecutivos son únicos en toda la BD)
    const [[maxRow]] = await conn.execute(`SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden`);
    const consecutivo = maxRow.next;

    // Insertar orden
    const [ordRes] = await conn.execute(
      `INSERT INTO b2c_orden (ord_consecutivo, uid_cliente, ord_estado, ord_total, ord_impuestos, ord_valor_total, ord_fecha, ord_tipo, ord_garantia_vence, ord_revision_limite, tenant_id)
       VALUES (?, ?, 'A', 0, 0, 0, ?, ?, ?, ?, ?)`,
      [consecutivo, uid_cliente, fechaHoy(), tipo, ord_garantia_vence || null, revisionLimite, tenantId]
    );
    const uid_orden = ordRes.insertId;

    // Insertar máquinas en la orden
    const herramientasCreadas = [];
    for (const maq of maquinas) {
      const [hRes] = await conn.execute(
        `INSERT INTO b2c_herramienta_orden (uid_orden, uid_herramienta, hor_observaciones, her_estado, tenant_id)
         VALUES (?, ?, ?, 'pendiente_revision', ?)`,
        [uid_orden, maq.uid_herramienta, maq.observaciones || null, tenantId]
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
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Subir foto de recepción ────────────────────────────────────────────────────
router.post('/crear-orden/foto/:herramientaOrdenId', upload.single('foto'), async (req, res) => {
  try {
    const { herramientaOrdenId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen' });

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre, tenant_id)
       VALUES (?, ?, ?, ?)`,
      [herramientaOrdenId, req.file.filename, req.file.originalname, tenantId]
    );
    conn.release();
    res.json({ success: true, filename: req.file.filename, url: `/uploads/fotos-recepcion/${req.file.filename}` });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Subir factura de garantía (PDF) ───────────────────────────────────────────
router.post('/crear-orden/factura/:uid_orden', uploadFactura.single('factura'), async (req, res) => {
  try {
    const { uid_orden } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ningún PDF' });

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    await conn.execute(
      `UPDATE b2c_orden SET ord_factura = ? WHERE uid_orden = ? AND tenant_id = ?`,
      [req.file.filename, uid_orden, tenantId]
    );
    conn.release();
    res.json({ success: true, filename: req.file.filename });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
