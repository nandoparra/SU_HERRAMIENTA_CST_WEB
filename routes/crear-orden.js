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
const { UPLOADS_DIR, checkMagicBytes } = require('../utils/uploads');

// Todas las rutas de crear-orden requieren rol interno
router.use(requireInterno);

// ── Multer — almacenamiento de fotos de recepción ────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'fotos-recepcion');
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
    const dir = path.join(UPLOADS_DIR, 'facturas-garantia');
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
    const like = `%${q}%`;
    const conn = await db.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT uid_cliente, cli_identificacion, cli_razon_social, cli_telefono, cli_direccion, cli_contacto
         FROM b2c_cliente
         WHERE tenant_id = ? AND (cli_identificacion LIKE ? OR cli_razon_social LIKE ? OR cli_telefono LIKE ?)
         ORDER BY cli_razon_social
         LIMIT 15`,
        [tenantId, like, like, like]
      );
      res.json(rows);
    } finally {
      conn.release();
    }
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

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Verificar que no exista ya en este tenant
      const [[existe]] = await conn.execute(
        `SELECT uid_cliente FROM b2c_cliente WHERE cli_identificacion = ? AND tenant_id = ? LIMIT 1`,
        [cli_identificacion, tenantId]
      );
      if (existe) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: `Ya existe un cliente con identificación ${cli_identificacion}` });
      }

      const claveRaw = clave || require('crypto').randomBytes(4).toString('hex'); // 8 hex chars aleatorios
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

      await conn.commit();
      res.json({
        success: true,
        clave_acceso: clave ? null : claveRaw, // solo se devuelve si fue autogenerada
        cliente: {
          uid_cliente: cRes.insertId,
          cli_identificacion,
          cli_razon_social,
          cli_telefono,
          cli_direccion: cli_direccion || null,
          cli_contacto: cli_contacto || null,
        },
      });
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    } finally {
      conn.release();
    }
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
    try {
      const [rows] = await conn.execute(
        `SELECT uid_herramienta, her_nombre, her_marca, her_serial, her_referencia
         FROM b2c_herramienta
         WHERE uid_cliente = ? AND tenant_id = ?
         ORDER BY her_nombre`,
        [req.params.clienteId, tenantId]
      );
      res.json(rows);
    } finally {
      conn.release();
    }
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
    try {
      const [r] = await conn.execute(
        `INSERT INTO b2c_herramienta (uid_cliente, her_nombre, her_marca, her_serial, her_referencia, her_estado, tenant_id)
         VALUES (?, ?, ?, ?, ?, 'A', ?)`,
        [uid_cliente, her_nombre, her_marca || null, her_serial || null, her_referencia || null, tenantId]
      );
      res.json({
        success: true,
        herramienta: { uid_herramienta: r.insertId, her_nombre, her_marca, her_serial, her_referencia },
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Crear orden completa ───────────────────────────────────────────────────────
// Body: { uid_cliente, maquinas: [{ uid_herramienta, observaciones, es_garantia, garantia_vence }] }
// ord_tipo se calcula automáticamente: 'garantia' si alguna máquina tiene es_garantia=true
router.post('/crear-orden/orden', async (req, res) => {
  try {
    const { uid_cliente, maquinas } = req.body;
    if (!uid_cliente || !Array.isArray(maquinas) || !maquinas.length) {
      return res.status(400).json({ success: false, error: 'Cliente y al menos una máquina son requeridos' });
    }

    // Validar que todas las máquinas marcadas como garantía tengan fecha
    for (const maq of maquinas) {
      if (maq.es_garantia && !maq.garantia_vence) {
        return res.status(400).json({ success: false, error: 'La fecha de vencimiento es obligatoria para cada máquina en garantía' });
      }
    }

    // ord_tipo = 'garantia' si al menos una máquina es garantía
    const tieneGarantia = maquinas.some(m => m.es_garantia);
    const tipo = tieneGarantia ? 'garantia' : 'normal';
    const revisionLimite = tieneGarantia ? toISODate(addDiasHabiles(new Date(), 2)) : null;

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Consecutivo siguiente (global — los consecutivos son únicos en toda la BD)
      const [[maxRow]] = await conn.execute(`SELECT COALESCE(MAX(ord_consecutivo), 0) + 1 AS next FROM b2c_orden`);
      const consecutivo = maxRow.next;

      // Insertar orden (ord_garantia_vence en nivel orden ya no aplica — es por máquina)
      const [ordRes] = await conn.execute(
        `INSERT INTO b2c_orden (ord_consecutivo, uid_cliente, ord_estado, ord_total, ord_impuestos, ord_valor_total, ord_fecha, ord_tipo, ord_revision_limite, tenant_id)
         VALUES (?, ?, 'A', 0, 0, 0, ?, ?, ?, ?)`,
        [consecutivo, uid_cliente, fechaHoy(), tipo, revisionLimite, tenantId]
      );
      const uid_orden = ordRes.insertId;

      // Insertar máquinas en la orden con campos de garantía por máquina
      const herramientasCreadas = [];
      for (const maq of maquinas) {
        const esGarantia = maq.es_garantia ? 1 : 0;
        const [hRes] = await conn.execute(
          `INSERT INTO b2c_herramienta_orden (uid_orden, uid_herramienta, hor_observaciones, her_estado, hor_es_garantia, hor_garantia_vence, tenant_id)
           VALUES (?, ?, ?, 'pendiente_revision', ?, ?, ?)`,
          [uid_orden, maq.uid_herramienta, maq.observaciones || null, esGarantia, maq.garantia_vence || null, tenantId]
        );
        herramientasCreadas.push({
          uid_herramienta_orden: hRes.insertId,
          uid_herramienta: maq.uid_herramienta,
          es_garantia: esGarantia,
        });
      }

      await conn.commit();
      res.json({ success: true, uid_orden, ord_consecutivo: consecutivo, herramientas: herramientasCreadas });
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    } finally {
      conn.release();
    }
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
    await checkMagicBytes(req.file.path, ['image/']);
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre, tenant_id)
         VALUES (?, ?, ?, ?)`,
        [herramientaOrdenId, req.file.filename, req.file.originalname, tenantId]
      );
      res.json({ success: true, filename: req.file.filename, url: `/uploads/fotos-recepcion/${req.file.filename}` });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Subir factura de garantía nivel orden (PDF) — legacy, mantener para compat ─
router.post('/crear-orden/factura/:uid_orden', uploadFactura.single('factura'), async (req, res) => {
  try {
    const { uid_orden } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ningún PDF' });
    await checkMagicBytes(req.file.path, ['application/pdf']);
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `UPDATE b2c_orden SET ord_factura = ? WHERE uid_orden = ? AND tenant_id = ?`,
        [req.file.filename, uid_orden, tenantId]
      );
      res.json({ success: true, filename: req.file.filename });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ── Subir factura de garantía por máquina (PDF) ───────────────────────────────
// Guarda el PDF y actualiza hor_garantia_factura en b2c_herramienta_orden
router.post('/crear-orden/factura-maquina/:uid_herramienta_orden', uploadFactura.single('factura'), async (req, res) => {
  try {
    const { uid_herramienta_orden } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ningún PDF' });
    await checkMagicBytes(req.file.path, ['application/pdf']);
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      // Validar que la herramienta_orden pertenece al tenant
      const [[row]] = await conn.execute(
        `SELECT ho.uid_herramienta_orden FROM b2c_herramienta_orden ho
         JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         WHERE ho.uid_herramienta_orden = ? AND o.tenant_id = ?`,
        [uid_herramienta_orden, tenantId]
      );
      if (!row) return res.status(404).json({ success: false, error: 'Máquina no encontrada' });

      await conn.execute(
        `UPDATE b2c_herramienta_orden SET hor_garantia_factura = ? WHERE uid_herramienta_orden = ?`,
        [req.file.filename, uid_herramienta_orden]
      );
      res.json({ success: true, filename: req.file.filename, url: `/uploads/facturas-garantia/${req.file.filename}` });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
