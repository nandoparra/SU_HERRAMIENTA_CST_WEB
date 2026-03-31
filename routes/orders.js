const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const {
  getHerramientaOrdenTechColumn,
  getUsuarioColumns,
  buildUserNameExpr,
  getTechnicianWhereClause,
  resolveOrder,
} = require('../utils/schema');
const { isReady, sendWAMessage } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');
const { requireInterno } = require('../middleware/auth');
const UPLOADS_DIR = require('../utils/uploads');

// Todas las rutas de órdenes requieren rol interno, excepto rutas de cliente
router.use((req, res, next) => {
  if (req.path === '/cliente/mis-ordenes') return next();
  if (req.path.match(/^\/cliente\/maquina\/\d+\/autorizar$/)) return next();
  return requireInterno(req, res, next);
});

// ── Multer para fotos del trabajo ─────────────────────────────────────────────
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

const ESTADOS_VALIDOS = [
  'pendiente_revision',
  'revisada',
  'cotizada',
  'autorizada',
  'no_autorizada',
  'reparada',
  'entregada',
];

// Órdenes recientes
router.get('/orders', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)));
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
              c.cli_razon_social, c.cli_telefono
       FROM b2c_orden o
       JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
       WHERE o.tenant_id = ?
       ORDER BY o.ord_fecha DESC
       LIMIT ${limit}`,
      [tenantId]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error cargando órdenes recientes:', e);
    res.status(500).json({ error: 'Error cargando órdenes', details: undefined });
  }
});

// Búsqueda
router.get('/orders/search', async (req, res) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    if (!qRaw) return res.json([]);

    const digits = qRaw.replace(/\D/g, '');
    const isOnlyDigits = digits.length > 0 && digits === qRaw;

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();

    if (isOnlyDigits && digits.length <= 8) {
      const [exact] = await conn.execute(
        `SELECT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
                o.ord_tipo, o.ord_factura, o.ord_garantia_vence, o.ord_revision_limite,
                c.uid_cliente, c.cli_razon_social, c.cli_telefono, c.cli_contacto,
                c.cli_identificacion, c.cli_direccion,
                COUNT(ho.uid_herramienta_orden) AS maquinas,
                GROUP_CONCAT(
                  CONCAT(
                    TRIM(CONCAT(IFNULL(h.her_nombre,''),' ',IFNULL(h.her_marca,''))),
                    IF(h.her_serial IS NULL OR h.her_serial = '', '', CONCAT(' (', h.her_serial, ')'))
                  ) SEPARATOR ' | '
                ) AS maquinas_resumen
         FROM b2c_orden o
         JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
         LEFT JOIN b2c_herramienta_orden ho ON ho.uid_orden = o.uid_orden
         LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         WHERE CAST(o.ord_consecutivo AS CHAR) = ? AND o.tenant_id = ?
         GROUP BY o.uid_orden
         ORDER BY o.ord_fecha DESC
         LIMIT 20`,
        [digits, tenantId]
      );
      if (exact.length) {
        conn.release();
        return res.json(exact);
      }
    }

    const likeText = `%${qRaw}%`;
    const likeDigits = digits ? `%${digits}%` : likeText;

    const [rows] = await conn.execute(
      `SELECT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
              o.ord_tipo, o.ord_factura, o.ord_garantia_vence, o.ord_revision_limite,
              c.uid_cliente, c.cli_razon_social, c.cli_telefono, c.cli_contacto,
              c.cli_identificacion, c.cli_direccion,
              COUNT(ho.uid_herramienta_orden) AS maquinas,
              GROUP_CONCAT(
                CONCAT(
                  TRIM(CONCAT(IFNULL(h.her_nombre,''),' ',IFNULL(h.her_marca,''))),
                  IF(h.her_serial IS NULL OR h.her_serial = '', '', CONCAT(' (', h.her_serial, ')'))
                ) SEPARATOR ' | '
              ) AS maquinas_resumen
       FROM b2c_orden o
       JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
       LEFT JOIN b2c_herramienta_orden ho ON ho.uid_orden = o.uid_orden
       LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE o.tenant_id = ?
         AND (CAST(o.ord_consecutivo AS CHAR) LIKE ?
         OR c.cli_identificacion LIKE ?
         OR c.cli_razon_social LIKE ?
         OR c.cli_contacto LIKE ?
         OR REPLACE(REPLACE(REPLACE(c.cli_telefono,' ',''),'-',''),'+','') LIKE ?)
       GROUP BY o.uid_orden
       ORDER BY o.ord_fecha DESC
       LIMIT 20`,
      [tenantId, likeText, likeDigits, likeText, likeText, digits ? likeDigits : likeText]
    );

    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error en búsqueda:', e);
    res.status(500).json({ error: 'Error en búsqueda', details: undefined });
  }
});

// Órdenes filtradas por estado de máquina (para KPIs del dashboard)
router.get('/orders/by-estado', async (req, res) => {
  try {
    const estado = String(req.query.estado || '');
    const mes    = String(req.query.mes    || '');

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const params = [tenantId];
    let estadoClause = '';
    if (estado === 'pendiente_revision') {
      estadoClause = `AND ho.her_estado IN ('pendiente_revision','revisada')`;
    } else if (estado) {
      estadoClause = `AND ho.her_estado = ?`;
      params.push(estado);
    }
    if (mes) {
      estadoClause += ` AND o.ord_fecha LIKE ?`;
      params.push(`${mes.replace('-', '')}%`);
    }

    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
              o.ord_tipo, o.ord_factura, o.ord_garantia_vence, o.ord_revision_limite,
              COALESCE(c.cli_razon_social, c.cli_contacto, '') AS cli_razon_social,
              GROUP_CONCAT(
                CONCAT(
                  TRIM(CONCAT(IFNULL(h.her_nombre,''),' ',IFNULL(h.her_marca,''))),
                  IF(h.her_serial IS NULL OR h.her_serial='','',CONCAT(' (',h.her_serial,')'))
                ) SEPARATOR ' | '
              ) AS maquinas_resumen
       FROM b2c_herramienta_orden ho
       JOIN b2c_orden o  ON o.uid_orden    = ho.uid_orden
       JOIN b2c_cliente c ON c.uid_cliente  = o.uid_cliente
       LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE o.tenant_id = ? ${estadoClause}
       GROUP BY o.uid_orden
       ORDER BY o.ord_tipo DESC, o.ord_fecha DESC
       LIMIT 200`,
      params
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error en /orders/by-estado:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Órdenes asignadas al técnico logueado
router.get('/orders/mis-ordenes-tecnico', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user || user.tipo !== 'T')
      return res.status(403).json({ error: 'Solo para técnicos' });

    const conn = await db.getConnection();
    const techCol = await getHerramientaOrdenTechColumn(conn);
    if (!techCol) { conn.release(); return res.json([]); }

    const techColIsId = techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id');
    let techValue;
    if (techColIsId) {
      techValue = String(user.id);
    } else {
      const usrCols = await getUsuarioColumns(conn);
      const nameField = usrCols.nameCol || usrCols.firstNameCol;
      if (nameField) {
        const [[usu]] = await conn.execute(
          `SELECT \`${nameField}\` AS nombre FROM b2c_usuario WHERE \`${usrCols.idCol}\` = ? LIMIT 1`,
          [user.id]
        );
        techValue = usu?.nombre || user.nombre;
      } else {
        techValue = user.nombre;
      }
    }

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const [rows] = await conn.execute(
      `SELECT DISTINCT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
              o.ord_tipo, o.ord_factura, o.ord_garantia_vence, o.ord_revision_limite,
              c.cli_razon_social, c.cli_telefono,
              GROUP_CONCAT(
                TRIM(CONCAT(IFNULL(h.her_nombre,''),' ',IFNULL(h.her_marca,'')))
                ORDER BY ho.uid_herramienta_orden SEPARATOR ' | '
              ) AS maquinas_resumen
       FROM b2c_herramienta_orden ho
       JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
       JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
       JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE ho.\`${techCol}\` = ? AND o.tenant_id = ?
       GROUP BY o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha, o.ord_tipo, o.ord_factura, o.ord_garantia_vence, o.ord_revision_limite, c.cli_razon_social, c.cli_telefono
       ORDER BY o.ord_tipo DESC, o.ord_fecha DESC
       LIMIT 50`,
      [techValue, tenantId]
    );

    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error mis-ordenes-tecnico:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Orden completa + máquinas + técnicos
router.get('/orders/:orderId', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();

    const order = await resolveOrder(conn, req.params.orderId, tenantId);
    if (!order) {
      conn.release();
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const techCol = await getHerramientaOrdenTechColumn(conn);
    const usrCols = await getUsuarioColumns(conn);
    const userIdCol = usrCols.idCol;
    const userNameExpr = buildUserNameExpr(usrCols);

    // hor_tecnico y similares guardan el nombre directamente (no un FK/ID)
    const techColIsId = techCol && (
      techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id')
    );

    let equipmentSql;
    if (techCol && userIdCol && techColIsId) {
      // Columna guarda ID → hacer join con b2c_usuario para obtener nombre
      equipmentSql = `
        SELECT ho.uid_herramienta_orden, h.uid_herramienta,
               h.her_nombre, h.her_marca, h.her_serial,
               ho.\`${techCol}\` AS tecnico_id,
               ${userNameExpr} AS tecnico_nombre,
               ho.her_estado,
               o.ord_fecha
        FROM b2c_herramienta_orden ho
        JOIN b2c_herramienta h ON ho.uid_herramienta = h.uid_herramienta
        JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
        LEFT JOIN b2c_usuario u ON u.\`${userIdCol}\` = ho.\`${techCol}\`
        WHERE ho.uid_orden = ?
        ORDER BY ho.uid_herramienta_orden`;
    } else if (techCol) {
      // Columna guarda nombre directamente (ej: hor_tecnico)
      equipmentSql = `
        SELECT ho.uid_herramienta_orden, h.uid_herramienta,
               h.her_nombre, h.her_marca, h.her_serial,
               NULL AS tecnico_id,
               ho.\`${techCol}\` AS tecnico_nombre,
               ho.her_estado,
               o.ord_fecha
        FROM b2c_herramienta_orden ho
        JOIN b2c_herramienta h ON ho.uid_herramienta = h.uid_herramienta
        JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
        WHERE ho.uid_orden = ?
        ORDER BY ho.uid_herramienta_orden`;
    } else {
      equipmentSql = `
        SELECT ho.uid_herramienta_orden, h.uid_herramienta,
               h.her_nombre, h.her_marca, h.her_serial,
               NULL AS tecnico_id, NULL AS tecnico_nombre,
               ho.her_estado,
               o.ord_fecha
        FROM b2c_herramienta_orden ho
        JOIN b2c_herramienta h ON ho.uid_herramienta = h.uid_herramienta
        JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
        WHERE ho.uid_orden = ?
        ORDER BY ho.uid_herramienta_orden`;
    }

    let [equipment] = await conn.execute(equipmentSql, [order.uid_orden]);
    if (equipment.length === 0) {
      const [fallback] = await conn.execute(equipmentSql, [order.ord_consecutivo]);
      equipment = fallback;
    }

    const techFilter = await getTechnicianWhereClause(conn, usrCols);
    const techNameExpr = buildUserNameExpr(usrCols);
    const emailSelect = usrCols.emailCol ? `u.\`${usrCols.emailCol}\`` : `NULL`;

    let technicians = [];
    if (usrCols.idCol) {
      const [rows] = await conn.execute(
        `SELECT u.\`${usrCols.idCol}\` AS uid_usuario,
                ${techNameExpr} AS usr_nombre,
                ${emailSelect} AS usr_email
         FROM b2c_usuario u
         ${techFilter.whereSql}
         ORDER BY usr_nombre
         LIMIT 500`,
        techFilter.params || []
      );
      technicians = rows;
    }

    const [[saved]] = await conn.execute(
      `SELECT COUNT(*) AS n FROM b2c_cotizacion_maquina WHERE uid_orden = ?`,
      [order.uid_orden]
    );

    conn.release();
    res.json({
      order, equipment, technicians,
      equipmentCount: equipment.length,
      quotesSaved: Number(saved?.n || 0),
      techniciansWarning: techFilter.warning || null,
      canAssignTechnician: Boolean(techCol),
    });
  } catch (e) {
    console.error('Error obteniendo orden:', e);
    res.status(500).json({ error: 'Error obteniendo orden', details: undefined });
  }
});

// Asignar técnico a máquina específica
router.patch('/equipment-order/:equipmentOrderId/assign-technician', async (req, res) => {
  try {
    const { technicianId } = req.body;
    const equipmentOrderId = String(req.params.equipmentOrderId);

    const conn = await db.getConnection();
    const techCol = await getHerramientaOrdenTechColumn(conn);

    if (!techCol) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No existe columna de técnico en b2c_herramienta_orden.' });
    }

    const techColIsId = techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id');
    let valueToStore = technicianId ?? null;

    if (!techColIsId && technicianId) {
      // La columna guarda nombres — buscar el nombre del usuario seleccionado
      const usrCols = await getUsuarioColumns(conn);
      const nameField = usrCols.nameCol || usrCols.firstNameCol;
      if (nameField) {
        const [users] = await conn.execute(
          `SELECT \`${nameField}\` AS nombre FROM b2c_usuario WHERE \`${usrCols.idCol}\` = ? LIMIT 1`,
          [technicianId]
        );
        valueToStore = users[0]?.nombre ?? technicianId;
      }
    }

    const [result] = await conn.execute(
      `UPDATE b2c_herramienta_orden SET \`${techCol}\` = ? WHERE uid_herramienta_orden = ?`,
      [valueToStore, equipmentOrderId]
    );

    conn.release();
    res.json({ success: true, affectedRows: result.affectedRows });
  } catch (e) {
    console.error('Error asignando técnico:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Asignar técnico a toda la orden
router.patch('/orders/:orderId/assign-technician', async (req, res) => {
  try {
    const { technicianId } = req.body;

    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) {
      conn.release();
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    const techCol = await getHerramientaOrdenTechColumn(conn);
    if (!techCol) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No existe columna de técnico en b2c_herramienta_orden.' });
    }

    const techColIsId = techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id');
    let valueToStore = technicianId ?? null;

    if (!techColIsId && technicianId) {
      // La columna guarda nombres — buscar el nombre del usuario seleccionado
      const usrCols = await getUsuarioColumns(conn);
      const nameField = usrCols.nameCol || usrCols.firstNameCol;
      if (nameField) {
        const [users] = await conn.execute(
          `SELECT \`${nameField}\` AS nombre FROM b2c_usuario WHERE \`${usrCols.idCol}\` = ? LIMIT 1`,
          [technicianId]
        );
        valueToStore = users[0]?.nombre ?? technicianId;
      }
    }

    const [result] = await conn.execute(
      `UPDATE b2c_herramienta_orden SET \`${techCol}\` = ? WHERE uid_orden = ?`,
      [valueToStore, order.uid_orden]
    );

    conn.release();
    res.json({ success: true, affectedRows: result.affectedRows });
  } catch (e) {
    console.error('Error asignando técnico a la orden:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Cambiar estado de una máquina específica
router.patch('/equipment-order/:equipmentOrderId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const equipmentOrderId = String(req.params.equipmentOrderId);
    const tenantId = req.tenant?.uid_tenant ?? 1;

    if (!status || !ESTADOS_VALIDOS.includes(status)) {
      return res.status(400).json({ success: false, error: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}` });
    }

    const conn = await db.getConnection();

    // Actualizar estado
    await conn.execute(
      `UPDATE b2c_herramienta_orden SET her_estado = ? WHERE uid_herramienta_orden = ?`,
      [status, equipmentOrderId]
    );

    // Registrar en historial
    await conn.execute(
      `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, ?, ?)`,
      [equipmentOrderId, status, tenantId]
    );
    const [[logRow]] = await conn.execute(
      `SELECT changed_at FROM b2c_herramienta_status_log WHERE uid_herramienta_orden = ? ORDER BY id DESC LIMIT 1`,
      [equipmentOrderId]
    );

    // Notificar al cliente automáticamente cuando la máquina pasa a "reparada"
    if (status === 'reparada' && isReady(tenantId)) {
      try {
        const [[maqRow]] = await conn.execute(
          `SELECT h.her_nombre, h.her_marca, c.cli_telefono, c.cli_razon_social, c.cli_contacto, o.ord_consecutivo
           FROM b2c_herramienta_orden ho
           JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
           JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
           JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
           WHERE ho.uid_herramienta_orden = ?`,
          [equipmentOrderId]
        );
        if (maqRow) {
          const chatIds = parseColombianPhones(maqRow.cli_telefono);
          const nombre = maqRow.cli_razon_social || maqRow.cli_contacto || 'cliente';
          const maquina = [maqRow.her_nombre, maqRow.her_marca].filter(Boolean).join(' ');
          const msg = `Hola ${nombre}, le informamos que su *${maquina}* de la orden *#${maqRow.ord_consecutivo}* está *reparada y lista para recoger* 🔧\n\n📍 Calle 21 No 10 02, Pereira\n📞 3104650437\n— SU HERRAMIENTA CST`;
          for (const chatId of chatIds) {
            sendWAMessage(tenantId, chatId, msg).catch(e => console.error('Error WA notif reparada:', e.message));
          }
        }
      } catch (e) {
        console.error('Error enviando notificación reparada:', e.message);
      }
    }

    conn.release();
    res.json({ success: true, status, changed_at: logRow?.changed_at || null });
  } catch (e) {
    console.error('Error actualizando estado de máquina:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Guardar observaciones del técnico en una máquina
router.patch('/equipment-order/:equipmentOrderId/observaciones', async (req, res) => {
  try {
    const { observaciones } = req.body;
    const uid = String(req.params.equipmentOrderId);
    const conn = await db.getConnection();
    await conn.execute(
      `UPDATE b2c_herramienta_orden SET hor_observaciones = ? WHERE uid_herramienta_orden = ?`,
      [observaciones ?? null, uid]
    );
    conn.release();
    res.json({ success: true });
  } catch (e) {
    console.error('Error guardando observaciones:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Enviar lista consolidada de repuestos (máquinas autorizadas) al encargado
router.post('/orders/:orderId/notify-parts', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId, tenantId);
    if (!order) { conn.release(); return res.status(404).json({ success: false, error: 'Orden no encontrada' }); }

    const partsNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
    if (!partsNumber) { conn.release(); return res.status(400).json({ success: false, error: 'PARTS_WHATSAPP_NUMBER no configurado en .env' }); }
    if (!isReady(tenantId)) { conn.release(); return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' }); }

    const [maquinas] = await conn.execute(`
      SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca, h.her_serial
      FROM b2c_herramienta_orden ho
      JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
      WHERE ho.uid_orden = ? AND ho.her_estado = 'autorizada'
      ORDER BY ho.uid_herramienta_orden
    `, [order.uid_orden]);

    if (!maquinas.length) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No hay máquinas con estado "autorizada" en esta orden' });
    }

    const bloques = await Promise.all(maquinas.map(async (maq) => {
      const [items] = await conn.execute(
        `SELECT nombre, cantidad FROM b2c_cotizacion_item WHERE uid_herramienta_orden = ? ORDER BY id`,
        [maq.uid_herramienta_orden]
      );
      const nombre = [maq.her_nombre, maq.her_marca].filter(Boolean).join(' ');
      const serial = maq.her_serial ? ` / S/N: ${maq.her_serial}` : '';
      const lineas = items.length
        ? items.map(i => `  • ${i.cantidad}x ${i.nombre}`).join('\n')
        : '  (solo mano de obra)';
      return `*${nombre}*${serial}\n${lineas}`;
    }));

    const msg =
      `🔧 *REPUESTOS AUTORIZADOS*\n` +
      `Orden #${order.ord_consecutivo}\n\n` +
      bloques.join('\n\n') +
      `\n\n— SU HERRAMIENTA CST`;

    let phone = partsNumber;
    if (!phone.startsWith('57')) phone = '57' + phone.slice(-10);
    await sendWAMessage(tenantId, `${phone}@c.us`, msg);

    conn.release();
    res.json({ success: true, maquinas: maquinas.length });
  } catch (e) {
    console.error('Error enviando lista de repuestos:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Notificar al cliente que sus máquinas están reparadas
router.post('/orders/:orderId/notify-ready', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId, tenantId);
    if (!order) { conn.release(); return res.status(404).json({ success: false, error: 'Orden no encontrada' }); }
    if (!isReady(tenantId)) { conn.release(); return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' }); }

    const [[cliente]] = await conn.execute(
      `SELECT c.cli_razon_social, c.cli_telefono FROM b2c_orden o JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente WHERE o.uid_orden = ?`,
      [order.uid_orden]
    );
    const [maquinas] = await conn.execute(`
      SELECT h.her_nombre, h.her_marca
      FROM b2c_herramienta_orden ho
      JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
      WHERE ho.uid_orden = ? AND ho.her_estado = 'reparada'
      ORDER BY ho.uid_herramienta_orden
    `, [order.uid_orden]);

    if (!maquinas.length) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No hay máquinas con estado "reparada" en esta orden' });
    }

    const nombre = cliente?.cli_razon_social || 'cliente';
    const lista = maquinas.map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`).join('\n');
    const msg =
      `Hola ${nombre}, le informamos que las siguientes herramientas están *reparadas y listas para recoger*:\n\n` +
      `${lista}\n\n` +
      `📍 Calle 21 No 10 02, Pereira\n📞 3104650437\n— SU HERRAMIENTA CST`;

    const chatIds = parseColombianPhones(cliente?.cli_telefono);
    if (!chatIds.length) { conn.release(); return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' }); }
    for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, msg);

    conn.release();
    res.json({ success: true, maquinas: maquinas.length, destinatarios: chatIds.length });
  } catch (e) {
    console.error('Error notificando reparadas:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Confirmar entrega al cliente
router.post('/orders/:orderId/notify-delivered', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId, tenantId);
    if (!order) { conn.release(); return res.status(404).json({ success: false, error: 'Orden no encontrada' }); }
    if (!isReady(tenantId)) { conn.release(); return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' }); }

    const [[cliente]] = await conn.execute(
      `SELECT c.cli_razon_social, c.cli_telefono FROM b2c_orden o JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente WHERE o.uid_orden = ?`,
      [order.uid_orden]
    );
    const [maquinas] = await conn.execute(`
      SELECT h.her_nombre, h.her_marca
      FROM b2c_herramienta_orden ho
      JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
      WHERE ho.uid_orden = ? AND ho.her_estado = 'entregada'
      ORDER BY ho.uid_herramienta_orden
    `, [order.uid_orden]);

    if (!maquinas.length) {
      conn.release();
      return res.status(400).json({ success: false, error: 'No hay máquinas con estado "entregada" en esta orden' });
    }

    const nombre = cliente?.cli_razon_social || 'cliente';
    const lista = maquinas.map(m => `  • ${[m.her_nombre, m.her_marca].filter(Boolean).join(' ')}`).join('\n');
    const msg =
      `Hola ${nombre}, confirmamos la entrega de las siguientes herramientas:\n\n` +
      `${lista}\n\n` +
      `¡Gracias por confiar en nosotros!\n— SU HERRAMIENTA CST`;

    const chatIds = parseColombianPhones(cliente?.cli_telefono);
    if (!chatIds.length) { conn.release(); return res.status(400).json({ success: false, error: 'No se encontró número móvil válido para el cliente' }); }
    for (const chatId of chatIds) await sendWAMessage(tenantId, chatId, msg);

    conn.release();
    res.json({ success: true, maquinas: maquinas.length, destinatarios: chatIds.length });
  } catch (e) {
    console.error('Error confirmando entregas:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Vista de detalle para la página de consulta de órdenes
router.get('/orders/:orderId/detalle', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId, tenantId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    // Orden + cliente
    const [[ordenRow]] = await conn.execute(
      `SELECT o.uid_orden, o.ord_consecutivo, o.ord_fecha, o.ord_estado,
              o.ord_tipo, o.ord_factura, o.ord_garantia_vence,
              c.cli_razon_social, c.cli_identificacion, c.cli_telefono, c.cli_direccion
       FROM b2c_orden o
       JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
       WHERE o.uid_orden = ?`,
      [order.uid_orden]
    );

    // Máquinas con observaciones
    const [maquinas] = await conn.execute(
      `SELECT ho.uid_herramienta_orden, ho.her_estado, ho.hor_observaciones,
              h.uid_herramienta, h.her_nombre, h.her_marca, h.her_serial, h.her_referencia
       FROM b2c_herramienta_orden ho
       JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       WHERE ho.uid_orden = ?
       ORDER BY ho.uid_herramienta_orden`,
      [order.uid_orden]
    );

    // Fotos agrupadas por uid_herramienta_orden (separadas por tipo)
    const fotoMap = {};
    if (maquinas.length) {
      const ids = maquinas.map(m => m.uid_herramienta_orden);
      const placeholders = ids.map(() => '?').join(',');
      const [fotos] = await conn.execute(
        `SELECT uid_foto_herramienta_orden, uid_herramienta_orden, fho_archivo, fho_nombre,
                COALESCE(fho_tipo, 'recepcion') AS fho_tipo
         FROM b2c_foto_herramienta_orden
         WHERE uid_herramienta_orden IN (${placeholders})
         ORDER BY uid_foto_herramienta_orden`,
        ids
      );
      fotos.forEach(f => {
        if (!fotoMap[f.uid_herramienta_orden]) fotoMap[f.uid_herramienta_orden] = { recepcion: [], trabajo: [] };
        const tipo = f.fho_tipo === 'trabajo' ? 'trabajo' : 'recepcion';
        fotoMap[f.uid_herramienta_orden][tipo].push({
          uid_foto_herramienta_orden: f.uid_foto_herramienta_orden,
          fho_archivo: f.fho_archivo,
          fho_nombre:  f.fho_nombre,
        });
      });
    }
    maquinas.forEach(m => {
      const map = fotoMap[m.uid_herramienta_orden] || { recepcion: [], trabajo: [] };
      m.fotos         = map.recepcion;
      m.fotos_trabajo = map.trabajo;
    });

    // Informes de mantenimiento por máquina
    if (maquinas.length) {
      const ids = maquinas.map(m => m.uid_herramienta_orden);
      const placeholders = ids.map(() => '?').join(',');
      const [informes] = await conn.execute(
        `SELECT uid_informe, uid_herramienta_orden, inf_fecha
         FROM b2c_informe_mantenimiento
         WHERE uid_herramienta_orden IN (${placeholders})
         ORDER BY inf_fecha DESC`,
        ids
      );
      const informeMap = {};
      informes.forEach(i => {
        if (!informeMap[i.uid_herramienta_orden]) informeMap[i.uid_herramienta_orden] = [];
        informeMap[i.uid_herramienta_orden].push({ uid_informe: i.uid_informe, inf_fecha: i.inf_fecha });
      });
      maquinas.forEach(m => { m.informes = informeMap[m.uid_herramienta_orden] || []; });
    } else {
      maquinas.forEach(m => { m.informes = []; });
    }

    // Cotización por máquina + items + totales de orden
    const [cotMaquinas] = await conn.execute(
      `SELECT uid_herramienta_orden, mano_obra, descripcion_trabajo, subtotal
       FROM b2c_cotizacion_maquina WHERE uid_orden = ?`,
      [order.uid_orden]
    );
    const tieneCotizacion = cotMaquinas.length > 0;

    if (tieneCotizacion) {
      const [cotItems] = await conn.execute(
        `SELECT uid_herramienta_orden, nombre, cantidad, precio, subtotal
         FROM b2c_cotizacion_item WHERE uid_orden = ?
         ORDER BY uid_herramienta_orden, id`,
        [order.uid_orden]
      );
      const [[cotOrden]] = await conn.execute(
        `SELECT subtotal, iva, total FROM b2c_cotizacion_orden WHERE uid_orden = ?`,
        [order.uid_orden]
      );

      // Indexar por uid_herramienta_orden
      const cotMap = {};
      cotMaquinas.forEach(cm => { cotMap[cm.uid_herramienta_orden] = { ...cm, items: [] }; });
      cotItems.forEach(ci => { if (cotMap[ci.uid_herramienta_orden]) cotMap[ci.uid_herramienta_orden].items.push(ci); });
      maquinas.forEach(m => { m.cotizacion = cotMap[m.uid_herramienta_orden] || null; });

      conn.release();
      res.json({ orden: ordenRow, maquinas, tieneCotizacion, cotOrden: cotOrden || null });
    } else {
      conn.release();
      res.json({ orden: ordenRow, maquinas, tieneCotizacion, cotOrden: null });
    }
  } catch (e) {
    console.error('Error obteniendo detalle de orden:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Informe de mantenimiento — acceso cliente con validación de propiedad
router.get('/cliente/informe/:uid_herramienta_orden', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    const [[row]] = await conn.execute(
      `SELECT i.inf_archivo
       FROM b2c_informe_mantenimiento i
       JOIN b2c_herramienta_orden ho ON ho.uid_herramienta_orden = i.uid_herramienta_orden
       JOIN b2c_orden o ON o.uid_orden = ho.uid_orden
       JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
       WHERE i.uid_herramienta_orden = ? AND c.uid_usuario = ? AND o.tenant_id = ?
       LIMIT 1`,
      [req.params.uid_herramienta_orden, user.id, tenantId]
    );
    conn.release();
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

    const tenantId = req.tenant?.uid_tenant ?? 1;
    // Verificar propiedad: la máquina debe pertenecer a una orden del cliente logueado
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

    // Actualizar estado + log en transacción
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

    // Si autorizada, enviar lista de repuestos al encargado (sin fallar el endpoint si WA no está listo)
    if (decision === 'autorizada') {
      try {
        const partsNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
        if (partsNumber && isReady(tenantId)) {
          const [[orderRow]] = await conn.execute(
            `SELECT ord_consecutivo FROM b2c_orden WHERE uid_orden = ?`,
            [maq.uid_orden]
          );
          const [maquinas] = await conn.execute(
            `SELECT ho.uid_herramienta_orden, h.her_nombre, h.her_marca, h.her_serial
             FROM b2c_herramienta_orden ho
             JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
             WHERE ho.uid_orden = ? AND ho.her_estado = 'autorizada'
             ORDER BY ho.uid_herramienta_orden`,
            [maq.uid_orden]
          );
          if (maquinas.length) {
            const bloques = await Promise.all(maquinas.map(async (maq2) => {
              const [items] = await conn.execute(
                `SELECT nombre, cantidad FROM b2c_cotizacion_item WHERE uid_herramienta_orden = ? ORDER BY id`,
                [maq2.uid_herramienta_orden]
              );
              const nombre = [maq2.her_nombre, maq2.her_marca].filter(Boolean).join(' ');
              const serial = maq2.her_serial ? ` / S/N: ${maq2.her_serial}` : '';
              const lineas = items.length
                ? items.map(i => `  • ${i.cantidad}x ${i.nombre}`).join('\n')
                : '  (solo mano de obra)';
              return `*${nombre}*${serial}\n${lineas}`;
            }));
            const msg =
              `🔧 *REPUESTOS AUTORIZADOS*\n` +
              `Orden #${orderRow?.ord_consecutivo || maq.uid_orden}\n\n` +
              bloques.join('\n\n') +
              `\n\n— SU HERRAMIENTA CST`;
            let phone = partsNumber;
            if (!phone.startsWith('57')) phone = '57' + phone.slice(-10);
            await sendWAMessage(tenantId, `${phone}@c.us`, msg);
          }
        } else {
          console.warn('⚠️ orders: WA no listo o PARTS_WHATSAPP_NUMBER no configurado, se omite notificación');
        }
      } catch (waErr) {
        console.warn('⚠️ orders: error enviando lista de repuestos por WA (autorización guardada):', waErr.message);
      }
    }

    res.json({ success: true, her_estado: decision });
  } catch (e) {
    console.error('Error en autorización cliente:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Órdenes del cliente logueado (seguimiento)
router.get('/cliente/mis-ordenes', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user || user.tipo !== 'C') return res.status(403).json([]);

    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();

    const [[cli]] = await conn.execute(
      `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? AND tenant_id = ? LIMIT 1`,
      [user.id, tenantId]
    );
    if (!cli) { conn.release(); return res.json([]); }

    const [ordenes] = await conn.execute(
      `SELECT uid_orden, ord_consecutivo, ord_fecha, ord_estado
       FROM b2c_orden WHERE uid_cliente = ? AND tenant_id = ?
       ORDER BY ord_fecha DESC LIMIT 50`,
      [cli.uid_cliente, tenantId]
    );

    if (!ordenes.length) { conn.release(); return res.json([]); }

    // ── Batch: todas las máquinas de todas las órdenes ────────────────────────
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

      // Historial de estados
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

      // Cotización por máquina
      const [cots] = await conn.execute(
        `SELECT uid_herramienta_orden, mano_obra, descripcion_trabajo, subtotal
         FROM b2c_cotizacion_maquina
         WHERE uid_herramienta_orden IN (${mhp})`,
        maqIds
      );
      cots.forEach(c => { cotMap[String(c.uid_herramienta_orden)] = c; });

      // Ítems (repuestos) por máquina
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

      // Informes de mantenimiento
      const [informeRows] = await conn.execute(
        `SELECT uid_herramienta_orden, uid_informe, inf_fecha, inf_archivo
         FROM b2c_informe_mantenimiento
         WHERE uid_herramienta_orden IN (${mhp})`,
        maqIds
      );
      informeRows.forEach(i => { informeMap[String(i.uid_herramienta_orden)] = i; });
    }

    // ── Ensamblar ─────────────────────────────────────────────────────────────
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

    conn.release();
    res.json(ordenes);
  } catch (e) {
    console.error('Error mis-ordenes:', e);
    res.status(500).json([]);
  }
});

// ── Subir foto de recepción (post-creación) ───────────────────────────────────
router.post('/orders/:id/fotos-recepcion/:uid_herramienta_orden', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre, fho_tipo)
       VALUES (?, ?, ?, 'recepcion')`,
      [req.params.uid_herramienta_orden, req.file.filename, req.file.originalname]
    );
    const [[ins]] = await conn.execute('SELECT LAST_INSERT_ID() AS id');
    conn.release();
    res.json({
      success:  true,
      uid_foto: ins.id,
      filename: req.file.filename,
      url:      '/uploads/fotos-recepcion/' + req.file.filename,
    });
  } catch (e) {
    console.error('Error subiendo foto de recepción:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Eliminar foto de recepción (post-creación) ────────────────────────────────
router.delete('/orders/fotos-recepcion/:uid_foto', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const [[foto]] = await conn.execute(
      `SELECT fho_archivo FROM b2c_foto_herramienta_orden
       WHERE uid_foto_herramienta_orden = ? AND fho_tipo = 'recepcion'`,
      [req.params.uid_foto]
    );
    if (!foto) { conn.release(); return res.status(404).json({ error: 'Foto no encontrada' }); }
    await conn.execute(
      `DELETE FROM b2c_foto_herramienta_orden WHERE uid_foto_herramienta_orden = ?`,
      [req.params.uid_foto]
    );
    conn.release();
    try { fs.unlinkSync(path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo)); } catch {}
    res.json({ success: true });
  } catch (e) {
    console.error('Error eliminando foto de recepción:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Subir foto del trabajo ────────────────────────────────────────────────────
router.post('/orders/:id/fotos-trabajo/:uid_herramienta_orden', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const conn = await db.getConnection();
    await conn.execute(
      `INSERT INTO b2c_foto_herramienta_orden (uid_herramienta_orden, fho_archivo, fho_nombre, fho_tipo)
       VALUES (?, ?, ?, 'trabajo')`,
      [req.params.uid_herramienta_orden, req.file.filename, req.file.originalname]
    );
    const [[ins]] = await conn.execute('SELECT LAST_INSERT_ID() AS id');
    conn.release();
    res.json({
      success:   true,
      uid_foto:  ins.id,
      filename:  req.file.filename,
      url:       '/uploads/fotos-recepcion/' + req.file.filename,
    });
  } catch (e) {
    console.error('Error subiendo foto de trabajo:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Eliminar foto del trabajo ─────────────────────────────────────────────────
router.delete('/orders/fotos-trabajo/:uid_foto', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const [[foto]] = await conn.execute(
      `SELECT fho_archivo FROM b2c_foto_herramienta_orden
       WHERE uid_foto_herramienta_orden = ? AND fho_tipo = 'trabajo'`,
      [req.params.uid_foto]
    );
    if (!foto) { conn.release(); return res.status(404).json({ error: 'Foto no encontrada' }); }
    await conn.execute(
      `DELETE FROM b2c_foto_herramienta_orden WHERE uid_foto_herramienta_orden = ?`,
      [req.params.uid_foto]
    );
    conn.release();
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo));
    } catch {}
    res.json({ success: true });
  } catch (e) {
    console.error('Error eliminando foto de trabajo:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
