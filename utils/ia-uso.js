'use strict';
const db  = require('./db');
const log = require('./logger');

// Precios vigentes por MTok (verificados 2026-07-17)
// Haiku 4.5:  $1.00 input / $5.00  output
// Opus  4.6+: $5.00 input / $25.00 output
const PRECIOS_MTK = {
  haiku: { input: 1.00,  output: 5.00  },
  opus:  { input: 5.00,  output: 25.00 },
};

/**
 * Estima el costo en USD de una llamada a Claude.
 * Modelo desconocido → precios Opus (conservador, nunca subestima).
 */
function calcularCostoEstimadoUSD(modelo, inputTokens, outputTokens) {
  const tier = String(modelo).toLowerCase().includes('haiku') ? 'haiku' : 'opus';
  const p = PRECIOS_MTK[tier];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/**
 * Registra el uso de tokens de una llamada a Claude en b2c_ia_uso_log.
 * Fire-and-forget: retorna undefined de inmediato, nunca propaga errores.
 */
function logIaUso({ tenantId, funcion, modelo, inputTokens, outputTokens }) {
  (async () => {
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `INSERT INTO b2c_ia_uso_log (tenant_id, funcion, modelo, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId ?? 1, String(funcion), String(modelo), inputTokens, outputTokens]
      );
    } finally {
      conn.release();
    }
  })().catch(e => {
    log.warn({ err: e.message, funcion }, 'ia-uso: INSERT falló (no crítico)');
  });
}

module.exports = { logIaUso, calcularCostoEstimadoUSD };
