require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const session = require('express-session');

const db      = require('./utils/db');
const MySQLSessionStore = require('./utils/session-store');
const { runMigrations } = require('./utils/migrations');
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

// Sesiones — store MySQL propio (sobrevive reinicios, sin memory leak)
app.use(session({
  store: new MySQLSessionStore(db),
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

// Archivos estáticos públicos (sin tenant — se sirven en cualquier hostname)
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// Superadmin routes — antes del tenant middleware (no requieren tenant)
app.use('/superadmin/api', require('./routes/superadmin'));
app.get('/superadmin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin', 'index.html')));

// Tenant middleware — resuelve req.tenant ANTES de auth y rutas protegidas.
// IMPORTANTE: debe correr antes de POST /login para que el login filtre usuarios
// por tenant (WHERE usu_login = ? AND tenant_id = req.tenant.uid_tenant).
app.use((req, res, next) => {
  if (req.path.startsWith('/superadmin')) return next();
  tenantMiddleware(req, res, next);
});

// Rutas públicas — login/logout/me (ya tienen req.tenant disponible)
app.use('/', require('./routes/auth'));

// Archivos HTML protegidos
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/seguimiento.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'seguimiento.html')));
app.get('/generador-cotizaciones.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'generador-cotizaciones.html')));
app.get('/crear-orden.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crear-orden.html')));
app.get('/dashboard.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/ordenes.html', requireInterno, (req, res) => res.sendFile(path.join(__dirname, 'public', 'ordenes.html')));
app.use('/uploads', requireLogin, express.static(require('./utils/uploads').UPLOADS_DIR));
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.tipo === 'C') return res.redirect('/seguimiento.html');
  res.redirect('/dashboard.html');
});

// Protección API key (todas las rutas /api/*)
app.use('/api', apiKey);

// Rutas /api públicas (sin auth) — config de branding por tenant
app.use('/api', require('./routes/tenant'));

// Protección de sesión en rutas /api/ — clientes solo acceden a sus endpoints
app.use('/api', requireLogin);

// Rutas modulares
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/orders-notificaciones'));
app.use('/api', require('./routes/orders-fotos'));
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📄 Abrir: http://localhost:${PORT}/generador-cotizaciones.html`);
  console.log('⏳ Esperando conexión de WhatsApp Web...');
  await runMigrations();
  initTenantClient(1); // inicializa cliente WA del tenant por defecto
});
