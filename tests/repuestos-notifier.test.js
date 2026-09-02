'use strict';
/**
 * Tests unitarios de utils/repuestos-notifier.js
 *
 * Verifica que el número del encargado se lee de b2c_tenant.ten_wa_parts_number
 * por tenant, sin fallback silencioso al número de otro tenant.
 *
 * No requieren BD real ni servidor — mock de conn.execute.
 */

const { test } = require('node:test');
const assert   = require('node:assert');

// Mock de whatsapp-client ANTES de require repuestos-notifier
// para evitar que Baileys intente conectarse.
const Module = require('module');
const _origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './whatsapp-client' || request === '../utils/whatsapp-client') {
    return { isReady: () => true, sendWAMessage: async () => {} };
  }
  if (request === './logger' || request === '../utils/logger') {
    return { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
  }
  return _origLoad.apply(this, arguments);
};

const { enviarListaRepuestos } = require('../utils/repuestos-notifier');

// Restaurar Module._load después de cargar el módulo bajo prueba
Module._load = _origLoad;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockConn({ partsNumber = null, maquinas = [], items = [] } = {}) {
  return {
    execute: async (sql) => {
      if (sql.includes('b2c_tenant'))         return [[{ ten_wa_parts_number: partsNumber }]];
      if (sql.includes('b2c_herramienta_orden')) return [maquinas];
      if (sql.includes('b2c_cotizacion_item')) return [items];
      return [[]];
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('ten_wa_parts_number NULL → sent:false, reason incluye "no configurado"', async () => {
  const conn = makeMockConn({ partsNumber: null });
  const result = await enviarListaRepuestos(conn, 2, 9999, 'ORD-TEST');
  assert.strictEqual(result.sent, false);
  assert.ok(result.reason.toLowerCase().includes('no configurado'), `reason inesperado: ${result.reason}`);
});

test('ten_wa_parts_number vacío → sent:false (sin fallback a env PARTS_WHATSAPP_NUMBER)', async () => {
  // Aunque process.env tuviera un número, el resultado sigue siendo sent:false
  const original = process.env.PARTS_WHATSAPP_NUMBER;
  process.env.PARTS_WHATSAPP_NUMBER = '3104650437';
  try {
    const conn = makeMockConn({ partsNumber: '' });
    const result = await enviarListaRepuestos(conn, 2, 9999, 'ORD-TEST');
    assert.strictEqual(result.sent, false, 'No debe hacer fallback al env cuando ten_wa_parts_number está vacío');
  } finally {
    if (original === undefined) delete process.env.PARTS_WHATSAPP_NUMBER;
    else process.env.PARTS_WHATSAPP_NUMBER = original;
  }
});

test('ten_wa_parts_number configurado pero sin máquinas autorizadas → sent:false', async () => {
  const conn = makeMockConn({ partsNumber: '3104650437', maquinas: [] });
  const result = await enviarListaRepuestos(conn, 1, 9999, 'ORD-001');
  assert.strictEqual(result.sent, false);
  assert.ok(result.reason.toLowerCase().includes('autorizada'));
});

test('ten_wa_parts_number configurado + máquinas autorizadas → sent:true', async () => {
  let waTarget = null;
  // Mock con sendWAMessage registrando el número destino
  const origLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === './whatsapp-client' || request === '../utils/whatsapp-client') {
      return {
        isReady: () => true,
        sendWAMessage: async (tid, jid) => { waTarget = jid; },
      };
    }
    return origLoad.apply(this, arguments);
  };

  // Re-require para aplicar el mock actualizado
  delete require.cache[require.resolve('../utils/repuestos-notifier')];
  const { enviarListaRepuestos: fn } = require('../utils/repuestos-notifier');
  Module._load = origLoad;

  const conn = makeMockConn({
    partsNumber: '3104650437',
    maquinas: [{ uid_herramienta_orden: 1, her_nombre: 'Taladro', her_marca: 'Bosch', her_serial: 'S001' }],
    items:    [{ nombre: 'Carbón', cantidad: 2 }],
  });
  const result = await fn(conn, 1, 9999, 'ORD-001');

  assert.strictEqual(result.sent, true);
  assert.strictEqual(result.maquinas, 1);
  // El JID destino debe contener el número del tenant, no un número hardcodeado
  assert.ok(waTarget?.includes('3104650437'), `JID destino inesperado: ${waTarget}`);

  // Limpiar cache para no afectar otros tests
  delete require.cache[require.resolve('../utils/repuestos-notifier')];
});
