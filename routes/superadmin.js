'use strict';
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcrypt');
const rateLimit  = require('express-rate-limit');
const db         = require('../utils/db');
const { calcularCostoEstimadoUSD } = require('../utils/ia-uso');
const { requireSuperadmin } = require('../middleware/requireSuperadmin');
const { invalidateTenantCache } = require('../middleware/tenant');
const { initTenantClient, resetTenantClient, sendWAMessage, getLastQR } = require('../utils/whatsapp-client');
const qrcode = require('qrcode');
const { parseColombianPhones }           = require('../utils/phones');
const { logAudit } = require('../utils/audit');
const log = require('../utils/logger');

// Máx 5 intentos de login cada 15 minutos por IP
const superadminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Espere 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Almacenamiento de logos de tenant ─────────────────────────────────────────
const LOGOS_DIR = path.join(__dirname, '..', 'public', 'assets', 'tenant-logos');
fs.mkdirSync(LOGOS_DIR, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, LOGOS_DIR),
  filename: (req, _file, cb) => cb(null, `tenant-${req.params.id}.png`),
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
}).single('logo');

// ── Auth superadmin ────────────────────────────────────────────────────────────

router.post('/login', superadminLoginLimiter, (req, res) => {
  const secret = process.env.SUPERADMIN_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'SUPERADMIN_SECRET no configurado' });
  }
  const { password } = req.body;
  if (!password || password !== secret) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  req.session.superadmin = true;
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session.superadmin) return res.status(401).json({ error: 'No autenticado' });
  res.json({ superadmin: true });
});

// ── Tenants CRUD ──────────────────────────────────────────────────────────────

router.get('/tenants', requireSuperadmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT uid_tenant, ten_nombre, ten_slug, ten_slug_locked,
              ten_dominio_custom, ten_logo, ten_color_primary, ten_color_accent,
              ten_wa_number, ten_wa_parts_number, ten_estado, ten_plan,
              ten_vence, ten_created_at,
              addon_contabilidad,
              ten_agente_wa, ten_agente_wa_hora_inicio, ten_agente_wa_hora_fin,
              ten_aviso_emergencia, ten_aviso_clave,
              ten_nit, ten_direccion, ten_telefono_empresa, ten_email, ten_website
       FROM b2c_tenant
       ORDER BY uid_tenant`
    );
    res.json(rows);
  } finally {
    conn.release();
  }
});

router.post('/tenants', requireSuperadmin, async (req, res) => {
  const {
    ten_nombre, ten_slug, ten_dominio_custom,
    ten_color_primary, ten_color_accent,
    ten_wa_number, ten_wa_parts_number,
    ten_estado, ten_plan, ten_vence,
  } = req.body;

  if (!ten_nombre || !ten_slug) {
    return res.status(400).json({ error: 'ten_nombre y ten_slug son obligatorios' });
  }
  const conn = await db.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO b2c_tenant
         (ten_nombre, ten_slug, ten_dominio_custom,
          ten_color_primary, ten_color_accent,
          ten_wa_number, ten_wa_parts_number,
          ten_estado, ten_plan, ten_vence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ten_nombre,
        ten_slug,
        ten_dominio_custom  || null,
        ten_color_primary   || '#1d3557',
        ten_color_accent    || '#e63946',
        ten_wa_number       || null,
        ten_wa_parts_number || null,
        ten_estado          || 'prueba',
        ten_plan            || 'mensual',
        ten_vence           || null,
      ]
    );
    await logAudit(db, { tenantId: null, userId: null, accion: 'tenant_creado', entidad: 'superadmin', uidEntidad: result.insertId, datosDespues: { ten_nombre, ten_slug }, ip: req.ip });
    res.status(201).json({ success: true, uid_tenant: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug o dominio ya existe' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

router.patch('/tenants/:id', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const allowed = [
    'ten_nombre', 'ten_slug', 'ten_dominio_custom',
    'ten_color_primary', 'ten_color_accent',
    'ten_wa_number', 'ten_wa_parts_number',
    'ten_estado', 'ten_plan', 'ten_vence',
    'addon_contabilidad',
    'ten_agente_wa', 'ten_agente_wa_hora_inicio', 'ten_agente_wa_hora_fin',
    'ten_aviso_emergencia', 'ten_aviso_clave',
    'ten_nit', 'ten_direccion', 'ten_telefono_empresa', 'ten_email', 'ten_website',
  ];

  const conn = await db.getConnection();
  try {
    // No permitir cambiar slug si está bloqueado (tenant 1 tiene slug bloqueado)
    if ('ten_slug' in req.body) {
      const [[row]] = await conn.execute(
        `SELECT ten_slug_locked FROM b2c_tenant WHERE uid_tenant = ?`, [id]
      );
      if (!row) { conn.release(); return res.status(404).json({ error: 'Tenant no encontrado' }); }
      if (row.ten_slug_locked) {
        delete req.body.ten_slug;
      }
    }

    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

    const set    = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f] ?? null);

    await conn.execute(
      `UPDATE b2c_tenant SET ${set} WHERE uid_tenant = ?`,
      [...values, id]
    );
    await logAudit(db, { tenantId: null, userId: null, accion: 'tenant_editado', entidad: 'superadmin', uidEntidad: id, datosDespues: Object.fromEntries(fields.map((f, i) => [f, values[i]])), ip: req.ip });

    // Invalida caché de tenant para que se recargue
    // (invalidamos por slug y dominio si los conocemos)
    invalidateTenantCache(req.body.ten_slug    || '');
    invalidateTenantCache(req.body.ten_dominio_custom || '');

    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug o dominio ya existe' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

// ── Logo upload ───────────────────────────────────────────────────────────────

router.post('/tenants/:id/logo', requireSuperadmin, (req, res, next) => {
  uploadLogo(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const id  = Number(req.params.id);
    const filename = req.file.filename;
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `UPDATE b2c_tenant SET ten_logo = ? WHERE uid_tenant = ?`,
        [filename, id]
      );
      invalidateTenantCache('');
      res.json({ success: true, logo: `/assets/tenant-logos/${filename}` });
    } catch (e) {
      next(e);
    } finally {
      conn.release();
    }
  });
});

// ── Usuarios por tenant ───────────────────────────────────────────────────────

router.get('/tenants/:id/usuarios', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT uid_usuario, usu_nombre, usu_login, usu_tipo, usu_estado
       FROM b2c_usuario WHERE tenant_id = ? ORDER BY uid_usuario`,
      [id]
    );
    res.json(rows);
  } finally {
    conn.release();
  }
});

router.post('/tenants/:id/usuarios', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const { usu_nombre, usu_login, usu_clave, usu_tipo } = req.body;

  if (!usu_nombre || !usu_login || !usu_clave) {
    return res.status(400).json({ error: 'nombre, login y clave son obligatorios' });
  }
  if (!['A', 'F', 'T'].includes(usu_tipo)) {
    return res.status(400).json({ error: 'Tipo inválido — usar A, F o T' });
  }

  const hash = await bcrypt.hash(usu_clave, 10);
  const conn = await db.getConnection();
  try {
    const [result] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id)
       VALUES (?, ?, ?, ?, 'A', ?)`,
      [usu_nombre, usu_login, hash, usu_tipo, id]
    );
    await logAudit(db, { tenantId: id, userId: null, accion: 'usuario_creado_superadmin', entidad: 'superadmin', uidEntidad: result.insertId, datosDespues: { usu_login, usu_tipo, tenant_id: id }, ip: req.ip });
    res.status(201).json({ success: true, uid_usuario: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese login ya existe' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

router.patch('/usuarios/:uid', requireSuperadmin, async (req, res) => {
  const uid = Number(req.params.uid);
  const allowed = ['usu_nombre', 'usu_tipo', 'usu_estado'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Sin campos a actualizar' });

  const conn = await db.getConnection();
  try {
    const set    = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f]);
    await conn.execute(
      `UPDATE b2c_usuario SET ${set} WHERE uid_usuario = ?`,
      [...values, uid]
    );
    res.json({ success: true });
  } finally {
    conn.release();
  }
});

// ── Consumo IA — desglose por tenant + función + modelo ──────────────────────

router.get('/ia/uso', requireSuperadmin, async (req, res) => {
  const fechaDesde = req.query.fecha_desde || null;
  const fechaHasta = req.query.fecha_hasta || null;
  const conn = await db.getConnection();
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (fechaDesde) { where += ' AND l.created_at >= ?'; params.push(fechaDesde + ' 00:00:00'); }
    if (fechaHasta) { where += ' AND l.created_at <  ?'; params.push(fechaHasta + ' 23:59:59'); }

    const [rows] = await conn.execute(
      `SELECT l.tenant_id,
              COALESCE(t.ten_nombre, CONCAT('Tenant #', l.tenant_id)) AS ten_nombre,
              l.funcion,
              l.modelo,
              COUNT(*)             AS llamadas,
              SUM(l.input_tokens)  AS total_input,
              SUM(l.output_tokens) AS total_output
       FROM b2c_ia_uso_log l
       LEFT JOIN b2c_tenant t ON t.uid_tenant = l.tenant_id
       ${where}
       GROUP BY l.tenant_id, t.ten_nombre, l.funcion, l.modelo
       ORDER BY l.tenant_id, l.funcion, l.modelo`,
      params
    );

    const resultado = rows.map(r => ({
      tenant_id:   Number(r.tenant_id),
      ten_nombre:  r.ten_nombre,
      funcion:     r.funcion,
      modelo:      r.modelo,
      llamadas:    Number(r.llamadas),
      total_input: Number(r.total_input),
      total_output: Number(r.total_output),
      costo_usd:   Number(calcularCostoEstimadoUSD(r.modelo, Number(r.total_input), Number(r.total_output)).toFixed(6)),
    }));

    res.json(resultado);
  } catch (e) {
    log.error({ err: e }, 'Error superadmin ia/uso');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// ── Inicializar WhatsApp del tenant ───────────────────────────────────────────

router.post('/tenants/:id/init-wa', requireSuperadmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    // resetTenantClient destruye el cliente viejo (aunque esté en pool), borra los
    // archivos de sesión del disco, y crea uno nuevo que emitirá QR fresco.
    resetTenantClient(id);
    res.json({ success: true, message: `Cliente WA del tenant ${id} inicializado. El QR aparecerá en el browser en segundos.` });
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/tenants/:id/wa-qr', requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const qrString = getLastQR(id);
  if (!qrString) return res.status(404).json({ qr: null });
  try {
    const dataURL = await qrcode.toDataURL(qrString, { margin: 2, width: 280 });
    res.json({ qr: dataURL });
  } catch (e) {
    log.error({ err: e }, 'Error generando QR WA');
    res.status(500).json({ error: 'Error generando QR' });
  }
});

// ── TEMPORAL — eliminar después del 10-ago-2026 ───────────────────────────────
// Broadcast de emergencia terremoto 10-ago. No tiene audit log formal ni tabla
// de BD — los logs del servidor (Railway) son el registro persistente del envío.
// Versión completa (filtros, imágenes, audit log, rol) está en el backlog.

// nombre puede ser '' cuando el cliente solo tiene su cédula registrada.
const MSG_TERREMOTO_A = (nombre) => {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  return (
    `${saludo} te escribimos desde SU HERRAMIENTA CST.\n\n` +
    `Como sabes, el terremoto del 10 de agosto afectó nuestro taller. Queremos que estés tranquilo: tu equipo está a salvo, no sufrió ningún daño.\n\n` +
    `Ya estamos retomando operaciones y pronto vamos a estar funcionando con normalidad. Te avisaremos apenas tengamos fecha exacta de reapertura.\n\n` +
    `Gracias por tu paciencia. Cualquier duda, puedes responder este mensaje.`
  );
};

const MSG_TERREMOTO_B = (nombre) => {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  return (
    `${saludo} te escribimos desde SU HERRAMIENTA CST.\n\n` +
    `Como sabes, el terremoto del 10 de agosto afectó nuestro taller. Queremos contarte que ya estamos retomando operaciones y pronto vamos a estar funcionando con normalidad, para seguir atendiéndote como siempre.\n\n` +
    `Gracias por confiar en nosotros. Cualquier duda o servicio que necesites, escríbenos.`
  );
};

async function _queryDestinatariosTerremoto(conn) {
  const [rows] = await conn.execute(`
    SELECT
      c.uid_cliente,
      COALESCE(NULLIF(TRIM(c.cli_razon_social),''), NULLIF(TRIM(c.cli_contacto),''), '') AS nombre,
      c.cli_telefono,
      CASE
        WHEN MAX(CASE WHEN ho.her_estado != 'entregada' THEN 1 ELSE 0 END) = 1 THEN 'A'
        ELSE 'B'
      END AS grupo
    FROM b2c_orden o
    JOIN b2c_cliente          c  ON c.uid_cliente = o.uid_cliente
    JOIN b2c_herramienta_orden ho ON ho.uid_orden  = o.uid_orden
    WHERE o.ord_fecha LIKE '2026%'
      AND o.tenant_id = 1
    GROUP BY c.uid_cliente, c.cli_razon_social, c.cli_contacto, c.cli_telefono
    ORDER BY grupo, nombre
  `);

  // Verificación de encoding — se computa DESPUÉS de armar la lista de destinatarios,
  // así el alcance es exactamente los 555 de este broadcast, no toda la tabla.

  // Deduplicación por teléfono: un número recibe un solo mensaje; Grupo A tiene prioridad
  const porChatId  = new Map(); // chatId → candidato
  const sinTelefono = [];

  for (const row of rows) {
    const chatIds = parseColombianPhones(row.cli_telefono);
    if (chatIds.length === 0) {
      sinTelefono.push({ nombre: row.nombre || '(sin nombre)', telefono_raw: row.cli_telefono || '(vacío)' });
      continue;
    }

    // Si el campo nombre es solo dígitos (cédula guardada como nombre)
    // o contiene Ã (Ñ con encoding roto) → saludo genérico sin nombre
    const nombreDisplay = (/^\d+$/.test(row.nombre) || row.nombre.includes('Ã')) ? '' : row.nombre;
    const chatId  = chatIds[0];
    const phone   = chatId.replace('@c.us', '');
    const mensaje = row.grupo === 'A' ? MSG_TERREMOTO_A(nombreDisplay) : MSG_TERREMOTO_B(nombreDisplay);
    const candidato = { uid_cliente: row.uid_cliente, nombre: row.nombre, nombreDisplay, phone, chatId, grupo: row.grupo, mensaje };

    const existing = porChatId.get(chatId);
    if (!existing) {
      porChatId.set(chatId, candidato);
    } else if (existing.grupo === 'B' && row.grupo === 'A') {
      porChatId.set(chatId, candidato); // Grupo A desplaza a Grupo B
    }
    // mismo grupo o existing ya es A → conservar el primero
  }

  const destinatarios = Array.from(porChatId.values());

  // Encoding check sobre los destinatarios de ESTE broadcast (no toda la tabla).
  // con_encoding_en_bd: cuántos tienen Ã en la BD (dato informativo).
  // con_encoding_en_mensaje: cuántos de esos llegaron al mensaje (debe ser 0 tras el fallback).
  const rawAfectados = destinatarios.filter(d => d.nombre.includes('Ã'));
  const enMensaje    = destinatarios.filter(d => d.nombreDisplay.includes('Ã'));
  const encodingCheck = {
    total_destinatarios:      destinatarios.length,
    con_encoding_en_bd:       rawAfectados.length,
    con_encoding_en_mensaje:  enMensaje.length,
    fallback_aplicado:        rawAfectados.map(d => ({ nombre_bd: d.nombre, phone: d.phone, grupo: d.grupo, mensaje_preview: d.mensaje.slice(0, 60) })),
  };

  return { destinatarios, sinTelefono, encodingCheck };
}

// GET /superadmin/api/broadcast-terremoto — dry-run, solo lectura
router.get('/broadcast-terremoto', requireSuperadmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { destinatarios, sinTelefono, encodingCheck } = await _queryDestinatariosTerremoto(conn);
    const grupoA = destinatarios.filter(d => d.grupo === 'A').length;
    const grupoB = destinatarios.filter(d => d.grupo === 'B').length;
    res.json({
      resumen: {
        total_destinatarios:   destinatarios.length,
        grupo_a_en_taller:     grupoA,
        grupo_b_ya_entregados: grupoB,
        sin_telefono_valido:   sinTelefono.length,
      },
      encoding_check: encodingCheck,
      advertencia_encoding: encodingCheck.con_encoding_en_mensaje > 0
        ? `⚠️ ${encodingCheck.con_encoding_en_mensaje} nombre(s) con encoding roto llegarán en el mensaje — revisar`
        : `✅ Mensajes OK — ${encodingCheck.con_encoding_en_bd > 0 ? `${encodingCheck.con_encoding_en_bd} nombres con Ã en BD usan saludo genérico (ver fallback_aplicado)` : 'no se detectaron caracteres Ã'}`,
      sin_telefono_valido: sinTelefono,
      destinatarios,
    });
  } catch (e) {
    log.error({ err: e }, '[broadcast-terremoto] Error en dry-run');
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    conn.release();
  }
});

// POST /superadmin/api/broadcast-terremoto — envío real con SSE streaming
// Body requerido: { confirm: "CONFIRMAR" }
// Registro completo queda en logs del servidor (Railway) vía log.info / log.warn.
router.post('/broadcast-terremoto', requireSuperadmin, async (req, res) => {
  if (req.body?.confirm !== 'CONFIRMAR') {
    return res.status(400).json({ error: 'Body debe incluir { confirm: "CONFIRMAR" }' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sse = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {} };

  // Detectar desconexión del cliente (cierre de pestaña, red caída, etc.)
  // aborted=true detiene el loop en el próximo tick; wakeupPausa interrumpe el setTimeout activo.
  let aborted = false;
  let wakeupPausa = null;
  req.on('close', () => {
    aborted = true;
    if (wakeupPausa) wakeupPausa();
    log.warn('[broadcast-terremoto] ⚠️ Cliente desconectado — loop abortado');
  });

  const conn = await db.getConnection();
  try {
    const { destinatarios, sinTelefono } = await _queryDestinatariosTerremoto(conn);
    const total = destinatarios.length;

    log.info({ total, sin_telefono: sinTelefono.length },
      '[broadcast-terremoto] ▶ Iniciando envío masivo — emergencia terremoto 10-ago-2026');
    sse({ status: 'start', total, sin_telefono: sinTelefono.length });

    let enviados = 0;
    let fallidos = 0;
    const fallidos_lista = [];

    for (let i = 0; i < destinatarios.length; i++) {
      if (aborted) break; // cliente desconectado — detener inmediatamente

      const d = destinatarios[i];
      try {
        await sendWAMessage(1, d.chatId, d.mensaje);
        enviados++;
        log.info({ pos: i + 1, total, nombre: d.nombre, phone: d.phone, grupo: d.grupo },
          '[broadcast-terremoto] ✅ Enviado');
        sse({ i: i + 1, n: total, nombre: d.nombre, phone: d.phone, grupo: d.grupo, status: 'ok' });
      } catch (e) {
        fallidos++;
        const motivo = e.message || 'Error desconocido';
        fallidos_lista.push({ nombre: d.nombre, phone: d.phone, grupo: d.grupo, motivo });
        log.warn({ pos: i + 1, total, nombre: d.nombre, phone: d.phone, motivo },
          '[broadcast-terremoto] ❌ Fallo');
        sse({ i: i + 1, n: total, nombre: d.nombre, phone: d.phone, grupo: d.grupo, status: 'error', motivo });
      }

      // Pausa interruptible: si el cliente se desconecta, clearTimeout cancela la espera
      if (!aborted && i < destinatarios.length - 1) {
        await new Promise(resolve => {
          const t = setTimeout(resolve, 4000);
          wakeupPausa = () => { clearTimeout(t); resolve(); };
        });
        wakeupPausa = null;
      }
    }

    const resumen = { enviados, fallidos, sin_telefono: sinTelefono.length, fallidos_lista, abortado: aborted };
    if (aborted) {
      log.warn({ ...resumen, enviados, fallidos }, '[broadcast-terremoto] ⚠️ Broadcast abortado por desconexión del cliente');
    } else {
      log.info(resumen, '[broadcast-terremoto] ✅ Broadcast completado');
    }
    sse({ done: true, ...resumen });
    res.end();
  } catch (e) {
    log.error({ err: e }, '[broadcast-terremoto] Error fatal durante envío');
    sse({ error: true, motivo: e.message || 'Error interno' });
    res.end();
  } finally {
    conn.release();
  }
});

// ── FIN TEMPORAL ──────────────────────────────────────────────────────────────

module.exports = router;
