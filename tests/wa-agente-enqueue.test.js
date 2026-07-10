'use strict';
/**
 * Tests de P1-1: serialización por wa_phone con _enqueue en wa-handler.js
 *
 * _enqueue(key, asyncFn) garantiza que dos llamadas concurrentes con la misma
 * clave se ejecuten en orden (la segunda espera a que termine la primera).
 * Claves distintas corren en paralelo.
 * El Map interno se limpia al resolver cada promesa para evitar memory leaks.
 *
 * Exportado como _enqueue y _queue desde utils/wa-handler.js.
 */

const { test } = require('node:test');
const assert   = require('node:assert');

let _enqueue, _queue;
try {
  ({ _enqueue, _queue } = require('../utils/wa-handler'));
} catch (e) {
  console.error('No se pudo cargar wa-handler.js:', e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: misma clave → las funciones se ejecutan en orden (no en paralelo)
// ─────────────────────────────────────────────────────────────────────────────
test('_enqueue: misma clave — segunda fn espera que termine la primera', async () => {
  const order = [];

  await Promise.all([
    _enqueue('phone:111', async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push(1);
    }),
    _enqueue('phone:111', async () => {
      order.push(2);
    }),
  ]);

  assert.deepStrictEqual(order, [1, 2],
    'fn 1 (con delay) debe terminar antes que fn 2 aunque fn 2 se invoque en paralelo');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: claves distintas → corren en paralelo
// ─────────────────────────────────────────────────────────────────────────────
test('_enqueue: claves distintas — se ejecutan en paralelo', async () => {
  const order = [];

  await Promise.all([
    _enqueue('phone:A', async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push('A');
    }),
    _enqueue('phone:B', async () => {
      order.push('B');  // sin delay → termina primero si son paralelas
    }),
  ]);

  assert.deepStrictEqual(order, ['B', 'A'],
    'B (sin delay) debe terminar antes que A (con delay) porque corren en paralelo');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: el Map se limpia después de resolver (no hay memory leak)
// ─────────────────────────────────────────────────────────────────────────────
test('_enqueue: Map limpiado después de resolver', async () => {
  const key = 'cleanup:test:' + Date.now();
  await _enqueue(key, async () => {});
  // Dar tiempo al finally para ejecutarse
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(_queue.has(key), false,
    'el Map debe limpiar la clave cuando la promesa resuelve');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: el Map se limpia incluso si la fn lanza error
// ─────────────────────────────────────────────────────────────────────────────
test('_enqueue: Map limpiado aunque la fn falle', async () => {
  const key = 'cleanup:fail:' + Date.now();
  try {
    await _enqueue(key, async () => { throw new Error('fn falló'); });
  } catch (_) {
    // esperado — _enqueue propaga el error
  }
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(_queue.has(key), false,
    'el Map debe limpiar la clave aunque la fn falle');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: cadena de 3 fns con la misma clave → todas en orden
// ─────────────────────────────────────────────────────────────────────────────
test('_enqueue: cadena de 3 fns — orden garantizado', async () => {
  const order = [];
  await Promise.all([
    _enqueue('chain:test', async () => { await new Promise(r => setTimeout(r, 20)); order.push(1); }),
    _enqueue('chain:test', async () => { await new Promise(r => setTimeout(r, 5));  order.push(2); }),
    _enqueue('chain:test', async () => {                                              order.push(3); }),
  ]);
  assert.deepStrictEqual(order, [1, 2, 3], 'las 3 fns deben ejecutarse en orden de encolado');
});
