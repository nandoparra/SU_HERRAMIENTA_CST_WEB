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

const { test, after } = require('node:test');
const assert   = require('node:assert/strict');

const { hasFlag, isProduction, checkRealClients, ensureStagingDomain } = require('../scripts/seed-staging');

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

// ── ensureStagingDomain ───────────────────────────────────────────────────────

/** Mock conn que registra cada llamada a execute() para verificar SQL/params. */
function makeTrackingConn() {
  const calls = [];
  return {
    calls,
    async execute(sql, params) { calls.push({ sql, params }); },
  };
}

test('ensureStagingDomain: ejecuta UPDATE con el dominio correcto cuando se pasa dominio', async () => {
  const conn = makeTrackingConn();
  const result = await ensureStagingDomain(conn, 'staging.suherramienta.com');
  assert.equal(result, true, 'debe retornar true cuando el dominio está definido');
  assert.equal(conn.calls.length, 1, 'debe ejecutar exactamente un query');
  assert.ok(
    conn.calls[0].params.includes('staging.suherramienta.com'),
    'el dominio debe estar en los params del UPDATE'
  );
});

test('ensureStagingDomain: no ejecuta ningún query cuando domain es undefined', async () => {
  const conn = makeTrackingConn();
  const result = await ensureStagingDomain(conn, undefined);
  assert.equal(result, false, 'debe retornar false cuando domain es undefined');
  assert.equal(conn.calls.length, 0, 'no debe ejecutar ningún query');
});

test('ensureStagingDomain: no ejecuta ningún query cuando domain es string vacío', async () => {
  const conn = makeTrackingConn();
  const result = await ensureStagingDomain(conn, '');
  assert.equal(result, false, 'debe retornar false cuando domain es cadena vacía');
  assert.equal(conn.calls.length, 0, 'no debe ejecutar ningún query');
});

// ── Capa 3: IDs seed deben pasar el filtro '999%' ─────────────────────────────
//
// Este test existe para que el mismatch entre datos seed y lógica de seguridad
// nunca vuelva a colarse sin ser detectado: si alguien cambia los IDs seed a un
// prefijo que no sea '999', checkRealClients() los tratará como clientes reales
// y abortará el seed — exactamente el bug que encontramos en producción.

const { SEED_CLIENTES_IDS } = require('../scripts/seed-staging');

test('IDs seed de clientes: todos empiezan con 999 (Capa 3 los trata como safe)', () => {
  assert.ok(SEED_CLIENTES_IDS.length > 0, 'debe haber al menos un ID seed definido');
  for (const id of SEED_CLIENTES_IDS) {
    assert.ok(
      String(id).startsWith('999'),
      `ID seed '${id}' no empieza con '999' — checkRealClients() lo marcará como cliente real y abortará el seed`
    );
  }
});

test('IDs seed de clientes: ninguno coincide con identificaciones reales colombianas típicas', () => {
  // Cédulas reales: 6-10 dígitos sin prefijo 999. NITs: terminan en dígito verificador.
  // Esta verificación adicional documenta la intención: 999xxxxx es un rango reservado para pruebas.
  for (const id of SEED_CLIENTES_IDS) {
    assert.ok(
      String(id).startsWith('999'),
      `ID '${id}' no usa el prefijo de prueba 999`
    );
  }
});

after(async () => { await require('../utils/db').end(); });
