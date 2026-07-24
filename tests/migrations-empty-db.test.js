'use strict';
/**
 * tests/migrations-empty-db.test.js
 *
 * Verifica que ensureInventarioColumns (y su helper _doInventarioColumns)
 * no crasha cuando b2c_concepto_costos no existe aún en una BD vacía.
 *
 * Este bug era invisible en producción porque la tabla siempre existió
 * (importada del ERP GoDaddy). Staging reveló el crash al tener BD vacía.
 *
 * Tests unitarios — no requieren BD real. Se inyecta un mock conn.
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { _doInventarioColumns } = require('../utils/migrations');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Crea un conn mock que responde en secuencia a cada llamada a execute().
 * Si el elemento es un Error, lo lanza (simula error de BD).
 * Si es cualquier otro valor, lo retorna como resultado.
 */
function makeConn(responses) {
  let idx = 0;
  return {
    async execute(_sql) {
      const r = responses[idx++];
      if (r instanceof Error) throw r;
      return r ?? [[], []];
    },
    release: () => {},
  };
}

function errNoSuchTable(tabla) {
  const e = new Error(`Table 'test.${tabla}' doesn't exist`);
  e.code = 'ER_NO_SUCH_TABLE';
  return e;
}

function errDupFieldname(col) {
  const e = new Error(`Duplicate column name '${col}'`);
  e.code = 'ER_DUP_FIELDNAME';
  return e;
}

function errAccessDenied() {
  const e = new Error('Access denied for user');
  e.code = 'ER_ACCESS_DENIED_ERROR';
  return e;
}

// ── _doInventarioColumns ──────────────────────────────────────────────────────

test('_doInventarioColumns: no lanza cuando b2c_concepto_costos no existe (ER_NO_SUCH_TABLE)', async () => {
  // En BD vacía (staging), la tabla ERP aún no existe → ER_NO_SUCH_TABLE
  const conn = makeConn([
    errNoSuchTable('b2c_concepto_costos'),  // primer ALTER (cco_costo)
    errNoSuchTable('b2c_concepto_costos'),  // segundo ALTER (cco_stock)
  ]);
  await assert.doesNotReject(() => _doInventarioColumns(conn));
});

test('_doInventarioColumns: no lanza cuando columnas ya existen (ER_DUP_FIELDNAME)', async () => {
  // En BD existente (producción), las columnas ya fueron agregadas → idempotente
  const conn = makeConn([
    errDupFieldname('cco_costo'),
    errDupFieldname('cco_stock'),
  ]);
  await assert.doesNotReject(() => _doInventarioColumns(conn));
});

test('_doInventarioColumns: no lanza cuando la primera columna existe y la segunda no', async () => {
  // Escenario parcial: cco_costo ya existe, cco_stock se agrega por primera vez
  const conn = makeConn([
    errDupFieldname('cco_costo'),  // ya existe → skip
    [[], []],                       // cco_stock se agrega correctamente
  ]);
  await assert.doesNotReject(() => _doInventarioColumns(conn));
});

test('_doInventarioColumns: re-lanza errores inesperados de BD', async () => {
  // Un error diferente (ej. permisos) debe propagarse — no ocultarlo
  const conn = makeConn([errAccessDenied()]);
  await assert.rejects(
    () => _doInventarioColumns(conn),
    { code: 'ER_ACCESS_DENIED_ERROR' }
  );
});
