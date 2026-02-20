'use strict';
const express      = require('express');
const router       = express.Router();
const db           = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { generateQuotePDF, generateMaintenancePDF } = require('../utils/pdf-generator');
const { generateText }  = require('../utils/ia');
const { waClient, isReady } = require('../utils/whatsapp-client');
const { MessageMedia }  = require('whatsapp-web.js');

// ─── Prompt IA para informe de mantenimiento ──────────────────────────────────
function buildMaintenancePrompt(machine, workDesc, items) {
  const partsList = items.length
    ? items.map(it => '- ' + it.nombre + ' (x' + it.cantidad + ')').join('\n')
    : 'Sin repuestos registrados';

  return 'Eres un t\u00e9cnico especialista en reparaci\u00f3n y mantenimiento de herramientas en Colombia.\n\n'
    + 'Genera un informe t\u00e9cnico de mantenimiento profesional en espa\u00f1ol.\n\n'
    + 'DATOS DEL EQUIPO:\n'
    + '- Equipo: ' + (machine.her_nombre || 'Herramienta') + '\n'
    + '- Marca: '  + (machine.her_marca  || 'N/A') + '\n'
    + '- Serial: ' + (machine.her_serial || 'N/A') + '\n\n'
    + 'TRABAJO REALIZADO:\n' + (workDesc || 'Mantenimiento general') + '\n\n'
    + 'REPUESTOS UTILIZADOS:\n' + partsList + '\n\n'
    + 'INSTRUCCIONES:\n'
    + '1. Comienza con "Informe T\u00e9cnico \u2014 ' + (machine.her_nombre || 'Equipo') + (machine.her_serial ? ' N\u00b0 ' + machine.her_serial : '') + ':"\n'
    + '2. Describe t\u00e9cnicamente el trabajo realizado y la justificaci\u00f3n de los repuestos cambiados\n'
    + '3. Finaliza con una nota de verificaci\u00f3n de funcionamiento \u00f3ptimo\n'
    + '4. Entre 80 y 150 palabras, terminolog\u00eda t\u00e9cnica apropiada\n'
    + '5. NO menciones precios ni valores econ\u00f3micos\n\n'
    + 'Genera SOLO el texto del informe, sin t\u00edtulos ni explicaciones adicionales.';
}

// ─── Helper: queries comunes ──────────────────────────────────────────────────
async function getMachineWithItems(conn, uidOrden, equipmentOrderId) {
  const [[machine]] = await conn.execute(
    `SELECT cm.*, h.her_nombre, h.her_marca, h.her_serial,
             ho.hor_tecnico, ho.hor_cargo_tecnico, ho.hor_proximo_mantenimiento
     FROM b2c_cotizacion_maquina cm
     LEFT JOIN b2c_herramienta_orden ho
           ON CAST(ho.uid_herramienta_orden AS CHAR) = CAST(cm.uid_herramienta_orden AS CHAR)
     LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
     WHERE cm.uid_orden = ? AND cm.uid_herramienta_orden = ?`,
    [uidOrden, equipmentOrderId]
  );

  const [items] = await conn.execute(
    `SELECT * FROM b2c_cotizacion_item
     WHERE uid_orden = ? AND uid_herramienta_orden = ?
     ORDER BY id`,
    [uidOrden, equipmentOrderId]
  );

  return { machine, items };
}

async function getAllMachinesWithItems(conn, uidOrden) {
  const [machines] = await conn.execute(
    `SELECT cm.*, h.her_nombre, h.her_marca, h.her_serial,
             ho.hor_tecnico, ho.hor_cargo_tecnico, ho.hor_proximo_mantenimiento
     FROM b2c_cotizacion_maquina cm
     LEFT JOIN b2c_herramienta_orden ho
           ON CAST(ho.uid_herramienta_orden AS CHAR) = CAST(cm.uid_herramienta_orden AS CHAR)
     LEFT JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
     WHERE cm.uid_orden = ?
     ORDER BY cm.uid_herramienta_orden`,
    [uidOrden]
  );

  const [items] = await conn.execute(
    `SELECT * FROM b2c_cotizacion_item WHERE uid_orden = ? ORDER BY uid_herramienta_orden, id`,
    [uidOrden]
  );

  return { machines, items };
}

function getPhone(order) {
  let phone = String(order.cli_telefono || '').replace(/[^0-9]/g, '');
  if (!phone.startsWith('57')) phone = '57' + phone.slice(-10);
  return phone + '@c.us';
}

// ─── DESCARGAR cotizaci\u00f3n PDF ─────────────────────────────────────────────
router.get('/orders/:orderId/pdf/quote', async (req, res) => {
  try {
    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    const { machines, items } = await getAllMachinesWithItems(conn, order.uid_orden);
    conn.release();

    if (!machines.length) return res.status(400).json({ error: 'No hay cotizaciones guardadas para esta orden.' });

    const pdf = await generateQuotePDF({ order, machines, items, quoteNumber: order.ord_consecutivo });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="cotizacion-' + order.ord_consecutivo + '.pdf"' });
    res.send(pdf);
  } catch (e) {
    console.error('Error generando PDF cotizaci\u00f3n:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── DESCARGAR informe de mantenimiento PDF ───────────────────────────────────
router.get('/orders/:orderId/pdf/maintenance/:equipmentOrderId', async (req, res) => {
  try {
    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    const { machine, items } = await getMachineWithItems(conn, order.uid_orden, req.params.equipmentOrderId);
    conn.release();

    if (!machine) return res.status(404).json({ error: 'No hay cotizaci\u00f3n para esta m\u00e1quina.' });

    const observation = await generateText(buildMaintenancePrompt(machine, machine.descripcion_trabajo, items), 350);
    const pdf = await generateMaintenancePDF({ order, machine, items, observation });

    const fname = 'mantenimiento-' + order.ord_consecutivo + '-' + (machine.her_nombre || 'maquina').replace(/\s+/g, '-') + '.pdf';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' });
    res.send(pdf);
  } catch (e) {
    console.error('Error generando PDF mantenimiento:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── ENVIAR cotizaci\u00f3n PDF por WhatsApp ──────────────────────────────────
router.post('/orders/:orderId/send-pdf/quote', async (req, res) => {
  try {
    if (!isReady()) return res.status(503).json({ success: false, error: 'WhatsApp no est\u00e1 conectado.' });

    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    const { machines, items } = await getAllMachinesWithItems(conn, order.uid_orden);
    conn.release();

    if (!machines.length) return res.status(400).json({ error: 'No hay cotizaciones guardadas.' });

    const pdf    = await generateQuotePDF({ order, machines, items, quoteNumber: order.ord_consecutivo });
    const fname  = 'cotizacion-' + order.ord_consecutivo + '.pdf';
    const media  = new MessageMedia('application/pdf', pdf.toString('base64'), fname);
    await waClient.sendMessage(getPhone(order), media);

    res.json({ success: true, filename: fname });
  } catch (e) {
    console.error('Error enviando PDF cotizaci\u00f3n:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── ENVIAR informe de mantenimiento PDF por WhatsApp ────────────────────────
router.post('/orders/:orderId/send-pdf/maintenance/:equipmentOrderId', async (req, res) => {
  try {
    if (!isReady()) return res.status(503).json({ success: false, error: 'WhatsApp no est\u00e1 conectado.' });

    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    const { machine, items } = await getMachineWithItems(conn, order.uid_orden, req.params.equipmentOrderId);
    conn.release();

    if (!machine) return res.status(404).json({ error: 'No hay cotizaci\u00f3n para esta m\u00e1quina.' });

    const observation = await generateText(buildMaintenancePrompt(machine, machine.descripcion_trabajo, items), 350);
    const pdf   = await generateMaintenancePDF({ order, machine, items, observation });
    const fname = 'mantenimiento-' + order.ord_consecutivo + '-' + (machine.her_nombre || 'maquina').replace(/\s+/g, '-') + '.pdf';
    const media = new MessageMedia('application/pdf', pdf.toString('base64'), fname);
    await waClient.sendMessage(getPhone(order), media);

    res.json({ success: true, filename: fname });
  } catch (e) {
    console.error('Error enviando PDF mantenimiento:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
