'use strict';
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { pid: process.pid },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

module.exports = logger;
