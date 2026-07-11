'use strict';
/**
 * tests/wa-ratelimit.test.js
 *
 * Tests unitarios para checkRateLimit — rate limiting del agente WA.
 * Usa conn simulado (sin BD real).
 *
 * IMPORTANTE: checkRateLimit asume serialización por número via _enqueue() (P1-1,
 * wa-handler.js). Los tests corren en serie por diseño (node:test secuencial)
 * — no reproducen la concurrencia que P1-1 previene en producción.
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { checkRateLimit } = require('../services/wa-agente');

const RATE_LIMIT = 20;
const RATE_CAP   = RATE_LIMIT + 2; // 22

/**
 * Crea un conn simulado con estado inicial dado.
 * SELECT devuelve la fila almacenada; INSERT...ON DUPLICATE KEY la actualiza.
 */
function makeMockConn(initialRow = null) {
  let stored = initialRow ? { ...initialRow } : null;
  return {
    async execute(sql, params = []) {
      if (sql.includes('SELECT msgs_hora_count')) {
        return [[stored]];
      }
      if (sql.includes('INSERT INTO b2c_wa_estado_identificacion')) {
        // params: [tenantId, waPhone, count, desde]
        const [, , count, desde] = params;
        stored = { msgs_hora_count: count, msgs_hora_desde: desde };
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };
}

// ── Casos requeridos ──────────────────────────────────────────────────────────

test('primer mensaje (sin historial en BD) — ok', async () => {
  const conn = makeMockConn(null);
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'ok');
});

test('mensajes 1-19 dentro del límite — ok', async () => {
  const conn = makeMockConn({ msgs_hora_count: 9, msgs_hora_desde: new Date() });
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'ok');
});

test('mensaje 20 (último permitido) — ok (no bloquea antes del límite)', async () => {
  const conn = makeMockConn({ msgs_hora_count: 19, msgs_hora_desde: new Date() });
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'ok');
});

test('mensaje 21 — notify (corta exactamente en el intento 21)', async () => {
  const conn = makeMockConn({ msgs_hora_count: 20, msgs_hora_desde: new Date() });
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'notify');
});

test('mensaje 22 — silent (ya se envió el aviso, sin más respuestas)', async () => {
  const conn = makeMockConn({ msgs_hora_count: 21, msgs_hora_desde: new Date() });
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'silent');
});

test('contador en RATE_CAP — se estabiliza, no crece indefinidamente', async () => {
  const conn = makeMockConn({ msgs_hora_count: RATE_CAP, msgs_hora_desde: new Date() });
  const result = await checkRateLimit(conn, 'TEST', 1);
  assert.equal(result, 'silent');
  // verificar que el mock no escribió un valor mayor al tope
  const [[row]] = await conn.execute('SELECT msgs_hora_count', []);
  assert.equal(row.msgs_hora_count, RATE_CAP);
});

test('ventana expirada (>1h) — resetea y deja pasar el primer mensaje', async () => {
  const hace70min = new Date(Date.now() - 70 * 60 * 1000);
  const conn = makeMockConn({ msgs_hora_count: 21, msgs_hora_desde: hace70min });
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'ok');
});

test('ventana a 59 min 59 s — no expira, sigue contando dentro de la ventana', async () => {
  const hace59m59s = new Date(Date.now() - (60 * 60 * 1000 - 1000));
  const conn = makeMockConn({ msgs_hora_count: 20, msgs_hora_desde: hace59m59s });
  assert.equal(await checkRateLimit(conn, 'TEST', 1), 'notify');
});
