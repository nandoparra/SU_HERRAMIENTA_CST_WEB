const express = require('express');
const router = express.Router();
const db = require('../utils/db');
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

router.use(requireInterno);


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
    try {
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
      res.json(rows);
    } finally {
      conn.release();
    }
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
    try {
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
        if (exact.length) return res.json(exact);
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
      res.json(rows);
    } finally {
      conn.release();
    }
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
    try {
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
      res.json(rows);
    } finally {
      conn.release();
    }
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
    try {
      const techCol = await getHerramientaOrdenTechColumn(conn);
      if (!techCol) return res.json([]);

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
      res.json(rows);
    } finally {
      conn.release();
    }
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
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

      const techCol = await getHerramientaOrdenTechColumn(conn);
      const usrCols = await getUsuarioColumns(conn);
      const userIdCol = usrCols.idCol;
      const userNameExpr = buildUserNameExpr(usrCols);

      const techColIsId = techCol && (
        techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id')
      );

      let equipmentSql;
      if (techCol && userIdCol && techColIsId) {
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

      res.json({
        order, equipment, technicians,
        equipmentCount: equipment.length,
        quotesSaved: Number(saved?.n || 0),
        techniciansWarning: techFilter.warning || null,
        canAssignTechnician: Boolean(techCol),
      });
    } finally {
      conn.release();
    }
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
    try {
      const techCol = await getHerramientaOrdenTechColumn(conn);
      if (!techCol) return res.status(400).json({ success: false, error: 'No existe columna de técnico en b2c_herramienta_orden.' });

      const techColIsId = techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id');
      let valueToStore = technicianId ?? null;

      if (!techColIsId && technicianId) {
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
      res.json({ success: true, affectedRows: result.affectedRows });
    } finally {
      conn.release();
    }
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
    try {
      const order = await resolveOrder(conn, req.params.orderId);
      if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

      const techCol = await getHerramientaOrdenTechColumn(conn);
      if (!techCol) return res.status(400).json({ success: false, error: 'No existe columna de técnico en b2c_herramienta_orden.' });

      const techColIsId = techCol.startsWith('uid_') || techCol.startsWith('id_') || techCol.endsWith('_id');
      let valueToStore = technicianId ?? null;

      if (!techColIsId && technicianId) {
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
      res.json({ success: true, affectedRows: result.affectedRows });
    } finally {
      conn.release();
    }
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
    try {
      await conn.execute(
        `UPDATE b2c_herramienta_orden SET her_estado = ? WHERE uid_herramienta_orden = ?`,
        [status, equipmentOrderId]
      );
      await conn.execute(
        `INSERT INTO b2c_herramienta_status_log (uid_herramienta_orden, estado, tenant_id) VALUES (?, ?, ?)`,
        [equipmentOrderId, status, tenantId]
      );
      const [[logRow]] = await conn.execute(
        `SELECT changed_at FROM b2c_herramienta_status_log WHERE uid_herramienta_orden = ? ORDER BY id DESC LIMIT 1`,
        [equipmentOrderId]
      );

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

      res.json({ success: true, status, changed_at: logRow?.changed_at || null });
    } finally {
      conn.release();
    }
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
    try {
      await conn.execute(
        `UPDATE b2c_herramienta_orden SET hor_observaciones = ? WHERE uid_herramienta_orden = ?`,
        [observaciones ?? null, uid]
      );
      res.json({ success: true });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error guardando observaciones:', e);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Vista de detalle para la página de consulta de órdenes
router.get('/orders/:orderId/detalle', async (req, res) => {
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
    const conn = await db.getConnection();
    try {
      const order = await resolveOrder(conn, req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

      const [[ordenRow]] = await conn.execute(
        `SELECT o.uid_orden, o.ord_consecutivo, o.ord_fecha, o.ord_estado,
                o.ord_tipo, o.ord_factura, o.ord_garantia_vence,
                c.uid_cliente, c.cli_razon_social, c.cli_identificacion, c.cli_telefono, c.cli_direccion
         FROM b2c_orden o
         JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
         WHERE o.uid_orden = ?`,
        [order.uid_orden]
      );

      const [maquinas] = await conn.execute(
        `SELECT ho.uid_herramienta_orden, ho.her_estado, ho.hor_observaciones,
                ho.hor_es_garantia, ho.hor_garantia_vence, ho.hor_garantia_factura,
                h.uid_herramienta, h.her_nombre, h.her_marca, h.her_serial, h.her_referencia
         FROM b2c_herramienta_orden ho
         JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
         WHERE ho.uid_orden = ?
         ORDER BY ho.uid_herramienta_orden`,
        [order.uid_orden]
      );

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

      const [cotMaquinas] = await conn.execute(
        `SELECT uid_herramienta_orden, mano_obra, descripcion_trabajo, subtotal
         FROM b2c_cotizacion_maquina WHERE uid_orden = ?`,
        [order.uid_orden]
      );
      const tieneCotizacion = cotMaquinas.length > 0;

      let cotOrden = null;
      if (tieneCotizacion) {
        const [cotItems] = await conn.execute(
          `SELECT uid_herramienta_orden, nombre, cantidad, precio, subtotal
           FROM b2c_cotizacion_item WHERE uid_orden = ?
           ORDER BY uid_herramienta_orden, id`,
          [order.uid_orden]
        );
        const [[cotOrdenRow]] = await conn.execute(
          `SELECT subtotal, iva, total FROM b2c_cotizacion_orden WHERE uid_orden = ?`,
          [order.uid_orden]
        );
        cotOrden = cotOrdenRow || null;
        const cotMap = {};
        cotMaquinas.forEach(cm => { cotMap[cm.uid_herramienta_orden] = { ...cm, items: [] }; });
        cotItems.forEach(ci => { if (cotMap[ci.uid_herramienta_orden]) cotMap[ci.uid_herramienta_orden].items.push(ci); });
        maquinas.forEach(m => { m.cotizacion = cotMap[m.uid_herramienta_orden] || null; });
      }

      res.json({ orden: ordenRow, maquinas, tieneCotizacion, cotOrden });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('Error obteniendo detalle de orden:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
