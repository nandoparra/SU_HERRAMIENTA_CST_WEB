'use strict';
const path = require('path');
const fs   = require('fs');
const pino = require('pino');

const pinoOpts = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { pid: process.pid },
  serializers: { err: pino.stdSerializers.err },
};

let logger;

if (process.env.NODE_ENV === 'production' && process.env.LOGS_PATH) {
  // En producción con volumen persistente: rotación diaria, retención 30 días
  const logsDir = process.env.LOGS_PATH;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (_) {}

  const dest = require('pino-roll').createWriteStream({
    file:      path.join(logsDir, 'app.log'),
    frequency: 'daily',
    limit:     { count: 30 },  // retener 30 archivos (30 días)
    compress:  'gzip',
  });

  logger = pino(pinoOpts, dest);
} else {
  // Desarrollo o producción sin LOGS_PATH: stdout
  logger = pino(pinoOpts);
}

module.exports = logger;
