'use strict';
/**
 * Tests — fix-solicitudes-recogida-403
 *
 * Verifica estructuralmente que:
 * 1. solicitudes-taller.js usa requireInterno (permite A, F, T) — NO requireAdminFuncionario
 * 2. dashboard.js bypass incluye /taller/ (next('router') para no interceptar las rutas del taller)
 * 3. Las 4 rutas de solicitudes-taller tienen los paths correctos
 *
 * Todos unitarios — no requieren servidor ni BD.
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');

const SOLICITUDES_TALLER = path.join(__dirname, '../routes/solicitudes-taller.js');
const DASHBOARD           = path.join(__dirname, '../routes/dashboard.js');

// ── solicitudes-taller.js: guard correcto ─────────────────────────────────────

test('solicitudes-taller.js usa requireInterno a nivel router (no requireAdminFuncionario)', () => {
  const src = fs.readFileSync(SOLICITUDES_TALLER, 'utf8');

  // Debe tener router.use(requireInterno)
  assert.ok(
    src.includes('router.use(requireInterno)'),
    'solicitudes-taller.js debe usar router.use(requireInterno)'
  );
  // No debe tener router.use(requireAdminFuncionario) — eso bloquearía técnicos
  assert.ok(
    !src.includes('router.use(requireAdminFuncionario)'),
    'solicitudes-taller.js NO debe usar router.use(requireAdminFuncionario) — bloquearía técnicos'
  );
});

test('solicitudes-taller.js importa requireInterno (no requireAdmin)', () => {
  const src = fs.readFileSync(SOLICITUDES_TALLER, 'utf8');
  assert.ok(
    src.includes('requireInterno'),
    'solicitudes-taller.js debe importar requireInterno'
  );
  // Asegura que no hay requireAdmin (solo para admin A) en el archivo
  assert.ok(
    !src.includes('requireAdmin)') && !src.includes('requireAdmin,'),
    'solicitudes-taller.js no debe usar requireAdmin'
  );
});

// ── solicitudes-taller.js: rutas definidas ───────────────────────────────────

test("solicitudes-taller.js define GET /taller/solicitudes-recogida", () => {
  const src = fs.readFileSync(SOLICITUDES_TALLER, 'utf8');
  assert.ok(
    src.includes("router.get('/taller/solicitudes-recogida'"),
    "falta GET /taller/solicitudes-recogida"
  );
});

test("solicitudes-taller.js define las 3 rutas de mutación", () => {
  const src = fs.readFileSync(SOLICITUDES_TALLER, 'utf8');
  assert.ok(src.includes("'/taller/solicitudes-recogida/:id/confirmar'"), "falta PATCH confirmar");
  assert.ok(src.includes("'/taller/solicitudes-recogida/:id/crear-orden'"), "falta POST crear-orden");
  assert.ok(src.includes("'/taller/solicitudes-recogida/:id/estado'"), "falta PATCH estado");
});

// ── dashboard.js bypass: /taller/ incluido ────────────────────────────────────

test("dashboard.js bypass incluye /taller/ con next('router')", () => {
  const src = fs.readFileSync(DASHBOARD, 'utf8');

  // El bloque router.use() debe tener startsWith('/taller/')
  const bypassIdx = src.indexOf("router.use((req, res, next) =>");
  assert.ok(bypassIdx !== -1, 'No se encontró el bloque router.use() de bypass en dashboard.js');

  // Buscar desde el inicio del bypass hasta el primer next('router')
  const bypassEnd = src.indexOf("return requireInterno(req, res, next)", bypassIdx);
  const bypassBlock = src.slice(bypassIdx, bypassEnd + 40);

  assert.ok(
    bypassBlock.includes("startsWith('/taller/')"),
    "dashboard.js bypass debe incluir req.path.startsWith('/taller/') → next('router')"
  );
});

test("dashboard.js bypass llama next('router') para /taller/ ANTES de requireInterno", () => {
  const src = fs.readFileSync(DASHBOARD, 'utf8');

  const bypassIdx = src.indexOf("router.use((req, res, next) =>");
  const requireInternoIdx = src.indexOf("return requireInterno(req, res, next)", bypassIdx);
  const tallerIdx = src.indexOf("startsWith('/taller/')", bypassIdx);

  assert.ok(tallerIdx > bypassIdx, '/taller/ not found in bypass block');
  assert.ok(
    tallerIdx < requireInternoIdx,
    "/taller/ check must appear before requireInterno call in the bypass"
  );
});
