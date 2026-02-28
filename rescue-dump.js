require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

const TABLAS = [
  'b2c_cotizacion_orden',
  'b2c_cotizacion_maquina',
  'b2c_cotizacion_item',
  'b2c_herramienta_status_log',
  'b2c_informe_mantenimiento',
  'b2c_wa_autorizacion_pendiente',
  'b2c_foto_herramienta_orden',
];

const OUT = 'backup_critico_2026-02-27.sql';

async function dump() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  });

  let sql = `-- Backup crítico ${new Date().toISOString()}\n`;
  sql += `-- Base: ${process.env.DB_NAME}\n\n`;
  sql += `SET FOREIGN_KEY_CHECKS=0;\n\n`;

  for (const tabla of TABLAS) {
    console.log(`Exportando ${tabla}...`);
    try {
      const [rows] = await conn.execute(`SELECT * FROM \`${tabla}\``);
      sql += `-- Tabla: ${tabla} (${rows.length} filas)\n`;
      sql += `DELETE FROM \`${tabla}\`;\n`;

      for (const row of rows) {
        const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
        const vals = Object.values(row).map(v => {
          if (v === null) return 'NULL';
          if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
          if (typeof v === 'number') return v;
          return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        }).join(', ');
        sql += `INSERT INTO \`${tabla}\` (${cols}) VALUES (${vals});\n`;
      }
      sql += '\n';
      console.log(`  ✅ ${rows.length} filas`);
    } catch (e) {
      console.error(`  ❌ Error en ${tabla}: ${e.message}`);
      sql += `-- ERROR exportando ${tabla}: ${e.message}\n\n`;
    }
  }

  sql += `SET FOREIGN_KEY_CHECKS=1;\n`;
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`\n✅ Backup guardado en: ${OUT}`);
  await conn.end();
}

dump().catch(e => console.error('💥 Fatal:', e.message));
