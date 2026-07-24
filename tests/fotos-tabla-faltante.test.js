'use strict';
/**
 * tests/fotos-tabla-faltante.test.js
 *
 * Verifica los fixes del bug "tablas del sistema no existen en BD vacía de staging":
 *
 * Fix A — scripts/seed-staging.js:
 *   ensureErpSchema() debe crear b2c_foto_herramienta_orden + las 3 tablas del sistema
 *   (b2c_herramienta_status_log, b2c_wa_autorizacion_pendiente, b2c_informe_mantenimiento)
 *   y ser idempotente.
 *
 * Fix B — routes/orders.js:
 *   _loadFotosForOrden(), _loadInformesForOrden(), _loadHistorialForOrden() deben retornar []
 *   cuando sus tablas no existen (ER_NO_SUCH_TABLE) en lugar de crashear el detalle de orden.
 *
 * Tests unitarios — no requieren BD real ni servidor.
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { ensureErpSchema } = require('../scripts/seed-staging');
const { _loadFotosForOrden, _loadInformesForOrden, _loadHistorialForOrden } = require('../routes/orders');

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

// ── Fix B: _loadInformesForOrden ──────────────────────────────────────────────

test('_loadInformesForOrden: retorna [] cuando b2c_informe_mantenimiento no existe', async () => {
  const conn = makeConn(async () => { throw errCode('ER_NO_SUCH_TABLE', "Table 'staging.b2c_informe_mantenimiento' doesn't exist"); });
  const result = await _loadInformesForOrden(conn, [1, 2, 3]);
  assert.deepEqual(result, [], 'debe devolver array vacío cuando la tabla no existe');
});

test('_loadInformesForOrden: retorna las filas cuando la tabla existe', async () => {
  const informes = [
    { uid_informe: 1, uid_herramienta_orden: 10, inf_fecha: '2026-01-10 09:00:00' },
    { uid_informe: 2, uid_herramienta_orden: 11, inf_fecha: '2026-01-15 14:00:00' },
  ];
  const conn = makeConn(async () => [informes]);
  const result = await _loadInformesForOrden(conn, [10, 11]);
  assert.deepEqual(result, informes);
});

test('_loadInformesForOrden: retorna [] para lista de ids vacía sin hacer query', async () => {
  let called = false;
  const conn = makeConn(async () => { called = true; return [[]]; });
  const result = await _loadInformesForOrden(conn, []);
  assert.deepEqual(result, []);
  assert.equal(called, false, 'no debe ejecutar ninguna query cuando ids está vacío');
});

test('_loadInformesForOrden: re-lanza errores inesperados de BD', async () => {
  const conn = makeConn(async () => { throw errCode('ER_ACCESS_DENIED_ERROR', 'Access denied'); });
  await assert.rejects(
    () => _loadInformesForOrden(conn, [1]),
    { code: 'ER_ACCESS_DENIED_ERROR' },
    'debe propagar errores distintos de ER_NO_SUCH_TABLE'
  );
});

// ── Fix B: _loadHistorialForOrden ─────────────────────────────────────────────

test('_loadHistorialForOrden: retorna [] cuando b2c_herramienta_status_log no existe', async () => {
  const conn = makeConn(async () => { throw errCode('ER_NO_SUCH_TABLE', "Table 'staging.b2c_herramienta_status_log' doesn't exist"); });
  const result = await _loadHistorialForOrden(conn, [1, 2, 3]);
  assert.deepEqual(result, [], 'debe devolver array vacío cuando la tabla no existe');
});

test('_loadHistorialForOrden: retorna las filas cuando la tabla existe', async () => {
  const historial = [
    { uid_herramienta_orden: 10, estado: 'pendiente_revision', changed_at: '2026-01-10 08:00:00' },
    { uid_herramienta_orden: 10, estado: 'revisada',           changed_at: '2026-01-11 10:00:00' },
  ];
  const conn = makeConn(async () => [historial]);
  const result = await _loadHistorialForOrden(conn, [10]);
  assert.deepEqual(result, historial);
});

test('_loadHistorialForOrden: retorna [] para lista de ids vacía sin hacer query', async () => {
  let called = false;
  const conn = makeConn(async () => { called = true; return [[]]; });
  const result = await _loadHistorialForOrden(conn, []);
  assert.deepEqual(result, []);
  assert.equal(called, false, 'no debe ejecutar ninguna query cuando ids está vacío');
});

test('_loadHistorialForOrden: re-lanza errores inesperados de BD', async () => {
  const conn = makeConn(async () => { throw errCode('ER_ACCESS_DENIED_ERROR', 'Access denied'); });
  await assert.rejects(
    () => _loadHistorialForOrden(conn, [1]),
    { code: 'ER_ACCESS_DENIED_ERROR' },
    'debe propagar errores distintos de ER_NO_SUCH_TABLE'
  );
});

// ── Fix A extendido: tablas del sistema en ensureErpSchema ───────────────────

test('ensureErpSchema: incluye CREATE TABLE b2c_herramienta_status_log', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const found = sqls.some(sql => /CREATE\s+TABLE.*b2c_herramienta_status_log/si.test(sql));
  assert.ok(found, 'ensureErpSchema debe emitir un CREATE TABLE para b2c_herramienta_status_log');
});

test('ensureErpSchema: b2c_herramienta_status_log incluye tenant_id y uid_herramienta_orden', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const sql = sqls.find(s => /b2c_herramienta_status_log/i.test(s)) || '';
  assert.ok(/tenant_id/i.test(sql),             'debe incluir columna tenant_id');
  assert.ok(/uid_herramienta_orden/i.test(sql), 'debe incluir columna uid_herramienta_orden');
});

test('ensureErpSchema: incluye CREATE TABLE b2c_wa_autorizacion_pendiente', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const found = sqls.some(sql => /CREATE\s+TABLE.*b2c_wa_autorizacion_pendiente/si.test(sql));
  assert.ok(found, 'ensureErpSchema debe emitir un CREATE TABLE para b2c_wa_autorizacion_pendiente');
});

test('ensureErpSchema: incluye CREATE TABLE b2c_informe_mantenimiento', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const found = sqls.some(sql => /CREATE\s+TABLE.*b2c_informe_mantenimiento/si.test(sql));
  assert.ok(found, 'ensureErpSchema debe emitir un CREATE TABLE para b2c_informe_mantenimiento');
});

test('ensureErpSchema: b2c_informe_mantenimiento incluye UNIQUE KEY por uid_herramienta_orden', async () => {
  const sqls = [];
  const conn = makeConn(async (sql) => { sqls.push(sql); return [[], []]; });
  await ensureErpSchema(conn);
  const sql = sqls.find(s => /b2c_informe_mantenimiento/i.test(s)) || '';
  assert.ok(/UNIQUE\s+KEY/i.test(sql),          'debe incluir UNIQUE KEY (evita informes duplicados por máquina)');
  assert.ok(/uid_herramienta_orden/i.test(sql), 'la clave única debe referenciar uid_herramienta_orden');
});
