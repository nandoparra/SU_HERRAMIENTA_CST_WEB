'use strict';
/**
 * Tests para extractOpcion() — Capa 1 del fix de autorización WA.
 *
 * Problema que cierra:
 *   El check original era `['1','2','3','4'].includes(text)`, que exige
 *   coincidencia exacta. Un cliente que responde "1 autorizó la cotización"
 *   o "sí, la 1" no activa el flujo — el agente IA toma el mensaje, puede
 *   responder cualquier cosa, y la autorización queda sin efecto.
 *
 * Fix (Capa 1):
 *   extractOpcion(text) → '1'|'2'|'3'|'4'|null
 *   Regex: ^([1-4])(?:\s*$|[.,;:!?])
 *   El dígito debe estar al inicio y seguido de:
 *     - fin de texto (con espacios opcionales), O
 *     - puntuación inmediata (.  ,  ;  :  !  ?)
 *   Esto evita capturar "2 preguntas antes de decidir" como opción 2.
 *   Mensajes como "1 autorizó" NO caen aquí — van a Capa 2.
 *
 * Invariante clave:
 *   extractOpcion nunca devuelve null para los 4 strings exactos originales.
 *   Es un superconjunto compatible con el comportamiento anterior.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// La función se exporta desde wa-handler.js con module.exports._extractOpcion
// para permitir testearla de forma aislada.
let extractOpcion;

describe('extractOpcion — casos que SÍ deben capturarse (compatibilidad + nuevos)', () => {

  test('exporta _extractOpcion desde wa-handler.js', () => {
    const mod = require('../utils/wa-handler');
    assert.ok(typeof mod._extractOpcion === 'function',
      '_extractOpcion debe exportarse para ser testeable');
    extractOpcion = mod._extractOpcion;
  });

  test('"1" exacto → "1"', () => {
    assert.strictEqual(extractOpcion('1'), '1');
  });

  test('"2" exacto → "2"', () => {
    assert.strictEqual(extractOpcion('2'), '2');
  });

  test('"3" exacto → "3"', () => {
    assert.strictEqual(extractOpcion('3'), '3');
  });

  test('"4" exacto → "4"', () => {
    assert.strictEqual(extractOpcion('4'), '4');
  });

  test('"1 " (espacio final) → "1"  (trailing whitespace ignorado)', () => {
    assert.strictEqual(extractOpcion('1 '), '1');
  });

  test('"2\\t" (tab final) → "2"', () => {
    assert.strictEqual(extractOpcion('2\t'), '2');
  });

  test('"1." (punto inmediato) → "1"', () => {
    assert.strictEqual(extractOpcion('1.'), '1');
  });

  test('"2," (coma inmediata) → "2"', () => {
    assert.strictEqual(extractOpcion('2,'), '2');
  });

  test('"3!" (exclamación) → "3"', () => {
    assert.strictEqual(extractOpcion('3!'), '3');
  });

  test('"4;" (punto y coma) → "4"', () => {
    assert.strictEqual(extractOpcion('4;'), '4');
  });

  test('"1?" (interrogación) → "1"', () => {
    assert.strictEqual(extractOpcion('1?'), '1');
  });

  test('"1:" (dos puntos) → "1"', () => {
    assert.strictEqual(extractOpcion('1:'), '1');
  });

  // El dígito es lo único que cuenta; el texto después de la puntuación no afecta.
  test('"1, autorizo todo" (coma inmediata + texto) → "1"', () => {
    assert.strictEqual(extractOpcion('1, autorizo todo'), '1');
  });

  test('"2. no me interesa" (punto + texto) → "2"', () => {
    assert.strictEqual(extractOpcion('2. no me interesa'), '2');
  });
});

describe('extractOpcion — casos que NO deben capturarse (evitar falsos positivos)', () => {

  test('"1 autorizó la cotización" (espacio + texto) → null', () => {
    // Este es el caso que MOTIVÓ el fix — "1 autorizó" NO debe capturarse aquí.
    // Va a Capa 2 (detectarIntentAutorizacion) que lo clasificará SI_CLARO.
    assert.strictEqual(extractOpcion('1 autorizó la cotización'), null);
  });

  test('"2 preguntas antes de decidir" → null', () => {
    // El "2" es cantidad, no opción. Capa 2 lo clasificará AMBIGUA.
    assert.strictEqual(extractOpcion('2 preguntas antes de decidir'), null);
  });

  test('"1autorizó" (sin separador) → null', () => {
    assert.strictEqual(extractOpcion('1autorizó'), null);
  });

  test('"3 ok" (espacio + texto) → null', () => {
    assert.strictEqual(extractOpcion('3 ok'), null);
  });

  test('"4 asesor" (espacio + texto) → null', () => {
    assert.strictEqual(extractOpcion('4 asesor'), null);
  });

  test('"5" (dígito fuera de rango) → null', () => {
    assert.strictEqual(extractOpcion('5'), null);
  });

  test('"0" → null', () => {
    assert.strictEqual(extractOpcion('0'), null);
  });

  test('"" (vacío) → null', () => {
    assert.strictEqual(extractOpcion(''), null);
  });

  test('"sí" → null  (va a Capa 2)', () => {
    assert.strictEqual(extractOpcion('sí'), null);
  });

  test('"sí claro autorizo" → null  (va a Capa 2)', () => {
    assert.strictEqual(extractOpcion('sí claro autorizo'), null);
  });

  test('"no gracias" → null  (va a Capa 2)', () => {
    assert.strictEqual(extractOpcion('no gracias'), null);
  });

  test('"dale" → null  (va a Capa 2)', () => {
    assert.strictEqual(extractOpcion('dale'), null);
  });

  test('"autorizo todo" → null  (va a Capa 2)', () => {
    assert.strictEqual(extractOpcion('autorizo todo'), null);
  });
});

describe('extractOpcion — invariante de retrocompatibilidad', () => {
  // Los 4 strings exactos que el código original manejaba deben seguir funcionando.
  test('los 4 valores exactos originales siguen siendo capturados', () => {
    for (const v of ['1', '2', '3', '4']) {
      assert.strictEqual(extractOpcion(v), v,
        `"${v}" debe seguir siendo capturado por Capa 1`);
    }
  });

  test('extractOpcion es superconjunto de includes(): todo lo que antes pasaba, sigue pasando', () => {
    const originalSet = ['1', '2', '3', '4'];
    for (const v of originalSet) {
      const antes = originalSet.includes(v);
      const ahora = extractOpcion(v) !== null;
      assert.strictEqual(ahora, antes,
        `"${v}": antes=${antes}, ahora=${ahora} — no debe haber regresión`);
    }
  });
});
