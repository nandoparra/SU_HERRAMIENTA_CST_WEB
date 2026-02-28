require('dotenv').config();
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MYSQL = 'C:/xampp/mysql/bin/mysql.exe';
const BASE = process.env.DB_NAME;
const ARGS_BASE = ['-u', process.env.DB_USER, '-h', process.env.DB_HOST, '--default-character-set=utf8mb4'];

function runSQL(sql, label) {
  console.log(`\n▶ ${label}...`);
  try {
    execFileSync(MYSQL, [...ARGS_BASE, '-e', sql], { stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`  ✅ OK`);
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().slice(0, 200);
    console.error(`  ❌ Error: ${msg}`);
    throw e;
  }
}

function importFile(filePath, label) {
  console.log(`\n▶ ${label}...`);
  const content = fs.readFileSync(filePath);
  try {
    execFileSync(MYSQL, [...ARGS_BASE, BASE], { input: content, stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`  ✅ OK`);
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().slice(0, 300);
    console.error(`  ❌ Error: ${msg}`);
    throw e;
  }
}

async function restore() {
  const backupCompleto = path.join(__dirname, 'backup_completo_2026-02-25T21-40-44.sql');
  const backupCritico  = path.join(__dirname, 'backup_critico_2026-02-27.sql');

  if (!fs.existsSync(backupCompleto)) {
    console.error('❌ No se encontró:', backupCompleto);
    process.exit(1);
  }
  if (!fs.existsSync(backupCritico)) {
    console.error('❌ No se encontró:', backupCritico);
    process.exit(1);
  }

  // 1. Recrear la base de datos limpia
  runSQL(`DROP DATABASE IF EXISTS \`${BASE}\``, `Eliminando base de datos corrupta (${BASE})`);
  runSQL(`CREATE DATABASE \`${BASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, `Creando base de datos limpia`);

  // 2. Importar backup completo del 25 de febrero
  importFile(backupCompleto, 'Importando backup completo (25-feb) — puede tardar unos segundos');

  // 3. Importar datos críticos del 25-27 de febrero (sobrescribe tablas de cotizaciones)
  importFile(backupCritico, 'Restaurando datos críticos (cotizaciones e informes hasta hoy)');

  console.log('\n✅ Restauración completa. Reinicia el servidor Node (node server.js).');
}

restore().catch(e => {
  console.error('\n💥 Restauración fallida:', e.message);
  process.exit(1);
});
