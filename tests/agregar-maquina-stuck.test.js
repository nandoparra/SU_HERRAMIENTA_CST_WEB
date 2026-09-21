'use strict';
/**
 * Tests — fix-agregar-maquina-stuck
 *
 * Verifica estructuralmente que ord_abrirAgregarMaquina resetea
 * tanto disabled como textContent del botón "Agregar a la orden".
 *
 * Bug: tras un envío exitoso el texto del botón quedaba en "⏳ Agregando..."
 * porque ord_abrirAgregarMaquina solo hacía disabled=true pero nunca
 * restablecía textContent. El próximo open del modal mostraba el texto stale.
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
