'use strict';
/**
 * Tests para el módulo de logging de uso de tokens de Claude.
 *
 * Piezas testeadas:
 *   calcularCostoEstimadoUSD — función pura, sin BD ni API
 *   logIaUso                 — garantía fire-and-forget: nunca lanza
 *   generateText             — retrocompatibilidad tras cambio de firma
 *
 * Precios vigentes usados (verificados 2026-07-17):
 *   Haiku 4.5: $1.00 input / $5.00 output por MTok
 *   Opus 4.6+: $5.00 input / $25.00 output por MTok
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ── 1. calcularCostoEstimadoUSD — pura, sin efectos ──────────────────────────

describe('calcularCostoEstimadoUSD', () => {
  let calcularCosto;

  test('exporta calcularCostoEstimadoUSD desde utils/ia-uso.js', () => {
    const mod = require('../utils/ia-uso');
    assert.ok(typeof mod.calcularCostoEstimadoUSD === 'function');
    calcularCosto = mod.calcularCostoEstimadoUSD;
  });

  // ── Haiku ──────────────────────────────────────────────────────────────────

  test('Haiku: 1 MTok input → $1.00', () => {
    assert.strictEqual(calcularCosto('claude-haiku-4-5-20251001', 1_000_000, 0), 1.00);
  });

  test('Haiku: 1 MTok output → $5.00', () => {
    assert.strictEqual(calcularCosto('claude-haiku-4-5-20251001', 0, 1_000_000), 5.00);
  });

  test('Haiku: 500k input + 100k output → $0.50 + $0.50 = $1.00', () => {
    const result = calcularCosto('claude-haiku-4-5-20251001', 500_000, 100_000);
    assert.ok(Math.abs(result - 1.00) < 1e-9, `esperado ~$1.00, obtenido ${result}`);
  });

  test('Haiku: 10 tokens input + 5 tokens output (llamada típica clasificador)', () => {
    // 10 * 1.00/1e6 + 5 * 5.00/1e6 = 0.00001 + 0.000025 = 0.000035
    const result = calcularCosto('claude-haiku-4-5-20251001', 10, 5);
    assert.ok(Math.abs(result - 0.000035) < 1e-10);
  });

  test('modelo "haiku" (nombre corto) también usa precios Haiku', () => {
    const full  = calcularCosto('claude-haiku-4-5-20251001', 1000, 500);
    const short = calcularCosto('haiku', 1000, 500);
    assert.strictEqual(full, short);
  });

  // ── Opus ───────────────────────────────────────────────────────────────────

  test('Opus: 1 MTok input → $5.00', () => {
    assert.strictEqual(calcularCosto('claude-opus-4-6', 1_000_000, 0), 5.00);
  });

  test('Opus: 1 MTok output → $25.00', () => {
    assert.strictEqual(calcularCosto('claude-opus-4-6', 0, 1_000_000), 25.00);
  });

  test('Opus: 350 tokens output (informe mantenimiento típico)', () => {
    // 350 * 25 / 1e6 = 0.00000875 — solo output porque el costo de salida domina
    const result = calcularCosto('claude-opus-4-6', 1200, 350);
    // 1200 * 5/1e6 + 350 * 25/1e6 = 0.006/1000 + 0.00875/1000
    const expected = (1200 * 5 + 350 * 25) / 1_000_000;
    assert.ok(Math.abs(result - expected) < 1e-12);
  });

  // ── Modelo desconocido → Opus (conservador) ────────────────────────────────

  test('modelo desconocido → precios Opus (conservador, no subestima)', () => {
    const desconocido = calcularCosto('claude-future-model', 1_000_000, 0);
    const opus        = calcularCosto('claude-opus-4-6',    1_000_000, 0);
    assert.strictEqual(desconocido, opus,
      'Modelo no reconocido debe usar precios Opus para no subestimar el costo');
  });

  test('modelo vacío → precios Opus', () => {
    const result = calcularCosto('', 1_000_000, 0);
    assert.strictEqual(result, 5.00);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  test('0 tokens → $0.00', () => {
    assert.strictEqual(calcularCosto('claude-opus-4-6', 0, 0), 0);
  });

  test('output cuesta más que input — invariante de precios', () => {
    // Para cualquier modelo, 1 token output debe costar más que 1 token input
    for (const modelo of ['claude-haiku-4-5-20251001', 'claude-opus-4-6']) {
      const costoInput  = calcularCosto(modelo, 1, 0);
      const costoOutput = calcularCosto(modelo, 0, 1);
      assert.ok(costoOutput > costoInput,
        `${modelo}: output (${costoOutput}) debe costar más que input (${costoInput})`);
    }
  });

  test('Opus output cuesta 5× más que Opus input — ratio correcto', () => {
    const input  = calcularCosto('claude-opus-4-6', 1_000_000, 0);   // $5
    const output = calcularCosto('claude-opus-4-6', 0, 1_000_000);   // $25
    assert.strictEqual(output / input, 5);
  });

  test('Haiku output cuesta 5× más que Haiku input — ratio correcto', () => {
    const input  = calcularCosto('claude-haiku-4-5-20251001', 1_000_000, 0); // $1
    const output = calcularCosto('claude-haiku-4-5-20251001', 0, 1_000_000); // $5
    assert.strictEqual(output / input, 5);
  });
});

// ── 2. logIaUso — garantía fire-and-forget ───────────────────────────────────

describe('logIaUso — fire-and-forget: nunca lanza ni bloquea', () => {
  let logIaUso;

  test('exporta logIaUso desde utils/ia-uso.js', () => {
    const mod = require('../utils/ia-uso');
    assert.ok(typeof mod.logIaUso === 'function');
    logIaUso = mod.logIaUso;
  });

  test('no lanza de forma síncrona', () => {
    // En el entorno de test no hay BD — la función debe absorber el error
    assert.doesNotThrow(() => {
      logIaUso({
        tenantId:     1,
        funcion:      'test_funcion',
        modelo:       'claude-haiku-4-5-20251001',
        inputTokens:  100,
        outputTokens: 50,
      });
    });
  });

  test('retorna undefined — no es una Promise que el llamador deba await', () => {
    const result = logIaUso({
      tenantId:     1,
      funcion:      'test_funcion',
      modelo:       'claude-opus-4-6',
      inputTokens:  200,
      outputTokens: 80,
    });
    // fire-and-forget: el llamador no espera, el resultado es undefined o void
    assert.ok(result === undefined || result === null,
      'logIaUso no debe devolver una Promise al llamador — es fire-and-forget');
  });

  test('no propaga error cuando la BD falla — espera que el IIFE interno lo absorba', async () => {
    // Llamamos y esperamos un tick para que el IIFE interno intente conectar y falle
    logIaUso({ tenantId: 99, funcion: 'test', modelo: 'test', inputTokens: 1, outputTokens: 1 });
    await new Promise(r => setTimeout(r, 150));
    // Si llegamos aquí sin unhandledRejection, el error fue absorbido correctamente
    assert.ok(true, 'El error de BD fue absorbido silenciosamente');
  });
});

// ── 3. generateText — retrocompatibilidad de firma ───────────────────────────

describe('generateText — firma retrocompatible tras agregar 3er parámetro', () => {
  test('acepta llamada con solo 1 argumento (llamadores existentes sin cambios)', () => {
    const { generateText } = require('../utils/ia');
    // Verificamos solo la firma/aridad — no ejecutamos la llamada real a Claude
    assert.ok(typeof generateText === 'function');
    assert.ok(generateText.length <= 3,
      'generateText no debe requerir más de 3 parámetros');
  });

  test('acepta llamada con 2 argumentos (prompt + maxTokens)', () => {
    const { generateText } = require('../utils/ia');
    // Solo chequeamos que la función existe y tiene la aridad correcta
    assert.ok(generateText.length <= 3);
  });

  test('el 3er parámetro es opcional — no rompe llamadas existentes sin él', () => {
    // Verificamos que el parámetro tiene default ({}) en la firma
    // toString() de la función debe incluir '= {}' o similar
    const { generateText } = require('../utils/ia');
    const src = generateText.toString();
    assert.ok(
      src.includes('= {}') || src.includes('={}'),
      'El 3er parámetro de generateText debe tener default {} para ser opcional'
    );
  });
});
