'use strict';
/**
 * Smoke test Sprint 4 — Views.ventas UI
 * Verifica:
 *   1. dashboard.html tiene el nav item de ventas
 *   2. dashboard.js tiene Views.ventas con los 4 componentes
 *   3. El servidor sirve dashboard.html autenticado correctamente
 *   4. Las APIs usadas por la vista responden con la forma esperada
 *
 * Uso: node tests/sprint4-ui.test.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const assert = require('assert/strict');

const BASE  = 'http://localhost:3001';
const LOGIN = process.env.TEST_ADMIN_LOGIN || 'admin';
const PASS  = process.env.TEST_ADMIN_PASS  || '123';

const HTML_PATH = path.join(__dirname, '..', 'public', 'dashboard.html');
const JS_PATH   = path.join(__dirname, '..', 'public', 'assets', 'dashboard.js');

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port || 80,
      path: u.pathname + u.search, method,
      headers: { 'Content-Type':'application/json', ...headers,
                 ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json; try { json = JSON.parse(raw); } catch(_) { json = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookies(r) {
  return (r.headers['set-cookie'] || []).map(c=>c.split(';')[0]).join('; ');
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅  ${name}`); passed++; }
  catch(e) { console.error(`  ❌  ${name}\n       ${e.message}`); failed++; }
}

(async () => {
  console.log('\n── Sprint 4 — Views.ventas UI smoke test ────────────────────\n');

  // ── 1. Verificación estática de archivos ──────────────────────────────────

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const js   = fs.readFileSync(JS_PATH,   'utf8');

  await test('dashboard.html: nav item data-view="ventas" presente', () => {
    assert.ok(html.includes('data-view="ventas"'), 'Falta nav item ventas en dashboard.html');
  });

  await test('dashboard.html: icono 🛒 presente', () => {
    assert.ok(html.includes('🛒'), 'Falta emoji 🛒 en dashboard.html');
  });

  await test('dashboard.js: VIEW_LABELS incluye ventas', () => {
    assert.ok(js.includes("ventas:'Ventas'") || js.includes("ventas: 'Ventas'"),
      'VIEW_LABELS no incluye ventas');
  });

  await test('dashboard.js: Views.ventas definido', () => {
    assert.ok(js.includes('Views.ventas'), 'Views.ventas no encontrado en dashboard.js');
  });

  await test('dashboard.js: ven_reload (lista con filtros)', () => {
    assert.ok(js.includes('ven_reload'), 'ven_reload no encontrado');
  });

  await test('dashboard.js: ven_openCreate (modal nueva venta)', () => {
    assert.ok(js.includes('ven_openCreate'), 'ven_openCreate no encontrado');
  });

  await test('dashboard.js: ven_renderItems (tabla dinámica)', () => {
    assert.ok(js.includes('ven_renderItems'), 'ven_renderItems no encontrado');
  });

  await test('dashboard.js: ven_toggleCostos (costo opcional con margen)', () => {
    assert.ok(js.includes('ven_toggleCostos'), 'ven_toggleCostos no encontrado');
  });

  await test('dashboard.js: ven_recalcTotales (cálculo en tiempo real)', () => {
    assert.ok(js.includes('ven_recalcTotales'), 'ven_recalcTotales no encontrado');
  });

  await test('dashboard.js: ven_verDetalle (panel detalle)', () => {
    assert.ok(js.includes('ven_verDetalle'), 'ven_verDetalle no encontrado');
  });

  await test('dashboard.js: panel financiero admin (Análisis financiero)', () => {
    assert.ok(js.includes('Análisis financiero'), 'Bloque financiero admin no encontrado');
  });

  await test('dashboard.js: sugerencias en panel financiero', () => {
    assert.ok(js.includes('Sugerencias para mejorar rentabilidad') ||
              js.includes('sugerencias'), 'Sugerencias no encontradas en panel financiero');
  });

  await test('dashboard.js: ven_pagar + ven_anular (acciones)', () => {
    assert.ok(js.includes('ven_pagar') && js.includes('ven_anular'),
      'ven_pagar o ven_anular no encontrado');
  });

  // ── 2. API endpoints que usa la vista (servidor debe estar corriendo) ──────

  let cookie;
  await test('Servidor responde — login admin', async () => {
    const r = await request('POST', `${BASE}/login`, { username: LOGIN, password: PASS });
    assert.ok(r.status === 200 || r.status === 302, `status ${r.status}`);
    cookie = extractCookies(r);
    assert.ok(cookie.length > 0, 'Sin cookie de sesión');
  });

  if (!cookie) { console.error('\nSin sesión — saltando pruebas de API'); }
  else {
    const hdr = { Cookie: cookie };
    const mes = new Date().toISOString().slice(0,7);

    await test('GET /api/ventas devuelve array (usado por ven_reload)', async () => {
      const r = await request('GET', `${BASE}/api/ventas?fecha_desde=${mes}-01&fecha_hasta=${mes}-31`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(Array.isArray(r.body), 'body no es array');
    });

    // Crear una venta de prueba para verificar el ciclo completo
    let ventaId;
    await test('POST /api/ventas (ven_guardar) → crea y devuelve uid', async () => {
      const r = await request('POST', `${BASE}/api/ventas`, {
        ven_fecha: new Date().toISOString().slice(0,10),
        ven_metodo_pago: 'efectivo',
        items: [
          { vi_descripcion:'Mano de obra test', vi_tipo:'mano_obra',
            vi_cantidad:1, vi_precio_unitario:75000, vi_costo_unitario:0,
            vi_descuento_pct:0, vi_iva_pct:0 },
          { vi_descripcion:'Repuesto test', vi_tipo:'repuesto',
            vi_cantidad:1, vi_precio_unitario:30000, vi_costo_unitario:10000,
            vi_descuento_pct:0, vi_iva_pct:0 },
        ],
      }, hdr);
      assert.equal(r.status, 201, `status ${r.status} — ${JSON.stringify(r.body)}`);
      ventaId = r.body.uid_venta;
    });

    await test('GET /api/ventas/:id (ven_verDetalle) — incluye items + financiero', async () => {
      if (!ventaId) throw new Error('ventaId no disponible');
      const r = await request('GET', `${BASE}/api/ventas/${ventaId}`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(Array.isArray(r.body.items), 'sin items');
      assert.ok('financiero' in r.body,       'sin bloque financiero (admin)');
      assert.ok('sugerencias' in r.body,      'sin sugerencias');
    });

    await test('GET /api/ventas/:id/pdf devuelve PDF válido', async () => {
      if (!ventaId) throw new Error('ventaId no disponible');
      const r = await request('GET', `${BASE}/api/ventas/${ventaId}/pdf`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(r.headers['content-type']?.includes('pdf'), 'content-type no es pdf');
      assert.ok(r.raw.startsWith('%PDF'), 'cuerpo no inicia con %PDF');
    });

    await test('PATCH /api/ventas/:id/pagar (ven_pagar)', async () => {
      if (!ventaId) throw new Error('ventaId no disponible');
      const r = await request('PATCH', `${BASE}/api/ventas/${ventaId}/pagar`, {}, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
    });

    await test('PATCH /api/ventas/:id/anular (ven_anular)', async () => {
      if (!ventaId) throw new Error('ventaId no disponible');
      const r = await request('PATCH', `${BASE}/api/ventas/${ventaId}/anular`, {}, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
    });
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${passed} pasaron, ${failed} fallaron ─────────────────────\n`);
  if (failed > 0) process.exit(1);
})();
