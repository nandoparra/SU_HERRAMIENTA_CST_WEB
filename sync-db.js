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
  'b2c_foto_herramienta_orden', // fotos subidas localmente (no existen en GoDaddy)
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

/**
 * Dump de tablas usando mysql2 (evita mysqldump que crashea MariaDB 10.4 con tablas latin1).
 * Genera INSERT statements compatibles con mysql.exe para restaurar.
 */
async function dumpTablesNode(tablas, outFile) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB_HOST, user: DB_USER, password: DB_PASS || '', database: DB_NAME,
  });
  let sql = `-- Backup Node.js ${new Date().toISOString()}\nSET FOREIGN_KEY_CHECKS=0;\n\n`;
  for (const tabla of tablas) {
    try {
      const [rows] = await conn.execute(`SELECT * FROM \`${tabla}\``);
      sql += `-- ${tabla} (${rows.length} filas)\nDELETE FROM \`${tabla}\`;\n`;
      for (const row of rows) {
        const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
        const vals = Object.values(row).map(v => {
          if (v === null) return 'NULL';
          if (v instanceof Date) return `'${v.toISOString().slice(0,19).replace('T',' ')}'`;
          if (typeof v === 'number') return v;
          return `'${String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`;
        }).join(', ');
        sql += `INSERT INTO \`${tabla}\` (${cols}) VALUES (${vals});\n`;
      }
      sql += '\n';
      console.log(`  ✅ ${tabla}: ${rows.length} filas`);
    } catch (e) {
      console.warn(`  ⚠️  ${tabla}: ${e.message}`);
    }
  }
  sql += 'SET FOREIGN_KEY_CHECKS=1;\n';
  fs.writeFileSync(outFile, sql, 'utf8');
  await conn.end();
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

  // ── PASO 1: Backup completo omitido ─────────────────────────────────────
  // mysqldump crashea MariaDB 10.4 con tablas latin1 (SHOW FIELDS). Se omite.
  log('PASO 1/7 — Backup completo (omitido — mysqldump crashea con tablas latin1).');
  console.log('  ℹ️  El backup crítico reciente está en backup_critico_2026-02-27.sql');

  // ── PASO 2: Backup de tablas de cotización (via Node.js) ─────────────────
  log('PASO 2/7 — Guardando cotizaciones locales (via Node.js)...');
  await dumpTablesNode(QUOTE_TABLES, backupFile);
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

  // ── PASO 5.5: Crear tablas locales (no vienen en el dump de GoDaddy) ───────
  log('PASO 5.5/7 — Creando tablas locales de cotizaciones...');
  const createSQL = [
    `CREATE TABLE IF NOT EXISTS b2c_cotizacion_orden (uid_orden VARCHAR(64) PRIMARY KEY, subtotal DECIMAL(14,2) NOT NULL DEFAULT 0, iva DECIMAL(14,2) NOT NULL DEFAULT 0, total DECIMAL(14,2) NOT NULL DEFAULT 0, mensaje_whatsapp TEXT NULL, whatsapp_enviado TINYINT(1) NOT NULL DEFAULT 0, whatsapp_enviado_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS b2c_cotizacion_maquina (uid_orden VARCHAR(64) NOT NULL, uid_herramienta_orden VARCHAR(64) NOT NULL, tecnico_id VARCHAR(64) NULL, mano_obra DECIMAL(14,2) NOT NULL DEFAULT 0, descripcion_trabajo TEXT NULL, subtotal DECIMAL(14,2) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (uid_orden, uid_herramienta_orden))`,
    `CREATE TABLE IF NOT EXISTS b2c_cotizacion_item (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, uid_orden VARCHAR(64) NOT NULL, uid_herramienta_orden VARCHAR(64) NOT NULL, nombre VARCHAR(255) NOT NULL, cantidad INT NOT NULL DEFAULT 1, precio DECIMAL(14,2) NOT NULL DEFAULT 0, subtotal DECIMAL(14,2) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_cot_item (uid_orden, uid_herramienta_orden))`,
    `CREATE TABLE IF NOT EXISTS b2c_herramienta_status_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, uid_herramienta_orden VARCHAR(64) NOT NULL, estado VARCHAR(32) NOT NULL, changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_hsl (uid_herramienta_orden))`,
    `CREATE TABLE IF NOT EXISTS b2c_wa_autorizacion_pendiente (uid_autorizacion INT AUTO_INCREMENT PRIMARY KEY, uid_orden INT NOT NULL, wa_phone VARCHAR(20) NOT NULL, estado ENUM('esperando_opcion','esperando_maquinas') NOT NULL DEFAULT 'esperando_opcion', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_wa_phone (wa_phone))`,
    `CREATE TABLE IF NOT EXISTS b2c_informe_mantenimiento (uid_informe INT AUTO_INCREMENT PRIMARY KEY, uid_orden INT NOT NULL, uid_herramienta_orden INT NOT NULL, inf_archivo VARCHAR(255) NOT NULL, inf_fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_informe_maquina (uid_herramienta_orden), INDEX idx_inf_orden (uid_orden))`,
    `ALTER TABLE b2c_herramienta_orden ADD COLUMN IF NOT EXISTS her_estado VARCHAR(32) NOT NULL DEFAULT 'pendiente_revision'`,
    `ALTER TABLE b2c_foto_herramienta_orden ADD COLUMN IF NOT EXISTS fho_tipo VARCHAR(20) NOT NULL DEFAULT 'recepcion'`,
  ].join('; ');
  run(`"${MYSQL_BIN}" ${connArgs()} -e "${createSQL.replace(/"/g, '\\"')}"`);
  console.log('  Tablas locales listas.');

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
  console.log(`  Backup cotizaciones en:  ${backupFile}\n`);
}

main().catch(e => {
  console.error('\n[sync-db] ERROR:', e.message);
  process.exit(1);
});
