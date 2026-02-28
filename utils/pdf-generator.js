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
          const fpath = path.join(__dirname, '..', 'public', 'uploads', 'fotos-recepcion', foto.fho_archivo);
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

module.exports = { generateQuotePDF, generateMaintenancePDF, generateOrdenServicioPDF };
