require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./utils/db');
const { waClient } = require('./utils/whatsapp-client');
const apiKey = require('./middleware/apiKey');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/generador-cotizaciones.html'));

// Protección API key (todas las rutas /api/*)
app.use('/api', apiKey);

// Rutas modulares
app.use('/api', require('./routes/orders'));
app.use('/api', require('./routes/quote'));
app.use('/api', require('./routes/whatsapp'));
app.use('/api', require('./routes/pdf'));

// Health
app.get('/health', (req, res) => {
  const { isReady } = require('./utils/whatsapp-client');
  res.json({ status: 'OK', whatsappReady: isReady(), timestamp: new Date() });
});

// Debug endpoint: solo en desarrollo
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/usuario-schema', async (req, res) => {
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
    const [cols] = await conn.execute(
      `SHOW COLUMNS FROM b2c_herramienta_orden LIKE 'her_estado'`
    );
    if (cols.length === 0) {
      await conn.execute(
        `ALTER TABLE b2c_herramienta_orden
         ADD COLUMN her_estado VARCHAR(32) NOT NULL DEFAULT 'pendiente_revision'`
      );
    }

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

    console.log('✅ Tablas de estado verificadas/creadas');
  } catch (e) {
    console.warn('⚠️ No pude crear/verificar tablas de estado:', String(e?.message || e));
  } finally {
    conn.release();
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📄 Abrir: http://localhost:${PORT}/generador-cotizaciones.html`);
  console.log('⏳ Esperando conexión de WhatsApp Web...');
  await ensureQuoteTables();
  await ensureStatusTables();
  waClient.initialize();
});
