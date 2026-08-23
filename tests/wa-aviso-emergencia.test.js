'use strict';
/**
 * Tests unitarios del modo "aviso de emergencia" del agente WA.
 *
 * Prueba las funciones puras exportadas desde utils/wa-handler.js:
 *   _buildAvisoMensaje(avisoText, respuesta)  — construye el mensaje combinado
 *   _shouldShowAviso(tenantConfig, rows)       — decide si hay que anteponer el aviso
 *
 * Estos tests NO requieren BD ni servidor — son 100% unitarios.
 */

const { test } = require('node:test');
const assert   = require('node:assert');

let _buildAvisoMensaje, _shouldShowAviso;
try {
  ({ _buildAvisoMensaje, _shouldShowAviso } = require('../utils/wa-handler'));
} catch (e) {
  console.error('No se pudo cargar wa-handler.js:', e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// _buildAvisoMensaje
// ─────────────────────────────────────────────────────────────────────────────

test('_buildAvisoMensaje: antepone el aviso con separador — antes de respuesta normal', () => {
  const aviso = 'Antes de continuar: el taller estuvo afectado.';
  const respuesta = 'Tu orden #101 está en reparación.';
  const resultado = _buildAvisoMensaje(aviso, respuesta);
  assert.ok(resultado.startsWith(aviso), 'Debe empezar con el aviso');
  assert.ok(resultado.includes('\n\n—\n\n'), 'Debe incluir el separador');
  assert.ok(resultado.endsWith(respuesta), 'Debe terminar con la respuesta del agente');
  assert.strictEqual(resultado, `${aviso}\n\n—\n\n${respuesta}`);
});

test('_buildAvisoMensaje: formato exacto del separador (doble salto + guión largo + doble salto)', () => {
  const resultado = _buildAvisoMensaje('AVISO', 'RESPUESTA');
  const partes = resultado.split('\n\n—\n\n');
  assert.strictEqual(partes.length, 2, 'El separador debe partir el mensaje en exactamente 2 partes');
  assert.strictEqual(partes[0], 'AVISO');
  assert.strictEqual(partes[1], 'RESPUESTA');
});

test('_buildAvisoMensaje: funciona con respuesta multilinea del agente', () => {
  const respuesta = 'Línea 1\nLínea 2\nLínea 3';
  const resultado = _buildAvisoMensaje('AVISO', respuesta);
  assert.ok(resultado.endsWith(respuesta));
});

// ─────────────────────────────────────────────────────────────────────────────
// _shouldShowAviso
// ─────────────────────────────────────────────────────────────────────────────

test('_shouldShowAviso: NULL en ten_aviso_emergencia → no mostrar (modo desactivado)', () => {
  const config = { ten_aviso_emergencia: null, ten_aviso_clave: 'terremoto_0810' };
  assert.strictEqual(_shouldShowAviso(config, []), false);
});

test('_shouldShowAviso: string vacío en ten_aviso_emergencia → no mostrar', () => {
  const config = { ten_aviso_emergencia: '', ten_aviso_clave: 'terremoto_0810' };
  assert.strictEqual(_shouldShowAviso(config, []), false);
});

test('_shouldShowAviso: NULL en ten_aviso_clave → no mostrar (aviso sin clave no se trackea)', () => {
  const config = { ten_aviso_emergencia: 'Mensaje de aviso.', ten_aviso_clave: null };
  assert.strictEqual(_shouldShowAviso(config, []), false);
});

test('_shouldShowAviso: aviso activo + clave + cliente sin fila previa → mostrar', () => {
  const config = { ten_aviso_emergencia: 'Mensaje de aviso.', ten_aviso_clave: 'terremoto_0810' };
  assert.strictEqual(_shouldShowAviso(config, []), true);
});

test('_shouldShowAviso: aviso activo + clave + cliente YA recibió el aviso (fila existe) → no repetir', () => {
  const config = { ten_aviso_emergencia: 'Mensaje de aviso.', ten_aviso_clave: 'terremoto_0810' };
  const rows = [{ uid_aviso: 1 }]; // fila existente en b2c_wa_aviso_enviado
  assert.strictEqual(_shouldShowAviso(config, rows), false);
});

test('_shouldShowAviso: clave cambiada (nuevo aviso) → volver a mostrar aunque rows tenga fila de clave anterior', () => {
  // El tracking usa (sender, clave) — si la clave cambió, la fila anterior no aplica.
  // La query en BD filtra por aviso_clave, así que rows[] llegará vacío para la nueva clave.
  // Este test verifica que con rows=[] y nueva clave se muestra correctamente.
  const config = { ten_aviso_emergencia: 'Nuevo aviso distinto.', ten_aviso_clave: 'corte_agua_0901' };
  assert.strictEqual(_shouldShowAviso(config, []), true);
});

test('_shouldShowAviso: tenantConfig undefined → no mostrar (defensivo)', () => {
  assert.strictEqual(_shouldShowAviso(undefined, []), false);
});

test('_shouldShowAviso: tenantConfig null → no mostrar (defensivo)', () => {
  assert.strictEqual(_shouldShowAviso(null, []), false);
});
