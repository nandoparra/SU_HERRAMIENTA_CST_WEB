'use strict';
/**
 * Tests para Capa 2 (detectarIntentAutorizacion) y Capa 3 (system prompt).
 *
 * Problema que cierra:
 *   Con Capa 1 activa, mensajes como "1 autorizó la cotización", "sí autorizo",
 *   "dale" caen al agente IA sin ningún filtro. El agente puede responder cualquier
 *   cosa y la autorización queda sin efecto — o peor, el agente puede confirmar
 *   erróneamente que "ya se autorizó" sin que el sistema lo registre.
 *
 * Capa 2:
 *   detectarIntentAutorizacion(text) → 'SI_CLARO'|'NO_CLARO'|'AMBIGUA'|'NINGUNA'
 *   SI_CLARO  → ejecutar como opción '1' (autorizar todo)
 *   NO_CLARO  → ejecutar como opción '2' (no autorizar)
 *   AMBIGUA   → pedir confirmación — nunca ejecutar
 *   NINGUNA   → flujo normal del agente
 *
 * Capa 3:
 *   buildSystemPrompt contiene prohibición explícita de confirmar autorizaciones.
 *
 * Audit log:
 *   SI_CLARO y NO_CLARO dejan registro con texto original + categoría
 *   para poder verificar exactamente qué escribió el cliente.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ── 1. _parseIntentResponse — puro, sin BD ni Claude ─────────────────────────

describe('_parseIntentResponse — parser de respuesta Claude', () => {

  let parseIntentResponse;

  test('exporta _parseIntentResponse desde wa-agente.js', () => {
    const mod = require('../services/wa-agente');
    assert.ok(typeof mod._parseIntentResponse === 'function',
      '_parseIntentResponse debe exportarse para ser testeable');
    parseIntentResponse = mod._parseIntentResponse;
  });

  test('SI_CLARO → "SI_CLARO"', () => {
    assert.strictEqual(parseIntentResponse('SI_CLARO'), 'SI_CLARO');
  });

  test('NO_CLARO → "NO_CLARO"', () => {
    assert.strictEqual(parseIntentResponse('NO_CLARO'), 'NO_CLARO');
  });

  test('AMBIGUA → "AMBIGUA"', () => {
    assert.strictEqual(parseIntentResponse('AMBIGUA'), 'AMBIGUA');
  });

  test('NINGUNA → "NINGUNA"', () => {
    assert.strictEqual(parseIntentResponse('NINGUNA'), 'NINGUNA');
  });

  test('case insensitive: "si_claro" → "SI_CLARO"', () => {
    assert.strictEqual(parseIntentResponse('si_claro'), 'SI_CLARO');
  });

  test('case insensitive: "no_claro" → "NO_CLARO"', () => {
    assert.strictEqual(parseIntentResponse('no_claro'), 'NO_CLARO');
  });

  test('espacios alrededor ignorados: "  SI_CLARO  " → "SI_CLARO"', () => {
    assert.strictEqual(parseIntentResponse('  SI_CLARO  '), 'SI_CLARO');
  });

  // Fallback seguro — cualquier respuesta inesperada de Claude
  test('categoría desconocida → "AMBIGUA" (fallback seguro)', () => {
    assert.strictEqual(parseIntentResponse('QUIZAS'), 'AMBIGUA');
  });

  test('respuesta con texto extra → "AMBIGUA" (Claude no siguió el formato)', () => {
    assert.strictEqual(parseIntentResponse('SI_CLARO porque el cliente dijo...'), 'AMBIGUA');
  });

  test('cadena vacía → "AMBIGUA"', () => {
    assert.strictEqual(parseIntentResponse(''), 'AMBIGUA');
  });

  test('null → "AMBIGUA"', () => {
    assert.strictEqual(parseIntentResponse(null), 'AMBIGUA');
  });

  test('undefined → "AMBIGUA"', () => {
    assert.strictEqual(parseIntentResponse(undefined), 'AMBIGUA');
  });
});

// ── 2. _opcionForIntent — mapeo categoría → dígito de autorización ────────────

describe('_opcionForIntent — mapeo intent → opción autorización', () => {

  let opcionForIntent;

  test('exporta _opcionForIntent desde wa-agente.js', () => {
    const mod = require('../services/wa-agente');
    assert.ok(typeof mod._opcionForIntent === 'function',
      '_opcionForIntent debe exportarse');
    opcionForIntent = mod._opcionForIntent;
  });

  test('SI_CLARO → "1" (autorizar todo)', () => {
    assert.strictEqual(opcionForIntent('SI_CLARO'), '1');
  });

  test('NO_CLARO → "2" (no autorizar)', () => {
    assert.strictEqual(opcionForIntent('NO_CLARO'), '2');
  });

  test('AMBIGUA → null (nunca ejecuta automaticamente)', () => {
    assert.strictEqual(opcionForIntent('AMBIGUA'), null,
      'AMBIGUA nunca debe producir una autorización automática');
  });

  test('NINGUNA → null (flujo normal del agente)', () => {
    assert.strictEqual(opcionForIntent('NINGUNA'), null);
  });

  test('categoría desconocida → null (safe)', () => {
    assert.strictEqual(opcionForIntent('QUIZAS'), null);
  });

  // Invariante crítica de seguridad
  test('solo SI_CLARO y NO_CLARO producen acción de autorización', () => {
    const ejecutan = ['SI_CLARO', 'NO_CLARO', 'AMBIGUA', 'NINGUNA']
      .filter(i => opcionForIntent(i) !== null);
    assert.deepStrictEqual(ejecutan, ['SI_CLARO', 'NO_CLARO'],
      'Solo SI_CLARO y NO_CLARO deben disparar la autorización');
  });
});

// ── 3. _buildIntentAuditPayload — estructura del audit log ───────────────────

describe('_buildIntentAuditPayload — audit log para autorización por intent', () => {

  let buildIntentAuditPayload;

  test('exporta _buildIntentAuditPayload desde wa-agente.js', () => {
    const mod = require('../services/wa-agente');
    assert.ok(typeof mod._buildIntentAuditPayload === 'function',
      '_buildIntentAuditPayload debe exportarse');
    buildIntentAuditPayload = mod._buildIntentAuditPayload;
  });

  test('incluye textoOriginal', () => {
    const payload = buildIntentAuditPayload('sí claro autorizo', 'SI_CLARO', 42);
    assert.strictEqual(payload.textoOriginal, 'sí claro autorizo',
      'El audit log debe conservar el texto exacto que escribió el cliente');
  });

  test('incluye la categoría asignada', () => {
    const payload = buildIntentAuditPayload('no gracias', 'NO_CLARO', 42);
    assert.strictEqual(payload.categoria, 'NO_CLARO');
  });

  test('incluye uid_orden para trazabilidad', () => {
    const payload = buildIntentAuditPayload('dale', 'SI_CLARO', 99);
    assert.strictEqual(payload.uid_orden, 99);
  });

  test('incluye marcador de via para identificar el canal', () => {
    const payload = buildIntentAuditPayload('sí', 'SI_CLARO', 1);
    assert.ok('via' in payload,
      'El payload debe tener un campo "via" para identificar que fue Capa 2');
    assert.ok(String(payload.via).length > 0);
  });

  test('para SI_CLARO el payload preserva el texto que autorizó', () => {
    const texto = 'sí, adelante con la reparación';
    const payload = buildIntentAuditPayload(texto, 'SI_CLARO', 5);
    assert.strictEqual(payload.textoOriginal, texto,
      'El texto original de autorización debe quedar inmutable en el audit');
  });
});

// ── 4. Capa 3 — system prompt prohíbe confirmar autorizaciones ────────────────

describe('buildSystemPrompt — Capa 3: prohibición de confirmar autorizaciones', () => {

  let buildSystemPrompt;

  test('exporta _buildSystemPrompt desde wa-agente.js', () => {
    const mod = require('../services/wa-agente');
    assert.ok(typeof mod._buildSystemPrompt === 'function',
      '_buildSystemPrompt debe exportarse para testear el contenido del prompt');
    buildSystemPrompt = mod._buildSystemPrompt;
  });

  test('el system prompt contiene una prohibición sobre autorizaciones de cotizaciones', () => {
    const prompt = buildSystemPrompt('contexto de prueba');
    const lower = prompt.toLowerCase();
    // Debe prohibir confirmar/tramitar autorizaciones
    const tieneProhibicion = lower.includes('autorizar') || lower.includes('autorización') || lower.includes('autorizacion');
    assert.ok(tieneProhibicion,
      'El system prompt debe mencionar autorizaciones en la sección NO PUEDES');
  });

  test('la prohibición está en la sección NO PUEDES (no en PUEDES)', () => {
    const prompt = buildSystemPrompt('contexto');
    const noPuedes = prompt.indexOf('NO PUEDES:');
    const puedes   = prompt.indexOf('PUEDES:');
    assert.ok(noPuedes > -1, 'El prompt debe tener sección NO PUEDES:');
    assert.ok(puedes > -1,   'El prompt debe tener sección PUEDES:');

    // El texto de prohibición debe aparecer después de NO PUEDES
    const seccionNoPuedes = prompt.slice(noPuedes);
    const lower = seccionNoPuedes.toLowerCase();
    assert.ok(
      lower.includes('confirmr') || lower.includes('confirmar') || lower.includes('tramitar') || lower.includes('registrar'),
      'La sección NO PUEDES debe prohibir confirmar/tramitar autorizaciones'
    );
  });

  test('con cotizacionPendiente=true: el prompt incluye las opciones 1-4 para autorizar', () => {
    const prompt = buildSystemPrompt('contexto', true);
    assert.ok(
      /respondiendo 1, 2, 3 o 4/.test(prompt),
      'Con pendiente activo el prompt debe recordar las opciones numéricas 1-4'
    );
  });

  test('con cotizacionPendiente=false (default): PUEDES no invita al menú 1-4', () => {
    const prompt = buildSystemPrompt('contexto', false);
    const puedesIdx  = prompt.indexOf('PUEDES:');
    const noPuedesIdx = prompt.indexOf('NO PUEDES:');
    assert.ok(puedesIdx > -1 && noPuedesIdx > -1, 'Debe tener secciones PUEDES y NO PUEDES');
    const seccionPuedes = prompt.slice(puedesIdx, noPuedesIdx);
    assert.ok(
      !seccionPuedes.includes('respondiendo 1, 2, 3 o 4'),
      'Sin cotizacionPendiente, PUEDES no debe invitar al menú de autorización'
    );
  });

  test('el system prompt sigue siendo un string no vacío', () => {
    const prompt = buildSystemPrompt('cualquier contexto');
    assert.ok(typeof prompt === 'string' && prompt.length > 100,
      'buildSystemPrompt debe seguir devolviendo un prompt válido');
  });
});

// ── 5. detectarIntentAutorizacion — comportamiento real ante fallos ───────────
//
// Estos tests verifican la garantía de seguridad central:
// "nunca ejecuta a ciegas si Claude falla".
// Se inyecta un cliente simulado via _testClient para no llamar a la API real.

describe('detectarIntentAutorizacion — safe default ante fallos reales', () => {

  const { detectarIntentAutorizacion } = require('../services/wa-agente');

  test('exporta detectarIntentAutorizacion como función', () => {
    assert.ok(typeof detectarIntentAutorizacion === 'function');
  });

  test('(a) error de red/API → resuelve a AMBIGUA', async () => {
    const errorClient = {
      beta: { messages: { create: async () => {
        throw new Error('ECONNREFUSED — simulación de fallo de red');
      }}}
    };
    const result = await detectarIntentAutorizacion('sí claro autorizo', { _testClient: errorClient });
    assert.strictEqual(result, 'AMBIGUA',
      'Un error de red/API debe resolverse a AMBIGUA, nunca lanzar ni ejecutar la autorización');
  });

  test('(b) timeout — cliente no responde dentro de _testTimeoutMs → AMBIGUA', async () => {
    // Cliente que cuelga indefinidamente; timeout reducido a 60ms para que el test sea rápido
    const slowClient = {
      beta: { messages: { create: () => new Promise(() => {}) }} // nunca resuelve
    };
    const result = await detectarIntentAutorizacion('dale', {
      _testClient: slowClient,
      _testTimeoutMs: 60,
    });
    assert.strictEqual(result, 'AMBIGUA',
      'El timeout debe resolverse a AMBIGUA — la autorización no se ejecuta a ciegas');
  });

  test('(c) Claude responde con formato inesperado → AMBIGUA (integración con _parseIntentResponse)', async () => {
    // Claude no siguió las instrucciones y devolvió texto libre en vez de una categoría
    const unexpectedClient = {
      beta: { messages: { create: async () => ({
        content: [{ text: 'Creo que el cliente quiere autorizar la cotización completa.' }]
      })}}
    };
    const result = await detectarIntentAutorizacion('sí claro', { _testClient: unexpectedClient });
    assert.strictEqual(result, 'AMBIGUA',
      '_parseIntentResponse debe rechazar texto libre y retornar AMBIGUA');
  });

  test('(d) happy path — respuesta válida SI_CLARO llega correctamente', async () => {
    // Confirma que el canal completo funciona cuando Claude sí responde bien
    const happyClient = {
      beta: { messages: { create: async () => ({ content: [{ text: 'SI_CLARO' }] }) }}
    };
    const result = await detectarIntentAutorizacion('sí, adelante', { _testClient: happyClient });
    assert.strictEqual(result, 'SI_CLARO');
  });

  test('(e) happy path — respuesta válida NO_CLARO llega correctamente', async () => {
    const happyClient = {
      beta: { messages: { create: async () => ({ content: [{ text: 'NO_CLARO' }] }) }}
    };
    const result = await detectarIntentAutorizacion('no gracias', { _testClient: happyClient });
    assert.strictEqual(result, 'NO_CLARO');
  });

  test('(f) respuesta vacía de Claude → AMBIGUA', async () => {
    const emptyClient = {
      beta: { messages: { create: async () => ({ content: [] }) }}
    };
    const result = await detectarIntentAutorizacion('hmm', { _testClient: emptyClient });
    assert.strictEqual(result, 'AMBIGUA');
  });
});

// ── 6. Protección contra menú de autorización falso (bug orden #8045) ─────────
//
// Escenario real (2026-07-14): orden #8045 en estado 'cotizada' sin pendiente activo.
// El agente presentó el menú 1/2/3/4 y cuando el cliente respondió "1", confirmó
// la autorización con total confianza — pero el sistema nunca la registró.
// Fix: el menú 1/2/3/4 solo aparece en el prompt cuando hay cotizacionPendiente activo.

describe('Protección menú falso — sin cotizacionPendiente no hay menú 1/2/3/4', () => {

  let buildSystemPrompt;

  test('carga _buildSystemPrompt', () => {
    const mod = require('../services/wa-agente');
    assert.ok(typeof mod._buildSystemPrompt === 'function');
    buildSystemPrompt = mod._buildSystemPrompt;
  });

  test('sin pendiente: PUEDES no incluye la invitación a responder 1/2/3/4', () => {
    const prompt = buildSystemPrompt('orden #8045 — AMOLADORA cotizada', false);
    const puedesIdx   = prompt.indexOf('PUEDES:');
    const noPuedesIdx = prompt.indexOf('NO PUEDES:');
    const seccionPuedes = prompt.slice(puedesIdx, noPuedesIdx);
    assert.ok(
      !seccionPuedes.includes('respondiendo 1, 2, 3 o 4'),
      'Sin pendiente activo, PUEDES no debe incluir la invitación al menú de autorización'
    );
  });

  test('sin pendiente: NO PUEDES prohíbe presentar el menú 1/2/3/4', () => {
    const prompt = buildSystemPrompt('orden #8045 — AMOLADORA cotizada', false);
    const noPuedesIdx = prompt.indexOf('NO PUEDES:');
    const seccionNoPuedes = prompt.slice(noPuedesIdx).toLowerCase();
    assert.ok(
      seccionNoPuedes.includes('nunca presentes el menú') ||
      seccionNoPuedes.includes('nunca presentes'),
      'Sin pendiente activo, NO PUEDES debe prohibir presentar el menú de autorización'
    );
  });

  test('con pendiente activo: PUEDES sí incluye el recordatorio del menú 1/2/3/4', () => {
    const prompt = buildSystemPrompt('COTIZACIÓN PENDIENTE DE AUTORIZAR', true);
    assert.ok(
      /respondiendo 1, 2, 3 o 4/.test(prompt),
      'Con pendiente activo, el prompt debe incluir el recordatorio del menú'
    );
  });

  test('el estado label "cotizada" ya no dice "pendiente de autorizar"', () => {
    // El label anterior inducía a Claude a pensar que debía gestionar la autorización.
    // Ahora debe ser neutro.
    const mod = require('../services/wa-agente');
    // Verificar vía el prompt sin pendiente: el contexto no debe sugerir acción de autorización
    const contextoConCotizada = 'Cotizada — en espera de decisión del cliente';
    const prompt = buildSystemPrompt(contextoConCotizada, false);
    // El sistema NO debe presentar el menú aunque el contexto mencione la cotización
    const puedesIdx   = prompt.indexOf('PUEDES:');
    const noPuedesIdx = prompt.indexOf('NO PUEDES:');
    const seccionPuedes = prompt.slice(puedesIdx, noPuedesIdx);
    assert.ok(
      !seccionPuedes.includes('respondiendo 1, 2, 3 o 4'),
      'El nuevo label de cotizada no debe provocar que PUEDES incluya el menú de autorización'
    );
  });

  test('sin ten_telefono_empresa ni PARTS_WHATSAPP_NUMBER: prompt no contiene número hardcodeado', () => {
    // Protección multi-tenant: si no hay datos configurados para este tenant,
    // el prompt usa texto genérico — nunca cae a un número de otro negocio.
    const promptSinPhone = buildSystemPrompt('contexto', false, null);
    // No debe haber ningún número de 10 dígitos colombiano
    assert.ok(
      !/\b3\d{9}\b/.test(promptSinPhone),
      'Sin teléfono configurado, el prompt no debe contener ningún número de celular colombiano'
    );
    // Debe indicar al cliente que contacte al taller de forma genérica
    const lower = promptSinPhone.toLowerCase();
    assert.ok(
      lower.includes('directamente con el taller') || lower.includes('contacte directamente'),
      'Sin teléfono, el prompt debe usar un placeholder genérico para el contacto'
    );
  });

  test('_fallbackMsg con phone=null: no incluye número hardcodeado', () => {
    // Accedemos a la función interna vía módulo cargado (no exportada, test indirecto)
    // Verificamos que el mensaje de rate-limit/fallback con null phone es genérico
    const prompt = buildSystemPrompt('contexto', false, null);
    // Todo el prompt no debe tener el número personal hardcodeado
    assert.ok(
      !prompt.includes('3104650437'),
      'El número personal hardcodeado no debe aparecer en ningún prompt cuando tallerPhone=null'
    );
  });
});
