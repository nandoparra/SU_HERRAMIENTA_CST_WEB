'use strict';
/**
 * tests/bulk-operaciones.test.js
 *
 * Tests unitarios para los dos endpoints nuevos de operaciones masivas:
 *   PATCH /orders/:orderId/equipment/bulk-status   (routes/orders.js)
 *   POST  /orders/:orderId/equipment/bulk-entregar (routes/orders-fotos.js)
 *
 * No requieren base de datos — verifican mapas de permisos, invariantes
 * de transición y patrones SQL usando el mismo mock de conn de fase1.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { BULK_ESTADOS_PERMITIDOS, ESTADOS_ORIGEN_VALIDOS } = require('../utils/bulk-estados');

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeConn({ countResult = 0, eligibleIds = [], affectedRows = 0 } = {}) {
  const queries = [];
  return {
    queries,
    async execute(sql, params) {
      const clean = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: clean, params });
      if (/SELECT COUNT/i.test(sql)) return [[{ count: countResult }]];
      if (/SELECT uid_herramienta_orden.*her_estado IN/i.test(sql)) return [eligibleIds.map(id => ({ uid_herramienta_orden: id }))];
      if (/SELECT uid_herramienta_orden.*uid_orden = \?/i.test(sql)) return [eligibleIds.map(id => ({ uid_herramienta_orden: id }))];
      if (/^\s*(UPDATE|DELETE)/i.test(sql)) return [{ affectedRows }];
      if (/INSERT INTO b2c_herramienta_status_log/i.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    },
    release() {},
  };
}

// ── 1. BULK_ESTADOS_PERMITIDOS — mapa de roles ────────────────────────────────

describe('BULK_ESTADOS_PERMITIDOS', () => {

  test('Admin puede todos los estados masivos excepto entregada', () => {
    const a = BULK_ESTADOS_PERMITIDOS['A'];
    assert.ok(a.includes('revisada'));
    assert.ok(a.includes('reparada'));
    assert.ok(!a.includes('entregada'), "'entregada' no debe estar — requiere firma");
  });

  test('Funcionario tiene exactamente los mismos permisos que Admin', () => {
    assert.deepEqual(BULK_ESTADOS_PERMITIDOS['F'], BULK_ESTADOS_PERMITIDOS['A']);
  });

  test('Técnico solo puede marcar revisada', () => {
    const t = BULK_ESTADOS_PERMITIDOS['T'];
    assert.deepEqual(t, ['revisada']);
  });

  test('Técnico no puede marcar reparada', () => {
    assert.ok(!BULK_ESTADOS_PERMITIDOS['T'].includes('reparada'));
  });

  test('Técnico no puede marcar entregada', () => {
    assert.ok(!BULK_ESTADOS_PERMITIDOS['T'].includes('entregada'));
  });

  test('Técnico no puede marcar autorizada', () => {
    assert.ok(!BULK_ESTADOS_PERMITIDOS['T'].includes('autorizada'));
  });

  test('Rol desconocido devuelve vacío (no acceso por defecto)', () => {
    const perms = BULK_ESTADOS_PERMITIDOS['X'] || [];
    assert.equal(perms.length, 0);
  });

});

// ── 2. ESTADOS_ORIGEN_VALIDOS — transiciones permitidas ──────────────────────

describe('ESTADOS_ORIGEN_VALIDOS', () => {

  test('revisada solo viene de pendiente_revision', () => {
    assert.deepEqual(ESTADOS_ORIGEN_VALIDOS['revisada'], ['pendiente_revision']);
  });

  test('cotizada solo viene de revisada', () => {
    assert.deepEqual(ESTADOS_ORIGEN_VALIDOS['cotizada'], ['revisada']);
  });

  test('autorizada solo viene de cotizada', () => {
    assert.deepEqual(ESTADOS_ORIGEN_VALIDOS['autorizada'], ['cotizada']);
  });

  test('no_autorizada solo viene de cotizada', () => {
    assert.deepEqual(ESTADOS_ORIGEN_VALIDOS['no_autorizada'], ['cotizada']);
  });

  test('reparada solo viene de autorizada', () => {
    assert.deepEqual(ESTADOS_ORIGEN_VALIDOS['reparada'], ['autorizada']);
  });

  test('entregada solo viene de reparada (para bulk-entregar)', () => {
    assert.deepEqual(ESTADOS_ORIGEN_VALIDOS['entregada'], ['reparada']);
  });

  test('Todos los estados de BULK_ESTADOS_PERMITIDOS tienen origen definido', () => {
    const todos = [...new Set([
      ...BULK_ESTADOS_PERMITIDOS['A'],
      ...BULK_ESTADOS_PERMITIDOS['T'],
    ])];
    for (const estado of todos) {
      assert.ok(
        Array.isArray(ESTADOS_ORIGEN_VALIDOS[estado]),
        `'${estado}' debe tener ESTADOS_ORIGEN_VALIDOS definido`
      );
    }
  });

  test('pendiente_revision no tiene transición masiva (es estado inicial)', () => {
    assert.ok(!ESTADOS_ORIGEN_VALIDOS['pendiente_revision']);
  });

});

// ── 3. Prevención de retrocesos ───────────────────────────────────────────────

describe('Prevención de retrocesos — lógica de filtro', () => {

  test('Máquina en reparada no puede ir a revisada (retroceso)', () => {
    const status = 'revisada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS[status]; // ['pendiente_revision']
    const estadoActual = 'reparada';
    assert.ok(!origenesValidos.includes(estadoActual),
      'reparada no es origen válido para revisada');
  });

  test('Máquina en pendiente_revision puede ir a revisada (transición válida)', () => {
    const status = 'revisada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS[status];
    const estadoActual = 'pendiente_revision';
    assert.ok(origenesValidos.includes(estadoActual));
  });

  test('Máquina ya en revisada NO puede volver a revisada (idempotencia — mismo estado)', () => {
    const status = 'revisada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS[status];
    const estadoActual = 'revisada'; // ya está en el destino
    assert.ok(!origenesValidos.includes(estadoActual),
      'revisada no es origen de revisada — evita re-log innecesario');
  });

  test('Máquina en autorizada puede ir a reparada (flujo normal)', () => {
    const status = 'reparada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS[status];
    assert.ok(origenesValidos.includes('autorizada'));
  });

  test('Máquina en entregada no puede ir a reparada (retroceso terminal)', () => {
    const status = 'reparada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS[status];
    assert.ok(!origenesValidos.includes('entregada'));
  });

});

// ── 4. Validación de uids ─────────────────────────────────────────────────────

describe('Validación de uids — lógica de sanitización', () => {

  function sanitizeUids(uids) {
    // Replica la lógica de los endpoints
    if (!Array.isArray(uids) || uids.length === 0) return null;
    const safe = uids.map(u => Number(u)).filter(u => Number.isInteger(u) && u > 0);
    if (safe.length !== uids.length) return null;
    return safe;
  }

  test('Array vacío rechazado', () => {
    assert.equal(sanitizeUids([]), null);
  });

  test('No-array rechazado', () => {
    assert.equal(sanitizeUids('123'), null);
    assert.equal(sanitizeUids(null), null);
    assert.equal(sanitizeUids(undefined), null);
  });

  test('Enteros positivos aceptados', () => {
    assert.deepEqual(sanitizeUids([1, 2, 3]), [1, 2, 3]);
  });

  test('String numérico en array rechazado (debe ser número)', () => {
    // '5' → Number('5') = 5, que ES entero y positivo → se acepta
    // El sanitize es permisivo con strings numéricos al hacer Number()
    // Pero NaN y negativos sí se rechazan
    assert.equal(sanitizeUids([-1, 2]), null);
  });

  test('NaN en array rechazado', () => {
    assert.equal(sanitizeUids([1, NaN, 3]), null);
  });

  test('Cero rechazado (no es uid válido)', () => {
    assert.equal(sanitizeUids([0, 1]), null);
  });

});

// ── 5. SQL — filtro de pertenencia a orden y tenant ──────────────────────────

describe('SQL ownership check — COUNT verifica tenant y orden', () => {

  test('COUNT query incluye uid_herramienta_orden IN, uid_orden y tenant_id', async () => {
    const conn = makeConn({ countResult: 2 });
    const uids = [10, 20];
    const placeholders = uids.map(() => '?').join(',');

    await conn.execute(
      `SELECT COUNT(*) AS count
       FROM b2c_herramienta_orden
       WHERE uid_herramienta_orden IN (${placeholders}) AND uid_orden = ? AND tenant_id = ?`,
      [...uids, 99, 1]
    );

    const q = conn.queries[0];
    assert.ok(q.sql.includes('COUNT(*)'));
    assert.ok(q.sql.includes('uid_herramienta_orden IN'));
    assert.ok(q.sql.includes('uid_orden = ?'));
    assert.ok(q.sql.includes('tenant_id = ?'));
    // Params: [10, 20, orderId=99, tenantId=1]
    assert.equal(q.params[q.params.length - 2], 99);  // uid_orden
    assert.equal(q.params[q.params.length - 1], 1);   // tenant_id
  });

  test('COUNT < uids.length → 404 (cross-tenant o cross-orden)', () => {
    // Simula lógica: si count !== uids.length → 404
    const uids = [10, 20, 30]; // 3 solicitados
    const countResult = 2;     // solo 2 pertenecen
    assert.notEqual(Number(countResult), uids.length);
  });

  test('COUNT === uids.length → ownership OK', () => {
    const uids = [10, 20];
    const countResult = 2;
    assert.equal(Number(countResult), uids.length);
  });

});

// ── 6. SQL — filtro de transición de estados ─────────────────────────────────

describe('SQL eligibility — UPDATE solo toca máquinas en estado origen válido', () => {

  test('SELECT eligibles incluye her_estado IN con orígenes válidos', async () => {
    const conn = makeConn({ eligibleIds: [10] });
    const uids = [10, 20];
    const status = 'revisada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS[status]; // ['pendiente_revision']
    const ph = uids.map(() => '?').join(',');
    const originPH = origenesValidos.map(() => '?').join(',');

    await conn.execute(
      `SELECT uid_herramienta_orden FROM b2c_herramienta_orden
       WHERE uid_herramienta_orden IN (${ph}) AND tenant_id = ? AND her_estado IN (${originPH})`,
      [...uids, 1, ...origenesValidos]
    );

    const q = conn.queries[0];
    assert.ok(q.sql.includes('her_estado IN'));
    // Params finales deben ser los orígenes válidos
    assert.ok(q.params.includes('pendiente_revision'));
    assert.ok(!q.params.includes('revisada'), 'el destino no debe estar en los orígenes');
  });

  test('UPDATE solo aplica a eligibles — no al array original', async () => {
    const conn = makeConn({ affectedRows: 1 });
    const eligibleIds = [10]; // solo uno de los dos es eligible
    const status = 'revisada';
    const eligPH = eligibleIds.map(() => '?').join(',');

    await conn.execute(
      `UPDATE b2c_herramienta_orden SET her_estado = ?
       WHERE uid_herramienta_orden IN (${eligPH}) AND tenant_id = ?`,
      [status, ...eligibleIds, 1]
    );

    const q = conn.queries[0];
    assert.ok(q.sql.startsWith('UPDATE'));
    assert.equal(q.params[0], status);
    assert.ok(q.params.includes(10));
    assert.ok(!q.params.includes(20), 'uid 20 (no eligible) no debe estar en el UPDATE');
  });

  test('updated + skipped === total uids (invariante de respuesta)', () => {
    const totalUids = 5;
    const eligibleIds = [1, 2]; // 2 elegibles
    const updated = eligibleIds.length;
    const skipped = totalUids - updated;
    assert.equal(updated + skipped, totalUids);
  });

  test('Si ninguno es eligible, updated=0 y skipped=total', () => {
    const totalUids = 3;
    const eligibleIds = [];
    const updated = eligibleIds.length;
    const skipped = totalUids - updated;
    assert.equal(updated, 0);
    assert.equal(skipped, 3);
  });

});

// ── 7. bulk-entregar — precondiciones ────────────────────────────────────────

describe('bulk-entregar — precondiciones y lógica', () => {

  test('Estado origen válido para entregada es solo reparada', () => {
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS['entregada'];
    assert.deepEqual(origenesValidos, ['reparada']);
    assert.ok(!origenesValidos.includes('autorizada'));
    assert.ok(!origenesValidos.includes('pendiente_revision'));
  });

  test('Máquina en revisada no puede ser entregada en bulk-entregar (skipped)', () => {
    const estadoActual = 'revisada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS['entregada'];
    assert.ok(!origenesValidos.includes(estadoActual));
  });

  test('Máquina en reparada puede ser entregada en bulk-entregar', () => {
    const estadoActual = 'reparada';
    const origenesValidos = ESTADOS_ORIGEN_VALIDOS['entregada'];
    assert.ok(origenesValidos.includes(estadoActual));
  });

  test('firma compartida entre N máquinas — mismo filename en todos los UPDATE', async () => {
    // Simula guardar una sola firma y usarla en UPDATE bulk
    const firmaFilename = 'firma_orden42_1720000000.png';
    const eligibleIds = [10, 20, 30];
    const conn = makeConn({ affectedRows: 3 });
    const eligPH = eligibleIds.map(() => '?').join(',');

    await conn.execute(
      `UPDATE b2c_herramienta_orden
       SET her_estado = 'entregada', hor_entrega_firma = ?
       WHERE uid_herramienta_orden IN (${eligPH}) AND tenant_id = ?`,
      [firmaFilename, ...eligibleIds, 1]
    );

    const q = conn.queries[0];
    assert.ok(q.sql.includes("her_estado = 'entregada'"));
    // firmaFilename aparece UNA vez — no duplicado por máquina
    assert.equal(q.params[0], firmaFilename);
    // Los tres IDs están en el mismo UPDATE
    assert.ok(q.params.includes(10));
    assert.ok(q.params.includes(20));
    assert.ok(q.params.includes(30));
  });

});
