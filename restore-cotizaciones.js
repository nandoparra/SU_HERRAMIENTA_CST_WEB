require('dotenv').config();
const { execFileSync } = require('child_process');
const fs = require('fs');

const MYSQL = 'C:/xampp/mysql/bin/mysql.exe';
const DB    = process.env.DB_NAME;
const ARGS  = ['-u', process.env.DB_USER, '-h', process.env.DB_HOST];

const file = process.argv[2] || 'backup_critico_2026-02-27.sql';

if (!fs.existsSync(file)) {
  console.error('No se encontró:', file);
  process.exit(1);
}

console.log(`Restaurando cotizaciones desde: ${file}`);
try {
  execFileSync(MYSQL, [...ARGS, DB], {
    input: fs.readFileSync(file),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('✅ Cotizaciones restauradas correctamente.');
} catch (e) {
  console.error('❌ Error:', e.message);
}
