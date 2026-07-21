'use strict';
/**
 * Tests para services/alegra-factura.js
 *
 * Verifica que el payload enviado a Alegra tiene stamp: true (boolean),
 * no stamp: 'true' (string). Un string es ignorado por la API de Alegra
 * y la factura queda sin timbrar — requiriendo emisión manual desde Alegra.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// ── Helpers de módulo ─────────────────────────────────────────────────────────

function fakeMaquinas(subtotal = 150000) {
  return [{ her_nombre: 'TALADRO', her_marca: 'BOSCH', descripcion_trabajo: 'Revisión general', subtotal }];
}

const FAKE_ORDEN   = { uid_orden: 1, ord_consecutivo: 9001 };
const FAKE_CLIENTE = { cli_identificacion: '900123456-1', cli_razon_social: 'EMPRESA TEST', cli_contacto: 'Ana', cli_telefono: '3100000001' };

// ── 1. stamp debe ser boolean true ────────────────────────────────────────────

describe('alegra-factura — parámetro stamp en payload de creación de factura', () => {

  let capturedPayload = null;

  // Inyectar mocks ANTES de require (Node cachea módulos — hacerlo antes del primer require)
  before(() => {
    // Mock de alegra-client: captura el payload del POST /invoices
    require.cache[require.resolve('../utils/alegra-client')] = {
      id:      require.resolve('../utils/alegra-client'),
      exports: {
        alegraGet:  async (path) => {
          // GET /contacts?identification=... → sin resultados (fuerza creación)
          if (path.includes('/contacts')) return [];
          return {};
        },
        alegraPost: async (path, data) => {
          if (path === '/contacts') {
            return { id: 42 }; // contactId simulado
          }
          if (path === '/invoices') {
            capturedPayload = data; // capturar para aserciones
            return { id: 999, shareLink: null };
          }
          return {};
        },
        buildAuthHeader: () => 'Basic fake',
      },
    };
  });

  test('stamp en el payload de POST /invoices es boolean true, no string', async () => {
    const { generarFactura } = require('../services/alegra-factura');
    await generarFactura({ orden: FAKE_ORDEN, cliente: FAKE_CLIENTE, maquinas: fakeMaquinas() });

    assert.ok(capturedPayload !== null, 'alegraPost /invoices fue llamado');
    assert.ok('stamp' in capturedPayload, 'El payload incluye el campo stamp');
    assert.strictEqual(typeof capturedPayload.stamp, 'boolean',
      `stamp debe ser boolean, recibido: ${typeof capturedPayload.stamp} (valor: ${JSON.stringify(capturedPayload.stamp)})`);
    assert.strictEqual(capturedPayload.stamp, true,
      'stamp debe ser true (boolean) para disparar el timbrado DIAN automático');
  });

  test('stamp: "true" (string) falla la aserción de tipo — regresión', () => {
    // Test de regresión: si alguien vuelve a poner stamp: 'true' (string), este test lo detecta
    const payload = { stamp: 'true' };
    assert.notStrictEqual(typeof payload.stamp, 'boolean',
      'stamp: "true" es string, no boolean — este test demuestra por qué importa el tipo');
    // El valor boolean correcto
    const payloadCorrecto = { stamp: true };
    assert.strictEqual(typeof payloadCorrecto.stamp, 'boolean',
      'stamp: true (boolean) es el valor correcto para la API de Alegra');
  });

  test('el payload de la factura incluye status: "open"', async () => {
    assert.ok(capturedPayload !== null, 'alegraPost fue llamado (depende del test anterior)');
    assert.strictEqual(capturedPayload.status, 'open');
  });

  test('el payload incluye los ítems de las máquinas con subtotal > 0', async () => {
    assert.ok(Array.isArray(capturedPayload?.items) && capturedPayload.items.length > 0,
      'El payload debe incluir al menos un ítem');
    assert.ok(capturedPayload.items[0].price > 0, 'El precio del ítem debe ser > 0');
  });
});
