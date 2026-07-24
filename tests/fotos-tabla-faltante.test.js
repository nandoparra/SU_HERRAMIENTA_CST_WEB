'use strict';
/**
 * tests/fotos-tabla-faltante.test.js
 *
 * Verifica los dos fixes del bug "b2c_foto_herramienta_orden no existe en BD vacía":
 *
 * Fix A — scripts/seed-staging.js:
 *   ensureErpSchema() debe crear b2c_foto_herramienta_orden y ser idempotente.
 *
 * Fix B — routes/orders.js:
 *   _loadFotosForOrden() debe retornar [] cuando la tabla no existe (ER_NO_SUCH_TABLE)
 *   en lugar de propagar el error y crashear el endpoint GET /orders/:id/detalle.
 *
 * Tests unitarios — no requieren BD real ni servidor.
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { ensureErpSchema } = require('../scripts/seed-staging');
const { _loadFotosForOrden } = require('../routes/orders');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeConn(handler) {
  return { async execute(sql, params) { return handler(sql, params); } };
}

function errCode(code, msg = '') {
  return Object.assign(new Error(msg || code), { code });
}

// ── Fix A: ensureErpSchema ────────────────────────────────────────────────────

test('ensureErpSchema: incluye CREATE TABLE b2c_foto_herramienta_orden', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const found = sqls.some(sql => /CREATE\s+TABLE.*b2c_foto_herramienta_orden/si.test(sql));
  assert.ok(found, 'ensureErpSchema debe emitir un CREATE TABLE para b2c_foto_herramienta_orden');
});

test('ensureErpSchema: es idempotente — puede llamarse dos veces sin lanzar', async () => {
  const conn = makeConn(async () => [[], []]);
  await assert.doesNotReject(async () => {
    await ensureErpSchema(conn);
    await ensureErpSchema(conn);
  });
});

test('ensureErpSchema: incluye fho_tipo y tenant_id en la definición de b2c_foto_herramienta_orden', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const fotoSql = sqls.find(sql => /b2c_foto_herramienta_orden/i.test(sql)) || '';
  assert.ok(/fho_tipo/i.test(fotoSql),   'debe incluir columna fho_tipo');
  assert.ok(/tenant_id/i.test(fotoSql),  'debe incluir columna tenant_id');
});

// ── Fix B: _loadFotosForOrden ─────────────────────────────────────────────────

test('_loadFotosForOrden: retorna [] cuando b2c_foto_herramienta_orden no existe (ER_NO_SUCH_TABLE)', async () => {
  const conn = makeConn(async () => { throw errCode('ER_NO_SUCH_TABLE', "Table 'staging.b2c_foto_herramienta_orden' doesn't exist"); });
  const result = await _loadFotosForOrden(conn, [1, 2, 3]);
  assert.deepEqual(result, [], 'debe devolver array vacío — el detalle de orden sigue funcionando sin fotos');
});

test('_loadFotosForOrden: retorna las filas cuando la tabla existe', async () => {
  const fotos = [
    { uid_foto_herramienta_orden: 1, uid_herramienta_orden: 10, fho_archivo: 'foto1.jpg', fho_nombre: 'foto1.jpg', fho_tipo: 'recepcion' },
    { uid_foto_herramienta_orden: 2, uid_herramienta_orden: 10, fho_archivo: 'foto2.jpg', fho_nombre: 'foto2.jpg', fho_tipo: 'trabajo'   },
  ];
  const conn = makeConn(async () => [fotos]);
  const result = await _loadFotosForOrden(conn, [10]);
  assert.deepEqual(result, fotos);
});

test('_loadFotosForOrden: retorna [] para lista de ids vacía sin hacer query', async () => {
  let called = false;
  const conn = makeConn(async () => { called = true; return [[]]; });
  const result = await _loadFotosForOrden(conn, []);
  assert.deepEqual(result, []);
  assert.equal(called, false, 'no debe ejecutar ninguna query cuando ids está vacío');
});

test('_loadFotosForOrden: re-lanza errores inesperados de BD', async () => {
  const conn = makeConn(async () => { throw errCode('ER_ACCESS_DENIED_ERROR', 'Access denied'); });
  await assert.rejects(
    () => _loadFotosForOrden(conn, [1]),
    { code: 'ER_ACCESS_DENIED_ERROR' },
    'debe propagar errores distintos de ER_NO_SUCH_TABLE'
  );
});
