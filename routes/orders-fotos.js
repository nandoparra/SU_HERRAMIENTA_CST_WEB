'use strict';
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { resolveOrder } = require('../utils/schema');
const { requireInterno } = require('../middleware/auth');
const { UPLOADS_DIR, checkMagicBytes } = require('../utils/uploads');

router.use(requireInterno);

// ── Multer para fotos ─────────────────────────────────────────────────────────
const fotoStorage = multer.diskStorage({
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
const uploadFoto = multer({
  storage: fotoStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

const facturaStorage = multer.diskStorage({
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
  storage: facturaStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Solo PDF'));
  },
});

// ── Subir foto de recepción (post-creación) ───────────────────────────────────
router.post('/orders/:id/fotos-recepcion/:uid_herramienta_orden', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    await checkMagicBytes(req.file.path, ['image/']);
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre, fho_tipo)
         VALUES (?, ?, ?, 'recepcion')`,
        [req.params.uid_herramienta_orden, req.file.filename, req.file.originalname]
      );
      const [[ins]] = await conn.execute('SELECT LAST_INSERT_ID() AS id');
      res.json({
        success:  true,
        uid_foto: ins.id,
        filename: req.file.filename,
        url:      '/uploads/fotos-recepcion/' + req.file.filename,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error subiendo foto de recepción:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Eliminar foto de recepción ────────────────────────────────────────────────
router.delete('/orders/fotos-recepcion/:uid_foto', async (req, res) => {
  try {
    const conn = await db.getConnection();
    try {
      const [[foto]] = await conn.execute(
        `SELECT fho_archivo FROM b2c_foto_herramienta_orden
         WHERE uid_foto_herramienta_orden = ? AND fho_tipo = 'recepcion'`,
        [req.params.uid_foto]
      );
      if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
      await conn.execute(
        `DELETE FROM b2c_foto_herramienta_orden WHERE uid_foto_herramienta_orden = ?`,
        [req.params.uid_foto]
      );
      try { fs.unlinkSync(path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo)); } catch {}
      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error eliminando foto de recepción:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Subir foto del trabajo ────────────────────────────────────────────────────
router.post('/orders/:id/fotos-trabajo/:uid_herramienta_orden', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    await checkMagicBytes(req.file.path, ['image/']);
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre, fho_tipo)
         VALUES (?, ?, ?, 'trabajo')`,
        [req.params.uid_herramienta_orden, req.file.filename, req.file.originalname]
      );
      const [[ins]] = await conn.execute('SELECT LAST_INSERT_ID() AS id');
      res.json({
        success:   true,
        uid_foto:  ins.id,
        filename:  req.file.filename,
        url:       '/uploads/fotos-recepcion/' + req.file.filename,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error subiendo foto de trabajo:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Eliminar foto del trabajo ─────────────────────────────────────────────────
router.delete('/orders/fotos-trabajo/:uid_foto', async (req, res) => {
  try {
    const conn = await db.getConnection();
    try {
      const [[foto]] = await conn.execute(
        `SELECT fho_archivo FROM b2c_foto_herramienta_orden
         WHERE uid_foto_herramienta_orden = ? AND fho_tipo = 'trabajo'`,
        [req.params.uid_foto]
      );
      if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
      await conn.execute(
        `DELETE FROM b2c_foto_herramienta_orden WHERE uid_foto_herramienta_orden = ?`,
        [req.params.uid_foto]
      );
      try { fs.unlinkSync(path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo)); } catch {}
      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error eliminando foto de trabajo:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Subir factura de garantía por máquina ─────────────────────────────────────
router.post('/orders/:orderId/factura-maquina/:uid_herramienta_orden', uploadFactura.single('factura'), async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún PDF' });
    await checkMagicBytes(req.file.path, ['application/pdf']);
    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

      const { uid_herramienta_orden } = req.params;
      const [[row]] = await conn.execute(
        `SELECT uid_herramienta_orden FROM b2c_herramienta_orden WHERE uid_herramienta_orden = ? AND uid_orden = ?`,
        [uid_herramienta_orden, order.uid_orden]
      );
      if (!row) return res.status(404).json({ error: 'Máquina no encontrada en esta orden' });

      await conn.execute(
        `UPDATE b2c_herramienta_orden SET hor_garantia_factura = ? WHERE uid_herramienta_orden = ?`,
        [req.file.filename, uid_herramienta_orden]
      );
      res.json({ success: true, filename: req.file.filename, url: `/uploads/facturas-garantia/${req.file.filename}` });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Agregar máquina a orden existente ────────────────────────────────────────
router.post('/orders/:orderId/agregar-maquina', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const { uid_herramienta, observaciones, es_garantia, garantia_vence } = req.body;
    if (!uid_herramienta) return res.status(400).json({ error: 'uid_herramienta requerido' });
    if (es_garantia && !garantia_vence) return res.status(400).json({ error: 'La fecha de vencimiento es obligatoria para máquinas en garantía' });

    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

      const [[herr]] = await conn.execute(
        `SELECT uid_herramienta FROM b2c_herramienta WHERE uid_herramienta = ? AND tenant_id = ?`,
        [uid_herramienta, tenantId]
      );
      if (!herr) return res.status(404).json({ error: 'Máquina no encontrada' });

      const [[yaEnOrden]] = await conn.execute(
        `SELECT uid_herramienta_orden FROM b2c_herramienta_orden WHERE uid_orden = ? AND uid_herramienta = ?`,
        [order.uid_orden, uid_herramienta]
      );
      if (yaEnOrden) return res.status(409).json({ error: 'La máquina ya está en esta orden' });

      const esGarantia = es_garantia ? 1 : 0;
      await conn.execute(
        `INSERT INTO b2c_herramienta_orden (uid_orden, uid_herramienta, hor_observaciones, her_estado, hor_es_garantia, hor_garantia_vence, tenant_id)
         VALUES (?, ?, ?, 'pendiente_revision', ?, ?, ?)`,
        [order.uid_orden, uid_herramienta, observaciones || null, esGarantia, garantia_vence || null, tenantId]
      );
      const [[ins]] = await conn.execute('SELECT LAST_INSERT_ID() AS id');

      if (esGarantia) {
        await conn.execute(
          `UPDATE b2c_orden SET ord_tipo = 'garantia' WHERE uid_orden = ? AND ord_tipo != 'garantia'`,
          [order.uid_orden]
        );
      }

      res.json({ success: true, uid_herramienta_orden: ins.id, es_garantia: esGarantia });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error agregando máquina a orden:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
