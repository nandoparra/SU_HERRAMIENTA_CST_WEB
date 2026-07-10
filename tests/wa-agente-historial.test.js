'use strict';
/**
 * Tests de wa-agente.js — historial de conversación y persistencia.
 *
 * Estrategia de mock:
 *   wa-agente.js hace `const { getClient, withTimeout } = require('../utils/ia')` al
 *   cargar — la destructuring fija las referencias. No se puede cambiar getClient()
 *   después de la carga reasignando iaCache.exports.getClient.
 *
 *   Solución: inyectamos un mock con estado compartido (iaMockState) ANTES de
 *   requerir wa-agente.js. El mock lee iaMockState en cada llamada, así los tests
 *   pueden cambiar el comportamiento modificando ese objeto.
 *
 * Orden de SELECTs en responderConIA(conn, '573104650437', 1, texto):
 *   [DML] DELETE lazy cleanup                  (no consume cola)
 *   1.  SELECT b2c_cliente                     (findClienteByPhone primaria)
 *   2.  SELECT b2c_orden                       (órdenes activas)
 *   3.  SELECT b2c_herramienta_orden + JOIN    (máquinas de la orden)
 *   4.  SELECT b2c_orden (historial entregadas)
 *   5.  SELECT b2c_wa_autorizacion_pendiente   (cotización pendiente)
 *   6.  SELECT b2c_wa_conversacion             (historial conversación ← lo que testamos)
 *   [DML] INSERT user (+ INSERT assistant si exitoIA)
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const path     = require('path');

// ── Estado compartido del mock de IA ─────────────────────────────────────────
// Los tests modifican iaMockState.shouldFail para simular fallos de Claude
// sin necesidad de reasignar el exports (que no funcionaría tras la destructuring).
const iaMockState = { shouldFail: false };

// ── Mock utils/logger ─────────────────────────────────────────────────────────
const loggerPath = path.resolve(__dirname, '../utils/logger.js');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true, children: [],
  exports: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
};

// ── Mock utils/ia.js ANTES de cargar wa-agente.js ────────────────────────────
// iaMockState es una referencia capturada en el closure de create().
// Cambiar iaMockState.shouldFail = true/false en un test cambia el
// comportamiento en la siguiente llamada aunque getClient ya esté bound.
const iaPath = path.resolve(__dirname, '../utils/ia.js');
require.cache[iaPath] = {
  id: iaPath, filename: iaPath, loaded: true, children: [],
  exports: {
    getClient: () => ({
      beta: {
        messages: {
          create: async (_params) => {
            if (iaMockState.shouldFail) {
              throw new Error('timeout simulado');
            }
            return { content: [{ text: 'Respuesta mock del agente' }] };
          },
        },
      },
    }),
    withTimeout: (promise, _ms, _label) => promise,
  },
};

// ── Cargar wa-agente.js (usará los mocks) ────────────────────────────────────
const { responderConIA } = require('../services/wa-agente');

// ── Helper: mock de conn basado en cola ───────────────────────────────────────
// Mismo patrón que smoke-wa-agente.js:
//   DML (INSERT / DELETE / UPDATE) retorna {affectedRows:1} sin consumir cola.
//   SELECT consume la siguiente entrada de la cola.
function makeConn(queue) {
  const calls = [];
  const q = queue.map(r => (Array.isArray(r) ? r : [r]));
  return {
    calls,
    execute: async (sql, params = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      const upper = normalized.toUpperCase();
      if (upper.startsWith('INSERT') || upper.startsWith('DELETE') || upper.startsWith('UPDATE')) {
        return [{ affectedRows: 1 }];
      }
      const next = q.shift() ?? [];
      return [next];
    },
  };
}

// Cola base: SELECTs 1–5 con cliente y orden disponibles, historial vacío.
// El slot 6 (historial conversación) se inyecta por cada test.
function baseQueue(historialRows = []) {
  return [
    // 1. findClienteByPhone — cliente encontrado directamente por teléfono
    [{ uid_cliente: 1, cli_razon_social: 'CLIENTE TEST', cli_contacto: null, cli_identificacion: '123' }],
    // 2. órdenes activas
    [{ uid_orden: 100, ord_consecutivo: 100, ord_fecha: '20260710' }],
    // 3. máquinas de la orden
    [{ her_nombre: 'Taladro', her_marca: 'Makita', her_estado: 'revisada', hor_observaciones: null, subtotal: null }],
    // 4. historial entregadas
    [],
    // 5. cotización pendiente
    [],
    // 6. historial conversación — inyectado por el test
    historialRows,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: La query de historial usa subquery DESC LIMIT 20 reordenada ASC
// ─────────────────────────────────────────────────────────────────────────────
test('historial: query usa subquery ORDER BY uid_mensaje DESC LIMIT 20 reordenada ASC', async () => {
  const conn = makeConn(baseQueue([]));
  await responderConIA(conn, '573104650437', 1, '¿cómo va mi herramienta?');

  const histCall = conn.calls.find(c =>
    c.sql.includes('b2c_wa_conversacion') &&
    !c.sql.toUpperCase().startsWith('DELETE') &&
    c.sql.includes('ORDER BY uid_mensaje DESC') &&
    c.sql.includes('LIMIT 20') &&
    c.sql.includes('ORDER BY t.uid_mensaje ASC')
  );

  assert.ok(histCall,
    'debe existir una query con subquery DESC LIMIT 20 y outer ORDER BY t.uid_mensaje ASC');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Una sola query SELECT a b2c_wa_conversacion
// ─────────────────────────────────────────────────────────────────────────────
test('historial: una sola query SELECT a b2c_wa_conversacion (no dos queries separadas)', async () => {
  const conn = makeConn(baseQueue([]));
  await responderConIA(conn, '573104650437', 1, 'hola');

  const selects = conn.calls.filter(c =>
    c.sql.includes('b2c_wa_conversacion') &&
    c.sql.toUpperCase().includes('SELECT') &&
    !c.sql.toUpperCase().startsWith('DELETE')
  );

  assert.strictEqual(selects.length, 1,
    'debe ser exactamente 1 query SELECT a b2c_wa_conversacion');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Regresión — de 25 mensajes disponibles, el mock devuelve los 20 más
//         recientes en orden ASC (uid 6-25).
//
//         En BD real: la subquery toma uid 25→6 (DESC LIMIT 20) y la outer
//         los reordena 6→25 (ASC). El mock devuelve directamente ese resultado.
// ─────────────────────────────────────────────────────────────────────────────
test('historial: regresión — de 25 disponibles, devuelve los 20 más recientes en ASC', async () => {
  const filas20 = Array.from({ length: 20 }, (_, i) => ({
    rol:         i % 2 === 0 ? 'user' : 'assistant',
    contenido:   `mensaje número ${i + 6}`,
    uid_mensaje: i + 6,  // uid 6 al 25 (los más recientes de 25 totales)
  }));

  const conn = makeConn(baseQueue(filas20));
  const respuesta = await responderConIA(conn, '573104650437', 1, '¿qué pasó?');

  assert.strictEqual(respuesta, 'Respuesta mock del agente',
    'debe retornar la respuesta de Claude (mock), no FALLBACK ni MSG_NO_IDENTIFICADO');

  const inserts = conn.calls.filter(c =>
    c.sql.toUpperCase().startsWith('INSERT') &&
    c.sql.includes('b2c_wa_conversacion')
  );
  assert.strictEqual(inserts.length, 2,
    'debe insertar user + assistant cuando Claude responde correctamente');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: El límite es 20 (no 10 — el valor del bug original)
// ─────────────────────────────────────────────────────────────────────────────
test('historial: el límite en la subquery es exactamente 20, no 10', async () => {
  const conn = makeConn(baseQueue([]));
  await responderConIA(conn, '573104650437', 1, 'test');

  const histCall = conn.calls.find(c =>
    c.sql.includes('b2c_wa_conversacion') &&
    !c.sql.toUpperCase().startsWith('DELETE')
  );

  assert.ok(histCall, 'debe existir query a b2c_wa_conversacion');
  assert.ok(histCall.sql.includes('LIMIT 20'), 'el límite debe ser exactamente 20');
  assert.ok(!histCall.sql.includes('LIMIT 10'), 'el límite NO debe ser 10 (bug original)');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 (P1-2 — trazabilidad): Claude falla → solo INSERT user, NO assistant
//
// Este test FALLA con el código actual porque el INSERT user está dentro de
// `if (exitoIA)`. Pasa una vez implementado P1-2.
// ─────────────────────────────────────────────────────────────────────────────
test('trazabilidad P1-2: Claude timeout → INSERT user persiste, NO assistant', async () => {
  iaMockState.shouldFail = true;
  try {
    const conn = makeConn(baseQueue([]));
    const respuesta = await responderConIA(conn, '573104650437', 1, 'hola');

    // responderConIA nunca lanza — siempre retorna FALLBACK_MSG
    assert.ok(
      typeof respuesta === 'string' && respuesta.length > 0,
      'debe retornar un string (FALLBACK_MSG) aunque Claude falle'
    );
    assert.ok(
      !respuesta.includes('Respuesta mock del agente'),
      'la respuesta NO debe ser la del mock de Claude (Claude falló)'
    );

    const inserts = conn.calls.filter(c =>
      c.sql.toUpperCase().startsWith('INSERT') &&
      c.sql.includes('b2c_wa_conversacion')
    );

    // Con P1-2 (trazabilidad): 1 INSERT (solo user).
    // Sin P1-2 (código actual): 0 INSERTs.
    assert.strictEqual(inserts.length, 1,
      'debe insertar exactamente el mensaje del usuario (trazabilidad), aunque Claude falle');

    assert.ok(inserts[0].sql.includes("'user'"),
      "el INSERT de trazabilidad debe tener rol = 'user'");

  } finally {
    iaMockState.shouldFail = false;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 (P1-2 — trazabilidad): Claude tiene éxito → INSERT user + INSERT assistant
// ─────────────────────────────────────────────────────────────────────────────
test('trazabilidad P1-2: Claude OK → INSERT user + INSERT assistant', async () => {
  const conn = makeConn(baseQueue([]));
  const respuesta = await responderConIA(conn, '573104650437', 1, 'hola');

  assert.strictEqual(respuesta, 'Respuesta mock del agente',
    'debe retornar respuesta de Claude (mock)');

  const inserts = conn.calls.filter(c =>
    c.sql.toUpperCase().startsWith('INSERT') &&
    c.sql.includes('b2c_wa_conversacion')
  );

  assert.strictEqual(inserts.length, 2,
    'debe insertar user + assistant cuando Claude responde correctamente');

  assert.ok(inserts[0].sql.includes("'user'"),    "primer INSERT debe tener rol = 'user'");
  assert.ok(inserts[1].sql.includes("'assistant'"), "segundo INSERT debe tener rol = 'assistant'");
});
