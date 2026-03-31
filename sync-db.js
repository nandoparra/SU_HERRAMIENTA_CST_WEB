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
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
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
  return `-h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} ${pass} ${DB_NAME}`;
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
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '', database: DB_NAME,
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
 * Importa un archivo .sql completo via Node.js mysql2 (sin mysql.exe).
 * Divide el contenido en sentencias y las ejecuta una a una.
 * Usado cuando mysql.exe no puede conectar (ej: Railway MySQL 8.0).
 */
async function importSqlFileNode(filePath) {
  const mysql = require('mysql2/promise');

  // DROP + CREATE sin base de datos seleccionada
  const connAdmin = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '',
  });
  await connAdmin.execute(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await connAdmin.execute(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connAdmin.end();

  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '',
    database: DB_NAME, multipleStatements: false,
  });

  const content = fs.readFileSync(filePath, 'latin1');
  const lines = content.split(/\r?\n/);

  // Acumular líneas hasta encontrar el fin de sentencia (línea que termina en ';')
  // Este patrón es el estándar para leer mysqldump correctamente
  let stmt = '';
  let ok = 0, skip = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Ignorar comentarios, líneas vacías y USE (el dump trae USE `b2csuherramienta` que no existe en Railway)
    if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('*/')) continue;
    // Ignorar /* comentarios normales */ pero NO /*!40014 ... */ (son instrucciones condicionales de MySQL)
    if (trimmed.startsWith('/*') && !trimmed.startsWith('/*!')) continue;
    if (/^use\s+`/i.test(trimmed)) continue;
    stmt += line + '\n';
    // Ejecutar cuando la línea termina en ';'
    if (trimmed.endsWith(';')) {
      try {
        await conn.query(stmt);
        ok++;
      } catch (e) {
        if (!['ER_EMPTY_QUERY', 'ER_BAD_DB_ERROR'].includes(e.code)) {
          skip++;
          if (skip <= 10) console.log(`  ⚠️  Error [${e.code}]: ${e.message.slice(0,150)}`);
        }
      }
      stmt = '';
    }
  }
  // Verificar cuántas tablas quedaron
  const [tables] = await conn.query('SHOW TABLES');
  console.log(`  ${ok} sentencias ejecutadas, ${skip} con error omitidas.`);
  console.log(`  Tablas en BD después del import: ${tables.length}`);
  if (tables.length < 5) {
    console.log('  ADVERTENCIA: pocas tablas creadas — primeros errores del import:');
  }
  await conn.end();
}

/**
 * Agrega columna solo si no existe — compatible con MySQL 8.0 y MariaDB.
 */
async function addColumnSafe(table, column, definition) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '',
    database: DB_NAME,
  });
  try {
    await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  + ${table}.${column} agregada.`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log(`  ✓ ${table}.${column} ya existe.`);
    else throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Restaura un archivo .sql sobre la BD existente SIN hacer DROP/CREATE.
 * Usado para restaurar el backup de cotizaciones después del import principal.
 */
async function restoreSqlFileNode(filePath) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '',
    database: DB_NAME, multipleStatements: false,
  });
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let stmt = '', ok = 0, skip = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    stmt += line + '\n';
    if (trimmed.endsWith(';')) {
      try {
        await conn.query(stmt);
        ok++;
      } catch (e) {
        if (e.code !== 'ER_EMPTY_QUERY') { skip++; if (skip <= 5) console.log(`  ⚠️  [${e.code}]: ${e.message.slice(0,120)}`); }
      }
      stmt = '';
    }
  }
  await conn.end();
  console.log(`  ${ok} sentencias restauradas, ${skip} omitidas.`);
}

/**
 * Ejecuta sentencias SQL directamente via Node.js mysql2.
 */
async function runSqlNode(sql) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '',
    database: DB_NAME, multipleStatements: true,
  });
  await conn.query(sql);
  await conn.end();
}

/**
 * Lee el dump de GoDaddy y compara con las órdenes en Railway.
 * Muestra qué órdenes son reales (coinciden consecutivo + identificación cliente)
 * y cuáles son de prueba. Pide confirmación antes de continuar.
 */
async function reportarOrdenesPrueba(sqlPath) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '', database: DB_NAME,
  });

  // Órdenes actuales en Railway con cliente
  const [ordenesRailway] = await conn.execute(`
    SELECT o.uid_orden, o.ord_consecutivo, c.cli_identificacion, c.cli_razon_social
    FROM b2c_orden o
    JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente
  `);
  await conn.end();

  if (ordenesRailway.length === 0) {
    console.log('  No hay órdenes en Railway — nada que verificar.');
    return;
  }

  // Leer el dump y extraer el bloque de b2c_orden
  const dump = fs.readFileSync(sqlPath, 'latin1');

  // Extraer bloque de INSERTs de b2c_orden (hasta la siguiente sección del dump)
  const ordenStart = dump.indexOf('INSERT INTO `b2c_orden`');
  const clienteStart = dump.indexOf('INSERT INTO `b2c_cliente`');

  const ordenBlock  = ordenStart  !== -1 ? dump.slice(ordenStart,  dump.indexOf('\n\n', ordenStart)  + 1 || undefined) : '';
  const clienteBlock = clienteStart !== -1 ? dump.slice(clienteStart, dump.indexOf('\n\n', clienteStart) + 1 || undefined) : '';

  // Para cada orden de Railway, verificar si el consecutivo aparece en el bloque de b2c_orden
  // y si la identificacion del cliente aparece en el bloque de b2c_cliente
  const reales = [];
  const prueba = [];

  for (const o of ordenesRailway) {
    const consec = String(o.ord_consecutivo).trim();
    const ident  = String(o.cli_identificacion).trim();

    // Buscar consecutivo como valor entre comas/paréntesis (quoted o unquoted)
    const consecOk = ordenBlock.includes(`'${consec}'`) ||
                     ordenBlock.includes(`,${consec},`) ||
                     ordenBlock.includes(`(${consec},`);

    // Buscar identificacion (trim para ignorar espacios extra del ERP)
    const identOk = clienteBlock.includes(`'${ident}'`) ||
                    dump.includes(`'${ident}'`);

    if (consecOk && identOk) reales.push(o);
    else prueba.push(o);
  }

  console.log(`\n  ┌─ ÓRDENES EN RAILWAY (${ordenesRailway.length} total) ─────────────────`);
  if (reales.length) {
    console.log(`  │  ✅ REALES (${reales.length}) — se conservarán con sus cotizaciones:`);
    reales.forEach(o => console.log(`  │     Orden #${o.ord_consecutivo} — ${o.cli_razon_social} (${o.cli_identificacion})`));
  }
  if (prueba.length) {
    console.log(`  │  🧪 PRUEBA (${prueba.length}) — sus cotizaciones serán eliminadas:`);
    prueba.forEach(o => console.log(`  │     Orden #${o.ord_consecutivo} — ${o.cli_razon_social} (${o.cli_identificacion})`));
  }
  console.log(`  └───────────────────────────────────────────────────────`);

  if (prueba.length === 0) {
    console.log('  Todas las órdenes son reales. Continuando...');
    return;
  }

  // Pedir confirmación
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve, reject) => {
    rl.question('\n  ¿Continuar? Las cotizaciones de prueba se eliminarán después del sync. [s/N]: ', ans => {
      rl.close();
      if (ans.trim().toLowerCase() === 's') resolve();
      else reject(new Error('Sync cancelado por el usuario.'));
    });
  });
}

/**
 * Elimina cotizaciones cuyos uid_herramienta_orden o uid_orden
 * ya no existen en la BD (órdenes de prueba eliminadas por el sync).
 */
async function limpiarCotizacionesHuerfanas() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '', database: DB_NAME,
  });
  try {
    let total = 0;
    const queries = [
      `DELETE FROM b2c_cotizacion_item   WHERE uid_herramienta_orden NOT IN (SELECT uid_herramienta_orden FROM b2c_herramienta_orden)`,
      `DELETE FROM b2c_cotizacion_maquina WHERE uid_herramienta_orden NOT IN (SELECT uid_herramienta_orden FROM b2c_herramienta_orden)`,
      `DELETE FROM b2c_cotizacion_orden   WHERE uid_orden NOT IN (SELECT uid_orden FROM b2c_orden)`,
    ];
    for (const q of queries) {
      try {
        const [r] = await conn.execute(q);
        total += r.affectedRows;
      } catch (e) {
        console.log(`  (omitido: ${e.message})`);
      }
    }
    console.log(total > 0 ? `  🧹 ${total} registros huérfanos eliminados.` : '  Sin cotizaciones huérfanas — todo limpio.');
  } finally {
    await conn.end();
  }
}

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

  // ── PASO 0: Cambiar auth plugin a mysql_native_password si es Railway ────
  if (DB_PORT !== 3306) {
    log('PASO 0/7 — Ajustando autenticación para compatibilidad con cliente local...');
    try {
      const mysql = require('mysql2/promise');
      const conn = await mysql.createConnection({
        host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS || '',
        database: DB_NAME,
      });
      await conn.execute(`ALTER USER '${DB_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '${DB_PASS}'`);
      await conn.end();
      console.log('  Auth plugin actualizado a mysql_native_password.');
    } catch (e) {
      console.log(`  (Ajuste auth omitido: ${e.message})`);
    }
  }

  // ── PASO 1: Backup completo omitido ─────────────────────────────────────
  // mysqldump crashea MariaDB 10.4 con tablas latin1 (SHOW FIELDS). Se omite.
  log('PASO 1/7 — Backup completo (omitido — mysqldump crashea con tablas latin1).');
  console.log('  ℹ️  El backup crítico reciente está en backup_critico_2026-02-27.sql');

  // ── PASO 2: Backup de tablas de cotización (via Node.js) ─────────────────
  log('PASO 2/7 — Guardando cotizaciones locales (via Node.js)...');
  await dumpTablesNode(QUOTE_TABLES, backupFile);
  console.log(`  Backup cotizaciones guardado en: ${backupFile}`);

  // ── PASO 2.5: Reporte órdenes reales vs prueba ───────────────────────────
  log('PASO 2.5/7 — Verificando órdenes Railway vs dump GoDaddy...');
  try {
    await reportarOrdenesPrueba(sqlPath);
  } catch (e) {
    console.log(`  (Reporte omitido — BD vacía o sin órdenes: ${e.message})`);
  }

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
  if (DB_PORT !== 3306) {
    // Railway u host remoto: usar Node.js (mysql.exe de XAMPP no soporta MySQL 8.0)
    console.log('  Usando importador Node.js (conexión remota)...');
    await importSqlFileNode(processedSql);
  } else {
    const dropCmd = `"${MYSQL_BIN}" -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} ${passArg} -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`; CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`;
    run(dropCmd);
    const importCmd = `"${MYSQL_BIN}" --default-character-set=utf8mb4 ${connArgs()} < "${processedSql}"`;
    run(importCmd);
  }

  // Limpiar archivo temporal
  try { fs.unlinkSync(processedSql); } catch (_) {}
  console.log('  Archivo temporal eliminado.');

  // ── PASO 5.5: Crear tablas locales (no vienen en el dump de GoDaddy) ───────
  log('PASO 5.5/7 — Creando tablas locales de cotizaciones...');
  const createStatements = [
    `CREATE TABLE IF NOT EXISTS b2c_cotizacion_orden (uid_orden VARCHAR(64) PRIMARY KEY, subtotal DECIMAL(14,2) NOT NULL DEFAULT 0, iva DECIMAL(14,2) NOT NULL DEFAULT 0, total DECIMAL(14,2) NOT NULL DEFAULT 0, mensaje_whatsapp TEXT NULL, whatsapp_enviado TINYINT(1) NOT NULL DEFAULT 0, whatsapp_enviado_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS b2c_cotizacion_maquina (uid_orden VARCHAR(64) NOT NULL, uid_herramienta_orden VARCHAR(64) NOT NULL, tecnico_id VARCHAR(64) NULL, mano_obra DECIMAL(14,2) NOT NULL DEFAULT 0, descripcion_trabajo TEXT NULL, subtotal DECIMAL(14,2) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (uid_orden, uid_herramienta_orden))`,
    `CREATE TABLE IF NOT EXISTS b2c_cotizacion_item (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, uid_orden VARCHAR(64) NOT NULL, uid_herramienta_orden VARCHAR(64) NOT NULL, nombre VARCHAR(255) NOT NULL, cantidad INT NOT NULL DEFAULT 1, precio DECIMAL(14,2) NOT NULL DEFAULT 0, subtotal DECIMAL(14,2) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_cot_item (uid_orden, uid_herramienta_orden))`,
    `CREATE TABLE IF NOT EXISTS b2c_herramienta_status_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, uid_herramienta_orden VARCHAR(64) NOT NULL, estado VARCHAR(32) NOT NULL, changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_hsl (uid_herramienta_orden))`,
    `CREATE TABLE IF NOT EXISTS b2c_wa_autorizacion_pendiente (uid_autorizacion INT AUTO_INCREMENT PRIMARY KEY, uid_orden INT NOT NULL, wa_phone VARCHAR(20) NOT NULL, estado ENUM('esperando_opcion','esperando_maquinas') NOT NULL DEFAULT 'esperando_opcion', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_wa_phone (wa_phone))`,
    `CREATE TABLE IF NOT EXISTS b2c_informe_mantenimiento (uid_informe INT AUTO_INCREMENT PRIMARY KEY, uid_orden INT NOT NULL, uid_herramienta_orden INT NOT NULL, inf_archivo VARCHAR(255) NOT NULL, inf_fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_informe_maquina (uid_herramienta_orden), INDEX idx_inf_orden (uid_orden))`,
  ];
  if (DB_PORT !== 3306) {
    await runSqlNode(createStatements.join('; '));
  } else {
    run(`"${MYSQL_BIN}" ${connArgs()} -e "${createStatements.join('; ').replace(/"/g, '\\"')}"`);
  }
  console.log('  Tablas locales listas.');

  // ── PASO 6: Restaurar tablas de cotización ───────────────────────────────
  log('PASO 6/7 — Restaurando cotizaciones y logs locales...');
  if (DB_PORT !== 3306) {
    await restoreSqlFileNode(backupFile);
  } else {
    run(`"${MYSQL_BIN}" ${connArgs()} < "${backupFile}"`);
  }

  // ── PASO 6.5: Limpiar cotizaciones huérfanas (de órdenes de prueba) ──────
  log('PASO 6.5/7 — Limpiando cotizaciones huérfanas...');
  await limpiarCotizacionesHuerfanas();

  // ── PASO 7: Verificar columnas agregadas
  log('PASO 7/7 — Verificando columnas her_estado y fho_tipo...');
  await addColumnSafe('b2c_herramienta_orden',       'her_estado', `VARCHAR(32) NOT NULL DEFAULT 'pendiente_revision'`);
  await addColumnSafe('b2c_foto_herramienta_orden',  'fho_tipo',   `VARCHAR(20) NOT NULL DEFAULT 'recepcion'`);
  await addColumnSafe('b2c_orden', 'ord_tipo',             `VARCHAR(20) NOT NULL DEFAULT 'normal'`);
  await addColumnSafe('b2c_orden', 'ord_factura',          `VARCHAR(255) NULL`);
  await addColumnSafe('b2c_orden', 'ord_garantia_vence',   `DATE NULL`);
  await addColumnSafe('b2c_orden', 'ord_revision_limite',  `DATE NULL`);
  console.log('  Columnas verificadas.');

  log('¡Listo! Base de datos actualizada con datos de GoDaddy y datos locales preservados.');
  console.log(`  Backup cotizaciones en:  ${backupFile}\n`);
}

main().catch(e => {
  console.error('\n[sync-db] ERROR:', e.message);
  process.exit(1);
});
