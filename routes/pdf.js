'use strict';
const express      = require('express');
const router       = express.Router();
const db           = require('../utils/db');
const { resolveOrder } = require('../utils/schema');
const { generateQuotePDF, generateMaintenancePDF, generateOrdenServicioPDF } = require('../utils/pdf-generator');
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

// ─── Helper: todas las máquinas de una orden para el PDF ─────────────────────
async function getOrdenServicioDataCompleta(conn, uid_orden) {
  const [[ordenRow]] = await conn.execute(
    `SELECT o.uid_orden, o.ord_consecutivo, o.ord_fecha,
            c.cli_razon_social, c.cli_identificacion, c.cli_telefono, c.cli_direccion
     FROM b2c_orden o
     JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
     WHERE o.uid_orden = ?`,
    [uid_orden]
  );
  if (!ordenRow) return null;

  const [maquinas] = await conn.execute(
    `SELECT h.her_nombre, h.her_marca, h.her_serial, h.her_referencia,
            ho.hor_observaciones, ho.her_estado
     FROM b2c_herramienta_orden ho
     JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
     WHERE ho.uid_orden = ?
     ORDER BY ho.uid_herramienta_orden`,
    [uid_orden]
  );
  return { ordenRow, maquinas };
}

function printHtml(pdfUrl) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Imprimir Orden de Servicio</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;flex-direction:column;height:100vh;font-family:'Segoe UI',sans-serif;background:#f0f4f8}
  .bar{background:#1d3557;padding:10px 20px;display:flex;align-items:center;gap:14px;flex-shrink:0}
  .bar span{color:#fff;font-weight:600;font-size:14px;flex:1}
  .bar button{background:#fff;color:#1d3557;border:none;padding:8px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer}
  .bar button:hover{background:#e2e8f0}
  iframe{flex:1;border:none;width:100%}
</style></head><body>
  <div class="bar">
    <span>Orden de Servicio</span>
    <button onclick="document.getElementById('f').contentWindow.print()">🖨️ Imprimir</button>
  </div>
  <iframe id="f" src="${pdfUrl}"></iframe>
  <script>
    document.getElementById('f').addEventListener('load', function() {
      try { this.contentWindow.print(); } catch(e) {}
    });
  </script>
</body></html>`;
}

// ─── DESCARGAR / IMPRIMIR orden completa (todas las máquinas) ─────────────────
router.get('/orders/:orderId/pdf/orden', async (req, res) => {
  try {
    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    const data = await getOrdenServicioDataCompleta(conn, order.uid_orden);
    conn.release();
    if (!data) return res.status(404).json({ error: 'Orden no encontrada' });

    const { ordenRow, maquinas } = data;
    const pdf = await generateOrdenServicioPDF({
      orden:   { ord_consecutivo: ordenRow.ord_consecutivo, ord_fecha: ordenRow.ord_fecha },
      cliente: { cli_razon_social: ordenRow.cli_razon_social, cli_identificacion: ordenRow.cli_identificacion, cli_telefono: ordenRow.cli_telefono, cli_direccion: ordenRow.cli_direccion },
      maquinas,
    });

    const fname = 'orden-' + ordenRow.ord_consecutivo + '.pdf';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + fname + '"' });
    res.send(pdf);
  } catch (e) {
    console.error('Error generando PDF orden:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/orders/:orderId/print/orden', async (req, res) => {
  const conn  = await db.getConnection();
  const order = await resolveOrder(conn, req.params.orderId);
  conn.release();
  if (!order) return res.status(404).send('Orden no encontrada');
  res.send(printHtml(`/api/orders/${order.uid_orden}/pdf/orden`));
});

// ─── ENVIAR orden completa PDF por WhatsApp ───────────────────────────────────
router.post('/orders/:orderId/send-pdf/orden', async (req, res) => {
  try {
    if (!isReady()) return res.status(503).json({ success: false, error: 'WhatsApp no est\u00e1 conectado.' });

    const conn  = await db.getConnection();
    const order = await resolveOrder(conn, req.params.orderId);
    if (!order) { conn.release(); return res.status(404).json({ error: 'Orden no encontrada' }); }

    const data = await getOrdenServicioDataCompleta(conn, order.uid_orden);
    conn.release();
    if (!data) return res.status(404).json({ error: 'Orden no encontrada' });

    const { ordenRow, maquinas } = data;
    const pdf = await generateOrdenServicioPDF({
      orden:   { ord_consecutivo: ordenRow.ord_consecutivo, ord_fecha: ordenRow.ord_fecha },
      cliente: { cli_razon_social: ordenRow.cli_razon_social, cli_identificacion: ordenRow.cli_identificacion, cli_telefono: ordenRow.cli_telefono, cli_direccion: ordenRow.cli_direccion },
      maquinas,
    });

    const fname = 'orden-' + ordenRow.ord_consecutivo + '.pdf';
    const media = new MessageMedia('application/pdf', pdf.toString('base64'), fname);
    await waClient.sendMessage(getPhone({ cli_telefono: ordenRow.cli_telefono }), media);

    res.json({ success: true, filename: fname });
  } catch (e) {
    console.error('Error enviando PDF orden de servicio:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
