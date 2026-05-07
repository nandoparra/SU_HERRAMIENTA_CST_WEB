'use strict';
/**
 * Smoke test Sprint 5 — Views.finanzas (admin-only dashboard)
 * Verifica:
 *   1. dashboard.html tiene el nav item de finanzas (admin-only)
 *   2. dashboard.js tiene Views.finanzas con todos los componentes
 *   3. Las APIs del dashboard financiero responden correctamente
 *   4. PUT /financiero/config acepta los campos de costos desglosados
 *
 * Uso: node tests/sprint5-ui.test.js
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
  console.log('\n── Sprint 5 — Views.finanzas dashboard financiero smoke test ────\n');

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const js   = fs.readFileSync(JS_PATH,   'utf8');

  // ── 1. Verificación estática ──────────────────────────────────────────────

  await test('dashboard.html: nav item data-view="finanzas" presente', () => {
    assert.ok(html.includes('data-view="finanzas"'), 'Falta nav item finanzas en dashboard.html');
  });

  await test('dashboard.html: nav finanzas tiene clase admin-only', () => {
    const idx = html.indexOf('data-view="finanzas"');
    assert.ok(idx !== -1, 'nav item finanzas no encontrado');
    const ctx = html.slice(Math.max(0, idx - 80), idx + 20);
    assert.ok(ctx.includes('admin-only'), 'nav finanzas no tiene clase admin-only');
  });

  await test('dashboard.js: VIEW_LABELS incluye finanzas', () => {
    assert.ok(js.includes("finanzas:'Finanzas'") || js.includes("finanzas: 'Finanzas'"),
      'VIEW_LABELS no incluye finanzas');
  });

  await test('dashboard.js: Views.finanzas definido', () => {
    assert.ok(js.includes('Views.finanzas'), 'Views.finanzas no encontrado');
  });

  await test('dashboard.js: fin_load (carga de datos)', () => {
    assert.ok(js.includes('fin_load'), 'fin_load no encontrado');
  });

  await test('dashboard.js: fin_renderChart (gráfica SVG diaria)', () => {
    assert.ok(js.includes('fin_renderChart'), 'fin_renderChart no encontrado');
  });

  await test('dashboard.js: fin_renderDesglose (desglose mensual)', () => {
    assert.ok(js.includes('fin_renderDesglose'), 'fin_renderDesglose no encontrado');
  });

  await test('dashboard.js: fin_renderMetaDiaria (meta diaria inteligente)', () => {
    assert.ok(js.includes('fin_renderMetaDiaria'), 'fin_renderMetaDiaria no encontrado');
  });

  await test('dashboard.js: fin_renderConfig (formulario de costos)', () => {
    assert.ok(js.includes('fin_renderConfig'), 'fin_renderConfig no encontrado');
  });

  await test('dashboard.js: fin_renderHistorial (historial de configuraciones)', () => {
    assert.ok(js.includes('fin_renderHistorial'), 'fin_renderHistorial no encontrado');
  });

  await test('dashboard.js: fin_guardarConfig (guardar configuración)', () => {
    assert.ok(js.includes('fin_guardarConfig'), 'fin_guardarConfig no encontrado');
  });

  await test('dashboard.js: campos costos fijos en config (cf_arriendo, cf_salarios)', () => {
    assert.ok(js.includes('cf_arriendo') && js.includes('cf_salarios'),
      'Campos de costos fijos no encontrados');
  });

  await test('dashboard.js: SVG chart (viewBox en fin_renderChart)', () => {
    assert.ok(js.includes('viewBox') && js.includes('fin_renderChart'),
      'SVG viewBox no encontrado en fin_renderChart');
  });

  // ── 2. API endpoints ──────────────────────────────────────────────────────

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

    await test('GET /api/financiero/dashboard devuelve KPIs con campos esperados', async () => {
      const r = await request('GET', `${BASE}/api/financiero/dashboard?mes=${mes}`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok('utilidad_acumulada'    in r.body, 'sin utilidad_acumulada');
      assert.ok('utilidad_por_dia'      in r.body, 'sin utilidad_por_dia');
      assert.ok('ventas_mano_obra_total' in r.body, 'sin ventas_mano_obra_total');
      assert.ok('ventas_repuestos_total' in r.body, 'sin ventas_repuestos_total');
      assert.ok('dias_del_mes'          in r.body, 'sin dias_del_mes');
      assert.ok('faltante_para_meta'    in r.body, 'sin faltante_para_meta');
    });

    await test('GET /api/financiero/config devuelve configuración activa', async () => {
      const r = await request('GET', `${BASE}/api/financiero/config`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(r.body.cf_utilidad_objetivo_min != null, 'sin cf_utilidad_objetivo_min');
      assert.ok(r.body.cf_meta_total_mes        != null, 'sin cf_meta_total_mes');
    });

    // PUT con todos los campos de costos
    let newConfigId;
    await test('PUT /api/financiero/config acepta campos desglosados de costos', async () => {
      const r = await request('PUT', `${BASE}/api/financiero/config`, {
        cf_utilidad_objetivo_min: 62000,
        cf_utilidad_objetivo_opt: 90000,
        cf_margen_objetivo_rep:   0.5,
        cf_meta_total_mes:        14000000,
        cf_arriendo:              2800000,
        cf_energia:               350000,
        cf_agua:                  80000,
        cf_internet:              120000,
        cf_telefono:              60000,
        cf_salarios:              4500000,
        cf_seguridad_social:      900000,
        cf_parafiscales:          450000,
        cf_mantenimiento:         200000,
        cf_otros:                 150000,
        cf_descripcion_otros:     'Test contabilidad',
        cf_meta_ahorro_mes:       2800000,
        cf_mano_obra_base:        38000,
      }, hdr);
      assert.equal(r.status, 201, `status ${r.status} — ${JSON.stringify(r.body)}`);
      assert.ok(r.body.uid_config, 'sin uid_config');
      newConfigId = r.body.uid_config;
    });

    await test('GET /api/financiero/config refleja cf_total_costos_fijos calculado', async () => {
      const r = await request('GET', `${BASE}/api/financiero/config`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(Number(r.body.cf_total_costos_fijos) > 0, 'cf_total_costos_fijos debe ser > 0');
      // 2800000+350000+80000+120000+60000+4500000+900000+450000+200000+150000 = 9610000
      assert.equal(Number(r.body.cf_total_costos_fijos), 9610000,
        `cf_total_costos_fijos esperado 9610000, got ${r.body.cf_total_costos_fijos}`);
    });

    await test('GET /api/financiero/config/historial incluye la nueva config', async () => {
      const r = await request('GET', `${BASE}/api/financiero/config/historial`, null, hdr);
      assert.equal(r.status, 200, `status ${r.status}`);
      assert.ok(Array.isArray(r.body), 'body no es array');
      const entry = r.body.find(e => String(e.uid_config) === String(newConfigId));
      assert.ok(entry, `uid_config ${newConfigId} no encontrado en historial`);
      assert.ok(entry.cf_descripcion_otros === 'Test contabilidad', 'cf_descripcion_otros no guardado');
    });
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${passed} pasaron, ${failed} fallaron ─────────────────────\n`);
  if (failed > 0) process.exit(1);
})();
