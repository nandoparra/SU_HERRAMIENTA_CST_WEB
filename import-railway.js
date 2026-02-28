/**
 * import-railway.js — Importa el dump de GoDaddy directamente a Railway MySQL
 * Usa mysql2 (Node.js) en vez de mysql.exe — compatible con MySQL 8 / caching_sha2_password
 *
 * Uso:
 *   node import-railway.js <host> <port>
 *
 * Ejemplo:
 *   node import-railway.js switchback.proxy.rlwy.net 23534
 */

const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

// ── Credenciales Railway MySQL ────────────────────────────────────────────────
const DB_HOST = process.argv[2];
const DB_PORT = parseInt(process.argv[3] || '3306');
const DB_USER = 'root';
const DB_PASS = 'mdOiMEpfvICjEYYiaIHbCkDUtvKvDevE';
const DB_NAME = 'railway';

// ── Rutas ─────────────────────────────────────────────────────────────────────
const SQL_FILE = 'C:/Users/USER/godaddy-sync/b2csuherramienta.sql';

// ── Validar argumentos ────────────────────────────────────────────────────────
if (!DB_HOST || !DB_PORT) {
  console.error('\nUso: node import-railway.js <host> <port>');
  console.error('Ejemplo: node import-railway.js switchback.proxy.rlwy.net 23534\n');
  process.exit(1);
}

if (!fs.existsSync(SQL_FILE)) {
  console.error(`\nNo se encontró el dump: ${SQL_FILE}\n`);
  process.exit(1);
}

/**
 * Reemplaza charset latin1 → utf8mb4 en las declaraciones de esquema.
 */
function preprocessDump(sqlPath) {
  const tempPath = sqlPath + '.railway.tmp';
  let content = fs.readFileSync(sqlPath, 'latin1');

  content = content
    .replace(/DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci/g,
             'DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')
    .replace(/DEFAULT CHARSET=latin1\b/g, 'DEFAULT CHARSET=utf8mb4')
    .replace(/COLLATE=latin1_swedish_ci/g, 'COLLATE=utf8mb4_unicode_ci')
    .replace(/ CHARACTER SET latin1\b/g, ' CHARACTER SET utf8mb4');

  fs.writeFileSync(tempPath, content, 'latin1');
  return tempPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       IMPORTAR GoDaddy → Railway MySQL                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Host:  ${DB_HOST}:${DB_PORT}`);
  console.log(`  Base:  ${DB_NAME}`);
  console.log(`  Dump:  ${SQL_FILE}`);

  // PASO 1: Verificar conexión
  console.log('\n[1/4] Verificando conexión a Railway MySQL...');
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    multipleStatements: true,
    connectTimeout: 15000,
  });
  console.log('  ✅ Conexión OK');

  // PASO 2: Preprocesar dump (latin1 → utf8mb4)
  console.log('\n[2/4] Preprocesando dump (charset latin1 → utf8mb4)...');
  const processedSql = preprocessDump(SQL_FILE);
  const fileSize = (fs.statSync(processedSql).size / 1024 / 1024).toFixed(1);
  console.log(`  ✅ Dump procesado (${fileSize} MB)`);

  // PASO 3: Limpiar BD y recrear con utf8mb4
  console.log('\n[3/4] Recreando base de datos Railway con utf8mb4...');
  await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await conn.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB_NAME}\``);
  console.log('  ✅ BD recreada');

  // PASO 4: Importar dump
  console.log('\n[4/4] Importando datos... (puede tardar 1-3 minutos según tamaño del dump)');
  const sql = fs.readFileSync(processedSql, 'latin1');
  await conn.query(sql);
  console.log('  ✅ Importación completada');

  await conn.end();

  // Limpiar temporal
  try { fs.unlinkSync(processedSql); } catch (_) {}

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  ¡Listo! Datos importados a Railway MySQL            ║');
  console.log('║                                                          ║');
  console.log('║  Próximo paso:                                           ║');
  console.log('║  - Configura las variables DB_* en tu app de Railway     ║');
  console.log('║  - Railway redesplegará y server.js creará las tablas    ║');
  console.log('║    locales (cotizaciones, status_log, etc.) al arrancar  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

main().catch(e => {
  console.error('\n[import-railway] ERROR:', e.message);
  process.exit(1);
});
