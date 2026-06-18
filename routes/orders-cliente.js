'use strict';
const { getTenantId } = require('../utils/tenant-id');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../utils/db');
const path = require('path');
const fs   = require('fs');
const { UPLOADS_DIR, checkMagicBytes } = require('../utils/uploads');
const { enviarListaRepuestos } = require('../utils/repuestos-notifier');
const { logAudit } = require('../utils/audit');
const log = require('../utils/logger');

const solicitudFotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'solicitudes-recogida');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `sol_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const uploadSolicitudFoto = multer({
  storage: solicitudFotoStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

// Fotos por item (máquina) van a fotos-recepcion/ para que cuando se convierta en orden
// el path en b2c_foto_herramienta_orden ya sea el correcto para el módulo de órdenes.
const itemFotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'fotos-recepcion');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `sol_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const uploadItemFoto = multer({
  storage: itemFotoStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

// Rutas de portal cliente — NO requieren requireInterno (tipo C).
// Este router se monta ANTES de orders.js en server.js para que las rutas /cliente/*
// sean capturadas aquí y nunca lleguen al middleware requireInterno de orders.js.
// Cada handler valida explícitamente que user.tipo === 'C'.

// Órdenes del cliente logueado (seguimiento)
router.get('/cliente/mis-ordenes', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user || user.tipo !== 'C') return res.status(403).json([]);

    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[cli]] = await conn.execute(
        `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? AND tenant_id = ? LIMIT 1`,
        [user.id, tenantId]
      );
      if (!cli) return res.json([]);

      const [ordenes] = await conn.execute(
        `SELECT uid_orden, ord_consecutivo, ord_fecha, ord_estado
         FROM b2c_orden WHERE uid_cliente = ? AND tenant_id = ?
         ORDER BY ord_fecha DESC LIMIT 50`,
        [cli.uid_cliente, tenantId]
      );
      if (!ordenes.length) return res.json([]);

      const ordenIds = ordenes.map(o => o.uid_orden);
      const ph = ordenIds.map(() => '?').join(',');

      const [todasMaquinas] = await conn.execute(
        `SELECT ho.uid_herramienta_orden, ho.uid_orden,
                ho.her_estado, ho.hor_observaciones, ho.hor_fecha_prom_entrega,
                h.her_nombre, h.her_marca, h.her_serial
         FROM b2c_herramienta_orden ho
         JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         WHERE ho.uid_orden IN (${ph})
         ORDER BY ho.uid_herramienta_orden`,
        ordenIds
      );

      const maqIds = todasMaquinas.map(m => m.uid_herramienta_orden);

      let statusMap = {}, cotMap = {}, itemsMap = {}, informeMap = {};
      if (maqIds.length) {
        const mhp = maqIds.map(() => '?').join(',');

        const [logs] = await conn.execute(
          `SELECT uid_herramienta_orden, estado, changed_at
           FROM b2c_herramienta_status_log
           WHERE uid_herramienta_orden IN (${mhp})
           ORDER BY id ASC`,
          maqIds
        );
        logs.forEach(l => {
          const k = String(l.uid_herramienta_orden);
          if (!statusMap[k]) statusMap[k] = [];
          statusMap[k].push({ estado: l.estado, changed_at: l.changed_at });
        });

        const [cots] = await conn.execute(
          `SELECT uid_herramienta_orden, mano_obra, descripcion_trabajo, subtotal
           FROM b2c_cotizacion_maquina
           WHERE uid_herramienta_orden IN (${mhp})`,
          maqIds
        );
        cots.forEach(c => { cotMap[String(c.uid_herramienta_orden)] = c; });

        const [items] = await conn.execute(
          `SELECT uid_herramienta_orden, nombre, cantidad, precio, subtotal
           FROM b2c_cotizacion_item
           WHERE uid_herramienta_orden IN (${mhp})
           ORDER BY uid_herramienta_orden`,
          maqIds
        );
        items.forEach(i => {
          const k = String(i.uid_herramienta_orden);
          if (!itemsMap[k]) itemsMap[k] = [];
          itemsMap[k].push(i);
        });

        const [informeRows] = await conn.execute(
          `SELECT uid_herramienta_orden, uid_informe, inf_fecha, inf_archivo
           FROM b2c_informe_mantenimiento
           WHERE uid_herramienta_orden IN (${mhp})`,
          maqIds
        );
        informeRows.forEach(i => { informeMap[String(i.uid_herramienta_orden)] = i; });
      }

      const maqByOrden = {};
      todasMaquinas.forEach(m => {
        const k = String(m.uid_herramienta_orden);
        m.historial  = statusMap[k]  || [];
        m.cotizacion = cotMap[k]     || null;
        m.items      = itemsMap[k]   || [];
        m.informe    = informeMap[k] ? { uid_informe: informeMap[k].uid_informe, inf_fecha: informeMap[k].inf_fecha } : null;
        if (!maqByOrden[m.uid_orden]) maqByOrden[m.uid_orden] = [];
        maqByOrden[m.uid_orden].push(m);
      });

      ordenes.forEach(o => { o.maquinas = maqByOrden[o.uid_orden] || []; });
      res.json(ordenes);
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error mis-ordenes:');
    res.status(500).json([]);
  }
});

// Informe de mantenimiento — acceso cliente con validación de propiedad
router.get('/cliente/informe/:uid_herramienta_orden', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    let row;
    try {
      const [[r]] = await conn.execute(
        `SELECT i.inf_archivo
         FROM b2c_informe_mantenimiento i
         JOIN b2c_herramienta_orden ho ON ho.uid_herramienta_orden = i.uid_herramienta_orden
         JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
         WHERE i.uid_herramienta_orden = ? AND c.uid_usuario = ? AND o.tenant_id = ?
         LIMIT 1`,
        [req.params.uid_herramienta_orden, user.id, tenantId]
      );
      row = r;
    } finally {
      conn.release();
    }
    if (!row) return res.status(404).json({ error: 'Informe no encontrado' });
    const fpath = path.join(UPLOADS_DIR, 'informes-mantenimiento', row.inf_archivo);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${row.inf_archivo}"` });
    fs.createReadStream(fpath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Autorizar o rechazar máquina desde portal cliente
router.patch('/cliente/maquina/:uid_herramienta_orden/autorizar', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Solo clientes pueden usar este endpoint' });

  const { decision } = req.body;
  if (!['autorizada', 'no_autorizada'].includes(decision)) {
    return res.status(400).json({ error: "decision debe ser 'autorizada' o 'no_autorizada'" });
  }

  const uid = Number(req.params.uid_herramienta_orden);
  if (!uid) return res.status(400).json({ error: 'uid inválido' });

  let conn;
  try {
    conn = await db.getConnection();

    const tenantId = getTenantId(req);
    const [[maq]] = await conn.execute(
      `SELECT ho.uid_herramienta_orden, ho.uid_orden, ho.her_estado
       FROM b2c_herramienta_orden ho
       JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
       JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
       WHERE ho.uid_herramienta_orden = ? AND c.uid_usuario = ? AND o.tenant_id = ?
       LIMIT 1`,
      [uid, user.id, tenantId]
    );
    if (!maq) return res.status(403).json({ error: 'No autorizado o máquina no encontrada' });
    if (maq.her_estado !== 'cotizada') {
      return res.status(409).json({ error: `La máquina no puede modificarse (estado actual: ${maq.her_estado})` });
    }

    await conn.beginTransaction();
    try {
      await conn.execute(
        `UPDATE b2c_herramienta_orden SET her_estado = ? WHERE uid_herramienta_orden = ?`,
        [decision, uid]
      );
      await conn.execute(
        `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado) VALUES (?, ?)`,
        [uid, decision]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }

    await logAudit(db, { tenantId, userId: user.id, accion: decision === 'autorizada' ? 'cotizacion_autorizada' : 'cotizacion_rechazada', entidad: 'herramienta_orden', uidEntidad: uid, datosDespues: { decision }, ip: req.ip });

    if (decision === 'autorizada') {
      try {
        const [[orderRow]] = await conn.execute(
          `SELECT ord_consecutivo FROM b2c_orden WHERE uid_orden = ?`,
          [maq.uid_orden]
        );
        await enviarListaRepuestos(conn, tenantId, maq.uid_orden, orderRow?.ord_consecutivo || maq.uid_orden);
      } catch (waErr) {
        log.warn({ err: waErr.message }, '⚠️ orders-cliente: error enviando lista de repuestos por WA (autorización guardada):');
      }
    }

    res.json({ success: true, her_estado: decision });
  } catch (e) {
    log.error({ err: e }, 'Error en autorización cliente:');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// ── KPIs resumen para el dashboard del cliente ────────────────────────────────
router.get('/cliente/kpis', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[cli]] = await conn.execute(
        `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? AND tenant_id = ? LIMIT 1`,
        [user.id, tenantId]
      );
      if (!cli) return res.json({ ordenes_activas: 0, maquinas_registradas: 0, listas_para_recoger: 0, solicitudes_pendientes: 0 });

      const [[kpis]] = await conn.execute(
        `SELECT
           COUNT(DISTINCT o.uid_orden) AS ordenes_activas,
           COUNT(DISTINCT h.uid_herramienta) AS maquinas_registradas,
           SUM(IF(ho.her_estado = 'reparada', 1, 0)) AS listas_para_recoger
         FROM b2c_orden o
         LEFT JOIN b2c_herramienta_orden ho ON ho.uid_orden = o.uid_orden
         LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         WHERE o.uid_cliente = ? AND o.tenant_id = ? AND o.ord_estado != 'C'`,
        [cli.uid_cliente, tenantId]
      );

      const [[solRow]] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM b2c_solicitud_recogida
         WHERE uid_cliente = ? AND tenant_id = ? AND estado = 'pendiente'`,
        [cli.uid_cliente, tenantId]
      );

      res.json({
        ordenes_activas:       Number(kpis.ordenes_activas   || 0),
        maquinas_registradas:  Number(kpis.maquinas_registradas || 0),
        listas_para_recoger:   Number(kpis.listas_para_recoger || 0),
        solicitudes_pendientes: Number(solRow.cnt || 0),
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error kpis cliente:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Máquinas del cliente (inventario) ─────────────────────────────────────────
router.get('/cliente/mis-maquinas', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json([]);
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[cli]] = await conn.execute(
        `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? AND tenant_id = ? LIMIT 1`,
        [user.id, tenantId]
      );
      if (!cli) return res.json([]);

      const [maquinas] = await conn.execute(
        `SELECT h.uid_herramienta, h.her_nombre, h.her_marca, h.her_serial, h.her_referencia,
                MAX(ho.her_estado) AS ultimo_estado,
                MAX(o.ord_fecha) AS ultima_orden_fecha
         FROM b2c_herramienta h
         LEFT JOIN b2c_herramienta_orden ho ON ho.uid_herramienta = h.uid_herramienta
         LEFT JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
         WHERE h.uid_cliente = ? AND h.tenant_id = ?
         GROUP BY h.uid_herramienta
         ORDER BY h.her_nombre`,
        [cli.uid_cliente, tenantId]
      );
      res.json(maquinas);
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error mis-maquinas:');
    res.status(500).json([]);
  }
});

// ── Crear solicitud de recogida (multi-máquina) ────────────────────────────────
router.post('/cliente/solicitudes', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });

  const { maquinas, direccion, fecha_sugerida } = req.body;
  if (!direccion) return res.status(400).json({ error: 'La dirección de recogida es obligatoria' });
  if (!Array.isArray(maquinas) || !maquinas.length) return res.status(400).json({ error: 'Agrega al menos una máquina' });
  for (const m of maquinas) {
    if (!m.uid_herramienta && !m.her_nombre?.trim()) {
      return res.status(400).json({ error: 'Cada máquina debe tener nombre o ser seleccionada del inventario' });
    }
  }

  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[cli]] = await conn.execute(
        `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? AND tenant_id = ? LIMIT 1`,
        [user.id, tenantId]
      );
      if (!cli) return res.status(403).json({ error: 'Cliente no encontrado' });

      await conn.beginTransaction();
      try {
        await conn.execute(
          `INSERT INTO b2c_solicitud_recogida (tenant_id, uid_cliente, direccion, fecha_sugerida)
           VALUES (?, ?, ?, ?)`,
          [tenantId, cli.uid_cliente, direccion, fecha_sugerida || null]
        );
        const [[ins]] = await conn.execute('SELECT LAST_INSERT_ID() AS id');
        const uid_solicitud = ins.id;

        const item_ids = [];
        for (const m of maquinas) {
          let uid_h  = m.uid_herramienta || null;
          let nombre = (m.her_nombre || '').trim();
          let marca  = m.her_marca  || null;
          let serial = m.her_serial || null;

          if (uid_h) {
            // Máquina existente — leer datos actuales para denormalizar en el item
            const [[h]] = await conn.execute(
              `SELECT her_nombre, her_marca, her_serial FROM b2c_herramienta
               WHERE uid_herramienta = ? AND uid_cliente = ? AND tenant_id = ?`,
              [uid_h, cli.uid_cliente, tenantId]
            );
            if (h) { nombre = h.her_nombre; marca = h.her_marca; serial = h.her_serial; }
          } else {
            // Máquina nueva — guardar en b2c_herramienta para que quede en el inventario del cliente
            const referencia = m.her_referencia || null;
            const [newH] = await conn.execute(
              `INSERT INTO b2c_herramienta (uid_cliente, her_nombre, her_marca, her_serial, her_referencia, her_estado, tenant_id)
               VALUES (?, ?, ?, ?, ?, 'A', ?)`,
              [cli.uid_cliente, nombre, marca, serial, referencia, tenantId]
            );
            uid_h = newH.insertId;
          }

          const [ins] = await conn.execute(
            `INSERT INTO b2c_solicitud_recogida_item
               (uid_solicitud, tenant_id, uid_herramienta, her_nombre, her_marca, her_serial, tipo_servicio, descripcion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [uid_solicitud, tenantId, uid_h, nombre, marca || null, serial || null,
             m.tipo_servicio || 'reparacion', m.descripcion?.trim() || null]
          );
          item_ids.push(ins.insertId);
        }
        await conn.commit();
        res.json({ success: true, uid_solicitud, item_ids });
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error creando solicitud recogida:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Agregar fotos a una solicitud de recogida ─────────────────────────────────
router.post('/cliente/solicitudes/:id/fotos', uploadSolicitudFoto.array('fotos', 5), async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });
  if (!req.files?.length) return res.status(400).json({ error: 'No se recibieron imágenes' });

  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[sol]] = await conn.execute(
        `SELECT s.uid_solicitud, s.fotos
         FROM b2c_solicitud_recogida s
         JOIN b2c_cliente c ON c.uid_cliente = s.uid_cliente
         WHERE s.uid_solicitud = ? AND c.uid_usuario = ? AND s.tenant_id = ?`,
        [req.params.id, user.id, tenantId]
      );
      if (!sol) {
        for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
        return res.status(404).json({ error: 'Solicitud no encontrada' });
      }

      for (const f of req.files) {
        await checkMagicBytes(f.path, ['image/']);
      }

      const fotos = JSON.parse(sol.fotos || '[]');
      for (const f of req.files) {
        fotos.push({ filename: f.filename, url: `/uploads/solicitudes-recogida/${f.filename}` });
      }

      await conn.execute(
        `UPDATE b2c_solicitud_recogida SET fotos = ? WHERE uid_solicitud = ?`,
        [JSON.stringify(fotos), sol.uid_solicitud]
      );
      res.json({ success: true, fotos });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error subiendo fotos solicitud:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Subir fotos a un ítem (máquina) de solicitud ──────────────────────────────
router.post('/cliente/solicitudes/:id/items/:uid_item/fotos', uploadItemFoto.array('fotos', 3), async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });
  if (!req.files?.length) return res.status(400).json({ error: 'No se recibieron imágenes' });

  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      // Verificar propiedad: ítem → solicitud → cliente del usuario
      const [[item]] = await conn.execute(
        `SELECT i.uid_item, i.fotos
         FROM b2c_solicitud_recogida_item i
         JOIN b2c_solicitud_recogida s ON s.uid_solicitud = i.uid_solicitud
         JOIN b2c_cliente c ON c.uid_cliente = s.uid_cliente
         WHERE i.uid_item = ? AND i.uid_solicitud = ? AND c.uid_usuario = ? AND i.tenant_id = ?`,
        [req.params.uid_item, req.params.id, user.id, tenantId]
      );
      if (!item) {
        for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
        return res.status(404).json({ error: 'Ítem no encontrado' });
      }

      for (const f of req.files) {
        await checkMagicBytes(f.path, ['image/']);
      }

      const fotos = JSON.parse(item.fotos || '[]');
      for (const f of req.files) {
        fotos.push({ filename: f.filename, url: `/uploads/fotos-recepcion/${f.filename}` });
      }
      await conn.execute(
        `UPDATE b2c_solicitud_recogida_item SET fotos = ? WHERE uid_item = ?`,
        [JSON.stringify(fotos), item.uid_item]
      );
      res.json({ success: true, fotos });
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error subiendo fotos item solicitud:');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Listar solicitudes del cliente (con ítems por solicitud) ──────────────────
router.get('/cliente/solicitudes', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json([]);
  try {
    const tenantId = getTenantId(req);
    const conn = await db.getConnection();
    try {
      const [[cli]] = await conn.execute(
        `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? AND tenant_id = ? LIMIT 1`,
        [user.id, tenantId]
      );
      if (!cli) return res.json([]);

      const [rows] = await conn.execute(
        `SELECT uid_solicitud, direccion, fecha_sugerida, fecha_confirmada, nota_confirmacion,
                fotos, estado, created_at
         FROM b2c_solicitud_recogida
         WHERE uid_cliente = ? AND tenant_id = ?
         ORDER BY created_at DESC LIMIT 30`,
        [cli.uid_cliente, tenantId]
      );
      if (!rows.length) return res.json([]);

      const ids = rows.map(r => r.uid_solicitud);
      const ph  = ids.map(() => '?').join(',');
      const [items] = await conn.execute(
        `SELECT uid_item, uid_solicitud, uid_herramienta, her_nombre, her_marca, her_serial, tipo_servicio, descripcion, fotos
         FROM b2c_solicitud_recogida_item
         WHERE uid_solicitud IN (${ph}) AND tenant_id = ?
         ORDER BY uid_item`,
        [...ids, tenantId]
      );
      const itemsMap = {};
      items.forEach(i => {
        const k = String(i.uid_solicitud);
        if (!itemsMap[k]) itemsMap[k] = [];
        itemsMap[k].push(i);
      });
      rows.forEach(r => { r.maquinas = itemsMap[String(r.uid_solicitud)] || []; });
      res.json(rows);
    } finally {
      conn.release();
    }
  } catch (e) {
    log.error({ err: e }, 'Error listando solicitudes:');
    res.status(500).json([]);
  }
});

module.exports = router;
