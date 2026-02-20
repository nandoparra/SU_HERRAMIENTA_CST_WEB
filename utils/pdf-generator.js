'use strict';
const PDFDocument = require('pdfkit');
const path        = require('path');
const fs          = require('fs');

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
function generateQuotePDF({ order, machines, items, quoteNumber }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = MG;

    // ── Header ────────────────────────────────────────────────────────────────
    // Logo rotado: imagen portrait 1396×2696 → rotar -90° para quedar horizontal
    const LOGO_FW = 110;                                   // ancho final en página
    const LOGO_FH = Math.round(LOGO_FW * 1396 / 2696);    // alto final ≈ 57 px
    const HDR_H   = Math.max(LOGO_FH, 65);                 // altura mínima del header

    if (fs.existsSync(LOGO)) {
      const cx = MG + LOGO_FW / 2;
      const cy = y + HDR_H / 2;
      doc.save()
        .translate(cx, cy)
        .rotate(-90)
        .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
        .restore();
    }

    // Company info - centro
    const infoX = MG + LOGO_FW + 5;
    const infoW = CW - LOGO_FW - 80;
    doc.save().font('Helvetica-Bold').fontSize(12).fillColor(C.dark)
      .text(COMPANY.name, infoX, y + 4, { width: infoW, align: 'center' }).restore();
    [COMPANY.nit, COMPANY.address, COMPANY.phone, COMPANY.website, COMPANY.email].forEach((line, i) => {
      doc.save().font('Helvetica').fontSize(8).fillColor(C.blk)
        .text(line, infoX, y + 19 + i * 9.5, { width: infoW, align: 'center' }).restore();
    });

    // Número de cotización - derecha
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

    // ── Datos del cliente ─────────────────────────────────────────────────────
    const LW = 355;
    const RW = CW - LW;
    const RH = 20;
    const LBL_W = 82;

    const clientRows = [
      { lbl: 'SE\u00d1OR(ES)', val: order.cli_razon_social,  rLbl: 'FECHA DE EXPEDICI\u00d3N',  rVal: fmtDate() },
      { lbl: 'DIRECCI\u00d3N', val: order.cli_direccion,    rLbl: '',                            rVal: '' },
      { lbl: 'CIUDAD',           val: '',                     rLbl: 'FECHA DE VENCIMIENTO',        rVal: fmtDate(new Date(Date.now() + 30 * 864e5)) },
      { lbl: 'TEL\u00c9FONO',  val: order.cli_telefono,     rLbl: 'NIT',                         rVal: order.cli_identificacion },
    ];

    for (const row of clientRows) {
      cell(doc, row.lbl, MG,          y, LBL_W,      RH, { fill: C.lbl, font: 'Helvetica-Bold', size: 7.5, color: C.wht });
      cell(doc, row.val, MG + LBL_W,  y, LW - LBL_W, RH, { size: 8.5 });
      if (row.rLbl) {
        cell(doc, row.rLbl, MG + LW,            y, RW / 2, RH, { fill: C.lbl, font: 'Helvetica-Bold', size: 7, color: C.wht, align: 'center', padY: 6 });
        cell(doc, row.rVal, MG + LW + RW / 2,   y, RW / 2, RH, { size: 8.5, align: 'center' });
      } else {
        strokeRect(doc, MG + LW, y, RW, RH);
      }
      y += RH;
    }

    y += 14;

    // ── Tabla de ítems ────────────────────────────────────────────────────────
    const COLS = [
      { key: 'nombre',    header: '\u00cdtem',      width: 265, align: 'left' },
      { key: 'precio',    header: 'Precio',      width: 65,  align: 'right' },
      { key: 'cantidad',  header: 'Cantidad',    width: 50,  align: 'center' },
      { key: 'descuento', header: 'Descuento',   width: 65,  align: 'center' },
      { key: 'total',     header: 'Total',       width: 70,  align: 'right' },
    ];
    const ROW_H = 19;

    // Header
    fillRect(doc, MG, y, CW, 20, C.dark);
    let cx = MG;
    for (const col of COLS) {
      doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.wht)
        .text(col.header, cx + 5, y + 6, { width: col.width - 10, align: col.align }).restore();
      cx += col.width;
    }
    strokeRect(doc, MG, y, CW, 20, C.dark);
    y += 20;

    // Filas
    const itemsByMachine = new Map();
    for (const it of items) {
      const k = String(it.uid_herramienta_orden);
      if (!itemsByMachine.has(k)) itemsByMachine.set(k, []);
      itemsByMachine.get(k).push(it);
    }

    const rows = [];
    for (const m of machines) {
      const k = String(m.uid_herramienta_orden);
      const mItems = itemsByMachine.get(k) || [];
      const mName = [m.her_nombre, m.her_marca ? '(' + m.her_marca + ')' : '', m.her_serial ? 'S/N:' + m.her_serial : ''].filter(Boolean).join(' ');
      // Fila principal: "Reparación [máquina]"
      rows.push({
        nombre:    'Reparaci\u00f3n ' + truncate(mName, 52),
        precio:    money(m.mano_obra),
        cantidad:  '1',
        descuento: '0.00%',
        total:     money(m.mano_obra),
        isMachine: true,
      });
      // Fila de descripción del trabajo (si existe)
      if (m.descripcion_trabajo) {
        rows.push({
          nombre:    '   \u21b3 ' + truncate(m.descripcion_trabajo, 72),
          precio: '', cantidad: '', descuento: '', total: '',
          isDesc: true,
        });
      }
      for (const it of mItems) {
        const lineTotal = Number(it.cantidad || 1) * Number(it.precio || 0);
        rows.push({
          nombre:    truncate(it.nombre, 75),
          precio:    money(it.precio),
          cantidad:  String(it.cantidad || 1),
          descuento: '0.00%',
          total:     money(lineTotal),
        });
      }
    }

    const MIN_ROWS = 10;
    let dataRowIdx = 0; // índice solo de filas con datos (para color alterno)
    for (let i = 0; i < Math.max(rows.length, MIN_ROWS); i++) {
      const row = rows[i] || {};
      const rh  = row.isDesc ? 14 : ROW_H;

      if (row.isMachine) {
        fillRect(doc, MG, y, CW, rh, C.lightBg);
      } else if (!row.isDesc && dataRowIdx % 2 === 1) {
        fillRect(doc, MG, y, CW, rh, C.alt);
      }
      if (!row.isMachine) dataRowIdx++;

      strokeRect(doc, MG, y, CW, rh);
      cx = MG;
      for (const col of COLS) {
        strokeRect(doc, cx, y, col.width, rh);
        const val = row[col.key];
        if (val) {
          const bold  = row.isMachine && col.key === 'nombre';
          const sz    = row.isDesc ? 7.5 : 8.5;
          const clr   = row.isDesc ? C.gry : C.blk;
          const padY  = (rh - sz) / 2;
          doc.save()
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(sz).fillColor(clr)
            .text(val, cx + 5, y + padY, { width: col.width - 10, align: col.align, lineBreak: false })
            .restore();
        }
        cx += col.width;
      }
      y += rh;
    }

    y += 8;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 6;

    // ── Totales ───────────────────────────────────────────────────────────────
    const subtotal  = machines.reduce((s, m) => s + Number(m.subtotal || 0), 0);
    const IVA_RATE  = parseFloat(process.env.IVA_RATE || '0');
    const iva       = subtotal * IVA_RATE;
    const total     = subtotal + iva;
    const TX        = MG + CW - 200;

    const totalRows = [{ bold: false, label: 'Subtotal', val: money(subtotal) }];
    if (IVA_RATE > 0) totalRows.push({ bold: false, label: 'IVA ' + (IVA_RATE * 100).toFixed(0) + '%', val: money(iva) });
    totalRows.push({ bold: true, label: 'Total', val: money(total) });

    for (const tr of totalRows) {
      fillRect(doc, TX, y, 200, 19, tr.bold ? C.dark : C.alt);
      strokeRect(doc, TX, y, 200, 19);
      doc.save().font(tr.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .fillColor(tr.bold ? C.wht : C.blk)
        .text(tr.label, TX + 6,   y + 5, { width: 110, lineBreak: false })
        .text(tr.val,   TX + 115, y + 5, { width: 79, align: 'right', lineBreak: false })
        .restore();
      y += 19;
    }

    // ── Firma ─────────────────────────────────────────────────────────────────
    const FY = A4H - 75;
    hLine(doc, MG, FY, MG + 150, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('ELABORADO POR', MG, FY + 5).restore();

    doc.end();
  });
}

// ─── INFORME DE MANTENIMIENTO PDF ─────────────────────────────────────────────
function generateMaintenancePDF({ order, machine, items, observation, proxMantenimiento }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = MG;

    // ── Header ────────────────────────────────────────────────────────────────
    // Logo rotado -90°: imagen portrait → aparece horizontal centrada al tope
    if (fs.existsSync(LOGO)) {
      const LOGO_FW = 200;                                   // ancho final en página
      const LOGO_FH = Math.round(LOGO_FW * 1396 / 2696);    // alto final ≈ 104 px
      const logoX   = (A4W - LOGO_FW) / 2;
      const cx      = logoX + LOGO_FW / 2;
      const cy      = y + LOGO_FH / 2;
      doc.save()
        .translate(cx, cy)
        .rotate(-90)
        .image(LOGO, -LOGO_FH / 2, -LOGO_FW / 2, { width: LOGO_FH, height: LOGO_FW })
        .restore();
      y += LOGO_FH + 10;
    } else {
      y += 20;
    }

    doc.save().font('Helvetica-Bold').fontSize(13).fillColor(C.gry)
      .text('INFORME DE MANTENIMIENTO', MG, y, { width: CW, align: 'center' }).restore();
    y += 18;
    hLine(doc, MG, y, MG + CW, C.bdr, 1);
    y += 10;

    // Fecha + Orden
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
      .text('Fecha Mantenimiento:', MG, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk)
      .text(fmtDate(), MG + 130, y).restore();
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk)
      .text('Orden N\u00famero:', MG + 300, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk)
      .text(String(order.ord_consecutivo || ''), MG + 380, y).restore();
    y += 18;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 6;

    // ── T\u00e9cnico ──────────────────────────────────────────────────────────
    y = sectionBar(doc, y, 'DATOS DEL T\u00c9CNICO ENCARGADO');
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Empresa:', MG + 5, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text('SU HERRAMIENTA CST', MG + 75, y).restore();
    y += 14;
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Persona Encargada:', MG + 5, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text(machine.hor_tecnico || '', MG + 120, y).restore();
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Cargo:', MG + 290, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text(machine.hor_cargo_tecnico || 'T\u00c9CNICO EN MAQUINARIA', MG + 325, y).restore();
    y += 18;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 6;

    // ── Solicitante ───────────────────────────────────────────────────────────
    y = sectionBar(doc, y, 'DATOS DEL SOLICITANTE');
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Identificaci\u00f3n:', MG + 5, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text(order.cli_identificacion || '', MG + 90, y).restore();
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Nombre:', MG + 230, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text(order.cli_razon_social || '', MG + 275, y).restore();
    y += 14;
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Direcci\u00f3n:', MG + 5, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text(truncate(order.cli_direccion || order.cli_contacto || '', 60), MG + 90, y).restore();
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk).text('Tel\u00e9fono:', MG + 230, y).restore();
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(C.blk).text(order.cli_telefono || '', MG + 275, y).restore();
    y += 18;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 6;

    // ── Pr\u00f3ximo mantenimiento ────────────────────────────────────────────
    y = sectionBar(doc, y, 'PR\u00d3XIMO MANTENIMIENTO');
    doc.save().font('Helvetica-Bold').fontSize(10).fillColor(C.blk)
      .text(proxMantenimiento || machine.hor_proximo_mantenimiento || '', MG + 10, y).restore();
    y += 20;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 6;

    // ── Descripci\u00f3n del equipo ───────────────────────────────────────────
    y = sectionBar(doc, y, 'DESCRIPCI\u00d3N DEL EQUIPO');
    const ECOLS = [
      { header: 'Equipo',      val: machine.her_nombre || '',  w: 130 },
      { header: 'Marca',       val: machine.her_marca  || '',  w: 120 },
      { header: 'Serial',      val: machine.her_serial || '',  w: 130 },
      { header: 'Referencia',  val: machine.her_referencia || machine.her_serial || '',  w: 135 },
    ];
    let ex = MG;
    for (const ec of ECOLS) {
      doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
        .text(ec.header, ex, y, { width: ec.w, align: 'center' }).restore();
      ex += ec.w;
    }
    y += 14;
    ex = MG;
    for (const ec of ECOLS) {
      doc.save().font('Helvetica-Bold').fontSize(9.5).fillColor(C.blk)
        .text(ec.val, ex, y, { width: ec.w, align: 'center' }).restore();
      ex += ec.w;
    }
    y += 18;
    hLine(doc, MG, y, MG + CW, C.bdr);
    y += 6;

    // ── Repuestos utilizados ──────────────────────────────────────────────────
    if (items && items.length > 0) {
      y = sectionBar(doc, y, 'REPUESTOS UTILIZADOS');
      for (const it of items) {
        doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
          .text('\u2022 ' + truncate(it.nombre, 55), MG + 10, y, { width: 280, lineBreak: false })
          .restore();
        doc.save().font('Helvetica').fontSize(8.5).fillColor(C.blk)
          .text('Cant: ' + (it.cantidad || 1) + '   ' + money(it.precio) + ' c/u', MG + 300, y, { width: CW - 310, align: 'right', lineBreak: false })
          .restore();
        y += 13;
      }
      y += 6;
      hLine(doc, MG, y, MG + CW, C.bdr);
      y += 6;
    }

    // ── Observaci\u00f3n (IA) ─────────────────────────────────────────────────
    y = sectionBar(doc, y, 'OBSERVACI\u00d3N');
    y += 2;
    const obsText = observation || '';
    doc.save().font('Helvetica').fontSize(9).fillColor(C.blk);
    doc.text(obsText, MG + 10, y, { width: CW - 20, align: 'justify' });
    y = doc.y + 15;

    hLine(doc, MG, y, MG + CW, C.bdr);

    // ── Firmas ────────────────────────────────────────────────────────────────
    const FY = A4H - 80;
    hLine(doc, MG, FY, MG + 160, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Firma del T\u00e9cnico', MG, FY + 5).restore();

    hLine(doc, A4W / 2 + 20, FY, A4W - MG, C.blk, 0.7);
    doc.save().font('Helvetica').fontSize(8).fillColor(C.gry)
      .text('Firma del Cliente / Recibido', A4W / 2 + 20, FY + 5).restore();

    doc.end();
  });
}

module.exports = { generateQuotePDF, generateMaintenancePDF };
