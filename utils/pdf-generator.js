'use strict';
const PDFDocument = require('pdfkit');
const path        = require('path');
const fs          = require('fs');
const { UPLOADS_DIR } = require('./uploads');

const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo.png');

const COMPANY = {
  name:    'HERNANDO PARRA ZAPATA',
  nit:     'NIT 9862087-1',
  address: 'calle 21 No 10 02 - Pereira',
  phone:   '3104650437',
  website: 'www.suherramienta.com',
  email:   'suherramientapereira@gmail.com',
};

const C = {
  dark:    '#1d3557',
  mid:     '#457b9d',
  lightBg: '#f0f4f8',
  alt:     '#f7f9fb',
  bdr:     '#aaaaaa',
  wht:     '#ffffff',
  blk:     '#111111',
  gry:     '#666666',
  lbl:     '#2d3748',
  secHdr:  '#e2e8f0',
  secTxt:  '#475569',
};

const A4W = 595.28;
const A4H = 841.89;
const MG  = 40;
const CW  = A4W - MG * 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const money = n => '$' + Number(n || 0).toLocaleString('es-CO');

const fmtDate = (d) => {
  const dt = d ? (d instanceof Date ? d : new Date(d)) : new Date();
  return dt.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

function hLine(doc, x1, y, x2, color = C.bdr, lw = 0.5) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(lw).strokeColor(color).stroke().restore();
}

function fillRect(doc, x, y, w, h, fill) {
  doc.save().rect(x, y, w, h).fillColor(fill).fill().restore();
}

function strokeRect(doc, x, y, w, h, stroke = C.bdr, lw = 0.4) {
  doc.save().rect(x, y, w, h).lineWidth(lw).strokeColor(stroke).stroke().restore();
}

function cell(doc, text, x, y, w, h, opts) {
  const { fill, stroke = C.bdr, font = 'Helvetica', size = 8.5,
          color = C.blk, align = 'left', padX = 5, padY = 4 } = opts || {};
  if (fill) fillRect(doc, x, y, w, h, fill);
  strokeRect(doc, x, y, w, h, stroke);
  if (text != null && text !== '') {
    const t = String(text);
    doc.save().font(font).fontSize(size).fillColor(color)
      .text(t, x + padX, y + padY, { width: w - padX * 2, align, lineBreak: false })
      .restore();
  }
}

function sectionBar(doc, y, title) {
  fillRect(doc, MG, y, CW, 16, C.secHdr);
  hLine(doc, MG, y,      MG + CW, '#94a3b8', 0.5);
  hLine(doc, MG, y + 16, MG + CW, '#94a3b8', 0.5);
  doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.secTxt)
    .text(title, MG, y + 4, { width: CW, align: 'center' }).restore();
  return y + 20;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 3) + '...' : str;
}

// ─── COTIZACIÓN PDF ───────────────────────────────────────────────────────────
function generateQuotePDF({ order, machines, items, quoteNumber, tenant }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // IVA: por tenant si est\u00e1 disponible, fallback a env var (compat)
    const ivaResponsable = !!(tenant?.ten_iva_responsable);
    const ivaPct = ivaResponsable
      ? Number(tenant?.ten_iva_porcentaje ?? 19) / 100
      : parseFloat(process.env.IVA_RATE || '0');

    const SAFE_Y  = A4H - 90;  // l\u00edmite inferior antes de salto de p\u00e1gina
    const COLS = [
      { key: 'nombre',    header: '\u00cdtem',     width: 265, align: 'left'   },
      { key: 'precio',    header: 'Precio',        width: 65,  align: 'right'  },
      { key: 'cantidad',  header: 'Cantidad',      width: 50,  align: 'center' },
      { key: 'descuento', header: 'Descuento',     width: 65,  align: 'center' },
      { key: 'total',     header: 'Total',         width: 70,  align: 'right'  },
    ];
    const ROW_H  = 19;
    const TBL_H  = 20; // altura header de tabla

    // Pre-calcular alturas de filas de descripci\u00f3n (necesita font activo)
    doc.font('Helvetica').fontSize(7.5);
    const descHeights = new Map();
    for (const m of machines) {
      if (m.descripcion_trabajo) {
        const dh = Math.max(
          doc.heightOfString('   \u21b3 ' + m.descripcion_trabajo,
            { width: COLS[0].width - 10 }) + 8,
          14
        );
        descHeights.set(String(m.uid_herramienta_orden), dh);
      }
    }

    let y = MG;

    // \u2500\u2500 Header \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const LOGO_FW = 110;
    const LOGO_FH = Math.round(LOGO_FW * 1396 / 2696);
    const HDR_H   = Math.max(LOGO_FH, 65);

    if (fs.existsSync(LOGO)) {
      const cx = MG + LOGO_FW / 2;
      const cy = y + HDR_H / 2;
      doc.save().translate(cx, cy).rotate(-90)
        .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
        .restore();
    }

    const infoX = MG + LOGO_FW + 5;
    const infoW = CW - LOGO_FW - 80;
    doc.save().font('Helvetica-Bold').fontSize(12).fillColor(C.dark)
      .text(COMPANY.name, infoX, y + 4, { width: infoW, align: 'center' }).restore();
    [COMPANY.nit, COMPANY.address, COMPANY.phone, COMPANY.website, COMPANY.email].forEach((line, i) => {
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(line, infoX, y + 19 + i * 9.5, { width: infoW, align: 'center' }).restore();
    });

    const QX = MG + CW - 75;
    fillRect(doc, QX, y, 75, HDR_H, C.lightBg);
    strokeRect(doc, QX, y, 75, HDR_H, C.bdr);
    doc.save().font('Helvetica').fontSize(8.5).fillColor(C.gry)
      .text('Cotizaci\u00f3n', QX, y + 10, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica-Bold').fontSize(15).fillColor(C.dark)
      .text('No. ' + quoteNumber, QX, y + 26, { width: 75, align: 'center' }).restore();

    y += HDR_H + 6;
    hLine(doc, MG, y, MG + CW, C.dark, 1.5);
    y += 10;

    // \u2500\u2500 Datos del cliente \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const LW    = 355;
    const RW    = CW - LW;
    const RH    = 20;
    const LBL_W = 82;

    const clientRows = [
      { lbl: 'SE\u00d1OR(ES)', val: order.cli_razon_social, rLbl: 'FECHA DE EXPEDICI\u00d3N', rVal: fmtDate() },
      { lbl: 'DIRECCI\u00d3N', val: order.cli_direccion,   rLbl: '',                          rVal: '' },
      { lbl: 'CIUDAD',          val: '',                    rLbl: 'FECHA DE VENCIMIENTO',      rVal: fmtDate(new Date(Date.now() + 30 * 864e5)) },
      { lbl: 'TEL\u00c9FONO', val: order.cli_telefono,    rLbl: 'NIT',                        rVal: order.cli_identificacion },
    ];

    for (const row of clientRows) {
      cell(doc, row.lbl, MG,         y, LBL_W,      RH, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, row.val, MG + LBL_W, y, LW - LBL_W, RH, { size: 8.5 });
      if (row.rLbl) {
        cell(doc, row.rLbl, MG + LW,          y, RW / 2, RH, { fill: C.lbl, font: 'Helvetica-Bold', size: 7, color: C.wht, align: 'center', padY: 6 });
        cell(doc, row.rVal, MG + LW + RW / 2, y, RW / 2, RH, { size: 8.5, align: 'center' });
      } else {
        strokeRect(doc, MG + LW, y, RW, RH);
      }
      y += RH;
    }
    y += 14;

    // \u2500\u2500 Header de tabla (se redibuja en cada p\u00e1gina nueva) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function drawTableHeader() {
      fillRect(doc, MG, y, CW, TBL_H, C.dark);
      let cx = MG;
      for (const col of COLS) {
        doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.wht)
          .text(col.header, cx + 5, y + 6, { width: col.width - 10, align: col.align }).restore();
        cx += col.width;
      }
      strokeRect(doc, MG, y, CW, TBL_H, C.dark);
      y += TBL_H;
    }
    drawTableHeader();

    // \u2500\u2500 Salto de p\u00e1gina \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    function checkPageBreak(neededH) {
      if (y + neededH > SAFE_Y) {
        doc.addPage();
        y = MG;
        drawTableHeader();
      }
    }

    // \u2500\u2500 \u00cdtems por m\u00e1quina \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const itemsByMachine = new Map();
    for (const it of items) {
      const k = String(it.uid_herramienta_orden);
      if (!itemsByMachine.has(k)) itemsByMachine.set(k, []);
      itemsByMachine.get(k).push(it);
    }

    let dataRowIdx = 0;

    function drawRow(rowData, rh, opts = {}) {
      const { isMachine, isDesc, isSubtotal } = opts;
      if (isMachine) {
        fillRect(doc, MG, y, CW, rh, C.lightBg);
      } else if (isSubtotal) {
        fillRect(doc, MG, y, CW, rh, '#e8efe8');
      } else if (!isDesc && dataRowIdx % 2 === 1) {
        fillRect(doc, MG, y, CW, rh, C.alt);
      }
      if (!isMachine && !isDesc && !isSubtotal) dataRowIdx++;

      strokeRect(doc, MG, y, CW, rh);
      let cx = MG;
      for (const col of COLS) {
        strokeRect(doc, cx, y, col.width, rh);
        const val = rowData[col.key];
        if (val) {
          const bold = (isMachine && col.key === 'nombre') || (isSubtotal && col.key === 'total');
          const sz   = isDesc ? 7.5 : 8.5;
          const clr  = isDesc ? C.gry : isSubtotal ? '#2d6a2d' : C.blk;
          const padY = isDesc ? 4 : Math.max((rh - sz) / 2, 2);
          const wrap = isDesc && col.key === 'nombre';
          doc.save()
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(sz).fillColor(clr)
            .text(val, cx + 5, y + padY, { width: col.width - 10, align: wrap ? 'left' : col.align, lineBreak: wrap })
            .restore();
        }
        cx += col.width;
      }
      y += rh;
    }

    // \u2500\u2500 Bloques por m\u00e1quina \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const machineSummary = [];

    for (const m of machines) {
      const k      = String(m.uid_herramienta_orden);
      const mItems = itemsByMachine.get(k) || [];
      const mName  = [m.her_nombre, m.her_marca ? '(' + m.her_marca + ')' : '', m.her_serial ? 'S/N:' + m.her_serial : ''].filter(Boolean).join(' ');

      // Fila encabezado de m\u00e1quina
      checkPageBreak(ROW_H);
      drawRow({ nombre: 'Reparaci\u00f3n ' + mName, precio: money(m.mano_obra), cantidad: '1', descuento: '0.00%', total: money(m.mano_obra) },
        ROW_H, { isMachine: true });

      // Descripci\u00f3n completa (multi-l\u00ednea)
      if (m.descripcion_trabajo) {
        const dh = descHeights.get(k) || 14;
        checkPageBreak(dh);
        drawRow({ nombre: '   \u21b3 ' + m.descripcion_trabajo, precio: '', cantidad: '', descuento: '', total: '' },
          dh, { isDesc: true });
      }

      // Repuestos / \u00edtems
      let itemsTotal = 0;
      for (const it of mItems) {
        const lineTotal = Number(it.cantidad || 1) * Number(it.precio || 0);
        itemsTotal += lineTotal;
        checkPageBreak(ROW_H);
        drawRow({ nombre: it.nombre, precio: money(it.precio), cantidad: String(it.cantidad || 1), descuento: '0.00%', total: money(lineTotal) },
          ROW_H);
      }

      // Subtotal por m\u00e1quina
      const machineTotal = Number(m.mano_obra || 0) + itemsTotal;
      checkPageBreak(ROW_H);
      drawRow({ nombre: 'Subtotal \u2014 ' + truncate(mName, 38), precio: '', cantidad: '', descuento: '', total: money(machineTotal) },
        ROW_H, { isSubtotal: true });

      machineSummary.push({ name: mName, total: machineTotal });
    }

    // \u2500\u2500 Resumen final \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const grandSubtotal = machineSummary.reduce((s, m) => s + m.total, 0);
    const iva           = grandSubtotal * ivaPct;
    const grandTotal    = grandSubtotal + iva;

    const TX = MG + CW - 240;
    const summaryH = 20 + machineSummary.length * 17 + 4 + 19 + (ivaPct > 0 ? 19 : 0) + 24 + 40;
    checkPageBreak(summaryH);

    y += 8;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 10;

    // Barra t\u00edtulo resumen
    fillRect(doc, TX, y, 240, 18, C.dark);
    doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(C.wht)
      .text('RESUMEN DE COTIZACI\u00d3N', TX, y + 5, { width: 240, align: 'center' }).restore();
    y += 18;

    // Fila por m\u00e1quina
    for (const ms of machineSummary) {
      fillRect(doc, TX, y, 240, 17, C.alt);
      strokeRect(doc, TX, y, 240, 17);
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(truncate(ms.name, 36), TX + 6,   y + 5, { width: 160, lineBreak: false })
        .text(money(ms.total),       TX + 170,  y + 5, { width: 64, align: 'right', lineBreak: false })
        .restore();
      y += 17;
    }

    hLine(doc, TX, y, TX + 240, C.bdr, 0.5);
    y += 4;

    // Subtotal general
    fillRect(doc, TX, y, 240, 19, C.alt);
    strokeRect(doc, TX, y, 240, 19);
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
      .text('Subtotal', TX + 6,  y + 5, { width: 160, lineBreak: false })
      .text(money(grandSubtotal), TX + 170, y + 5, { width: 64, align: 'right', lineBreak: false })
      .restore();
    y += 19;

    // IVA (solo si aplica)
    if (ivaPct > 0) {
      fillRect(doc, TX, y, 240, 19, C.alt);
      strokeRect(doc, TX, y, 240, 19);
      doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
        .text('IVA ' + (ivaPct * 100).toFixed(0) + '%', TX + 6, y + 5, { width: 160, lineBreak: false })
        .text(money(iva), TX + 170, y + 5, { width: 64, align: 'right', lineBreak: false })
        .restore();
      y += 19;
    }

    // TOTAL
    fillRect(doc, TX, y, 240, 24, C.dark);
    strokeRect(doc, TX, y, 240, 24, C.dark);
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(C.wht)
      .text('TOTAL', TX + 6,   y + 7, { width: 160, lineBreak: false })
      .text(money(grandTotal), TX + 170, y + 7, { width: 64, align: 'right', lineBreak: false })
      .restore();
    y += 24;

    // \u2500\u2500 Firma \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    y += 24;
    hLine(doc, MG, y, MG + 150, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('ELABORADO POR', MG, y + 5).restore();

    doc.end();
  });
}

// ─── INFORME DE MANTENIMIENTO PDF ─────────────────────────────────────────────
function generateMaintenancePDF({ order, machine, items, observation, proxMantenimiento, photos }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    doc.on('data', d => chunks.push(d));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const FOOT_H = 55;                     // altura reservada para el footer
    const SIG_H  = 50;                     // altura reservada para las firmas
    const SAFE_Y = A4H - FOOT_H - SIG_H;  // límite de contenido por página

    let y = MG;

    // ── Header (mismo patrón que cotización / orden de servicio) ─────────────
    const LOGO_FW = 110;
    const LOGO_FH = Math.round(LOGO_FW * 1396 / 2696);
    const HDR_H   = Math.max(LOGO_FH, 65);

    if (fs.existsSync(LOGO)) {
      const cx = MG + LOGO_FW / 2;
      const cy = y + HDR_H / 2;
      doc.save().translate(cx, cy).rotate(-90)
        .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
        .restore();
    }

    const infoX = MG + LOGO_FW + 5;
    const infoW = CW - LOGO_FW - 80;
    doc.save().font('Helvetica-Bold').fontSize(12).fillColor(C.dark)
      .text(COMPANY.name, infoX, y + 4, { width: infoW, align: 'center' }).restore();
    [COMPANY.nit, COMPANY.address, COMPANY.phone, COMPANY.website, COMPANY.email].forEach((line, i) => {
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(line, infoX, y + 19 + i * 9.5, { width: infoW, align: 'center' }).restore();
    });

    // Caja tipo documento (derecha)
    const QX = MG + CW - 75;
    fillRect(doc, QX, y, 75, HDR_H, C.lightBg);
    strokeRect(doc, QX, y, 75, HDR_H, C.bdr);
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text('INFORME DE', QX, y + 6, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text('MANTENIMIENTO', QX, y + 16, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica-Bold').fontSize(15).fillColor(C.dark)
      .text('No. ' + (order.ord_consecutivo || ''), QX, y + 30, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text(fmtDate(), QX, y + 52, { width: 75, align: 'center' }).restore();

    y += HDR_H + 6;
    hLine(doc, MG, y, MG + CW, C.dark, 1.5);
    y += 10;

    // ── Constantes de layout ──────────────────────────────────────────────────
    const LBL_W = 90;
    const ROW_H = 20;
    const HW    = CW / 2;

    // ── Datos del solicitante ─────────────────────────────────────────────────
    y = sectionBar(doc, y, 'DATOS DEL SOLICITANTE');
    cell(doc, 'CLIENTE',   MG,      y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, order.cli_razon_social || '', MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5, font: 'Helvetica-Bold' });
    cell(doc, 'NIT / CC',  MG + HW, y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, order.cli_identificacion || '', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    y += ROW_H;
    cell(doc, 'DIRECCI\u00d3N', MG,  y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, truncate(order.cli_direccion || '', 42), MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    cell(doc, 'TEL\u00c9FONO', MG + HW, y, LBL_W,   ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, order.cli_telefono || '', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    y += ROW_H + 6;

    // ── T\u00e9cnico encargado ──────────────────────────────────────────────────
    y = sectionBar(doc, y, 'T\u00c9CNICO ENCARGADO');
    cell(doc, 'EMPRESA',   MG,      y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, 'SU HERRAMIENTA CST', MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5, font: 'Helvetica-Bold' });
    cell(doc, 'CARGO',     MG + HW, y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, machine.hor_cargo_tecnico || 'T\u00c9CNICO EN MAQUINARIA', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    y += ROW_H;
    cell(doc, 'ENCARGADO', MG,      y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, machine.hor_tecnico || '', MG + LBL_W, y, CW - LBL_W, ROW_H, { size: 8.5 });
    y += ROW_H + 6;

    // ── Descripci\u00f3n del equipo ───────────────────────────────────────────
    y = sectionBar(doc, y, 'DESCRIPCI\u00d3N DEL EQUIPO');
    cell(doc, 'HERRAMIENTA', MG,      y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, machine.her_nombre || '', MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5, font: 'Helvetica-Bold' });
    cell(doc, 'MARCA',       MG + HW, y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, machine.her_marca || '', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    y += ROW_H;
    cell(doc, 'SERIAL',      MG,      y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, machine.her_serial || '', MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    cell(doc, 'REFERENCIA',  MG + HW, y, LBL_W,       ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
    cell(doc, machine.her_referencia || '', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
    y += ROW_H;
    const proxMant = proxMantenimiento || machine.hor_proximo_mantenimiento || '';
    if (proxMant) {
      cell(doc, 'PR\u00d3XIMO MANTENIMIENTO', MG, y, LBL_W, ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, proxMant, MG + LBL_W, y, CW - LBL_W, ROW_H, { size: 8.5 });
      y += ROW_H;
    }
    y += 6;

    // ── Repuestos utilizados (tabla) ──────────────────────────────────────────
    if (items && items.length > 0) {
      y = sectionBar(doc, y, 'REPUESTOS UTILIZADOS');
      const PCOLS = [
        { header: 'Repuesto / Componente', w: 335, align: 'left'   },
        { header: 'Cantidad',              w: 70,  align: 'center' },
        { header: 'Precio unit.',          w: 110, align: 'right'  },
      ];
      const PROW_H = 18;
      fillRect(doc, MG, y, CW, PROW_H, C.dark);
      let px = MG;
      for (const col of PCOLS) {
        doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(C.wht)
          .text(col.header, px + 5, y + 5, { width: col.w - 10, align: col.align, lineBreak: false }).restore();
        px += col.w;
      }
      strokeRect(doc, MG, y, CW, PROW_H, C.dark);
      y += PROW_H;
      items.forEach((it, i) => {
        if (i % 2 === 1) fillRect(doc, MG, y, CW, PROW_H, C.alt);
        strokeRect(doc, MG, y, CW, PROW_H);
        px = MG;
        [truncate(it.nombre, 62), String(it.cantidad || 1), money(it.precio)].forEach((val, ci) => {
          strokeRect(doc, px, y, PCOLS[ci].w, PROW_H);
          doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
            .text(val, px + 5, y + 5, { width: PCOLS[ci].w - 10, align: PCOLS[ci].align, lineBreak: false }).restore();
          px += PCOLS[ci].w;
        });
        y += PROW_H;
      });
      y += 8;
    }

    // ── Observaci\u00f3n t\u00e9cnica (IA) ─────────────────────────────────────
    y = sectionBar(doc, y, 'OBSERVACI\u00d3N T\u00c9CNICA');
    y += 4;
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
      .text(observation || '', MG + 8, y, { width: CW - 16, align: 'justify' }).restore();
    y = doc.y + 14;

    // ── Registro fotogr\u00e1fico ──────────────────────────────────────────────
    const photoGroups = [
      { label: 'ESTADO DE RECEPCI\u00d3N',  fotos: photos?.recepcion || [] },
      { label: 'REGISTRO DEL TRABAJO',      fotos: photos?.trabajo   || [] },
    ].filter(g => g.fotos.length > 0);

    if (photoGroups.length > 0) {
      const PW  = 246;
      const PH  = 160;
      const GAP = Math.floor((CW - PW * 2) / 2);

      for (const group of photoGroups) {
        if (y + 30 + PH > SAFE_Y) { doc.addPage(); y = MG; }
        y = sectionBar(doc, y, group.label);
        let col = 0;
        let rowY = y;
        for (const foto of group.fotos) {
          const fpath = path.join(UPLOADS_DIR, 'fotos-recepcion', foto.fho_archivo);
          if (!fs.existsSync(fpath)) continue;
          if (col === 0 && y + PH > SAFE_Y) { doc.addPage(); y = MG; rowY = y; }
          try { doc.image(fpath, MG + col * (PW + GAP), y, { fit: [PW, PH] }); } catch {}
          col++;
          if (col === 2) { col = 0; y = rowY + PH + 8; rowY = y; }
        }
        if (col > 0) y = rowY + PH + 8;
        y += 4;
      }
    }

    // ── Firmas ────────────────────────────────────────────────────────────────
    const FY = Math.max(y + 20, A4H - FOOT_H - SIG_H);
    hLine(doc, MG, FY, MG + 160, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Firma del T\u00e9cnico', MG, FY + 5).restore();
    hLine(doc, A4W / 2 + 20, FY, A4W - MG, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Firma del Cliente / Recibido', A4W / 2 + 20, FY + 5).restore();

    // ── Footer (mismo que orden de servicio) ──────────────────────────────────
    const footY = A4H - FOOT_H;
    hLine(doc, MG, footY, MG + CW, C.dark, 0.8);
    [COMPANY.email + '   Celular: ' + COMPANY.phone, COMPANY.address, COMPANY.website]
      .forEach((line, i) => {
        doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
          .text(line, MG, footY + 6 + i * 11, { width: CW, align: 'center' }).restore();
      });

    doc.end();
  });
}

// ─── ORDEN DE SERVICIO PDF ────────────────────────────────────────────────────
// maquinas: array de { her_nombre, her_marca, her_serial, her_referencia, hor_observaciones }
function generateOrdenServicioPDF({ orden, cliente, maquinas }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const parseOrdFecha = (raw) => {
      const m = String(raw || '').match(/^(\d{4})(\d{2})(\d{2})$/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
    };

    let y = MG;

    // ── Header ────────────────────────────────────────────────────────────────
    const LOGO_FW = 110;
    const LOGO_FH = Math.round(LOGO_FW * 1396 / 2696);
    const HDR_H   = Math.max(LOGO_FH, 65);

    if (fs.existsSync(LOGO)) {
      const cx = MG + LOGO_FW / 2;
      const cy = y + HDR_H / 2;
      doc.save()
        .translate(cx, cy).rotate(-90)
        .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
        .restore();
    }

    const infoX = MG + LOGO_FW + 5;
    const infoW = CW - LOGO_FW - 80;
    doc.save().font('Helvetica-Bold').fontSize(12).fillColor(C.dark)
      .text(COMPANY.name, infoX, y + 4, { width: infoW, align: 'center' }).restore();
    [COMPANY.nit, COMPANY.address, COMPANY.phone, COMPANY.website, COMPANY.email].forEach((line, i) => {
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(line, infoX, y + 19 + i * 9.5, { width: infoW, align: 'center' }).restore();
    });

    const QX = MG + CW - 75;
    fillRect(doc, QX, y, 75, HDR_H, C.lightBg);
    strokeRect(doc, QX, y, 75, HDR_H, C.bdr);
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text('ORDEN DE SERVICIO', QX, y + 8, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica-Bold').fontSize(15).fillColor(C.dark)
      .text('No. ' + (orden.ord_consecutivo || ''), QX, y + 24, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text(fmtDate(parseOrdFecha(orden.ord_fecha)), QX, y + 46, { width: 75, align: 'center' }).restore();

    y += HDR_H + 6;
    hLine(doc, MG, y, MG + CW, C.dark, 1.5);
    y += 10;

    // ── Datos del cliente ─────────────────────────────────────────────────────
    const LBL_W = 90;
    const ROW_H = 20;
    const HW    = CW / 2;

    const clientRows = [
      { lbl: 'CLIENTE',                  val: cliente.cli_razon_social || '' },
      { lbl: 'NIT / CC',                 val: cliente.cli_identificacion || '' },
      { lbl: 'DIRECCI\u00d3N / TEL\u00c9FONO', val: [cliente.cli_direccion, cliente.cli_telefono].filter(Boolean).join(' / ') },
    ];
    for (const row of clientRows) {
      cell(doc, row.lbl, MG, y, LBL_W, ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, row.val, MG + LBL_W, y, CW - LBL_W, ROW_H, { size: 8.5 });
      y += ROW_H;
    }
    y += 10;

    // ── Una sección por máquina ───────────────────────────────────────────────
    const lista = Array.isArray(maquinas) ? maquinas : [maquinas];
    lista.forEach((maq, idx) => {
      const label = lista.length > 1
        ? `EQUIPO ${idx + 1} — ${(maq.her_nombre || '').toUpperCase()}`
        : 'EQUIPO RECIBIDO';
      y = sectionBar(doc, y, label);

      cell(doc, 'HERRAMIENTA', MG, y, LBL_W, ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, maq.her_nombre || '', MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5, font: 'Helvetica-Bold' });
      cell(doc, 'MARCA', MG + HW, y, LBL_W, ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, maq.her_marca || '', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
      y += ROW_H;

      cell(doc, 'SERIAL', MG, y, LBL_W, ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, maq.her_serial || '', MG + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
      cell(doc, 'REFERENCIA', MG + HW, y, LBL_W, ROW_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, maq.her_referencia || '', MG + HW + LBL_W, y, HW - LBL_W, ROW_H, { size: 8.5 });
      y += ROW_H;

      const obsText = maq.hor_observaciones || '';
      const OBS_H  = 40;
      cell(doc, 'OBSERVACI\u00d3N', MG, y, LBL_W, OBS_H, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      strokeRect(doc, MG + LBL_W, y, CW - LBL_W, OBS_H);
      if (obsText) {
        doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
          .text(obsText, MG + LBL_W + 5, y + 5, { width: CW - LBL_W - 10, height: OBS_H - 8 })
          .restore();
      }
      y += OBS_H + 8;
    });

    y += 4;

    // ── Condiciones generales (una sola vez al final) ─────────────────────────
    const conditions = [
      'CONDICIONES GENERALES: Si transcurridos 30 d\u00edas desde la fecha de notificaci\u00f3n de reparaci\u00f3n o presupuesto, no se han retirado los equipos o cancelada su reparaci\u00f3n, estos equipos pasar\u00e1n a disposici\u00f3n de SU HERRAMIENTA CST, sin nada que reclamar.',
      'SU HERRAMIENTA CST se declara no responsable de la mercanc\u00eda arriba descrita, asumiendo s\u00f3lo la reparaci\u00f3n de la misma, desligandose de toda responsabilidad sobre el origen o ingreso de dicha mercanc\u00eda.',
      'La presentaci\u00f3n de este recibo es indispensable para retirar el equipo.',
      'Declaro haber le\u00eddo y aceptado las condiciones generales.',
    ];
    const condX = MG + 20;
    const condW = CW - 40;
    const condStartY = y;
    doc.save().font('Helvetica-Bold').fontSize(7.5).fillColor(C.blk)
      .text(conditions[0], condX, y, { width: condW, align: 'justify' }).restore();
    y = doc.y + 5;
    for (let i = 1; i < conditions.length; i++) {
      doc.save().font('Helvetica').fontSize(7.5).fillColor(C.blk)
        .text(conditions[i], condX, y, { width: condW, align: 'center' }).restore();
      y = doc.y + 4;
    }
    strokeRect(doc, MG, condStartY - 6, CW, y - condStartY + 14, C.bdr, 0.6);
    y += 14;

    // ── Firma ─────────────────────────────────────────────────────────────────
    const FY = Math.max(y + 30, A4H - 110);
    const lineW = 200;
    const lineX = (A4W - lineW) / 2;
    hLine(doc, lineX, FY, lineX + lineW, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Firma Cliente', 0, FY + 5, { width: A4W, align: 'center' }).restore();

    // ── Footer ────────────────────────────────────────────────────────────────
    const footY = A4H - 55;
    hLine(doc, MG, footY, MG + CW, C.dark, 0.8);
    [COMPANY.email + '   Celular: ' + COMPANY.phone, COMPANY.address, COMPANY.website]
      .forEach((line, i) => {
        doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
          .text(line, MG, footY + 6 + i * 11, { width: CW, align: 'center' }).restore();
      });

    doc.end();
  });
}

// ─── RECIBO DE CAJA PDF ───────────────────────────────────────────────────────
// cotizacion: { machines, items } cuando hay orden con cotización vinculada
// recibo.rc_items: JSON string con ítems manuales (mostrador sin orden)
function generateReciboPDF({ recibo, tenant, cotizacion }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const LABEL_METODO = {
      efectivo:      'Efectivo',
      transferencia: 'Transferencia bancaria',
      tarjeta:       'Tarjeta',
      nequi:         'Nequi',
      daviplata:     'Daviplata',
    };

    const ivaResponsable = !!(tenant?.ten_iva_responsable);
    const ivaPct = ivaResponsable
      ? Number(tenant?.ten_iva_porcentaje ?? 19) / 100
      : parseFloat(process.env.IVA_RATE || '0');

    const SAFE_Y = A4H - 90;

    // Parse manual items stored as JSON string in DB
    let manualItems = null;
    if (!cotizacion) {
      const raw = recibo.rc_items;
      if (raw) {
        try { manualItems = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
        if (!Array.isArray(manualItems) || !manualItems.length) manualItems = null;
      }
    }

    let y = MG;

    // ── Header ──────────────────────────────────────────────────────────────
    const LOGO_FW = 110;
    const LOGO_FH = Math.round(LOGO_FW * 1396 / 2696);
    const HDR_H   = Math.max(LOGO_FH, 65);

    if (fs.existsSync(LOGO)) {
      const cx = MG + LOGO_FW / 2;
      const cy = y + HDR_H / 2;
      doc.save().translate(cx, cy).rotate(-90)
        .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
        .restore();
    }

    const infoX = MG + LOGO_FW + 5;
    const infoW = CW - LOGO_FW - 80;
    doc.save().font('Helvetica-Bold').fontSize(12).fillColor(C.dark)
      .text(COMPANY.name, infoX, y + 4, { width: infoW, align: 'center' }).restore();
    [COMPANY.nit, COMPANY.address, COMPANY.phone, COMPANY.website, COMPANY.email]
      .forEach((line, i) => {
        doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
          .text(line, infoX, y + 19 + i * 9.5, { width: infoW, align: 'center' }).restore();
      });

    const QX = MG + CW - 75;
    fillRect(doc, QX, y, 75, HDR_H, C.lightBg);
    strokeRect(doc, QX, y, 75, HDR_H, C.bdr);
    doc.save().font('Helvetica').fontSize(8.5).fillColor(C.gry)
      .text('Recibo de Caja', QX, y + 10, { width: 75, align: 'center' }).restore();
    doc.save().font('Helvetica-Bold').fontSize(15).fillColor(C.dark)
      .text('No. ' + recibo.rc_consecutivo, QX, y + 26, { width: 75, align: 'center' }).restore();

    y += HDR_H + 6;
    hLine(doc, MG, y, MG + CW, C.dark, 1.5);
    y += 10;

    // ── Datos del cliente / receptor ────────────────────────────────────────
    const LW    = 355;
    const RW    = CW - LW;
    const RH    = 20;
    const LBL_W = 82;

    const nombre  = recibo.cli_razon_social || recibo.cli_contacto || recibo.rc_nombre_paga || 'Mostrador';
    const cedula  = recibo.cli_identificacion || recibo.rc_cliente_cedula || '';
    const clientRows = [
      { lbl: 'SEÑOR(ES)', val: nombre,                    rLbl: 'FECHA',      rVal: fmtDate(recibo.rc_fecha) },
      { lbl: 'DIRECCIÓN', val: recibo.cli_direccion || '', rLbl: cedula ? 'CC / NIT' : '', rVal: cedula },
      { lbl: 'TELÉFONO',  val: recibo.cli_telefono  || '', rLbl: 'ORDEN No.', rVal: recibo.ord_consecutivo ? String(recibo.ord_consecutivo) : '' },
    ];

    for (const row of clientRows) {
      cell(doc, row.lbl, MG,         y, LBL_W,      RH, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, row.val, MG + LBL_W, y, LW - LBL_W, RH, { size: 8.5 });
      if (row.rLbl) {
        cell(doc, row.rLbl, MG + LW,          y, RW / 2, RH, { fill: C.lbl, font: 'Helvetica-Bold', size: 7, color: C.wht, align: 'center', padY: 6 });
        cell(doc, row.rVal, MG + LW + RW / 2, y, RW / 2, RH, { size: 8.5, align: 'center' });
      } else {
        strokeRect(doc, MG + LW, y, RW, RH);
      }
      y += RH;
    }
    y += 10;

    // ── Detalle (3 modos según disponibilidad de datos) ─────────────────────

    if (cotizacion) {
      // ── MODO 1: desglose por máquina (orden con cotización) ─────────────
      // Barra concepto con altura dinámica para textos largos
      doc.font('Helvetica-Bold').fontSize(8);
      const concH1 = Math.max(doc.heightOfString('CONCEPTO: ' + recibo.rc_concepto, { width: CW - 16 }) + 8, 17);
      fillRect(doc, MG, y, CW, concH1, C.secHdr);
      hLine(doc, MG, y,         MG + CW, '#94a3b8', 0.5);
      hLine(doc, MG, y + concH1, MG + CW, '#94a3b8', 0.5);
      doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.secTxt)
        .text('CONCEPTO: ' + recibo.rc_concepto, MG + 8, y + 4, { width: CW - 16 }).restore();
      y += concH1 + 4;

      const COLS = [
        { key: 'nombre',    header: 'Ítem',    width: 265, align: 'left'   },
        { key: 'precio',    header: 'Precio',       width: 65,  align: 'right'  },
        { key: 'cantidad',  header: 'Cant.',        width: 50,  align: 'center' },
        { key: 'descuento', header: 'Dcto.',        width: 65,  align: 'center' },
        { key: 'total',     header: 'Total',        width: 70,  align: 'right'  },
      ];
      const ROW_H = 19;
      const TBL_H = 20;

      doc.font('Helvetica').fontSize(7.5);
      const descHeights = new Map();
      for (const m of cotizacion.machines) {
        if (m.descripcion_trabajo) {
          const dh = Math.max(
            doc.heightOfString('   ↳ ' + m.descripcion_trabajo, { width: COLS[0].width - 10 }) + 8,
            14
          );
          descHeights.set(String(m.uid_herramienta_orden), dh);
        }
      }

      function drawTblHeader() {
        fillRect(doc, MG, y, CW, TBL_H, C.dark);
        let cx = MG;
        for (const col of COLS) {
          doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.wht)
            .text(col.header, cx + 5, y + 6, { width: col.width - 10, align: col.align }).restore();
          cx += col.width;
        }
        strokeRect(doc, MG, y, CW, TBL_H, C.dark);
        y += TBL_H;
      }

      function checkPB(neededH) {
        if (y + neededH > SAFE_Y) { doc.addPage(); y = MG; drawTblHeader(); }
      }

      drawTblHeader();

      const itemsByMachine = new Map();
      for (const it of cotizacion.items) {
        const k = String(it.uid_herramienta_orden);
        if (!itemsByMachine.has(k)) itemsByMachine.set(k, []);
        itemsByMachine.get(k).push(it);
      }

      let dataRowIdx = 0;
      function drawRow(rowData, rh, opts = {}) {
        const { isMachine, isDesc, isSubtotal } = opts;
        if (isMachine)         fillRect(doc, MG, y, CW, rh, C.lightBg);
        else if (isSubtotal)   fillRect(doc, MG, y, CW, rh, '#e8efe8');
        else if (!isDesc && dataRowIdx % 2 === 1) fillRect(doc, MG, y, CW, rh, C.alt);
        if (!isMachine && !isDesc && !isSubtotal) dataRowIdx++;
        strokeRect(doc, MG, y, CW, rh);
        let cx = MG;
        for (const col of COLS) {
          strokeRect(doc, cx, y, col.width, rh);
          const val = rowData[col.key];
          if (val) {
            const bold = (isMachine && col.key === 'nombre') || (isSubtotal && col.key === 'total');
            const sz   = isDesc ? 7.5 : 8.5;
            const clr  = isDesc ? C.gry : isSubtotal ? '#2d6a2d' : C.blk;
            const padY = isDesc ? 4 : Math.max((rh - sz) / 2, 2);
            const wrap = isDesc && col.key === 'nombre';
            doc.save().font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz).fillColor(clr)
              .text(val, cx + 5, y + padY, { width: col.width - 10, align: wrap ? 'left' : col.align, lineBreak: wrap })
              .restore();
          }
          cx += col.width;
        }
        y += rh;
      }

      const machineSummary = [];
      for (const m of cotizacion.machines) {
        const k      = String(m.uid_herramienta_orden);
        const mItems = itemsByMachine.get(k) || [];
        const mName  = [m.her_nombre, m.her_marca ? '(' + m.her_marca + ')' : '', m.her_serial ? 'S/N:' + m.her_serial : ''].filter(Boolean).join(' ');

        checkPB(ROW_H);
        drawRow({ nombre: 'Reparación ' + mName, precio: money(m.mano_obra), cantidad: '1', descuento: '0.00%', total: money(m.mano_obra) },
          ROW_H, { isMachine: true });

        if (m.descripcion_trabajo) {
          const dh = descHeights.get(k) || 14;
          checkPB(dh);
          drawRow({ nombre: '   ↳ ' + m.descripcion_trabajo }, dh, { isDesc: true });
        }

        let itemsTotal = 0;
        for (const it of mItems) {
          const lineTotal = Number(it.cantidad || 1) * Number(it.precio || 0);
          itemsTotal += lineTotal;
          checkPB(ROW_H);
          drawRow({ nombre: it.nombre, precio: money(it.precio), cantidad: String(it.cantidad || 1), descuento: '0.00%', total: money(lineTotal) }, ROW_H);
        }

        const machineTotal = Number(m.mano_obra || 0) + itemsTotal;
        checkPB(ROW_H);
        drawRow({ nombre: 'Subtotal — ' + truncate(mName, 38), total: money(machineTotal) }, ROW_H, { isSubtotal: true });
        machineSummary.push({ name: mName, total: machineTotal });
      }

      // Resumen (igual que cotización)
      const grandSubtotal = machineSummary.reduce((s, m) => s + m.total, 0);
      const iva = grandSubtotal * ivaPct;
      const SX  = MG + CW - 240;
      const summaryH = 18 + machineSummary.length * 17 + 4 + 19 + (ivaPct > 0 ? 19 : 0) + 10;
      checkPB(summaryH + 60);

      y += 8;
      hLine(doc, MG, y, MG + CW, C.bdr);
      y += 10;

      fillRect(doc, SX, y, 240, 18, C.dark);
      doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(C.wht)
        .text('RESUMEN', SX, y + 5, { width: 240, align: 'center' }).restore();
      y += 18;

      for (const ms of machineSummary) {
        fillRect(doc, SX, y, 240, 17, C.alt);
        strokeRect(doc, SX, y, 240, 17);
        doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
          .text(truncate(ms.name, 36), SX + 6,   y + 5, { width: 160, lineBreak: false })
          .text(money(ms.total),       SX + 170,  y + 5, { width: 64, align: 'right', lineBreak: false })
          .restore();
        y += 17;
      }
      hLine(doc, SX, y, SX + 240, C.bdr, 0.5);
      y += 4;

      fillRect(doc, SX, y, 240, 19, C.alt);
      strokeRect(doc, SX, y, 240, 19);
      doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
        .text('Subtotal', SX + 6,       y + 5, { width: 160, lineBreak: false })
        .text(money(grandSubtotal), SX + 170, y + 5, { width: 64, align: 'right', lineBreak: false })
        .restore();
      y += 19;

      if (ivaPct > 0) {
        fillRect(doc, SX, y, 240, 19, C.alt);
        strokeRect(doc, SX, y, 240, 19);
        doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
          .text('IVA ' + (ivaPct * 100).toFixed(0) + '%', SX + 6, y + 5, { width: 160, lineBreak: false })
          .text(money(iva), SX + 170, y + 5, { width: 64, align: 'right', lineBreak: false })
          .restore();
        y += 19;
      }
      y += 12;

    } else if (manualItems) {
      // ── MODO 2: ítems manuales de mostrador ─────────────────────────────
      doc.font('Helvetica-Bold').fontSize(8);
      const concH2 = Math.max(doc.heightOfString('CONCEPTO: ' + recibo.rc_concepto, { width: CW - 16 }) + 8, 17);
      fillRect(doc, MG, y, CW, concH2, C.secHdr);
      hLine(doc, MG, y,          MG + CW, '#94a3b8', 0.5);
      hLine(doc, MG, y + concH2, MG + CW, '#94a3b8', 0.5);
      doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.secTxt)
        .text('CONCEPTO: ' + recibo.rc_concepto, MG + 8, y + 4, { width: CW - 16 }).restore();
      y += concH2 + 4;

      // 4 columnas: descripción, cant, precio, subtotal
      const IC = [
        { header: 'Descripción', w: 265, align: 'left'   },
        { header: 'Cant.',           w: 50,  align: 'center' },
        { header: 'Precio unit.',    w: 100, align: 'right'  },
        { header: 'Subtotal',        w: 100, align: 'right'  },
      ];
      const IR = 19;
      fillRect(doc, MG, y, CW, IR, C.dark);
      let hx = MG;
      for (const col of IC) {
        doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.wht)
          .text(col.header, hx + 5, y + 5, { width: col.w - 10, align: col.align }).restore();
        hx += col.w;
      }
      strokeRect(doc, MG, y, CW, IR, C.dark);
      y += IR;

      manualItems.forEach((it, i) => {
        const sub = Number(it.cantidad || 1) * Number(it.precio || 0);
        if (y + IR > SAFE_Y) { doc.addPage(); y = MG; }
        if (i % 2 === 1) fillRect(doc, MG, y, CW, IR, C.alt);
        strokeRect(doc, MG, y, CW, IR);
        let cx = MG;
        [
          { val: it.nombre || '', align: 'left'   },
          { val: String(it.cantidad || 1), align: 'center' },
          { val: money(it.precio),         align: 'right'  },
          { val: money(sub),               align: 'right'  },
        ].forEach((cd, ci) => {
          strokeRect(doc, cx, y, IC[ci].w, IR);
          doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
            .text(cd.val, cx + 5, y + 5, { width: IC[ci].w - 10, align: cd.align, lineBreak: false }).restore();
          cx += IC[ci].w;
        });
        y += IR;
      });
      y += 10;

    } else {
      // ── MODO 3: concepto simple (sin ítems ni cotización) ───────────────
      const COL_DESC  = CW - 100;
      const COL_VALOR = 100;
      const descH  = Math.max(doc.font('Helvetica').fontSize(8.5)
        .heightOfString(recibo.rc_concepto, { width: COL_DESC - 12 }) + 8, 28);

      fillRect(doc, MG, y, CW, 20, C.dark);
      doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.wht)
        .text('CONCEPTO', MG + 5, y + 6, { width: COL_DESC - 10 }).restore();
      doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.wht)
        .text('VALOR', MG + COL_DESC + 5, y + 6, { width: COL_VALOR - 10, align: 'right' }).restore();
      strokeRect(doc, MG, y, CW, 20, C.dark);
      y += 20;

      fillRect(doc, MG, y, CW, descH, C.alt);
      strokeRect(doc, MG, y, CW, descH);
      strokeRect(doc, MG, y, COL_DESC, descH);
      strokeRect(doc, MG + COL_DESC, y, COL_VALOR, descH);
      doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
        .text(recibo.rc_concepto, MG + 6, y + 6, { width: COL_DESC - 12, lineBreak: true }).restore();
      doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk)
        .text(money(recibo.rc_valor), MG + COL_DESC + 5, y + (descH - 9) / 2, { width: COL_VALOR - 10, align: 'right', lineBreak: false }).restore();
      y += descH + 4;
    }

    // ── Método de pago + referencia ─────────────────────────────────────────
    const metodoLabel = LABEL_METODO[recibo.rc_metodo_pago] || recibo.rc_metodo_pago;
    const metodoTxt   = recibo.rc_referencia
      ? `${metodoLabel} — Ref: ${recibo.rc_referencia}`
      : metodoLabel;
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Forma de pago: ' + metodoTxt, MG, y + 4).restore();
    y += 20;

    // ── Total recibido ────────────────────────────────────────────────────────
    const TOTX = MG + CW - 200;
    fillRect(doc, TOTX, y, 200, 28, C.dark);
    strokeRect(doc, TOTX, y, 200, 28, C.dark);
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(C.wht)
      .text('TOTAL RECIBIDO', TOTX + 8, y + 9, { width: 92, lineBreak: false }).restore();
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(C.wht)
      .text(money(recibo.rc_valor), TOTX + 100, y + 9, { width: 92, align: 'right', lineBreak: false }).restore();

    if (recibo.rc_estado === 'anulado') {
      doc.save().font('Helvetica-Bold').fontSize(36).fillColor('#cc0000').opacity(0.25)
        .text('ANULADO', MG, A4H / 2 - 30, { width: CW, align: 'center', rotate: -30 }).restore();
    }

    y += 28 + 40;

    // ── Firma ────────────────────────────────────────────────────────────────
    hLine(doc, MG, y, MG + 150, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('ELABORADO POR', MG, y + 5).restore();

    // ── Footer ───────────────────────────────────────────────────────────────
    const footY = A4H - 35;
    hLine(doc, MG, footY, MG + CW, C.dark, 1);
    doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.dark)
      .text('¡GRACIAS POR SU PAGO!', MG, footY + 6, { width: CW, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text(COMPANY.email + ' • ' + COMPANY.website, MG, footY + 18, { width: CW, align: 'center' }).restore();

    doc.end();
  });
}

// ─── generateVentaPDF ─────────────────────────────────────────────────────────
/**
 * @param {object} params
 * @param {object}   params.venta   — fila b2c_venta con JOINs (cliente, orden, creado_por_nombre)
 * @param {Array}    params.items   — filas b2c_venta_item
 * @param {object}  [params.tenant] — fila b2c_tenant (para IVA)
 * @returns {Buffer}
 */
function generateVentaPDF({ venta, items = [], tenant }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc    = new PDFDocument({ size: 'A4', margin: MG, bufferPages: true });
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const SAFE_Y = A4H - 90;
    let y = MG;

    // ── Header ───────────────────────────────────────────────────────────────
    const docNum = `VENTA #${venta.ven_consecutivo}`;
    try {
      doc.image(LOGO, MG, y, { width: 40, height: 40 });
    } catch (_) {}
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(C.dark)
      .text(COMPANY.name, MG + 50, y, { lineBreak: false }).restore();
    doc.save().font('Helvetica').fontSize(8.5).fillColor(C.gry)
      .text([COMPANY.nit, COMPANY.address, COMPANY.phone].join(' • '), MG + 50, y + 14, { width: 320 }).restore();

    // doc type box
    fillRect(doc, MG + CW - 110, y, 110, 40, C.lightBg);
    strokeRect(doc, MG + CW - 110, y, 110, 40);
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.dark)
      .text(docNum, MG + CW - 108, y + 5, { width: 106, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text(fmtDate(venta.ven_fecha), MG + CW - 108, y + 19, { width: 106, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Estado: ' + (venta.ven_estado || '').toUpperCase(), MG + CW - 108, y + 30, { width: 106, align: 'center' }).restore();
    y += 50;
    hLine(doc, MG, y, MG + CW, C.dark, 1.5);
    y += 8;

    // ── Datos cliente ────────────────────────────────────────────────────────
    const clienteNombre = venta.cli_razon_social || venta.cli_contacto || venta.ven_nombre_libre || '—';
    const clienteId     = venta.cli_identificacion || '';
    const ordenRef      = venta.ord_consecutivo ? `Orden #${venta.ord_consecutivo}` : '';

    fillRect(doc, MG, y, CW, 22, C.lightBg);
    strokeRect(doc, MG, y, CW, 22);
    doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.lbl)
      .text('CLIENTE', MG + 5, y + 7).restore();
    doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
      .text(clienteNombre + (clienteId ? `  |  CC/NIT: ${clienteId}` : '') + (ordenRef ? `  |  ${ordenRef}` : ''),
            MG + 60, y + 7, { width: CW - 70, lineBreak: false }).restore();
    y += 30;

    // ── Tabla de ítems ───────────────────────────────────────────────────────
    const COL = { desc: 220, tipo: 55, cant: 45, precio: 70, desc_: 45, total: 80 };
    const COL_X = {
      desc:   MG,
      tipo:   MG + COL.desc,
      cant:   MG + COL.desc + COL.tipo,
      precio: MG + COL.desc + COL.tipo + COL.cant,
      desc_:  MG + COL.desc + COL.tipo + COL.cant + COL.precio,
      total:  MG + COL.desc + COL.tipo + COL.cant + COL.precio + COL.desc_,
    };

    function drawTableHeader(yy) {
      fillRect(doc, MG, yy, CW, 18, C.dark);
      const hdr = [
        ['DESCRIPCIÓN', COL_X.desc, COL.desc, 'left'],
        ['TIPO',        COL_X.tipo, COL.tipo, 'center'],
        ['CANT',        COL_X.cant, COL.cant, 'center'],
        ['PRECIO',      COL_X.precio, COL.precio, 'right'],
        ['DSCTO%',      COL_X.desc_, COL.desc_, 'center'],
        ['TOTAL',       COL_X.total, COL.total, 'right'],
      ];
      for (const [label, lx, lw, align] of hdr) {
        doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.wht)
          .text(label, lx + 4, yy + 5, { width: lw - 8, align, lineBreak: false }).restore();
      }
      return yy + 18;
    }

    y = drawTableHeader(y);
    let rowAlt = false;

    for (const item of items) {
      const rowH = 18;
      if (y + rowH > SAFE_Y) {
        doc.addPage();
        y = MG;
        y = drawTableHeader(y);
        rowAlt = false;
      }
      if (rowAlt) fillRect(doc, MG, y, CW, rowH, C.alt);
      strokeRect(doc, MG, y, CW, rowH);
      rowAlt = !rowAlt;

      const tipo = item.vi_tipo === 'mano_obra' ? 'M. Obra' : 'Repuesto';
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(item.vi_descripcion || '', COL_X.desc + 4, y + 5, { width: COL.desc - 8, lineBreak: false }).restore();
      doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
        .text(tipo, COL_X.tipo + 4, y + 5, { width: COL.tipo - 8, align: 'center', lineBreak: false }).restore();
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(String(item.vi_cantidad), COL_X.cant + 4, y + 5, { width: COL.cant - 8, align: 'center', lineBreak: false }).restore();
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(money(item.vi_precio_unitario), COL_X.precio + 4, y + 5, { width: COL.precio - 8, align: 'right', lineBreak: false }).restore();
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(Number(item.vi_descuento_pct) > 0 ? item.vi_descuento_pct + '%' : '—',
              COL_X.desc_ + 4, y + 5, { width: COL.desc_ - 8, align: 'center', lineBreak: false }).restore();
      doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.blk)
        .text(money(item.vi_total), COL_X.total + 4, y + 5, { width: COL.total - 8, align: 'right', lineBreak: false }).restore();
      y += rowH;
    }
    y += 12;

    // ── Resumen totales ──────────────────────────────────────────────────────
    if (y + 80 > SAFE_Y) { doc.addPage(); y = MG; }
    const SUMX = MG + CW - 200;
    const ivaResponsable = tenant?.ten_iva_responsable || 0;

    const totLines = [
      ['Subtotal', venta.ven_subtotal],
    ];
    if (Number(venta.ven_descuento) > 0) totLines.push(['Descuento', -venta.ven_descuento]);
    if (ivaResponsable && Number(venta.ven_iva) > 0) {
      const ivaPct = tenant?.ten_iva_porcentaje ?? 19;
      totLines.push([`IVA (${ivaPct}%)`, venta.ven_iva]);
    }

    for (const [lbl, val] of totLines) {
      doc.save().font('Helvetica').fontSize(8.5).fillColor(C.gry)
        .text(lbl, SUMX, y, { width: 100, align: 'right', lineBreak: false }).restore();
      doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
        .text(money(Math.abs(val)), SUMX + 105, y, { width: 95, align: 'right', lineBreak: false }).restore();
      y += 14;
    }

    fillRect(doc, SUMX, y, 200, 24, C.dark);
    doc.save().font('Helvetica-Bold').fontSize(10).fillColor(C.wht)
      .text('TOTAL', SUMX + 6, y + 7, { width: 90, lineBreak: false }).restore();
    doc.save().font('Helvetica-Bold').fontSize(10).fillColor(C.wht)
      .text(money(venta.ven_total), SUMX + 100, y + 7, { width: 94, align: 'right', lineBreak: false }).restore();
    y += 32;

    // ── Método de pago ───────────────────────────────────────────────────────
    const LABEL_METODO_V = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', cheque:'Cheque', otro:'Otro' };
    const metodoTxt = LABEL_METODO_V[venta.ven_metodo_pago] || venta.ven_metodo_pago;
    const refTxt    = venta.ven_referencia ? `  —  Ref: ${venta.ven_referencia}` : '';
    doc.save().font('Helvetica').fontSize(8.5).fillColor(C.gry)
      .text('Forma de pago: ' + metodoTxt + refTxt, MG, y).restore();
    if (venta.ven_notas) {
      y += 12;
      doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
        .text('Notas: ' + venta.ven_notas, MG, y, { width: CW }).restore();
    }

    // ── Sello anulado ────────────────────────────────────────────────────────
    if (venta.ven_estado === 'anulada') {
      doc.save().font('Helvetica-Bold').fontSize(48).fillColor('#cc0000').opacity(0.2)
        .text('ANULADA', MG, A4H / 2 - 40, { width: CW, align: 'center', rotate: -30 }).restore();
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footY = A4H - 35;
    hLine(doc, MG, footY, MG + CW, C.dark, 1);
    doc.save().font('Helvetica-Bold').fontSize(8).fillColor(C.dark)
      .text('¡GRACIAS POR SU COMPRA!', MG, footY + 6, { width: CW, align: 'center' }).restore();
    doc.save().font('Helvetica').fontSize(7.5).fillColor(C.gry)
      .text(COMPANY.email + ' • ' + COMPANY.website, MG, footY + 18, { width: CW, align: 'center' }).restore();

    doc.end();
  });
}

module.exports = { generateQuotePDF, generateMaintenancePDF, generateOrdenServicioPDF, generateReciboPDF, generateVentaPDF };
