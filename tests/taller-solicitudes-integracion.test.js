'use strict';
/**
 * Test de integración — /api/taller/solicitudes-recogida
 *
 * Verifica que el endpoint devuelva 200 (no 403) cuando se llama con
 * credenciales de admin. Esto hubiera atrapado el bug real donde
 * contable.js tenía router.use(requireAddonContabilidad) sin prefijo de
 * ruta — el test unitario de estructura no verifica la cadena real de
 * routers en su orden de montaje en server.js.
 *
 * REQUIERE servidor corriendo en http://localhost:3001 y credenciales de seed.
 * En local sin servidor: ECONNREFUSED (fallo esperado, documentado en CLAUDE.md).
 * En CI: el servidor se levanta antes de este paso.
 *
 * Uso:
 *   TEST_ADMIN_LOGIN=admin_test TEST_ADMIN_PASS=Admin#Cst2026 node tests/taller-solicitudes-integracion.test.js
 */

const http   = require('http');
const assert = require('assert/strict');

const BASE  = 'http://localhost:3001';
const LOGIN = process.env.TEST_ADMIN_LOGIN || 'admin_test';
const PASS  = process.env.TEST_ADMIN_PASS  || 'Admin#Cst2026';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port || 80,
      path: u.pathname + u.search, method,
      timeout: 8000,
      headers: { 'Content-Type': 'application/json', ...headers,
                 ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json; try { json = JSON.parse(raw); } catch (_) { json = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HTTP timeout 8s')));
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookies(r) {
  return (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n── integración: /api/taller/solicitudes-recogida ────────────\n');

  // 1. Login como admin
  let cookie;
  const loginRes = await request('POST', `${BASE}/login`,
    { username: LOGIN, password: PASS });
  cookie = extractCookies(loginRes);
  if (!cookie) {
    console.error('Login fallido — ¿servidor corriendo? ¿credenciales correctas?');
    process.exit(1);
  }
  console.log(`  ✅  Login como ${LOGIN}`);

  // 2. GET /api/taller/solicitudes-recogida?estado=pendiente — NO debe ser 403
  // Antes del fix: contable.js tenía router.use(requireAddonContabilidad) sin
  // prefijo de ruta. Con addon_contabilidad=0 (staging default), cualquier
  // request que atravesara contable.js (que se monta ANTES de solicitudes-taller
  // en server.js) recibía 403 — incluyendo admin (tipo A).
  await test('GET /api/taller/solicitudes-recogida no devuelve 403 como admin', async () => {
    const r = await request('GET',
      `${BASE}/api/taller/solicitudes-recogida?estado=pendiente`,
      null, { Cookie: cookie });

    assert.notEqual(r.status, 403,
      `Recibió 403 — el middleware de contable.js está bloqueando la ruta. ` +
      `Verificar que router.use(requireAddonContabilidad) tenga prefijo '/contable'.`);

    // Debe ser 200 con JSON array (puede estar vacío si no hay solicitudes en el seed)
    assert.equal(r.status, 200,
      `Esperaba 200 pero recibió ${r.status}. Body: ${JSON.stringify(r.body)}`);

    assert.ok(Array.isArray(r.body),
      `Esperaba array JSON, recibió: ${JSON.stringify(r.body)}`);
  });

  // 3. Verificar que sin sesión retorna 401 (no rompe auth)
  await test('GET /api/taller/solicitudes-recogida retorna 401 sin sesión', async () => {
    const r = await request('GET',
      `${BASE}/api/taller/solicitudes-recogida?estado=pendiente`);
    assert.equal(r.status, 401,
      `Sin sesión debe ser 401, recibió ${r.status}`);
  });

  // ── Resultado ────────────────────────────────────────────────────────────────
  console.log(`\n  ${passed} pasaron, ${failed} fallaron\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
