'use strict';
/**
 * Smoke test para wa-agente.js — no requiere servidor ni DB real.
 * Mock de conn basado en cola: cada SELECT consume el siguiente response
 * en orden. INSERT/DELETE/UPDATE retornan affectedRows sin consumir cola.
 *
 * Ejecutar: node tests/smoke-wa-agente.js
 */

const { buildContextoCliente, normalizePhone } = require('../services/wa-agente');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

/**
 * Mock de conn.execute basado en cola.
 * SELECTs consumen la siguiente respuesta de la cola.
 * DML (INSERT/UPDATE/DELETE) retorna {affectedRows:1} sin consumir cola.
 * Todos los calls se registran en conn.calls para verificación.
 */
function makeConn(queue) {
  const calls = [];
  const q = queue.map(r => (Array.isArray(r) ? r : [r])); // normalizar a arrays
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
      return [next]; // conn.execute devuelve [rows, fields]
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Fallback 1b: LID mapeado a uid_cliente (sin wa_phone)
// Verifica que el cliente se encuentra directamente por uid_cliente
// cuando wa_phone es null en b2c_wa_lid_mapping.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Test 1: LID con uid_cliente en b2c_wa_lid_mapping (sin wa_phone) ===');
(async () => {
  const LID = '220052750090281';
  const UID_CLIENTE = 42;

  // Orden exacta de SELECTs en buildContextoCliente:
  // 1. findClienteByPhone — búsqueda primaria por teléfono → sin resultado
  // 2. findClienteByPhone — Fallback 1: SELECT wa_phone, uid_cliente FROM b2c_wa_lid_mapping
  // 3. findClienteByPhone — Fallback 1b: SELECT ... FROM b2c_cliente WHERE uid_cliente = ?
  // 4. SELECT órdenes activas (b2c_orden)
  // 5. SELECT máquinas orden 8414 (b2c_herramienta_orden)
  // 6. SELECT historial (b2c_orden con entregadas)
  // 7. SELECT cotización pendiente (b2c_wa_autorizacion_pendiente)
  const conn = makeConn([
    [],                                                                   // 1. phone search → sin resultado
    [{ wa_phone: null, uid_cliente: UID_CLIENTE }],                       // 2. lid_mapping → uid_cliente sin phone
    [{ uid_cliente: UID_CLIENTE, cli_razon_social: 'JUAN GABRIEL SALAZAR', cli_contacto: null, cli_identificacion: '1088274441' }], // 3. cliente por uid
    [{ uid_orden: 8414, ord_consecutivo: 8414, ord_fecha: '20260710' }], // 4. órdenes
    [{ her_nombre: 'Taladro', her_marca: 'Makita', her_estado: 'autorizada', hor_observaciones: 'Carbones desgastados', subtotal: 120000 }], // 5. máquinas
    [],                                                                   // 6. historial
    [],                                                                   // 7. cotiz pendiente
  ]);

  const contexto = await buildContextoCliente(conn, LID, 1, '');

  assert('buildContextoCliente no retorna null', contexto !== null);
  assert('Cliente es Juan Gabriel', contexto?.cliente?.nombre === 'JUAN GABRIEL SALAZAR');
  assert('Identificación correcta', contexto?.cliente?.identificacion === '1088274441');
  assert('1 orden activa', contexto?.ordenesActivas?.length === 1);
  assert('Orden #8414', contexto?.ordenesActivas?.[0]?.consecutivo === 8414);

  const maq = contexto?.ordenesActivas?.[0]?.maquinas?.[0];
  assert('Máquina Taladro Makita', maq?.her_nombre === 'Taladro' && maq?.her_marca === 'Makita');
  assert('hor_observaciones incluido', maq?.hor_observaciones === 'Carbones desgastados');
  assert('Subtotal correcto', maq?.subtotal === 120000);

  // Verificar que se consultó uid_cliente en el SELECT de b2c_wa_lid_mapping
  const lidSelect = conn.calls.find(c => c.sql.includes('b2c_wa_lid_mapping') && c.sql.startsWith('SELECT'));
  assert('SELECT de lid_mapping incluye uid_cliente', lidSelect?.sql.includes('uid_cliente'));

  // Verificar que se consultó b2c_cliente por uid_cliente (Fallback 1b)
  const clienteByUid = conn.calls.find(c =>
    c.sql.includes('b2c_cliente') && c.sql.includes('uid_cliente = ?') && c.sql.startsWith('SELECT')
  );
  assert('Fallback 1b ejecutado (SELECT b2c_cliente WHERE uid_cliente)', !!clienteByUid);
  assert('Fallback 1b usa uid_cliente=42', clienteByUid?.params?.includes(UID_CLIENTE));
})();

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Identificación por cédula guarda uid_cliente en b2c_wa_lid_mapping
// Verifica que después de identificarse por texto el mapping se persiste
// con uid_cliente (y wa_phone=null cuando cli_telefono no está disponible).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Test 2: Identificación por cédula → guarda uid_cliente en mapping ===');
(async () => {
  const LID = '220052750090281';
  const UID_CLIENTE = 42;

  // Orden de SELECTs:
  // 1. findClienteByPhone — búsqueda primaria → sin resultado
  // 2. findClienteByPhone — Fallback 1 lid_mapping → sin mapping previo
  // 3. findClienteByPhone — Fallback 2 pendiente → sin pendiente
  // 4. findClienteByTexto — busca por cédula 1088274441 → Juan Gabriel (cli_telefono: null)
  // [INSERT lid_mapping — DML, no consume cola]
  // 5. SELECT órdenes activas
  // 6. SELECT máquinas
  // 7. SELECT historial
  // 8. SELECT cotiz pendiente
  const conn = makeConn([
    [],                                                                       // 1. phone search → nada
    [],                                                                       // 2. lid_mapping → sin entrada
    [],                                                                       // 3. pendiente → nada
    [{ uid_cliente: UID_CLIENTE, cli_razon_social: 'JUAN GABRIEL SALAZAR', cli_contacto: null, cli_identificacion: '1088274441', cli_telefono: null }], // 4. por cédula
    [{ uid_orden: 8414, ord_consecutivo: 8414, ord_fecha: '20260710' }],     // 5. órdenes
    [{ her_nombre: 'Taladro', her_marca: 'Makita', her_estado: 'autorizada', hor_observaciones: 'Motor quemado', subtotal: null }], // 6. máquinas
    [],                                                                       // 7. historial
    [],                                                                       // 8. cotiz pendiente
  ]);

  const contexto = await buildContextoCliente(conn, LID, 1, 'mi cédula es 1088274441');
  await new Promise(r => setTimeout(r, 20)); // dejar ejecutar fire-and-forget

  assert('buildContextoCliente retorna contexto', contexto !== null);
  assert('Cliente identificado por cédula', contexto?.cliente?.nombre === 'JUAN GABRIEL SALAZAR');

  const insertCall = conn.calls.find(c =>
    c.sql.startsWith('INSERT') && c.sql.includes('b2c_wa_lid_mapping')
  );
  assert('INSERT a b2c_wa_lid_mapping ejecutado', !!insertCall);
  assert('INSERT incluye LID como wa_lid',       insertCall?.params?.includes(LID));
  assert('INSERT incluye uid_cliente=42',        insertCall?.params?.includes(UID_CLIENTE));
  assert('INSERT tiene wa_phone=null (cli_telefono no disponible)', insertCall?.params?.includes(null));
})();

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — hor_observaciones aparece en el contexto de órdenes
// Verifica que el campo hor_observaciones del técnico llega al contexto
// que se pasa a Claude (via formatContexto) correctamente.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Test 3: hor_observaciones en contexto para Claude ===');
(async () => {
  // Cliente con teléfono válido — identificado por búsqueda primaria
  // Orden: SELECTs en buildContextoCliente
  // 1. phone search → cliente
  // 2. órdenes
  // 3. máquinas (dos: Pulidora con obs, Sierra sin obs)
  // 4. historial
  // 5. cotiz pendiente
  const conn = makeConn([
    [{ uid_cliente: 1, cli_razon_social: 'CLIENTE TEST', cli_contacto: null, cli_identificacion: '123456789' }], // 1. phone search
    [{ uid_orden: 100, ord_consecutivo: 100, ord_fecha: '20260710' }],                                           // 2. órdenes
    [                                                                                                             // 3. máquinas
      { her_nombre: 'Pulidora', her_marca: 'Bosch',  her_estado: 'revisada',  hor_observaciones: 'Engranaje roto en caja reductora', subtotal: null },
      { her_nombre: 'Sierra',   her_marca: 'DeWalt', her_estado: 'reparada',  hor_observaciones: null,                               subtotal: 85000 },
    ],
    [],  // 4. historial
    [],  // 5. cotiz pendiente
  ]);

  const contexto = await buildContextoCliente(conn, '573104650437', 1, '');

  assert('contexto retornado', contexto !== null);
  const maquinas = contexto?.ordenesActivas?.[0]?.maquinas;
  assert('2 máquinas en la orden',             maquinas?.length === 2);
  assert('Pulidora tiene observaciones',        maquinas?.[0]?.hor_observaciones === 'Engranaje roto en caja reductora');
  assert('Sierra: observaciones null',          maquinas?.[1]?.hor_observaciones === null);
  assert('Sierra: subtotal correcto',           maquinas?.[1]?.subtotal === 85000);

  // formatContexto es función privada — verificamos via JSON del contexto
  const ctx = JSON.stringify(contexto);
  assert('Observaciones presentes en objeto contexto', ctx.includes('Engranaje roto en caja reductora'));
  assert('null no serializado como string vacío',      !ctx.includes('"hor_observaciones":""'));
})();

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — normalizePhone no confunde LIDs con teléfonos colombianos
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Test 4: normalizePhone ===');
(() => {
  assert('573XXXXXXXXXX → 10 dígitos', normalizePhone('573156151026') === '3156151026');
  assert('3XXXXXXXXXX → 10 dígitos',  normalizePhone('3156151026')   === '3156151026');
  const lidNorm = normalizePhone('220052750090281');
  assert('LID no produce móvil colombiano válido (10 dígitos que empiecen por 3)',
    !(lidNorm.length === 10 && lidNorm.startsWith('3')));
})();

// ─────────────────────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Resultado: ${passed} pasados, ${failed} fallados`);
  if (failed > 0) process.exit(1);
}, 100);
