'use strict';
// Bug documentado en CLAUDE.md: detectarIntentAutorizacion() no recibía tenantId,
// por lo que logIaUso siempre guardaba tenant_id=null (→ 1 en BD) sin importar
// qué tenant generó el mensaje. Con múltiples tenants el costo de clasificación
// aparecía íntegramente bajo el tenant 1 en el panel superadmin.
//
// Fix: tenantId se agrega al options object del segundo arg (backward-compatible —
// los tests existentes que pasan { _testClient } como segundo arg no cambian).
// wa-handler.js propaga tenantId al llamar detectarIntentAutorizacion(text, { tenantId }).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// ── mock de logIaUso vía require.cache (antes de require wa-agente) ───────────

let capturedIaUsoCall = null;

const IA_USO_PATH   = require.resolve('../utils/ia-uso');
const WA_AGENTE_PATH = require.resolve('../services/wa-agente');

const originalIaUso = require.cache[IA_USO_PATH];
const originalWaAgente = require.cache[WA_AGENTE_PATH];

before(() => {
  capturedIaUsoCall = null;
  // Inyecta mock antes de cargar wa-agente (o después de vaciar su caché)
  require.cache[IA_USO_PATH] = {
    id: IA_USO_PATH,
    filename: IA_USO_PATH,
    loaded: true,
    exports: {
      logIaUso: (params) => { capturedIaUsoCall = params; },
    },
  };
  delete require.cache[WA_AGENTE_PATH];
});

after(() => {
  // Restaurar caché original para no afectar otros tests en el mismo proceso
  if (originalIaUso) require.cache[IA_USO_PATH] = originalIaUso;
  else delete require.cache[IA_USO_PATH];

  if (originalWaAgente) require.cache[WA_AGENTE_PATH] = originalWaAgente;
  else delete require.cache[WA_AGENTE_PATH];
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeHappyClient(result = 'SI_CLARO') {
  return {
    beta: { messages: { create: async () => ({
      content: [{ text: result }],
      usage: { input_tokens: 10, output_tokens: 3 },
    }) } },
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('detectarIntentAutorizacion — tenantId propagado a logIaUso', () => {
  it('con tenantId=5 → logIaUso recibe tenantId=5 (no null)', async () => {
    capturedIaUsoCall = null;
    const { detectarIntentAutorizacion } = require('../services/wa-agente');

    await detectarIntentAutorizacion('sí, autorizo', {
      tenantId: 5,
      _testClient: makeHappyClient('SI_CLARO'),
    });

    assert.ok(capturedIaUsoCall !== null, 'logIaUso debe haber sido llamado');
    assert.strictEqual(capturedIaUsoCall.tenantId, 5,
      `tenantId esperado 5, recibido ${capturedIaUsoCall.tenantId}`);
    assert.strictEqual(capturedIaUsoCall.funcion, 'clasificador_autorizacion');
  });

  it('con tenantId=42 → logIaUso recibe tenantId=42', async () => {
    capturedIaUsoCall = null;
    const { detectarIntentAutorizacion } = require('../services/wa-agente');

    await detectarIntentAutorizacion('no gracias', {
      tenantId: 42,
      _testClient: makeHappyClient('NO_CLARO'),
    });

    assert.strictEqual(capturedIaUsoCall?.tenantId, 42);
  });

  it('backward-compat: sin tenantId → logIaUso recibe null (no explota)', async () => {
    capturedIaUsoCall = null;
    const { detectarIntentAutorizacion } = require('../services/wa-agente');

    // Llamada antigua — sin tenantId en options
    await detectarIntentAutorizacion('sí dale', {
      _testClient: makeHappyClient('SI_CLARO'),
    });

    assert.ok(capturedIaUsoCall !== null, 'logIaUso debe haber sido llamado');
    assert.strictEqual(capturedIaUsoCall.tenantId, null,
      'sin tenantId debe llegar null, no undefined ni 1');
  });

  it('el resultado de la clasificación no cambia al pasar tenantId', async () => {
    const { detectarIntentAutorizacion } = require('../services/wa-agente');

    const r1 = await detectarIntentAutorizacion('autorizo todo', {
      tenantId: 99,
      _testClient: makeHappyClient('SI_CLARO'),
    });
    assert.strictEqual(r1, 'SI_CLARO');

    const r2 = await detectarIntentAutorizacion('no gracias', {
      tenantId: 99,
      _testClient: makeHappyClient('NO_CLARO'),
    });
    assert.strictEqual(r2, 'NO_CLARO');
  });
});
