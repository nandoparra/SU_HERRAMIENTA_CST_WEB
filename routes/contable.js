'use strict';
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const db       = require('../utils/db');
const Anthropic = require('@anthropic-ai/sdk');
const { requireInterno, requireAddonContabilidad } = require('../middleware/auth');
let _iaClient = null;
function getIAClient() {
  if (!_iaClient) _iaClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _iaClient;
}
const { UPLOADS_DIR, checkMagicBytes } = require('../utils/uploads');
const { logAudit } = require('../utils/audit');
const log = require('../utils/logger');

router.use(requireInterno);
router.use(requireAddonContabilidad);

// ── Multer para facturas de egreso (imagen o PDF) ─────────────────────────────
const facturaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'facturas-egreso');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `egreso_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const uploadFactura = multer({
  storage: facturaStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    ok ? cb(null, true) : cb(new Error('Solo imágenes o PDF'));
  },
});

const CATEGORIAS = ['nomina','arriendo','servicios','compras','mantenimiento','impuestos','otros'];

// ─── GET /api/contable/egresos ────────────────────────────────────────────────
router.get('/contable/egresos', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const { mes, categoria, estado = 'activo' } = req.query;
  let where = 'WHERE e.tenant_id = ?';
  const params = [tenantId];

  if (mes) {
    where += ' AND e.egr_fecha >= ? AND e.egr_fecha <= LAST_DAY(?)';
    params.push(`${mes}-01`, `${mes}-01`);
  }
  if (categoria) { where += ' AND e.egr_categoria = ?'; params.push(categoria); }
  if (estado)    { where += ' AND e.egr_estado = ?';    params.push(estado); }

  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT e.*,
              u.usu_nombre AS creado_por_nombre
       FROM b2c_egreso e
       LEFT JOIN b2c_usuario u ON u.uid_usuario = e.egr_creado_por
       ${where}
       ORDER BY e.egr_fecha DESC, e.uid_egreso DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    log.error({ err }, 'Error listando egresos');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/contable/egresos ───────────────────────────────────────────────
router.post('/contable/egresos', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const userId   = req.session?.user?.id ?? null;
  const {
    egr_fecha, egr_concepto, egr_categoria = 'otros', egr_valor,
    egr_proveedor, egr_nit_proveedor, egr_metodo_pago = 'efectivo',
    egr_referencia, egr_notas, egr_factura_imagen, egr_ia_extraido = 0,
    egr_forma_pago = 'contado', egr_fecha_vencimiento,
  } = req.body;

  if (!egr_fecha)    return res.status(400).json({ error: 'egr_fecha es requerido' });
  if (!egr_concepto) return res.status(400).json({ error: 'egr_concepto es requerido' });
  if (!egr_valor || isNaN(Number(egr_valor)) || Number(egr_valor) <= 0)
    return res.status(400).json({ error: 'egr_valor debe ser mayor a 0' });
  if (!CATEGORIAS.includes(egr_categoria))
    return res.status(400).json({ error: `egr_categoria inválida. Opciones: ${CATEGORIAS.join(', ')}` });
  if (egr_forma_pago === 'credito' && !egr_fecha_vencimiento)
    return res.status(400).json({ error: 'egr_fecha_vencimiento es requerido para pagos a crédito' });

  // Crédito → pendiente de pago; contado → ya está pagado
  const estadoPago = egr_forma_pago === 'credito' ? 'pendiente' : 'pagado';

  const conn = await db.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO b2c_egreso
         (tenant_id, egr_fecha, egr_concepto, egr_categoria, egr_valor,
          egr_proveedor, egr_nit_proveedor, egr_metodo_pago,
          egr_referencia, egr_notas, egr_factura_imagen, egr_ia_extraido,
          egr_forma_pago, egr_fecha_vencimiento, egr_estado_pago, egr_creado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tenantId, egr_fecha, egr_concepto, egr_categoria, Number(egr_valor),
        egr_proveedor || null, egr_nit_proveedor || null, egr_metodo_pago,
        egr_referencia || null, egr_notas || null,
        egr_factura_imagen || null, egr_ia_extraido ? 1 : 0,
        egr_forma_pago, egr_fecha_vencimiento || null, estadoPago, userId,
      ]
    );
    await logAudit(req, 'egreso_creado', 'b2c_egreso', String(result.insertId), {
      egr_concepto, egr_valor: Number(egr_valor), egr_categoria,
    });
    res.status(201).json({ uid_egreso: result.insertId });
  } catch (err) {
    log.error({ err }, 'Error creando egreso');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── PATCH /api/contable/egresos/:id ─────────────────────────────────────────
router.patch('/contable/egresos/:id', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const { id } = req.params;
  const allowed = [
    'egr_fecha','egr_concepto','egr_categoria','egr_valor',
    'egr_proveedor','egr_nit_proveedor','egr_metodo_pago',
    'egr_referencia','egr_notas',
    'egr_forma_pago','egr_fecha_vencimiento',
  ];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

  const conn = await db.getConnection();
  try {
    const [[egr]] = await conn.execute(
      `SELECT uid_egreso, egr_estado FROM b2c_egreso WHERE uid_egreso = ? AND tenant_id = ?`,
      [id, tenantId]
    );
    if (!egr) return res.status(404).json({ error: 'Egreso no encontrado' });
    if (egr.egr_estado === 'anulado') return res.status(409).json({ error: 'No se puede editar un egreso anulado' });

    const set    = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f] ?? null);
    await conn.execute(
      `UPDATE b2c_egreso SET ${set} WHERE uid_egreso = ? AND tenant_id = ?`,
      [...values, id, tenantId]
    );
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'Error editando egreso');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── PATCH /api/contable/egresos/:id/anular ──────────────────────────────────
router.patch('/contable/egresos/:id/anular', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [[egr]] = await conn.execute(
      `SELECT uid_egreso, egr_estado FROM b2c_egreso WHERE uid_egreso = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!egr) return res.status(404).json({ error: 'Egreso no encontrado' });
    if (egr.egr_estado === 'anulado') return res.status(409).json({ error: 'Ya está anulado' });
    await conn.execute(
      `UPDATE b2c_egreso SET egr_estado = 'anulado' WHERE uid_egreso = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    await logAudit(req, 'egreso_anulado', 'b2c_egreso', String(req.params.id), {});
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'Error anulando egreso');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/contable/egresos/extraer-factura ───────────────────────────────
// Recibe imagen o PDF, llama a Claude Vision y devuelve los campos extraídos.
// El usuario revisa y confirma antes de guardar (POST /contable/egresos separado).
router.post('/contable/egresos/extraer-factura', uploadFactura.single('factura'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Se requiere el archivo de factura' });

  const filePath = req.file.path;
  const mime     = req.file.mimetype;

  try {
    await checkMagicBytes(filePath, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
  } catch {
    return res.status(422).json({ error: 'Archivo inválido o corrupto' });
  }

  try {
    const fileData  = fs.readFileSync(filePath);
    const b64       = fileData.toString('base64');

    // Para PDF enviamos como documento; para imágenes como image
    const isPdf     = mime === 'application/pdf';
    const mediaType = isPdf ? 'application/pdf' : mime;
    const sourceType = isPdf ? 'base64' : 'base64';

    const contentBlocks = [
      isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: b64 } },
      {
        type: 'text',
        text: `Analiza esta factura o comprobante de pago y extrae los siguientes datos en formato JSON estricto, sin texto adicional:
{
  "proveedor": "<nombre del proveedor o empresa>",
  "nit_proveedor": "<NIT o cédula del proveedor, sin puntos ni guiones, o null>",
  "fecha": "<fecha de emisión de la factura en formato YYYY-MM-DD, o null>",
  "fecha_vencimiento": "<fecha límite de pago en formato YYYY-MM-DD, o null si no aparece>",
  "forma_pago": "<'contado' si es de contado o efectivo inmediato, 'credito' si tiene plazo o fecha de vencimiento>",
  "valor_total": <número sin puntos ni comas, solo dígitos y punto decimal, o null>,
  "categoria_sugerida": "<una de: nomina, arriendo, servicios, compras, mantenimiento, impuestos, otros>",
  "concepto": "<descripción breve del concepto o servicio>",
  "referencia": "<número de factura o referencia, o null>"
}
Si no puedes extraer un campo con certeza, usa null. Responde únicamente con el JSON, sin explicaciones.`,
      },
    ];

    const response = await getIAClient().beta.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const raw  = response.content[0]?.text?.trim() || '{}';
    const json = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    let extraido;
    try { extraido = JSON.parse(json); } catch { extraido = {}; }

    res.json({
      ok: true,
      factura_imagen: path.basename(filePath),
      extraido: {
        proveedor:          extraido.proveedor          || null,
        nit_proveedor:      extraido.nit_proveedor      || null,
        fecha:              extraido.fecha              || null,
        fecha_vencimiento:  extraido.fecha_vencimiento  || null,
        forma_pago:         extraido.forma_pago === 'credito' ? 'credito' : 'contado',
        valor_total:        extraido.valor_total        != null ? Number(extraido.valor_total) : null,
        categoria_sugerida: extraido.categoria_sugerida || 'otros',
        concepto:           extraido.concepto           || null,
        referencia:         extraido.referencia         || null,
      },
    });
  } catch (err) {
    // Borrar archivo si hubo error en la llamada IA para no dejar huérfanos
    try { fs.unlinkSync(filePath); } catch {}
    log.error({ err }, 'Error extrayendo factura con IA');
    res.status(500).json({ error: 'Error al procesar la factura con IA' });
  }
});

// ─── PATCH /api/contable/egresos/:id/pagar ───────────────────────────────────
router.patch('/contable/egresos/:id/pagar', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [[egr]] = await conn.execute(
      `SELECT uid_egreso, egr_estado, egr_estado_pago FROM b2c_egreso WHERE uid_egreso = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!egr)                           return res.status(404).json({ error: 'Egreso no encontrado' });
    if (egr.egr_estado === 'anulado')   return res.status(409).json({ error: 'El egreso está anulado' });
    if (egr.egr_estado_pago === 'pagado') return res.status(409).json({ error: 'Ya está marcado como pagado' });
    await conn.execute(
      `UPDATE b2c_egreso SET egr_estado_pago = 'pagado' WHERE uid_egreso = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    await logAudit(req, 'egreso_pagado', 'b2c_egreso', String(req.params.id), {});
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'Error marcando egreso como pagado');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/contable/vencimientos ──────────────────────────────────────────
// Egresos a crédito pendientes de pago, ordenados por fecha de vencimiento.
router.get('/contable/vencimientos', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT uid_egreso, egr_fecha, egr_concepto, egr_categoria,
              egr_valor, egr_proveedor, egr_fecha_vencimiento, egr_referencia
       FROM b2c_egreso
       WHERE tenant_id = ? AND egr_estado = 'activo' AND egr_estado_pago = 'pendiente'
         AND egr_fecha_vencimiento IS NOT NULL
       ORDER BY egr_fecha_vencimiento ASC`,
      [tenantId]
    );
    res.json(rows);
  } catch (err) {
    log.error({ err }, 'Error listando vencimientos');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/contable/resumen ────────────────────────────────────────────────
// Estado de resultados del mes: ingresos, costos, egresos, utilidad neta.
router.get('/contable/resumen', async (req, res) => {
  const tenantId = req.tenant?.uid_tenant ?? 1;
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const fechaInicio = `${mes}-01`;

  const conn = await db.getConnection();
  try {
    // Ingresos: ventas pagadas del mes
    const [[ventasRow]] = await conn.execute(
      `SELECT COALESCE(SUM(ven_total), 0)              AS ingresos_ventas,
              COALESCE(SUM(ven_costo_repuestos), 0)    AS costo_repuestos,
              COALESCE(SUM(ven_utilidad_total), 0)     AS utilidad_bruta,
              COUNT(*)                                  AS num_ventas
       FROM b2c_venta
       WHERE tenant_id = ? AND ven_fecha >= ? AND ven_fecha <= LAST_DAY(?) AND ven_estado = 'pagada'`,
      [tenantId, fechaInicio, fechaInicio]
    );

    // Ingresos: recibos activos del mes
    const [[recibosRow]] = await conn.execute(
      `SELECT COALESCE(SUM(rc_valor), 0) AS ingresos_recibos, COUNT(*) AS num_recibos
       FROM b2c_recibo_caja
       WHERE tenant_id = ? AND rc_fecha >= ? AND rc_fecha <= LAST_DAY(?) AND rc_estado = 'activo'`,
      [tenantId, fechaInicio, fechaInicio]
    );

    // Compras de inventario del mes (egreso implícito)
    const [[comprasRow]] = await conn.execute(
      `SELECT COALESCE(SUM(ir_unidades * ir_costo_unitario), 0) AS total_compras
       FROM b2c_inventario_recepciones
       WHERE tenant_id = ? AND ir_fecha >= ? AND ir_fecha <= LAST_DAY(?)`,
      [tenantId, fechaInicio, fechaInicio]
    );

    // Egresos registrados del mes (activos), agrupados por categoría
    const [egresosCat] = await conn.execute(
      `SELECT egr_categoria, COALESCE(SUM(egr_valor), 0) AS total
       FROM b2c_egreso
       WHERE tenant_id = ? AND egr_fecha >= ? AND egr_fecha <= LAST_DAY(?) AND egr_estado = 'activo'
       GROUP BY egr_categoria`,
      [tenantId, fechaInicio, fechaInicio]
    );

    const totalEgresos = egresosCat.reduce((s, r) => s + Number(r.total), 0);
    const totalCompras = Number(comprasRow.total_compras);
    const ingresosVentas  = Number(ventasRow.ingresos_ventas);
    const ingresosRecibos = Number(recibosRow.ingresos_recibos);
    const totalIngresos   = ingresosVentas + ingresosRecibos;
    const costoVentas     = Number(ventasRow.costo_repuestos);
    const margenBruto     = totalIngresos - costoVentas;
    const utilidadNeta    = margenBruto - totalEgresos - totalCompras;

    res.json({
      mes,
      ingresos: {
        ventas:   Math.round(ingresosVentas  * 100) / 100,
        recibos:  Math.round(ingresosRecibos * 100) / 100,
        total:    Math.round(totalIngresos   * 100) / 100,
        num_ventas:   Number(ventasRow.num_ventas),
        num_recibos:  Number(recibosRow.num_recibos),
      },
      costo_ventas:   Math.round(costoVentas   * 100) / 100,
      margen_bruto:   Math.round(margenBruto   * 100) / 100,
      egresos: {
        compras_inventario: Math.round(totalCompras  * 100) / 100,
        operativos:         Math.round(totalEgresos  * 100) / 100,
        total:              Math.round((totalEgresos + totalCompras) * 100) / 100,
        por_categoria:      egresosCat.map(r => ({ categoria: r.egr_categoria, total: Math.round(Number(r.total) * 100) / 100 })),
      },
      utilidad_neta: Math.round(utilidadNeta * 100) / 100,
    });
  } catch (err) {
    log.error({ err }, 'Error calculando resumen contable');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

module.exports = router;
