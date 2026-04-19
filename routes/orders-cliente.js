'use strict';
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const path = require('path');
const fs   = require('fs');
const { isReady, sendWAMessage } = require('../utils/whatsapp-client');
const { UPLOADS_DIR } = require('../utils/uploads');

// Rutas de portal cliente — NO requieren requireInterno (tipo C).
// Este router se monta ANTES de orders.js en server.js para que las rutas /cliente/*
// sean capturadas aquí y nunca lleguen al middleware requireInterno de orders.js.
// Cada handler valida explícitamente que user.tipo === 'C'.

// Órdenes del cliente logueado (seguimiento)
router.get('/cliente/mis-ordenes', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user || user.tipo !== 'C') return res.status(403).json([]);

    const tenantId = req.tenant?.uid_tenant ?? 1;
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
    console.error('Error mis-ordenes:', e);
    res.status(500).json([]);
  }
});

// Informe de mantenimiento — acceso cliente con validación de propiedad
router.get('/cliente/informe/:uid_herramienta_orden', async (req, res) => {
  const user = req.session?.user;
  if (!user || user.tipo !== 'C') return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const tenantId = req.tenant?.uid_tenant ?? 1;
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

    const tenantId = req.tenant?.uid_tenant ?? 1;
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
          console.warn('⚠️ orders-cliente: WA no listo o PARTS_WHATSAPP_NUMBER no configurado, se omite notificación');
        }
      } catch (waErr) {
        console.warn('⚠️ orders-cliente: error enviando lista de repuestos por WA (autorización guardada):', waErr.message);
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

module.exports = router;
