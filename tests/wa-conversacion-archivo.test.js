'use strict';
/**
 * tests/wa-conversacion-archivo.test.js
 *
 * Tests para el archivado de b2c_wa_conversacion (>90 días) y la eliminación
 * del lazy DELETE de 24h en responderConIA.
 *
 * Los tests de _doArchivar usan conn simulado (sin BD real).
 * El test de lazy DELETE lee el código fuente directamente.
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const { _doArchivar } = require('../utils/migrations');

// ── Mock de conn para tests de archivado ─────────────────────────────────────
function makeArchiveConn({ insertFails = false } = {}) {
  const calls = [];
  let committed  = false;
  let rolledBack = false;
  return {
    calls,
    isCommitted:  () => committed,
    isRolledBack: () => rolledBack,
    async beginTransaction() {},
    async commit()   { committed   = true; },
    async rollback() { rolledBack  = true; },
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (insertFails && normalized.toUpperCase().startsWith('INSERT')) {
        throw new Error('Simulated INSERT failure');
      }
      // DELETE retorna 3 filas afectadas para verificar el log de éxito
      return [{ affectedRows: normalized.toUpperCase().startsWith('DELETE') ? 3 : 0 }];
    },
  };
}

// ── Tests de _doArchivar ──────────────────────────────────────────────────────

test('archivado: emite INSERT IGNORE con SELECT desde b2c_wa_conversacion', async () => {
  const conn = makeArchiveConn();
  await _doArchivar(conn);
  const ins = conn.calls.find(c => c.sql.toUpperCase().startsWith('INSERT IGNORE'));
  assert.ok(ins, 'debe existir un INSERT IGNORE');
  assert.ok(ins.sql.includes('b2c_wa_conversacion_archivo'), 'destino debe ser la tabla de archivo');
  assert.ok(ins.sql.includes('b2c_wa_conversacion'), 'fuente debe ser la tabla activa');
  assert.ok(ins.sql.includes('90 DAY'), 'filtro debe usar INTERVAL 90 DAY');
});

test('archivado: emite DELETE con el mismo filtro INTERVAL 90 DAY', async () => {
  const conn = makeArchiveConn();
  await _doArchivar(conn);
  const del = conn.calls.find(c => c.sql.toUpperCase().startsWith('DELETE'));
  assert.ok(del, 'debe existir un DELETE');
  assert.ok(del.sql.includes('b2c_wa_conversacion'), 'DELETE debe ser sobre la tabla activa');
  assert.ok(!del.sql.includes('b2c_wa_conversacion_archivo'), 'DELETE NO debe tocar el archivo');
  assert.ok(del.sql.includes('90 DAY'), 'DELETE debe usar el mismo INTERVAL 90 DAY');
});

test('archivado: INSERT va antes que DELETE (archiva antes de borrar)', async () => {
  const conn = makeArchiveConn();
  await _doArchivar(conn);
  const insertIdx = conn.calls.findIndex(c => c.sql.toUpperCase().startsWith('INSERT IGNORE'));
  const deleteIdx = conn.calls.findIndex(c => c.sql.toUpperCase().startsWith('DELETE'));
  assert.ok(insertIdx !== -1 && deleteIdx !== -1, 'deben existir ambas operaciones');
  assert.ok(insertIdx < deleteIdx, 'INSERT debe ejecutarse antes que DELETE');
});

test('archivado: commit al final si no hay error', async () => {
  const conn = makeArchiveConn();
  await _doArchivar(conn);
  assert.ok(conn.isCommitted(), 'debe hacer commit si todo va bien');
  assert.ok(!conn.isRolledBack(), 'NO debe hacer rollback si no hubo error');
});

test('archivado: rollback y re-lanza si INSERT falla', async () => {
  const conn = makeArchiveConn({ insertFails: true });
  await assert.rejects(
    () => _doArchivar(conn),
    /Simulated INSERT failure/,
    'debe re-lanzar el error del INSERT'
  );
  assert.ok(conn.isRolledBack(), 'debe hacer rollback si INSERT falla');
  assert.ok(!conn.isCommitted(), 'NO debe commitear si hubo error');
});

// ── Test de eliminación del lazy DELETE ───────────────────────────────────────

test('lazy DELETE eliminado: wa-agente.js no contiene DELETE con INTERVAL 24 HOUR', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../services/wa-agente.js'), 'utf8'
  );
  // El lazy DELETE que se eliminó era:
  //   DELETE FROM b2c_wa_conversacion ... INTERVAL 24 HOUR
  // Si vuelve a aparecer, este test falla inmediatamente.
  const hasLazyDelete = source.includes('INTERVAL 24 HOUR') ||
                        source.includes("INTERVAL '24'");
  assert.ok(
    !hasLazyDelete,
    'wa-agente.js no debe contener DELETE con INTERVAL 24 HOUR — fue reemplazado por archivado al arrancar'
  );
});
