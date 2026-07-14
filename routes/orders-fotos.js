'use strict';
const { getTenantId } = require('../utils/tenant-id');
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { resolveOrder } = require('../utils/schema');
const { requireInterno } = require('../middleware/auth');
const { UPLOADS_DIR, checkMagicBytes } = require('../utils/uploads');
const { isReady, sendWAMessage } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');
const { logAudit } = require('../utils/audit');
const log = require('../utils/logger');
const { ESTADOS_ORIGEN_VALIDOS } = require('../utils/bulk-estados');

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
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[maqCheck]] = await conn.execute(
        `SELECT ho.uid_herramienta_orden
         FROM b2c_herramienta_orden ho
         JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         WHERE ho.uid_herramienta_orden = ? AND o.tenant_id = ?`,
        [req.params.uid_herramienta_orden, tenantId]
      );
      if (!maqCheck) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({ error: 'Máquina no encontrada' });
      }
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
    log.error({ err: e }, 'Error subiendo foto de recepción:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Eliminar foto de recepción ────────────────────────────────────────────────
router.delete('/orders/fotos-recepcion/:uid_foto', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[foto]] = await conn.execute(
        `SELECT fho_archivo FROM b2c_foto_herramienta_orden
         WHERE uid_foto_herramienta_orden = ? AND fho_tipo = 'recepcion' AND tenant_id = ?`,
        [req.params.uid_foto, tenantId]
      );
      if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
      await conn.execute(
        `DELETE FROM b2c_foto_herramienta_orden WHERE uid_foto_herramienta_orden = ? AND tenant_id = ?`,
        [req.params.uid_foto, tenantId]
      );
      try { fs.unlinkSync(path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo)); } catch {}
      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error eliminando foto de recepción:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Subir foto del trabajo ────────────────────────────────────────────────────
router.post('/orders/:id/fotos-trabajo/:uid_herramienta_orden', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    await checkMagicBytes(req.file.path, ['image/']);
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[maqCheck]] = await conn.execute(
        `SELECT ho.uid_herramienta_orden
         FROM b2c_herramienta_orden ho
         JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         WHERE ho.uid_herramienta_orden = ? AND o.tenant_id = ?`,
        [req.params.uid_herramienta_orden, tenantId]
      );
      if (!maqCheck) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({ error: 'Máquina no encontrada' });
      }
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
    log.error({ err: e }, 'Error subiendo foto de trabajo:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Eliminar foto del trabajo ─────────────────────────────────────────────────
router.delete('/orders/fotos-trabajo/:uid_foto', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[foto]] = await conn.execute(
        `SELECT fho_archivo FROM b2c_foto_herramienta_orden
         WHERE uid_foto_herramienta_orden = ? AND fho_tipo = 'trabajo' AND tenant_id = ?`,
        [req.params.uid_foto, tenantId]
      );
      if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
      await conn.execute(
        `DELETE FROM b2c_foto_herramienta_orden WHERE uid_foto_herramienta_orden = ? AND tenant_id = ?`,
        [req.params.uid_foto, tenantId]
      );
      try { fs.unlinkSync(path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo)); } catch {}
      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error eliminando foto de trabajo:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Subir factura de garantía por máquina ─────────────────────────────────────
router.post('/orders/:orderId/factura-maquina/:uid_herramienta_orden', uploadFactura.single('factura'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    log.error({ err: e }, 'Error agregando máquina a orden:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Entregar máquina: captura datos + firma, cambia estado, envía WA ──────────
const firmaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'firmas-entrega');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `firma_${req.params.uid}_${Date.now()}.png`);
  },
});
const uploadFirma = multer({
  storage: firmaStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype === 'image/png' ? cb(null, true) : cb(new Error('La firma debe ser PNG'));
  },
});

router.post('/orders/equipment/:uid/entregar', uploadFirma.single('firma'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const uid = String(req.params.uid);
    const { entrega_nombre, entrega_telefono, entrega_cedula } = req.body;

    if (!entrega_nombre?.trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'El nombre de quien recoge es obligatorio' });
    }
    if (!entrega_telefono?.trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'El teléfono de quien recoge es obligatorio' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'La firma es obligatoria' });
    }
    await checkMagicBytes(req.file.path, ['image/png']);

    const conn = await db.getConnection();
    try {
      // Verificar que la máquina pertenece a este tenant
      const [[maqRow]] = await conn.execute(
        `SELECT ho.uid_herramienta_orden, ho.uid_orden, ho.her_estado,
                h.her_nombre, h.her_marca,
                c.cli_razon_social, c.cli_telefono,
                o.ord_consecutivo
         FROM b2c_herramienta_orden ho
         JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
         WHERE ho.uid_herramienta_orden = ? AND o.tenant_id = ?`,
        [uid, tenantId]
      );
      if (!maqRow) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({ error: 'Máquina no encontrada' });
      }

      await conn.execute(
        `UPDATE b2c_herramienta_orden
         SET her_estado = 'entregada',
             hor_entrega_nombre   = ?,
             hor_entrega_telefono = ?,
             hor_entrega_cedula   = ?,
             hor_entrega_firma    = ?,
             hor_entrega_fecha    = NOW()
         WHERE uid_herramienta_orden = ?`,
        [entrega_nombre.trim(), entrega_telefono.trim(), entrega_cedula?.trim() || null, req.file.filename, uid]
      );
      await conn.execute(
        `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, 'entregada', ?)`,
        [uid, tenantId]
      );

      // WA: notificar entrega al cliente (misma plantilla que notify-delivered, fallo silencioso)
      if (isReady(tenantId)) {
        try {
          const [entregadas] = await conn.execute(
            `SELECT h.her_nombre, h.her_marca
             FROM b2c_herramienta_orden ho
             JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
             WHERE ho.uid_orden = ? AND ho.her_estado = 'entregada'
             ORDER BY ho.uid_herramienta_orden`,
            [maqRow.uid_orden]
          );
          const nombre = maqRow.cli_razon_social || 'cliente';
          const lista = entregadas.map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`).join('\n');
          const msg =
            `Hola ${nombre}, confirmamos la entrega de las siguientes herramientas:\n\n` +
            `${lista}\n\n` +
            `¡Gracias por confiar en nosotros!\n— SU HERRAMIENTA CST`;
          const chatIds = parseColombianPhones(maqRow.cli_telefono);
          for (const chatId of chatIds) {
            sendWAMessage(tenantId, chatId, msg).catch(e => log.warn({ err: e.message }, 'WA entrega: fallo silencioso'));
          }
        } catch (e) {
          log.warn({ err: e.message }, 'WA entrega: error preparando notificación');
        }
      }

      await logAudit(db, {
        tenantId, userId: req.session?.user?.id,
        accion: 'estado_cambiado', entidad: 'herramienta_orden', uidEntidad: uid,
        datosDespues: { estado: 'entregada', entrega_nombre: entrega_nombre.trim() },
        ip: req.ip,
      });

      res.json({ success: true, status: 'entregada', firma: req.file.filename });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error registrando entrega:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Multer separado para firma bulk (usa orderId, no uid de máquina) ───────────
const firmaStorageBulk = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'firmas-entrega');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `firma_orden${req.params.orderId}_${Date.now()}.png`);
  },
});
const uploadFirmaBulk = multer({
  storage: firmaStorageBulk,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype === 'image/png' ? cb(null, true) : cb(new Error('La firma debe ser PNG'));
  },
});

// ── Entregar múltiples máquinas: firma compartida, misma persona ──────────────
router.post('/orders/:orderId/equipment/bulk-entregar', uploadFirmaBulk.single('firma'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { entrega_nombre, entrega_telefono, entrega_cedula } = req.body;

    // Parsear uids — el frontend los envía como JSON string en FormData
    let uids;
    try { uids = JSON.parse(req.body.uids); } catch { uids = []; }

    if (!Array.isArray(uids) || uids.length === 0) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'uids debe ser un array no vacío' });
    }
    if (!entrega_nombre?.trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'El nombre de quien recoge es obligatorio' });
    }
    if (!entrega_telefono?.trim()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'El teléfono de quien recoge es obligatorio' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'La firma es obligatoria' });
    }
    await checkMagicBytes(req.file.path, ['image/png']);

    const safeUids = uids.map(u => Number(u)).filter(u => Number.isInteger(u) && u > 0);
    if (safeUids.length !== uids.length) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'uids deben ser enteros positivos' });
    }

    const conn = await db.getConnection();
    try {
      // Verificar orden y tenant
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({ error: 'Orden no encontrada' });
      }

      // Ownership check: todos los uids deben pertenecer a esta orden y tenant
      const ph = safeUids.map(() => '?').join(',');
      const [[{ count }]] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM b2c_herramienta_orden
         WHERE uid_herramienta_orden IN (${ph}) AND uid_orden = ? AND tenant_id = ?`,
        [...safeUids, order.uid_orden, tenantId]
      );
      if (Number(count) !== safeUids.length) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({ error: 'Una o más máquinas no pertenecen a esta orden' });
      }

      // Elegibles: solo las en estado 'reparada' (ESTADOS_ORIGEN_VALIDOS['entregada'])
      const origenesValidos = ESTADOS_ORIGEN_VALIDOS['entregada']; // ['reparada']
      const [eligibleRows] = await conn.execute(
        `SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca,
                c.cli_razon_social, c.cli_telefono, o.ord_consecutivo
         FROM b2c_herramienta_orden ho
         JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
         WHERE ho.uid_herramienta_orden IN (${ph}) AND ho.tenant_id = ?
           AND ho.her_estado IN (${origenesValidos.map(() => '?').join(',')})`,
        [...safeUids, tenantId, ...origenesValidos]
      );

      const eligibleIds = eligibleRows.map(r => r.uid_herramienta_orden);
      const updated = eligibleIds.length;
      const skipped = safeUids.length - updated;

      if (eligibleIds.length > 0) {
        const firmaFilename = req.file.filename;
        const eligPH = eligibleIds.map(() => '?').join(',');

        // Firma guardada una vez — referenciada en todos los registros
        await conn.execute(
          `UPDATE b2c_herramienta_orden
           SET her_estado = 'entregada',
               hor_entrega_nombre   = ?,
               hor_entrega_telefono = ?,
               hor_entrega_cedula   = ?,
               hor_entrega_firma    = ?,
               hor_entrega_fecha    = NOW()
           WHERE uid_herramienta_orden IN (${eligPH}) AND tenant_id = ?`,
          [entrega_nombre.trim(), entrega_telefono.trim(), entrega_cedula?.trim() || null, firmaFilename, ...eligibleIds, tenantId]
        );

        for (const id of eligibleIds) {
          await conn.execute(
            `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, 'entregada', ?)`,
            [id, tenantId]
          );
        }

        // WA — un mensaje listando todas las máquinas entregadas
        if (isReady(tenantId)) {
          try {
            const r0 = eligibleRows[0];
            const nombre = r0.cli_razon_social || 'cliente';
            const lista = eligibleRows.map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`).join('\n');
            const msg = `Hola ${nombre}, confirmamos la entrega de las siguientes herramientas:\n\n${lista}\n\n¡Gracias por confiar en nosotros!\n— SU HERRAMIENTA CST`;
            const chatIds = parseColombianPhones(r0.cli_telefono);
            for (const chatId of chatIds) {
              sendWAMessage(tenantId, chatId, msg).catch(e => log.warn({ err: e.message }, 'WA bulk entrega: fallo silencioso'));
            }
          } catch (e) {
            log.warn({ err: e.message }, 'WA bulk entrega: error preparando notificación');
          }
        }

        const userId = req.session?.user?.id;
        for (const id of eligibleIds) {
          await logAudit(db, {
            tenantId, userId,
            accion: 'estado_cambiado', entidad: 'herramienta_orden', uidEntidad: id,
            datosDespues: { estado: 'entregada', entrega_nombre: entrega_nombre.trim(), bulk: true },
            ip: req.ip,
          });
        }
      } else {
        // Ninguna elegible — borrar firma subida (no se usará)
        try { fs.unlinkSync(req.file.path); } catch {}
      }

      res.json({ updated, skipped, firma: updated > 0 ? req.file.filename : null });
    } finally {
      conn.release();
    }
  } catch (e) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    log.error({ err: e }, 'Error en bulk-entregar:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
