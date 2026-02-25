/**
 * sync-db.js — Importa un dump de GoDaddy preservando las tablas de cotización locales.
 *
 * Uso:
 *   node sync-db.js
 *
 * El archivo se busca automáticamente en C:\Users\USER\Downloads\b2csuherramienta.sql
 * También puedes pasar una ruta distinta como argumento:
 *   node sync-db.js C:\otra\ruta\archivo.sql
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Configuración ────────────────────────────────────────────────────────────
const MYSQL_BIN  = 'C:/xampp/mysql/bin/mysql.exe';
const MYSQLDUMP  = 'C:/xampp/mysql/bin/mysqldump.exe';

// Ruta por defecto del archivo exportado de GoDaddy
// Crea esta carpeta una sola vez y siempre guarda el .sql ahí con el mismo nombre.
const DEFAULT_SQL = 'C:/Users/USER/godaddy-sync/b2csuherramienta.sql';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'b2csuherramienta';

const QUOTE_TABLES = [
  'b2c_cotizacion_orden',
  'b2c_cotizacion_maquina',
  'b2c_cotizacion_item',
  'b2c_herramienta_status_log',
  'b2c_informe_mantenimiento',
  'b2c_wa_autorizacion_pendiente',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function connArgs() {
  const pass = DB_PASS ? `-p${DB_PASS}` : '';
  return `-h ${DB_HOST} -u ${DB_USER} ${pass} ${DB_NAME}`;
}

function run(cmd) {
  console.log(`  > ${cmd.replace(DB_PASS || 'NOPASS', '***')}`);
  execSync(cmd, { stdio: 'inherit' });
}

function log(msg) { console.log(`\n[sync-db] ${msg}`); }

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sqlFile = process.argv[2] || DEFAULT_SQL;
  const sqlPath = path.resolve(sqlFile);
  console.log(`\n[sync-db] Archivo a importar: ${sqlPath}`);

  if (!fs.existsSync(sqlPath)) {
    console.error(`\nArchivo no encontrado: ${sqlPath}`);
    console.error('Descarga el .sql de GoDaddy y guárdalo en:');
    console.error(`  ${DEFAULT_SQL}\n`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(__dirname, `cotizaciones_backup_${timestamp}.sql`);

  const passArg = DB_PASS ? `-p${DB_PASS}` : '';

  // ── PASO 1: Backup completo de la BD local ───────────────────────────────
  log('PASO 1/4 — Backup completo de la base de datos local...');
  const fullBackupFile = path.join(__dirname, `backup_completo_${timestamp}.sql`);
  const fullDumpCmd = `"${MYSQLDUMP}" -h ${DB_HOST} -u ${DB_USER} ${passArg} ${DB_NAME} --result-file="${fullBackupFile}"`;
  run(fullDumpCmd);
  console.log(`  Backup completo guardado en: ${fullBackupFile}`);

  // ── PASO 2: Backup de tablas de cotización ───────────────────────────────
  log('PASO 2/4 — Guardando cotizaciones locales...');
  const dumpCmd = `"${MYSQLDUMP}" -h ${DB_HOST} -u ${DB_USER} ${passArg} ${DB_NAME} ${QUOTE_TABLES.join(' ')} --result-file="${backupFile}"`;
  run(dumpCmd);
  console.log(`  Backup cotizaciones guardado en: ${backupFile}`);

  // ── PASO 3: Importar dump de GoDaddy ────────────────────────────────────
  log('PASO 3/4 — Importando datos de GoDaddy...');
  // Primero vaciamos la BD para evitar el error "Table already exists"
  const dropCmd   = `"${MYSQL_BIN}" -h ${DB_HOST} -u ${DB_USER} ${passArg} -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`; CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`;
  run(dropCmd);
  const importCmd = `"${MYSQL_BIN}" ${connArgs()} < "${sqlPath}"`;
  run(importCmd);

  // ── PASO 4: Restaurar tablas de cotización ───────────────────────────────
  log('PASO 4/5 — Restaurando cotizaciones y logs locales...');
  const restoreCmd = `"${MYSQL_BIN}" ${connArgs()} < "${backupFile}"`;
  run(restoreCmd);

  // ── PASO 5: Re-crear columna her_estado si el dump de GoDaddy no la incluye ─
  log('PASO 5/5 — Verificando columna her_estado en b2c_herramienta_orden...');
  const alterCmd = `"${MYSQL_BIN}" ${connArgs()} -e "ALTER TABLE b2c_herramienta_orden ADD COLUMN IF NOT EXISTS her_estado VARCHAR(32) NOT NULL DEFAULT 'pendiente_revision';"`;
  run(alterCmd);
  console.log('  Columna her_estado verificada.');

  log('¡Listo! Base de datos actualizada con datos de GoDaddy y datos locales preservados.');
  console.log(`  Backup completo en:      ${fullBackupFile}`);
  console.log(`  Backup cotizaciones en:  ${backupFile}\n`);
}

main().catch(e => {
  console.error('\n[sync-db] ERROR:', e.message);
  process.exit(1);
});
