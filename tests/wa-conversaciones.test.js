'use strict';
/**
 * tests/wa-conversaciones.test.js
 *
 * Tests para las funciones puras de utils/wa-conversaciones.js:
 *   maskPhone            — enmascarar número para vista de lista
 *   makeConversacionToken — HMAC determinístico phone → token opaco
 *   resolveConversacionToken — resolver token → phone usando mock conn
 *
 * Los tests NO cubren los endpoints HTTP (requieren integración con BD real).
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  maskPhone,
  makeConversacionToken,
  resolveConversacionToken,
} = require('../utils/wa-conversaciones');

// ── maskPhone ──────────────────────────────────────────────────────────────────

test('maskPhone: teléfono de 10 dígitos → primeros 3 + **** + últimos 3', () => {
  assert.equal(maskPhone('3104650437'), '310****437');
});

test('maskPhone: prefijo 57 + 10 dígitos → lo trata como teléfono local', () => {
  assert.equal(maskPhone('573104650437'), '310****437');
});

test('maskPhone: el resultado contiene asteriscos (nunca igual al original)', () => {
  const phone  = '3104650437';
  const masked = maskPhone(phone);
  assert.ok(masked.includes('*'), 'debe contener asteriscos');
  assert.notEqual(masked, phone, 'no debe ser igual al original');
});

test('maskPhone: diferentes números producen diferentes máscaras', () => {
  assert.notEqual(maskPhone('3104650437'), maskPhone('3009876543'));
});

test('maskPhone: entrada muy corta no lanza excepción', () => {
  // Edge case defensivo — no debería ocurrir en producción
  assert.doesNotThrow(() => maskPhone('123'));
  assert.equal(typeof maskPhone('123'), 'string');
});

// ── makeConversacionToken ─────────────────────────────────────────────────────

test('makeConversacionToken: es determinístico — mismos inputs → mismo token', () => {
  const t1 = makeConversacionToken(1, '3104650437', 'my-secret');
  const t2 = makeConversacionToken(1, '3104650437', 'my-secret');
  assert.equal(t1, t2);
});

test('makeConversacionToken: diferente phone → diferente token', () => {
  const t1 = makeConversacionToken(1, '3104650437', 'secret');
  const t2 = makeConversacionToken(1, '3009876543', 'secret');
  assert.notEqual(t1, t2);
});

test('makeConversacionToken: diferente tenantId → diferente token (aislamiento tenant)', () => {
  const t1 = makeConversacionToken(1, '3104650437', 'secret');
  const t2 = makeConversacionToken(2, '3104650437', 'secret');
  assert.notEqual(t1, t2);
});

test('makeConversacionToken: diferente secret → diferente token', () => {
  const t1 = makeConversacionToken(1, '3104650437', 'secret-A');
  const t2 = makeConversacionToken(1, '3104650437', 'secret-B');
  assert.notEqual(t1, t2);
});

test('makeConversacionToken: retorna string hexadecimal de 32 caracteres', () => {
  const t = makeConversacionToken(1, '3104650437', 'secret');
  assert.match(t, /^[0-9a-f]{32}$/, 'debe ser 32 chars hex lowercase');
});

// ── resolveConversacionToken ──────────────────────────────────────────────────

function makeMockConn(phones) {
  return {
    async execute(_sql, _params) {
      // mysql2 execute() devuelve [rows, fields] — primer elem es el array de filas
      return [phones.map(p => ({ wa_phone: p }))];
    },
  };
}

test('resolveConversacionToken: encuentra el phone que corresponde al token', async () => {
  const phones = ['3104650437', '3009876543', '3157778888'];
  const conn   = makeMockConn(phones);
  const token  = makeConversacionToken(1, '3009876543', 'mysecret');

  const result = await resolveConversacionToken(token, conn, 1, 'mysecret');
  assert.equal(result, '3009876543');
});

test('resolveConversacionToken: retorna null para token desconocido', async () => {
  const conn   = makeMockConn(['3104650437', '3009876543']);
  const result = await resolveConversacionToken('token-invalido-xxx', conn, 1, 'mysecret');
  assert.equal(result, null);
});

test('resolveConversacionToken: token de tenant 2 no resuelve en tenant 1 (aislamiento)', async () => {
  // El conn devuelve el phone, pero el HMAC incluye tenantId — token de T2 no coincide en T1
  const conn       = makeMockConn(['3104650437']);
  const tokenT2    = makeConversacionToken(2, '3104650437', 'secret');
  const resultInT1 = await resolveConversacionToken(tokenT2, conn, 1, 'secret');
  assert.equal(resultInT1, null);
});
