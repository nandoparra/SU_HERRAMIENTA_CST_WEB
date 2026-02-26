/**
 * sync-db.js — Importa un dump de GoDaddy preservando las tablas de cotización locales.
 *
 * Uso:
 *   node sync-db.js
 *
 * El archivo se busca automáticamente en C:\Users\USER\godaddy-sync\b2csuherramienta.sql
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
  'b2c_wa_autorizacion_pendiente',
  // b2c_informe_mantenimiento NO se preserva — se regenera desde cero con los datos reales de GoDaddy
];

const INFORMES_DIR = path.join(__dirname, 'public/uploads/informes-mantenimiento');

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

/**
 * Preprocesa el dump de GoDaddy reemplazando charset latin1 → utf8mb4
 * en las declaraciones de esquema (CREATE TABLE).
 *
 * Por qué: GoDaddy exporta tablas con DEFAULT CHARSET=latin1, pero los bytes
 * almacenados son UTF-8 (el ERP guardó datos en UTF-8 dentro de columnas latin1).
 * Si importamos declarando latin1, MySQL convierte los bytes creyendo que son
 * caracteres latin1, lo que corrompe ñ, tildes, etc.
 * Al cambiar la declaración a utf8mb4, MySQL recibe los bytes UTF-8 (C3 91 para Ñ)
 * y los almacena directamente como utf8mb4, interpretándolos correctamente.
 *
 * Se usa encoding 'latin1' para leer/escribir y así preservar TODOS los bytes
 * del archivo sin ninguna transformación.
 */
function preprocessDump(sqlPath) {
  const tempPath = sqlPath + '.tmp';
  let content = fs.readFileSync(sqlPath, 'latin1');

  content = content
    // Tabla completa: DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci
    .replace(/DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci/g,
             'DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')
    // Tabla sin collate explícito
    .replace(/DEFAULT CHARSET=latin1\b/g, 'DEFAULT CHARSET=utf8mb4')
    // Collate suelto
    .replace(/COLLATE=latin1_swedish_ci/g, 'COLLATE=utf8mb4_unicode_ci')
    // Columnas con charset explícito
    .replace(/ CHARACTER SET latin1\b/g, ' CHARACTER SET utf8mb4');

  fs.writeFileSync(tempPath, content, 'latin1');
  return tempPath;
}

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
  log('PASO 1/7 — Backup completo de la base de datos local...');
  const fullBackupFile = path.join(__dirname, `backup_completo_${timestamp}.sql`);
  const fullDumpCmd = `"${MYSQLDUMP}" -h ${DB_HOST} -u ${DB_USER} ${passArg} ${DB_NAME} --result-file="${fullBackupFile}"`;
  run(fullDumpCmd);
  console.log(`  Backup completo guardado en: ${fullBackupFile}`);

  // ── PASO 2: Backup de tablas de cotización ───────────────────────────────
  log('PASO 2/7 — Guardando cotizaciones locales...');
  const dumpCmd = `"${MYSQLDUMP}" -h ${DB_HOST} -u ${DB_USER} ${passArg} ${DB_NAME} ${QUOTE_TABLES.join(' ')} --result-file="${backupFile}"`;
  run(dumpCmd);
  console.log(`  Backup cotizaciones guardado en: ${backupFile}`);

  // ── PASO 3: Limpiar informes de mantenimiento anteriores ─────────────────
  log('PASO 3/7 — Limpiando informes de mantenimiento anteriores...');
  if (fs.existsSync(INFORMES_DIR)) {
    const files = fs.readdirSync(INFORMES_DIR).filter(f => f.endsWith('.pdf'));
    files.forEach(f => fs.unlinkSync(path.join(INFORMES_DIR, f)));
    console.log(`  ${files.length} archivo(s) PDF eliminado(s) de ${INFORMES_DIR}`);
  } else {
    console.log('  Carpeta de informes no existe, nada que limpiar.');
  }

  // ── PASO 4: Preprocesar dump (latin1 → utf8mb4 en declaraciones de esquema)
  log('PASO 4/7 — Preprocesando dump (charset latin1 → utf8mb4 en esquema)...');
  const processedSql = preprocessDump(sqlPath);
  console.log(`  Dump procesado guardado en: ${processedSql}`);

  // ── PASO 5: Importar dump procesado ─────────────────────────────────────
  log('PASO 5/7 — Importando datos de GoDaddy...');
  const dropCmd = `"${MYSQL_BIN}" -h ${DB_HOST} -u ${DB_USER} ${passArg} -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`; CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`;
  run(dropCmd);
  const importCmd = `"${MYSQL_BIN}" --default-character-set=utf8mb4 ${connArgs()} < "${processedSql}"`;
  run(importCmd);

  // Limpiar archivo temporal
  try { fs.unlinkSync(processedSql); } catch (_) {}
  console.log('  Archivo temporal eliminado.');

  // ── PASO 6: Restaurar tablas de cotización ───────────────────────────────
  log('PASO 6/7 — Restaurando cotizaciones y logs locales...');
  const restoreCmd = `"${MYSQL_BIN}" ${connArgs()} < "${backupFile}"`;
  run(restoreCmd);

  // ── PASO 7: Re-crear columna her_estado si el dump de GoDaddy no la incluye
  log('PASO 7/7 — Verificando columna her_estado en b2c_herramienta_orden...');
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
