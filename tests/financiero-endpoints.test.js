'use strict';
/**
 * Smoke test para Sprint 3 — routes/financiero.js
 * Requiere servidor corriendo en http://localhost:3001
 *
 * Uso:
 *   node tests/financiero-endpoints.test.js
 *   TEST_ADMIN_LOGIN=admin TEST_ADMIN_PASS=123 node tests/financiero-endpoints.test.js
 */

const http   = require('http');
const assert = require('assert/strict');

const BASE  = 'http://localhost:3001';
const LOGIN = process.env.TEST_ADMIN_LOGIN || 'admin';
const PASS  = process.env.TEST_ADMIN_PASS  || '123';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const opts    = {
      hostname: u.hostname,
      port:     u.port || 80,
      path:     u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch (_) { json = raw; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookies(res) {
  const setCookie = res.headers?.['set-cookie'] || [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

function requestRaw(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const opts    = {
      hostname: u.hostname,
      port:     u.port || 80,
      path:     u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch (_) { json = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
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
  console.log('\n── Sprint 3 — financiero endpoints ─────────────────────────\n');

  // 1. Login como admin
  let cookie;
  await (async () => {
    const r = await requestRaw('POST', `${BASE}/login`,
      { username: LOGIN, password: PASS });
    cookie = extractCookies(r);
    if (!cookie) { console.error('Login fallido — abortando'); process.exit(1); }
    console.log('  ✅  Login como admin');
    passed++;
  })();

  const hdr = { Cookie: cookie };
  const mes = new Date().toISOString().slice(0, 7);
  let ventaId;

  // ── Config ────────────────────────────────────────────────────────────────

  // 2. GET /financiero/config — devuelve config activa
  await test('GET /financiero/config devuelve config activa', async () => {
    const r = await request('GET', `${BASE}/api/financiero/config`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.cf_utilidad_objetivo_min != null, 'sin cf_utilidad_objetivo_min');
    assert.ok(r.body.cf_meta_total_mes        != null, 'sin cf_meta_total_mes');
  });

  // 3. GET /financiero/config sin sesión → 401
  await test('GET /financiero/config sin sesión devuelve 401', async () => {
    const r = await request('GET', `${BASE}/api/financiero/config`);
    assert.ok(r.status === 401 || r.status === 302, `status ${r.status}`);
  });

  // 4. PUT /financiero/config — actualiza y devuelve uid_config
  let newConfigId;
  await test('PUT /financiero/config crea nueva versión', async () => {
    const r = await request('PUT', `${BASE}/api/financiero/config`, {
      cf_utilidad_objetivo_min: 60000,
      cf_utilidad_objetivo_opt: 85000,
      cf_margen_objetivo_rep:   0.5,
      cf_meta_total_mes:        13900000,
    }, hdr);
    assert.equal(r.status, 201, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.uid_config, 'sin uid_config');
    newConfigId = r.body.uid_config;
  });

  // 5. PUT /financiero/config — validación campos requeridos
  await test('PUT /financiero/config sin campos requeridos devuelve 400', async () => {
    const r = await request('PUT', `${BASE}/api/financiero/config`,
      { cf_margen_objetivo_rep: 0.4 }, hdr);
    assert.equal(r.status, 400, `status ${r.status}`);
  });

  // 6. GET /financiero/config — tras PUT, config activa tiene la nueva
  await test('GET /financiero/config tras PUT refleja valores nuevos', async () => {
    const r = await request('GET', `${BASE}/api/financiero/config`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status}`);
    assert.equal(String(r.body.uid_config), String(newConfigId),
      `uid esperado ${newConfigId}, got ${r.body.uid_config}`);
  });

  // 7. GET /financiero/config/historial — lista todas las versiones
  await test('GET /financiero/config/historial devuelve array con ≥2 entradas', async () => {
    const r = await request('GET', `${BASE}/api/financiero/config/historial`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status}`);
    assert.ok(Array.isArray(r.body), 'body no es array');
    assert.ok(r.body.length >= 2, `esperaba ≥2 entradas, got ${r.body.length}`);
    // La config que acabamos de crear debe existir en el historial y estar activa
    const nuevaEntry = r.body.find(e => String(e.uid_config) === String(newConfigId));
    assert.ok(nuevaEntry, `uid_config ${newConfigId} no encontrado en historial`);
    assert.equal(nuevaEntry.cf_vigente_hasta, null, 'la nueva config debe estar activa (cf_vigente_hasta null)');
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────

  // 8. GET /financiero/dashboard — mes actual
  await test('GET /financiero/dashboard devuelve KPIs del mes', async () => {
    const r = await request('GET', `${BASE}/api/financiero/dashboard?mes=${mes}`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.equal(r.body.mes, mes, 'mes incorrecto');
    assert.ok(r.body.utilidad_acumulada   != null, 'sin utilidad_acumulada');
    assert.ok(r.body.meta_total_mes       != null, 'sin meta_total_mes');
    assert.ok(Array.isArray(r.body.utilidad_por_dia), 'utilidad_por_dia no es array');
  });

  // 9. GET /financiero/dashboard — formato inválido
  await test('GET /financiero/dashboard con mes inválido devuelve 400', async () => {
    const r = await request('GET', `${BASE}/api/financiero/dashboard?mes=hoy`, null, hdr);
    assert.equal(r.status, 400, `status ${r.status}`);
  });

  // ── Ventas financiero + sugerencias ──────────────────────────────────────

  // Crear una venta de prueba para tener datos en el mes actual
  await (async () => {
    const r = await request('POST', `${BASE}/api/ventas`, {
      ven_fecha: new Date().toISOString().slice(0, 10),
      ven_metodo_pago: 'efectivo',
      items: [
        { vi_descripcion: 'Mano de obra', vi_tipo: 'mano_obra',
          vi_cantidad: 1, vi_precio_unitario: 40000, vi_costo_unitario: 0,
          vi_descuento_pct: 0, vi_iva_pct: 0 },
      ],
    }, hdr);
    if (r.status === 201) ventaId = r.body.uid_venta;
  })();

  // 10. GET /financiero/ventas?mes — devuelve ventas del mes
  await test('GET /financiero/ventas?mes devuelve array de ventas', async () => {
    const r = await request('GET', `${BASE}/api/financiero/ventas?mes=${mes}`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.equal(r.body.mes, mes);
    assert.ok(Array.isArray(r.body.ventas), 'ventas no es array');
    assert.ok(r.body.ventas.length > 0, 'esperaba al menos 1 venta en el mes');
    const v = r.body.ventas[0];
    assert.ok('ven_es_rentable'   in v, 'sin ven_es_rentable');
    assert.ok('ven_utilidad_total' in v, 'sin ven_utilidad_total');
  });

  // 11. GET /financiero/ventas — formato mes inválido
  await test('GET /financiero/ventas con mes inválido devuelve 400', async () => {
    const r = await request('GET', `${BASE}/api/financiero/ventas?mes=2026-13`, null, hdr);
    assert.equal(r.status, 400, `status ${r.status}`);
  });

  // 12. GET /financiero/ventas/:id/sugerencias — venta no rentable devuelve sugerencias
  await test('GET /financiero/ventas/:id/sugerencias devuelve resultado financiero', async () => {
    if (!ventaId) throw new Error('ventaId no disponible — POST falló');
    const r = await request('GET', `${BASE}/api/financiero/ventas/${ventaId}/sugerencias`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok('es_rentable'  in r.body, 'sin es_rentable');
    assert.ok('financiero'   in r.body, 'sin financiero');
    assert.ok('sugerencias'  in r.body, 'sin sugerencias');
    assert.ok(Array.isArray(r.body.sugerencias), 'sugerencias no es array');
    // Mano de obra 40000 < objetivo 60000 → no rentable → ≥1 sugerencia
    assert.ok(r.body.sugerencias.length >= 1, 'esperaba sugerencias para venta no rentable');
  });

  // 13. GET /financiero/ventas/:id/sugerencias — 404 para ID inexistente
  await test('GET /financiero/ventas/999999/sugerencias devuelve 404', async () => {
    const r = await request('GET', `${BASE}/api/financiero/ventas/999999/sugerencias`, null, hdr);
    assert.equal(r.status, 404, `status ${r.status}`);
  });

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${passed} pasaron, ${failed} fallaron ─────────────────────\n`);
  if (failed > 0) process.exit(1);
})();
