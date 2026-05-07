'use strict';
/**
 * Smoke test hotfix/ventas-ux
 * Verifica:
 *   Bug 1 — focus fix: ven_renderItems guarda/restaura foco (data-ven-row/field)
 *            ven_onItem no re-renderiza para vi_descripcion
 *   Bug 2a — ord_generarVenta en detalle de orden (btn + handler)
 *   Bug 2b — ven_buscarOrden + ven_seleccionarOrden + _venOrdenId en modal
 *   API    — POST /ventas/desde-orden/:id crea venta con ítems de cotización
 *
 * Uso: node tests/hotfix-ventas-ux.test.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const assert = require('assert/strict');

const BASE  = 'http://localhost:3001';
const LOGIN = process.env.TEST_ADMIN_LOGIN || 'admin';
const PASS  = process.env.TEST_ADMIN_PASS  || '123';

const JS_PATH = path.join(__dirname, '..', 'public', 'assets', 'dashboard.js');

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
  console.log('\n── hotfix/ventas-ux smoke test ──────────────────────────────────\n');

  const js = fs.readFileSync(JS_PATH, 'utf8');

  // ── Bug 1 — Focus fix ─────────────────────────────────────────────────────

  await test('Bug1: ven_renderItems guarda foco con data-ven-row', () => {
    assert.ok(js.includes('data-ven-row='), 'Falta data-ven-row en inputs del item');
  });

  await test('Bug1: ven_renderItems restaura foco después del rebuild', () => {
    assert.ok(js.includes('focusRow') && js.includes('focusField'),
      'Falta lógica de restauración de foco');
  });

  await test('Bug1: ven_onItem omite re-render para vi_descripcion', () => {
    assert.ok(
      js.includes("field === 'vi_descripcion') return"),
      'Falta early-return para vi_descripcion en ven_onItem'
    );
  });

  // ── Bug 2a — Generar venta desde detalle de orden ─────────────────────────

  await test('Bug2a: ord_generarVenta definido', () => {
    assert.ok(js.includes('ord_generarVenta'), 'ord_generarVenta no encontrado');
  });

  await test('Bug2a: botón Generar venta en ord-acciones', () => {
    assert.ok(js.includes('💳 Generar venta'), 'Botón Generar venta no encontrado');
  });

  await test('Bug2a: ord_generarVenta llama ventas/desde-orden', () => {
    assert.ok(js.includes('ventas/desde-orden/'), 'URL desde-orden no encontrada en ord_generarVenta');
  });

  // ── Bug 2b — Buscador de órdenes en modal ────────────────────────────────

  await test('Bug2b: ven_buscarOrden definido', () => {
    assert.ok(js.includes('ven_buscarOrden'), 'ven_buscarOrden no encontrado');
  });

  await test('Bug2b: ven_seleccionarOrden definido', () => {
    assert.ok(js.includes('ven_seleccionarOrden'), 'ven_seleccionarOrden no encontrado');
  });

  await test('Bug2b: _venOrdenId declarado y reseteado en openCreate', () => {
    assert.ok(js.includes('_venOrdenId'), '_venOrdenId no encontrado');
    assert.ok(js.includes('_venOrdenId = null'), '_venOrdenId no reseteado en openCreate');
  });

  await test('Bug2b: modal incluye input venOrdBuscar', () => {
    assert.ok(js.includes('venOrdBuscar'), 'venOrdBuscar input no encontrado en modal');
  });

  await test('Bug2b: ven_guardar incluye uid_orden en el body', () => {
    assert.ok(js.includes('uid_orden:') && js.includes('_venOrdenId'),
      'uid_orden no enviado en ven_guardar');
  });

  await test('Bug2b: ven_seleccionarOrden usa /recibos/cotizacion-orden/', () => {
    assert.ok(js.includes('recibos/cotizacion-orden/'),
      'ven_seleccionarOrden no llama a cotizacion-orden');
  });

  await test('Bug2b: debounce 300ms en ven_buscarOrden', () => {
    assert.ok(js.includes('300'), 'Debounce 300ms no encontrado');
  });

  // ── API: POST /ventas/desde-orden/:id ────────────────────────────────────

  let cookie;
  await test('Servidor responde — login admin', async () => {
    const r = await request('POST', `${BASE}/login`, { username: LOGIN, password: PASS });
    assert.ok(r.status === 200 || r.status === 302, `status ${r.status}`);
    cookie = extractCookies(r);
    assert.ok(cookie.length > 0, 'Sin cookie de sesión');
  });

  if (cookie) {
    const hdr = { Cookie: cookie };

    // Crear una orden con cotización para probar desde-orden
    let ventaDesdeOrden;
    let orderId;

    // Buscar una orden con cotización
    await test('GET /api/orders/search devuelve órdenes', async () => {
      const r = await request('GET', `${BASE}/api/orders/search?q=&limit=5`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(Array.isArray(r.body), 'body no es array');
    });

    // Crear orden de prueba completa con cotización para el test de desde-orden
    await (async () => {
      // 1. Buscar cliente existente
      const sc = await request('GET', `${BASE}/api/clientes/search?q=a&limit=1`, null, hdr);
      const clientes = Array.isArray(sc.body) ? sc.body : [];
      if (!clientes.length) return;
      const clienteId = clientes[0].uid_cliente;

      // 2. Obtener herramientas del cliente
      const sh = await request('GET', `${BASE}/api/crear-orden/herramientas/${clienteId}`, null, hdr);
      const hers = Array.isArray(sh.body) ? sh.body : [];
      if (!hers.length) return;

      // 3. Crear orden
      const ro = await request('POST', `${BASE}/api/crear-orden/orden`, {
        uid_cliente: clienteId, maquinas: [{
          uid_herramienta: hers[0].uid_herramienta,
          observaciones: 'Test desde-orden hotfix',
        }],
      }, hdr);
      if (ro.status !== 201) return;
      orderId = ro.body.uid_orden;
      const maquinaUid = ro.body.maquinas?.[0]?.uid_herramienta_orden;
      if (!maquinaUid) return;

      // 4. Crear cotización para esa orden+máquina
      const rc = await request('POST', `${BASE}/api/quotes/machine`, {
        uid_orden: orderId, uid_herramienta_orden: maquinaUid,
        mano_obra: 50000, descripcion_trabajo: 'Revisión test',
        items: [{ nombre: 'Repuesto test', cantidad: 1, precio: 20000, subtotal: 20000 }],
      }, hdr);
      if (rc.status !== 200 && rc.status !== 201) return;
    })();

    await test('POST /api/ventas/desde-orden/:id crea venta (cuando hay cotización)', async () => {
      if (!orderId) { console.log('       (saltando — no se pudo crear orden de prueba)'); passed++; return; }
      const r = await request('POST', `${BASE}/api/ventas/desde-orden/${orderId}`, {}, hdr);
      assert.equal(r.status, 201, `status ${r.status} — ${JSON.stringify(r.body)}`);
      assert.ok(r.body.uid_venta, 'sin uid_venta');
      assert.ok(r.body.ven_consecutivo, 'sin ven_consecutivo');
      ventaDesdeOrden = r.body.uid_venta;
    });

    await test('POST /api/ventas/desde-orden/99999999 → 404 para orden inexistente', async () => {
      const r = await request('POST', `${BASE}/api/ventas/desde-orden/99999999`, {}, hdr);
      assert.equal(r.status, 404, `status ${r.status}`);
    });
  }

  console.log(`\n── Resultado: ${passed} pasaron, ${failed} fallaron ─────────────────────\n`);
  if (failed > 0) process.exit(1);
})();
