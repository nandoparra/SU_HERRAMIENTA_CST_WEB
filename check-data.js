require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  });

  const queries = [
    ['Cotizaciones (b2c_cotizacion_orden)',    'SELECT COUNT(*) as n, MAX(updated_at) as ultima FROM b2c_cotizacion_orden'],
    ['Ítems cotización (b2c_cotizacion_item)', 'SELECT COUNT(*) as n FROM b2c_cotizacion_item'],
    ['Informes mantenimiento',                 'SELECT COUNT(*) as n, MAX(inf_fecha) as ultimo FROM b2c_informe_mantenimiento'],
    ['Órdenes ERP (b2c_orden)',                'SELECT COUNT(*) as n, MAX(ord_fecha) as ultima FROM b2c_orden'],
    ['Herramientas (b2c_herramienta)',          'SELECT COUNT(*) as n FROM b2c_herramienta'],
    ['Clientes (b2c_cliente)',                  'SELECT COUNT(*) as n FROM b2c_cliente'],
  ];

  for (const [label, sql] of queries) {
    try {
      const [[row]] = await conn.execute(sql);
      const extra = row.ultima || row.ultimo ? ` | más reciente: ${row.ultima || row.ultimo}` : '';
      console.log(`  ${label}: ${row.n} registros${extra}`);
    } catch (e) {
      console.log(`  ${label}: ERROR — ${e.message}`);
    }
  }

  await conn.end();
}

check().catch(e => console.error('Error:', e.message));
