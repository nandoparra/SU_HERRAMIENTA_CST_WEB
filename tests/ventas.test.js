'use strict';
/**
 * Smoke test para Sprint 2 — routes/ventas.js
 * Requiere servidor corriendo en http://localhost:3001
 * y un usuario admin válido (env TEST_ADMIN_LOGIN, TEST_ADMIN_PASS).
 *
 * Uso:
 *   node tests/ventas.test.js
 *   TEST_ADMIN_LOGIN=admin TEST_ADMIN_PASS=123 node tests/ventas.test.js
 */

const http    = require('http');
const assert  = require('assert/strict');

const BASE    = 'http://localhost:3001';
const LOGIN   = process.env.TEST_ADMIN_LOGIN || 'admin';
const PASS    = process.env.TEST_ADMIN_PASS  || '123';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u        = new URL(url);
    const payload  = body ? JSON.stringify(body) : null;
    const opts     = {
      hostname: u.hostname,
      port:     u.port || 80,
      path:     u.pathname + u.search,
      method,
      headers:  {
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
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Extrae cookies de la respuesta de login
function extractCookies(res) {
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
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
  console.log('\n── Sprint 2 — ventas endpoints ─────────────────────────────\n');

  // 1. Login
  let cookie;
  await test('Login como admin', async () => {
    const r = await request('POST', `${BASE}/login`,
      { username: LOGIN, password: PASS });
    assert.ok(r.status === 200 || r.status === 302, `status ${r.status}`);
    cookie = extractCookies(r);
    assert.ok(cookie.length > 0, 'Sin cookie de sesión');
  });

  if (!cookie) {
    console.error('\nNo hay sesión — abortando.');
    process.exit(1);
  }

  const hdr = { Cookie: cookie };

  // 2. GET /api/ventas — lista vacía o con filas
  let ventaId;
  await test('GET /api/ventas devuelve array', async () => {
    const r = await request('GET', `${BASE}/api/ventas`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status}`);
    assert.ok(Array.isArray(r.body), 'body no es array');
  });

  // 3. POST /api/ventas — crear venta
  await test('POST /api/ventas crea venta con 2 ítems', async () => {
    const r = await request('POST', `${BASE}/api/ventas`, {
      ven_fecha:      new Date().toISOString().slice(0, 10),
      ven_metodo_pago: 'efectivo',
      items: [
        { vi_descripcion: 'Mano de obra test', vi_tipo: 'mano_obra',
          vi_cantidad: 1, vi_precio_unitario: 70000, vi_costo_unitario: 0,
          vi_descuento_pct: 0, vi_iva_pct: 0 },
        { vi_descripcion: 'Repuesto test', vi_tipo: 'repuesto',
          vi_cantidad: 2, vi_precio_unitario: 30000, vi_costo_unitario: 15000,
          vi_descuento_pct: 0, vi_iva_pct: 0 },
      ],
    }, hdr);
    assert.equal(r.status, 201, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.uid_venta,        'sin uid_venta');
    assert.ok(r.body.ven_consecutivo,  'sin ven_consecutivo');
    ventaId = r.body.uid_venta;
  });

  // 4. POST /api/ventas — validación: sin fecha
  await test('POST /api/ventas sin ven_fecha devuelve 400', async () => {
    const r = await request('POST', `${BASE}/api/ventas`, {
      items: [{ vi_descripcion: 'X', vi_tipo: 'repuesto', vi_cantidad: 1, vi_precio_unitario: 1000 }],
    }, hdr);
    assert.equal(r.status, 400, `status ${r.status}`);
  });

  // 5. POST /api/ventas — validación: sin ítems
  await test('POST /api/ventas sin items devuelve 400', async () => {
    const r = await request('POST', `${BASE}/api/ventas`, {
      ven_fecha: new Date().toISOString().slice(0, 10),
      items: [],
    }, hdr);
    assert.equal(r.status, 400, `status ${r.status}`);
  });

  // 6. GET /api/ventas/:id — detalle
  await test('GET /api/ventas/:id devuelve venta + items', async () => {
    if (!ventaId) throw new Error('ventaId no definido — POST falló');
    const r = await request('GET', `${BASE}/api/ventas/${ventaId}`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status}`);
    assert.ok(Array.isArray(r.body.items),        'sin items array');
    assert.equal(r.body.items.length, 2,           'items length != 2');
    assert.ok(Number(r.body.ven_total) > 0,        'ven_total inválido');
  });

  // 7. GET /api/ventas/:id — 404 para ID inexistente
  await test('GET /api/ventas/999999 devuelve 404', async () => {
    const r = await request('GET', `${BASE}/api/ventas/999999`, null, hdr);
    assert.equal(r.status, 404, `status ${r.status}`);
  });

  // 8. PATCH /api/ventas/:id/pagar
  await test('PATCH /ventas/:id/pagar marca como pagada', async () => {
    if (!ventaId) throw new Error('ventaId no definido');
    const r = await request('PATCH', `${BASE}/api/ventas/${ventaId}/pagar`, {}, hdr);
    assert.equal(r.status, 200, `status ${r.status} — ${JSON.stringify(r.body)}`);
    assert.ok(r.body.ok, 'body.ok no true');
  });

  // 9. PATCH /api/ventas/:id/pagar — idempotencia (409 si ya pagada)
  await test('PATCH /ventas/:id/pagar devuelve 409 si ya pagada', async () => {
    if (!ventaId) throw new Error('ventaId no definido');
    const r = await request('PATCH', `${BASE}/api/ventas/${ventaId}/pagar`, {}, hdr);
    assert.equal(r.status, 409, `status ${r.status}`);
  });

  // 10. PATCH /api/ventas/:id/anular
  await test('PATCH /ventas/:id/anular marca como anulada', async () => {
    if (!ventaId) throw new Error('ventaId no definido');
    const r = await request('PATCH', `${BASE}/api/ventas/${ventaId}/anular`, {}, hdr);
    assert.equal(r.status, 200, `status ${r.status} — ${JSON.stringify(r.body)}`);
  });

  // 11. PATCH /api/ventas/:id/anular — idempotencia (409 si ya anulada)
  await test('PATCH /ventas/:id/anular devuelve 409 si ya anulada', async () => {
    if (!ventaId) throw new Error('ventaId no definido');
    const r = await request('PATCH', `${BASE}/api/ventas/${ventaId}/anular`, {}, hdr);
    assert.equal(r.status, 409, `status ${r.status}`);
  });

  // 12. GET /api/ventas/:id/pdf — devuelve PDF
  await test('GET /ventas/:id/pdf devuelve PDF válido', async () => {
    if (!ventaId) throw new Error('ventaId no definido');
    const r = await request('GET', `${BASE}/api/ventas/${ventaId}/pdf`, null, hdr);
    assert.equal(r.status, 200, `status ${r.status}`);
    assert.ok(r.headers['content-type']?.includes('pdf'),
      `content-type incorrecto: ${r.headers['content-type']}`);
    assert.ok(r.raw.startsWith('%PDF'), 'body no inicia con %PDF');
  });

  // 13. Sin sesión — debe devolver 401
  await test('GET /api/ventas sin sesión devuelve 401', async () => {
    const r = await request('GET', `${BASE}/api/ventas`);
    assert.ok(r.status === 401 || r.status === 302, `status ${r.status}`);
  });

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${passed} pasaron, ${failed} fallaron ─────────────────────\n`);
  if (failed > 0) process.exit(1);
})();
