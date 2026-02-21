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
const { waClient, isReady } = require('../utils/whatsapp-client');
const { parseColombianPhones } = require('../utils/phones');

// ── Multer para fotos del trabajo ─────────────────────────────────────────────
const fotoStorage = multer.diskStorage({
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
    const conn = await db.getConnection();
    const [rows] = await conn.execute(
      `SELECT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
              c.cli_razon_social, c.cli_telefono
       FROM b2c_orden o
       JOIN b2c_cliente c ON o.uid_cliente = c.uid_cliente
       ORDER BY o.ord_fecha DESC
       LIMIT ?`,
      [limit]
    );
    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error cargando órdenes recientes:', e);
    res.status(500).json({ error: 'Error cargando órdenes', details: e.message });
  }
});

// Búsqueda
router.get('/orders/search', async (req, res) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    if (!qRaw) return res.json([]);

    const digits = qRaw.replace(/\D/g, '');
    const isOnlyDigits = digits.length > 0 && digits === qRaw;

    const conn = await db.getConnection();

    if (isOnlyDigits && digits.length <= 8) {
      const [exact] = await conn.execute(
        `SELECT o.uid_orden, o.ord_consecutivo, o.ord_estado, o.ord_fecha,
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
         WHERE CAST(o.ord_consecutivo AS CHAR) = ?
         GROUP BY o.uid_orden
         ORDER BY o.ord_fecha DESC
         LIMIT 20`,
        [digits]
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
       WHERE CAST(o.ord_consecutivo AS CHAR) LIKE ?
         OR c.cli_identificacion LIKE ?
         OR c.cli_razon_social LIKE ?
         OR c.cli_contacto LIKE ?
         OR REPLACE(REPLACE(REPLACE(c.cli_telefono,' ',''),'-',''),'+','') LIKE ?
       GROUP BY o.uid_orden
       ORDER BY o.ord_fecha DESC
       LIMIT 20`,
      [likeText, likeDigits, likeText, likeText, digits ? likeDigits : likeText]
    );

    conn.release();
    res.json(rows);
  } catch (e) {
    console.error('Error en búsqueda:', e);
    res.status(500).json({ error: 'Error en búsqueda', details: e.message });
  }
});

// Orden completa + máquinas + técnicos
router.get('/orders/:orderId', async (req, res) => {
  try {
    const conn = await db.getConnection();

    const order = await resolveOrder(conn, req.params.orderId);
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
    res.status(500).json({ error: 'Error obteniendo orden', details: e.message });
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
    res.status(500).json({ success: false, error: e.message });
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
    res.status(500).json({ success: false, error: e.message });
  }
});

// Cambiar estado de una máquina específica
router.patch('/equipment-order/:equipmentOrderId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const equipmentOrderId = String(req.params.equipmentOrderId);

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
      `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado) VALUES (?, ?)`,
      [equipmentOrderId, status]
    );
    const [[logRow]] = await conn.execute(
      `SELECT changed_at FROM b2c_herramienta_status_log WHERE uid_herramienta_orden = ? ORDER BY id DESC LIMIT 1`,
      [equipmentOrderId]
    );

    conn.release();
    res.json({ success: true, status, changed_at: logRow?.changed_at || null });
  } catch (e) {
    console.error('Error actualizando estado de máquina:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Enviar lista consolidada de repuestos (máquinas autorizadas) al encargado
router.post('/orders/:orderId/notify-parts', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ success: false, error: 'Orden no encontrada' }); }

    const partsNumber = String(process.env.PARTS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
    if (!partsNumber) { conn.release(); return res.status(400).json({ success: false, error: 'PARTS_WHATSAPP_NUMBER no configurado en .env' }); }
    if (!isReady()) { conn.release(); return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' }); }

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
    await waClient.sendMessage(`${phone}@c.us`, msg);

    conn.release();
    res.json({ success: true, maquinas: maquinas.length });
  } catch (e) {
    console.error('Error enviando lista de repuestos:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Notificar al cliente que sus máquinas están reparadas
router.post('/orders/:orderId/notify-ready', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ success: false, error: 'Orden no encontrada' }); }
    if (!isReady()) { conn.release(); return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' }); }

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
    for (const chatId of chatIds) await waClient.sendMessage(chatId, msg);

    conn.release();
    res.json({ success: true, maquinas: maquinas.length, destinatarios: chatIds.length });
  } catch (e) {
    console.error('Error notificando reparadas:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Confirmar entrega al cliente
router.post('/orders/:orderId/notify-delivered', async (req, res) => {
  try {
    const conn = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ success: false, error: 'Orden no encontrada' }); }
    if (!isReady()) { conn.release(); return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' }); }

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
    for (const chatId of chatIds) await waClient.sendMessage(chatId, msg);

    conn.release();
    res.json({ success: true, maquinas: maquinas.length, destinatarios: chatIds.length });
  } catch (e) {
    console.error('Error confirmando entregas:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Vista de detalle para la página de consulta de órdenes
router.get('/orders/:orderId/detalle', async (req, res) => {
  try {
    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    // Orden + cliente
    const [[ordenRow]] = await conn.execute(
      `SELECT o.uid_orden, o.ord_consecutivo, o.ord_fecha, o.ord_estado,
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
    res.status(500).json({ error: e.message });
  }
});

// Órdenes del cliente logueado (seguimiento)
router.get('/cliente/mis-ordenes', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user || user.tipo !== 'C') return res.status(403).json([]);

    const conn = await db.getConnection();

    // Buscar el uid_cliente vinculado a este usuario
    const [[cli]] = await conn.execute(
      `SELECT uid_cliente FROM b2c_cliente WHERE uid_usuario = ? LIMIT 1`,
      [user.id]
    );
    if (!cli) { conn.release(); return res.json([]); }

    const [ordenes] = await conn.execute(
      `SELECT uid_orden, ord_consecutivo, ord_fecha, ord_estado
       FROM b2c_orden WHERE uid_cliente = ?
       ORDER BY ord_fecha DESC LIMIT 50`,
      [cli.uid_cliente]
    );

    for (const orden of ordenes) {
      const [maquinas] = await conn.execute(
        `SELECT h.her_nombre, h.her_marca, h.her_serial, ho.her_estado
         FROM b2c_herramienta_orden ho
         JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         WHERE ho.uid_orden = ?`,
        [orden.uid_orden]
      );
      orden.maquinas = maquinas;
    }

    conn.release();
    res.json(ordenes);
  } catch (e) {
    console.error('Error mis-ordenes:', e);
    res.status(500).json([]);
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
    res.status(500).json({ error: e.message });
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
      fs.unlinkSync(path.join(__dirname, '..', 'public', 'uploads', 'fotos-recepcion', foto.fho_archivo));
    } catch {}
    res.json({ success: true });
  } catch (e) {
    console.error('Error eliminando foto de trabajo:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
