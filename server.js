require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const session = require('express-session');

const db      = require('./utils/db');
const { initTenantClient } = require('./utils/whatsapp-client');
require('./utils/wa-handler'); // Listener de mensajes entrantes (autorización por WA)
const apiKey  = require('./middleware/apiKey');
const { requireLogin, requireInterno } = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');

// Validar SESSION_SECRET antes de arrancar
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET no configurado. Defina esta variable de entorno antes de iniciar en producción.');
  } else {
    console.warn('\x1b[33m⚠️  SEGURIDAD: SESSION_SECRET no configurado — usando valor de desarrollo. NO usar en producción.\x1b[0m');
  }
}

const app = express();

// HTTPS redirect — Escenario B: detrás de proxy inverso que termina TLS (nginx, Render, Railway…)
// Activar con BEHIND_PROXY=true en el entorno de producción.
if (process.env.BEHIND_PROXY === 'true') {
  app.set('trust proxy', 1); // confiar en X-Forwarded-* del primer proxy
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
    }
    next();
  });
}

app.use(express.json());
// CORS: solo mismo origen — bloquea peticiones cross-origin de otros dominios
app.use(cors({ origin: false }));

// Cabeceras de seguridad HTTP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:              ["'self'"],
      scriptSrc:               ["'self'", "'unsafe-inline'"],
      scriptSrcAttr:           ["'unsafe-inline'"], // páginas usan onclick/onsubmit en atributos HTML
      styleSrc:                ["'self'", "'unsafe-inline'"],
      imgSrc:                  ["'self'", "data:", "blob:"],
      connectSrc:              ["'self'"],
      fontSrc:                 ["'self'"],
      objectSrc:               ["'none'"],
      upgradeInsecureRequests: null, // manejamos el redirect HTTPS manualmente
    },
  },
}));

// Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || 'cst-dev-insecure',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge:   8 * 60 * 60 * 1000, // 8 horas
    httpOnly: true,                // JS del frontend no puede leer la cookie
    sameSite: 'lax',               // protección CSRF básica
    secure:   process.env.NODE_ENV === 'production', // solo HTTPS en prod
  },
}));

// Rutas públicas — login/logout/me
app.use('/', require('./routes/auth'));

// Archivos estáticos — protegidos excepto login.html y assets
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/seguimiento.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'seguimiento.html')));
app.get('/generador-cotizaciones.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'generador-cotizaciones.html')));
app.get('/crear-orden.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crear-orden.html')));
app.get('/dashboard.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/ordenes.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'ordenes.html')));
app.use('/uploads', requireLogin, express.static(path.join(__dirname, 'public', 'uploads')));
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.tipo === 'C') return res.redirect('/seguimiento.html');
  res.redirect('/dashboard.html');
});

// Tenant middleware — resuelve req.tenant por hostname (excluye /superadmin)
app.use((req, res, next) => {
  if (req.path.startsWith('/superadmin')) return next();
  tenantMiddleware(req, res, next);
});

// Protección API key (todas las rutas /api/*)
app.use('/api', apiKey);

// Protección de sesión en rutas /api/ — clientes solo acceden a sus endpoints
app.use('/api', requireLogin);

// Rutas modulares
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/orders'));
app.use('/api', require('./routes/quote'));
app.use('/api', require('./routes/whatsapp'));
app.use('/api', require('./routes/pdf'));
app.use('/api', require('./routes/crear-orden'));

// Health — solo usuarios internos autenticados
app.get('/health', requireInterno, (req, res) => {
  const { isReady } = require('./utils/whatsapp-client');
  res.json({ status: 'OK', whatsappReady: isReady(), timestamp: new Date() });
});

// Debug endpoint: solo en desarrollo y solo usuarios internos
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/usuario-schema', requireInterno, async (req, res) => {
    try {
      const conn = await db.getConnection();
      const { getUsuarioColumns } = require('./utils/schema');
      const usrCols = await getUsuarioColumns(conn);

      const out = { columns: usrCols.all, detected: usrCols, sampleRoles: [], sampleStatus: [] };

      if (usrCols.roleCol) {
        const [roles] = await conn.execute(
          `SELECT DISTINCT CAST(\`${usrCols.roleCol}\` AS CHAR) AS v FROM b2c_usuario WHERE \`${usrCols.roleCol}\` IS NOT NULL LIMIT 50`
        );
        out.sampleRoles = roles.map(r => r.v);
      }

      if (usrCols.statusCol) {
        const [st] = await conn.execute(
          `SELECT DISTINCT CAST(\`${usrCols.statusCol}\` AS CHAR) AS v FROM b2c_usuario WHERE \`${usrCols.statusCol}\` IS NOT NULL LIMIT 50`
        );
        out.sampleStatus = st.map(r => r.v);
      }

      conn.release();
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Crear tablas de cotización al inicio (si no existen)
async function ensureQuoteTables() {
  const conn = await db.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_cotizacion_orden (
        uid_orden VARCHAR(64) PRIMARY KEY,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        iva DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        mensaje_whatsapp TEXT NULL,
        whatsapp_enviado TINYINT(1) NOT NULL DEFAULT 0,
        whatsapp_enviado_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_cotizacion_maquina (
        uid_orden VARCHAR(64) NOT NULL,
        uid_herramienta_orden VARCHAR(64) NOT NULL,
        tecnico_id VARCHAR(64) NULL,
        mano_obra DECIMAL(14,2) NOT NULL DEFAULT 0,
        descripcion_trabajo TEXT NULL,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (uid_orden, uid_herramienta_orden)
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_cotizacion_item (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        uid_orden VARCHAR(64) NOT NULL,
        uid_herramienta_orden VARCHAR(64) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        cantidad INT NOT NULL DEFAULT 1,
        precio DECIMAL(14,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cot_item (uid_orden, uid_herramienta_orden)
      )
    `);

    console.log('✅ Tablas de cotización verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar tablas de cotización. Si tu usuario de BD no tiene permisos CREATE, créalas manualmente.');
    console.warn(String(e?.message || e));
  } finally {
    conn.release();
  }
}

async function ensureStatusTables() {
  const conn = await db.getConnection();
  try {
    // Agregar columna her_estado si no existe
    // IF NOT EXISTS es sintaxis MariaDB — en MySQL 8 usamos try/catch con ER_DUP_FIELDNAME
    try {
      await conn.execute(
        `ALTER TABLE b2c_herramienta_orden ADD COLUMN her_estado VARCHAR(32) NOT NULL DEFAULT 'pendiente_revision'`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // Agregar columna fho_tipo a fotos si no existe
    try {
      await conn.execute(
        `ALTER TABLE b2c_foto_herramienta_orden ADD COLUMN fho_tipo VARCHAR(20) NOT NULL DEFAULT 'recepcion'`
      );
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // Columnas para órdenes de garantía
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_tipo VARCHAR(20) NOT NULL DEFAULT 'normal'`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_factura VARCHAR(255) NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_garantia_vence DATE NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    try {
      await conn.execute(`ALTER TABLE b2c_orden ADD COLUMN ord_revision_limite DATE NULL`);
    } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }

    // Tabla de historial de cambios de estado
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_herramienta_status_log (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        uid_herramienta_orden VARCHAR(64) NOT NULL,
        estado      VARCHAR(32) NOT NULL,
        changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hsl (uid_herramienta_orden)
      )
    `);

    // Tabla de conversaciones de autorización por WhatsApp
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_wa_autorizacion_pendiente (
        uid_autorizacion INT AUTO_INCREMENT PRIMARY KEY,
        uid_orden        INT NOT NULL,
        wa_phone         VARCHAR(20) NOT NULL,
        estado           ENUM('esperando_opcion','esperando_maquinas') NOT NULL DEFAULT 'esperando_opcion',
        created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_wa_phone (wa_phone)
      )
    `);

    // Tabla de informes de mantenimiento persistentes
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_informe_mantenimiento (
        uid_informe           INT AUTO_INCREMENT PRIMARY KEY,
        uid_orden             INT NOT NULL,
        uid_herramienta_orden INT NOT NULL,
        inf_archivo           VARCHAR(255) NOT NULL,
        inf_fecha             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_informe_maquina (uid_herramienta_orden),
        INDEX idx_inf_orden (uid_orden)
      )
    `);

    console.log('✅ Tablas de estado verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar tablas de estado:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TENANT — Fase 1: Crear b2c_tenant + tenant por defecto
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTenantTable() {
  const conn = await db.getConnection();
  try {
    // Crear tabla b2c_tenant
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS b2c_tenant (
        uid_tenant        INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ten_nombre        VARCHAR(100) NOT NULL,
        ten_slug          VARCHAR(50)  NOT NULL,
        ten_slug_locked   TINYINT(1)   NOT NULL DEFAULT 0,
        ten_dominio_custom VARCHAR(100) NULL,
        ten_logo          VARCHAR(255) NULL,
        ten_color_primary VARCHAR(7)   NOT NULL DEFAULT '#1B2A6B',
        ten_color_accent  VARCHAR(7)   NOT NULL DEFAULT '#E31E24',
        ten_wa_number     VARCHAR(20)  NULL,
        ten_wa_parts_number VARCHAR(20) NULL,
        ten_estado        ENUM('activo','suspendido','prueba') NOT NULL DEFAULT 'prueba',
        ten_plan          VARCHAR(20)  NOT NULL DEFAULT 'mensual',
        ten_vence         DATE         NULL,
        ten_created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_slug (ten_slug),
        UNIQUE KEY uq_dominio (ten_dominio_custom)
      )
    `);

    // Insertar tenant por defecto (SU HERRAMIENTA CST) si no existe
    await conn.execute(`
      INSERT IGNORE INTO b2c_tenant
        (uid_tenant, ten_nombre, ten_slug, ten_slug_locked, ten_estado,
         ten_color_primary, ten_color_accent,
         ten_wa_number, ten_wa_parts_number)
      VALUES
        (1, 'SU HERRAMIENTA CST', 'suherramienta', 1, 'activo',
         '#1d3557', '#e63946',
         ?, ?)
    `, [
      process.env.PARTS_WHATSAPP_NUMBER || null,
      process.env.PARTS_WHATSAPP_NUMBER || null,
    ]);

    console.log('✅ Tabla b2c_tenant verificada/creada — tenant por defecto listo');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar b2c_tenant:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TENANT — Fase 1: Agregar tenant_id a todas las tablas de negocio
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTenantColumns() {
  const conn = await db.getConnection();

  // Tablas que necesitan tenant_id
  const tablas = [
    'b2c_usuario',
    'b2c_cliente',
    'b2c_orden',
    'b2c_herramienta',
    'b2c_herramienta_orden',
    'b2c_foto_herramienta_orden',
    'b2c_concepto_costos',
    'b2c_cotizacion_orden',
    'b2c_cotizacion_maquina',
    'b2c_cotizacion_item',
    'b2c_herramienta_status_log',
    'b2c_wa_autorizacion_pendiente',
    'b2c_informe_mantenimiento',
  ];

  try {
    for (const tabla of tablas) {
      // Agregar columna tenant_id con DEFAULT 1 (tenant SU HERRAMIENTA CST)
      try {
        await conn.execute(
          `ALTER TABLE \`${tabla}\` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1`
        );
        // Agregar índice para búsquedas eficientes por tenant
        try {
          await conn.execute(
            `ALTER TABLE \`${tabla}\` ADD INDEX idx_tenant (tenant_id)`
          );
        } catch (_) { /* índice ya existe */ }

        console.log(`  ✅ tenant_id agregado a ${tabla}`);
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
          // Columna ya existe — solo asegurarse de que los registros sin asignar queden en tenant 1
          await conn.execute(
            `UPDATE \`${tabla}\` SET tenant_id = 1 WHERE tenant_id = 0`
          );
        } else if (e.code === 'ER_NO_SUCH_TABLE') {
          // Tabla aún no existe (se crea más adelante en el arranque)
          console.log(`  ⏭ ${tabla} aún no existe, se migrará al crearse`);
        } else {
          throw e;
        }
      }
    }
    console.log('✅ Columnas tenant_id verificadas en todas las tablas');
  } catch (e) {
    console.warn('⚠️ Error al agregar tenant_id:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📄 Abrir: http://localhost:${PORT}/generador-cotizaciones.html`);
  console.log('⏳ Esperando conexión de WhatsApp Web...');
  await ensureTenantTable();    // Fase 1a — b2c_tenant + tenant por defecto
  await ensureQuoteTables();
  await ensureStatusTables();
  await ensureTenantColumns();  // Fase 1b — tenant_id en todas las tablas
  initTenantClient(1); // inicializa cliente WA del tenant por defecto
});
