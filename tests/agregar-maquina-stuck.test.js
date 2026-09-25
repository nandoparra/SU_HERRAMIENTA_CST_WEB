'use strict';
/**
 * Tests — fix-agregar-maquina-stuck
 *
 * Cubre DOS flujos donde el modal "Agregar máquina" se queda atascado:
 *
 * 1. ord_abrirAgregarMaquina — agregar máquina a una orden YA GUARDADA
 *    Bug: solo reseteaba disabled=true, nunca textContent.
 *
 * 2. no_abrirModalMaquina — asistente de Nueva Orden (paso Máquinas)
 *    Bug: al crear una máquina nueva (modo nueva), no_toggleNuevaMaqModal
 *    oculta no_mm_selectRow + no_mm_separador. La función de cierre exitoso
 *    (no_cerrarModalMaquina) solo esconde el modal sin restaurar el DOM.
 *    Al volver a abrir: selectRow/separador siguen ocultos (desplegable
 *    desaparece) y el botón muestra "⏳ Agregando..." stale.
 *
 * Unitario — no requiere servidor ni BD.
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');

const DASHBOARD_JS = path.join(__dirname, '../public/assets/dashboard.js');

function src() {
  return fs.readFileSync(DASHBOARD_JS, 'utf8');
}

// ── ord_abrirAgregarMaquina: resetea textContent del botón ───────────────────

test('ord_abrirAgregarMaquina resetea amBtnAgregar.textContent a "Agregar a la orden"', () => {
  const code = src();

  // Localizar la función
  const fnStart = code.indexOf('window.ord_abrirAgregarMaquina');
  assert.ok(fnStart !== -1, 'No se encontró window.ord_abrirAgregarMaquina');

  // El cuerpo de la función — hasta el cierre de la siguiente función
  const fnEnd = code.indexOf('window.ord_cerrarAgregarMaquina', fnStart);
  const fnBody = code.slice(fnStart, fnEnd);

  // Debe contener textContent = 'Agregar a la orden' dentro de esa función
  assert.ok(
    fnBody.includes("textContent = 'Agregar a la orden'"),
    'ord_abrirAgregarMaquina debe resetear amBtnAgregar.textContent a "Agregar a la orden" para evitar el bug de texto stale'
  );
});

test('ord_abrirAgregarMaquina resetea amBtnAgregar.disabled = true', () => {
  const code = src();

  const fnStart = code.indexOf('window.ord_abrirAgregarMaquina');
  const fnEnd   = code.indexOf('window.ord_cerrarAgregarMaquina', fnStart);
  const fnBody  = code.slice(fnStart, fnEnd);

  assert.ok(
    fnBody.includes("'amBtnAgregar'"),
    'ord_abrirAgregarMaquina debe referenciar amBtnAgregar para resetear su estado'
  );
  assert.ok(
    fnBody.includes('.disabled = true'),
    'ord_abrirAgregarMaquina debe poner disabled = true al abrir (sin máquina seleccionada)'
  );
});

// ── ord_confirmarAgregarMaquina: re-habilita en catch ────────────────────────

test('ord_confirmarAgregarMaquina re-habilita el botón en el bloque catch', () => {
  const code = src();

  const fnStart = code.indexOf('window.ord_confirmarAgregarMaquina');
  assert.ok(fnStart !== -1, 'No se encontró window.ord_confirmarAgregarMaquina');

  const fnEnd = code.indexOf('window.ord_enviarCotWA', fnStart);
  const fnBody = code.slice(fnStart, fnEnd);

  // El catch debe re-habilitar el botón con el texto correcto
  assert.ok(
    fnBody.includes("btn.disabled = false"),
    'ord_confirmarAgregarMaquina catch debe hacer btn.disabled = false'
  );
  assert.ok(
    fnBody.includes("btn.textContent = 'Agregar a la orden'"),
    "ord_confirmarAgregarMaquina catch debe restablecer btn.textContent = 'Agregar a la orden'"
  );
});

// ── ord_toggleNuevaMaquina: habilita botón en modo nueva ─────────────────────

test('ord_toggleNuevaMaquina habilita amBtnAgregar cuando _amModoNueva=true', () => {
  const code = src();

  const fnStart = code.indexOf('window.ord_toggleNuevaMaquina');
  assert.ok(fnStart !== -1, 'No se encontró window.ord_toggleNuevaMaquina');

  const fnEnd = code.indexOf('window.am_toggleGarantia', fnStart);
  const fnBody = code.slice(fnStart, fnEnd);

  assert.ok(
    fnBody.includes("'amBtnAgregar').disabled = false"),
    'ord_toggleNuevaMaquina debe habilitar amBtnAgregar cuando se activa el modo nueva'
  );
});

// ── no_abrirModalMaquina: resetea textContent + selectRow + separador ────────

test('no_abrirModalMaquina resetea no_mm_btnAgregar.textContent a "Agregar a la orden"', () => {
  const code = src();

  const fnStart = code.indexOf('window.no_abrirModalMaquina');
  assert.ok(fnStart !== -1, 'No se encontró window.no_abrirModalMaquina');

  const fnEnd = code.indexOf('window.no_cerrarModalMaquina', fnStart);
  const fnBody = code.slice(fnStart, fnEnd);

  assert.ok(
    fnBody.includes("textContent = 'Agregar a la orden'"),
    'no_abrirModalMaquina debe resetear no_mm_btnAgregar.textContent para evitar texto stale "⏳ Agregando..."'
  );
});

test('no_abrirModalMaquina restaura no_mm_selectRow visible (display block)', () => {
  const code = src();

  const fnStart = code.indexOf('window.no_abrirModalMaquina');
  const fnEnd   = code.indexOf('window.no_cerrarModalMaquina', fnStart);
  const fnBody  = code.slice(fnStart, fnEnd);

  // no_toggleNuevaMaqModal lo pone en 'none'; la reapertura debe restaurarlo
  assert.ok(
    fnBody.includes("'no_mm_selectRow'") && fnBody.includes("'block'"),
    'no_abrirModalMaquina debe restaurar no_mm_selectRow a display:block para que el desplegable de máquinas aparezca'
  );
});

test('no_abrirModalMaquina restaura no_mm_separador visible (display block)', () => {
  const code = src();

  const fnStart = code.indexOf('window.no_abrirModalMaquina');
  const fnEnd   = code.indexOf('window.no_cerrarModalMaquina', fnStart);
  const fnBody  = code.slice(fnStart, fnEnd);

  assert.ok(
    fnBody.includes("'no_mm_separador'") && fnBody.includes("'block'"),
    'no_abrirModalMaquina debe restaurar no_mm_separador a display:block'
  );
});

test('no_confirmarAgregarMaquina re-habilita el botón en el bloque catch', () => {
  const code = src();

  const fnStart = code.indexOf('window.no_confirmarAgregarMaquina');
  assert.ok(fnStart !== -1, 'No se encontró window.no_confirmarAgregarMaquina');

  const fnEnd = code.indexOf('window.no_quitarMaquina', fnStart);
  const fnBody = code.slice(fnStart, fnEnd);

  assert.ok(
    fnBody.includes("btn.disabled = false"),
    'no_confirmarAgregarMaquina catch debe hacer btn.disabled = false'
  );
  assert.ok(
    fnBody.includes("btn.textContent = 'Agregar a la orden'"),
    "no_confirmarAgregarMaquina catch debe restablecer btn.textContent = 'Agregar a la orden'"
  );
});
