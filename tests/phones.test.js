'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseColombianPhones } = require('../utils/phones');

test('retorna [] para entrada vacía / null / undefined', () => {
  assert.deepEqual(parseColombianPhones(null), []);
  assert.deepEqual(parseColombianPhones(undefined), []);
  assert.deepEqual(parseColombianPhones(''), []);
  assert.deepEqual(parseColombianPhones('   '), []);
});

test('número móvil colombiano de 10 dígitos', () => {
  assert.deepEqual(parseColombianPhones('3104650437'), ['573104650437@c.us']);
});

test('número con prefijo 57 ya incluido (12 dígitos)', () => {
  assert.deepEqual(parseColombianPhones('573104650437'), ['573104650437@c.us']);
});

test('número fijo (7 dígitos) es descartado', () => {
  assert.deepEqual(parseColombianPhones('3256001'), []);
});

test('número que no empieza por 3 es descartado', () => {
  assert.deepEqual(parseColombianPhones('4104650437'), []);
  assert.deepEqual(parseColombianPhones('1234567890'), []);
});

test('múltiples números separados por coma', () => {
  const result = parseColombianPhones('3104650437,3209876543');
  assert.deepEqual(result.sort(), ['573104650437@c.us', '573209876543@c.us'].sort());
});

test('múltiples números separados por barra', () => {
  const result = parseColombianPhones('3104650437/3209876543');
  assert.equal(result.length, 2);
});

test('números sin separadores internos separados por guión', () => {
  // Los números deben estar juntos (sin espacios internos) para ser reconocidos
  const result = parseColombianPhones('3104650437-3209876543');
  assert.equal(result.length, 2);
  assert.ok(result.includes('573104650437@c.us'));
  assert.ok(result.includes('573209876543@c.us'));
});

test('número con espacios internos no se reconoce (fragmentado por split)', () => {
  // "310 465 0437" → ['310','465','0437'] — ningún segmento de 10 dígitos
  const result = parseColombianPhones('310 465 0437');
  assert.deepEqual(result, []);
});

test('elimina duplicados', () => {
  const result = parseColombianPhones('3104650437, 3104650437');
  assert.equal(result.length, 1);
});

test('mezcla de válidos e inválidos', () => {
  const result = parseColombianPhones('3104650437, 123, 3209876543, abc, 4104650437');
  assert.equal(result.length, 2);
  assert.ok(result.includes('573104650437@c.us'));
  assert.ok(result.includes('573209876543@c.us'));
});

test('número con separadores dentro (formato legible)', () => {
  // "310-465-0437" → segmento "310", "465", "0437" → ninguno de 10 dígitos válido
  // Comportamiento esperado: descartado (no es móvil)
  const result = parseColombianPhones('310-465-0437');
  assert.deepEqual(result, []);
});

test('retorna array (no Set)', () => {
  const result = parseColombianPhones('3104650437');
  assert.ok(Array.isArray(result));
});
