const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  charset:            'utf8mb4',
  connectTimeout:     10000,  // 10 s — falla explícitamente si MySQL no responde en lugar de colgar
  waitForConnections: true,
  connectionLimit:    5,
  queueLimit:         0,
});

module.exports = pool;
