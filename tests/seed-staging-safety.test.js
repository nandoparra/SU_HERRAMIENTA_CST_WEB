'use strict';
/**
 * tests/seed-staging-safety.test.js
 *
 * Tests unitarios para las 3 capas de seguridad de scripts/seed-staging.js.
 * No requieren BD real — se inyectan mocks de conn donde hace falta.
 *
 * Cobertura:
 *   hasFlag        — Capa 1: flag --staging-confirmed requerido
 *   isProduction   — Capa 2: NODE_ENV=production bloquea ejecución
 *   checkRealClients — Capa 3: detecta clientes reales / tabla inexistente
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { hasFlag, isProduction, checkRealClients } = require('../scripts/seed-staging');

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Mock conn para checkRealClients.
 * Si `response` es un Error, execute() lo lanza.
 * Si no, lo devuelve tal cual (debe ser [[{ cnt: N }]] para satisfacer [[row]]).
 */
function makeConn(response) {
  return {
    async execute(_sql, _params) {
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function errCode(code, msg) {
  return Object.assign(new Error(msg), { code });
}

// ── Capa 1: hasFlag ───────────────────────────────────────────────────────────

test('hasFlag: false cuando argv está vacío', () => {
  assert.equal(hasFlag([]), false);
});

test('hasFlag: false cuando hay otros flags pero no --staging-confirmed', () => {
  assert.equal(hasFlag(['--clean', '--verbose']), false);
});

test('hasFlag: true cuando --staging-confirmed está presente', () => {
  assert.equal(hasFlag(['--staging-confirmed']), true);
});

test('hasFlag: true aunque haya otros flags junto a --staging-confirmed', () => {
  assert.equal(hasFlag(['--clean', '--staging-confirmed']), true);
});

// ── Capa 2: isProduction ─────────────────────────────────────────────────────

test('isProduction: true para NODE_ENV=production', () => {
  assert.equal(isProduction({ NODE_ENV: 'production' }), true);
});

test('isProduction: false para NODE_ENV=staging', () => {
  assert.equal(isProduction({ NODE_ENV: 'staging' }), false);
});

test('isProduction: false para NODE_ENV=development', () => {
  assert.equal(isProduction({ NODE_ENV: 'development' }), false);
});

test('isProduction: false cuando NODE_ENV no está definido', () => {
  assert.equal(isProduction({}), false);
});

// ── Capa 3: checkRealClients ─────────────────────────────────────────────────

test('checkRealClients: retorna "safe" cuando la tabla existe pero está vacía (count=0)', async () => {
  const conn = makeConn([[{ cnt: 0 }]]);
  const result = await checkRealClients(conn);
  assert.equal(result, 'safe');
});

test('checkRealClients: retorna "unsafe" cuando hay clientes reales (count>0)', async () => {
  const conn = makeConn([[{ cnt: 7 }]]);
  const result = await checkRealClients(conn);
  assert.equal(result, 'unsafe');
});

test('checkRealClients: retorna "table_missing" cuando b2c_cliente no existe (BD vacía)', async () => {
  // Escenario clave: staging recién creado, tablas ERP todavía no existen
  const conn = makeConn(errCode('ER_NO_SUCH_TABLE', "Table 'staging.b2c_cliente' doesn't exist"));
  const result = await checkRealClients(conn);
  assert.equal(result, 'table_missing');
});

test('checkRealClients: re-lanza errores inesperados de BD (no los silencia)', async () => {
  const conn = makeConn(errCode('ER_ACCESS_DENIED_ERROR', 'Access denied for user'));
  await assert.rejects(
    () => checkRealClients(conn),
    { code: 'ER_ACCESS_DENIED_ERROR' }
  );
});

test('checkRealClients: "unsafe" con un solo cliente real (borde count=1)', async () => {
  const conn = makeConn([[{ cnt: 1 }]]);
  const result = await checkRealClients(conn);
  assert.equal(result, 'unsafe');
});
