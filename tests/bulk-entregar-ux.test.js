'use strict';
/**
 * Tests de lógica UX para bulk-entregar.
 *
 * Verifica las reglas de comportamiento del modal según la respuesta
 * del backend ({ updated, skipped }), independientemente del DOM real.
 *
 * Clase de bug cerrada: cuando el backend devolvía { updated:0, skipped:2 }
 * el modal se cerraba y mostraba ✅ + "WA enviado" — todo falso.
 *
 * Reglas post-fix:
 *   updated > 0, skipped = 0 → éxito total    → cerrar modal, toast verde
 *   updated > 0, skipped > 0 → éxito parcial  → modal permanece, aviso
 *   updated = 0              → nada entregado  → modal permanece, error
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Lógica pura extraída del handler — testeable sin DOM.
// Debe mantenerse sincronizada con la implementación en dashboard.js.
function clasificarResultadoBulkEntrega({ updated, skipped }) {
  if (updated > 0 && skipped === 0) return 'exito_total';
  if (updated > 0 && skipped > 0)  return 'exito_parcial';
  return 'nada_entregado';
}

describe('clasificarResultadoBulkEntrega', () => {

  test('updated=2, skipped=0 → exito_total (cerrar modal, toast)', () => {
    assert.strictEqual(
      clasificarResultadoBulkEntrega({ updated: 2, skipped: 0 }),
      'exito_total'
    );
  });

  test('updated=1, skipped=1 → exito_parcial (modal permanece, aviso)', () => {
    assert.strictEqual(
      clasificarResultadoBulkEntrega({ updated: 1, skipped: 1 }),
      'exito_parcial'
    );
  });

  test('updated=0, skipped=2 → nada_entregado (modal permanece, error)', () => {
    assert.strictEqual(
      clasificarResultadoBulkEntrega({ updated: 0, skipped: 2 }),
      'nada_entregado'
    );
  });

  test('updated=0, skipped=0 → nada_entregado (edge case: lista vacía procesada)', () => {
    assert.strictEqual(
      clasificarResultadoBulkEntrega({ updated: 0, skipped: 0 }),
      'nada_entregado'
    );
  });

  test('nada_entregado no cierra el modal', () => {
    const resultado = clasificarResultadoBulkEntrega({ updated: 0, skipped: 2 });
    assert.notStrictEqual(resultado, 'exito_total',
      'updated:0 nunca debe cerrar el modal automáticamente');
  });

  test('exito_parcial no cierra el modal', () => {
    const resultado = clasificarResultadoBulkEntrega({ updated: 1, skipped: 1 });
    assert.notStrictEqual(resultado, 'exito_total',
      'Con omitidas el modal debe permanecer abierto para que el usuario lo confirme');
  });

  test('solo exito_total cierra el modal', () => {
    const casos = [
      { updated: 3, skipped: 0 },
      { updated: 1, skipped: 0 },
    ];
    for (const caso of casos) {
      assert.strictEqual(clasificarResultadoBulkEntrega(caso), 'exito_total');
    }
  });
});
