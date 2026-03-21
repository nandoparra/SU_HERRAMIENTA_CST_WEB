/**
 * isolation-test.js — Tests de aislamiento multi-tenant
 *
 * Verifica que un usuario del tenant A no puede ver, crear ni alterar datos
 * del tenant B y viceversa. Incluye pruebas de sesión cruzada.
 *
 * Crea un tenant 2 de prueba, ejecuta los tests, y limpia todo al finalizar.
 *
 * Uso:
 *   node isolation-test.js --admin admin --pass 123 [--url http://localhost:3001]
 *                          [--superadmin-secret XXXX]
 */

'use strict';
require('dotenv').config();
const http = require('http');
const db   = require('./utils/db');

// ── Configuración ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : def; };

const CONFIG = {
  url:              arg('--url',              'http://localhost:3001'),
  adminUser:        arg('--admin',            'admin'),
  adminPass:        arg('--pass',             'admin'),
  superadminSecret: arg('--superadmin-secret', process.env.SUPERADMIN_SECRET || ''),
};

const T2_SLUG  = 't2test';
const T2_ADMIN = 'admin_t2test';
const T2_PASS  = 'T2testPass';
const T2_COLOR = '#2d6a4f';   // verde oscuro — distinguible de azul del tenant 1

// IDs creados durante el setup (para cleanup)
let t2TenantId  = null;
let t2UserId    = null;
let t2ClienteId = null;
let t2OrdenId   = null;

// ── Helpers HTTP (http.request para poder setear Host header) ─────────────────
const BASE_URL = new URL(CONFIG.url);

function httpReq(method, path, body, cookies, host) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(bodyStr || ''),
      'Host':           host || BASE_URL.hostname,
      ...(cookies ? { Cookie: cookies } : {}),
    };

    const options = {
      hostname: BASE_URL.hostname,
      port:     Number(BASE_URL.port) || 3001,
      path,
      method,
      headers,
    };

    const r = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        // Node puede devolver array de set-cookie; tomar el primero
        const rawCookie = Array.isArray(res.headers['set-cookie'])
          ? res.headers['set-cookie'][0]
          : (res.headers['set-cookie'] || '');
        resolve({
          status:    res.statusCode,
          json,
          text:      data,
          setCookie: rawCookie.split(';')[0],
          location:  res.headers['location'] || null,
        });
      });
    });

    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

// Helper de login — retorna cookie de sesión
async function login(username, password, host) {
  const r = await httpReq('POST', '/login', { username, password }, null, host);
  if ((r.status === 200 || r.status === 302) && r.setCookie) {
    return r.setCookie;
  }
  throw new Error(`Login fallido para ${username}@${host}: HTTP ${r.status} — ${r.json?.error || r.text.slice(0,80)}`);
}

// ── Resultados ─────────────────────────────────────────────────────────────────
const results = [];
let passed = 0, failed = 0;

function ok(name, detail = '') {
  passed++;
  results.push({ ok: true, name, detail });
  console.log(`  ✅  ${name}${detail ? ' — ' + detail : ''}`);
}

function fail(name, detail = '') {
  failed++;
  results.push({ ok: false, name, detail });
  console.log(`  ❌  ${name}${detail ? ' — ' + detail : ''}`);
}

function section(num, title) {
  console.log(`\n${'─'.repeat(60)}\n  ${num}. ${title}\n${'─'.repeat(60)}`);
}

// ── Setup: crear tenant 2 con usuario, cliente y orden ─────────────────────────
async function setup() {
  section('SETUP', 'Crear tenant 2 de prueba en BD');
  const conn = await db.getConnection();
  try {
    // 1. Insertar tenant 2
    const [t2] = await conn.execute(
      `INSERT INTO b2c_tenant
         (ten_nombre, ten_slug, ten_estado, ten_color_primary, ten_color_accent, ten_plan)
       VALUES (?, ?, 'activo', ?, '#f4a261', 'prueba')`,
      ['Taller Dos TEST', T2_SLUG, T2_COLOR]
    );
    t2TenantId = t2.insertId;
    console.log(`  📦 Tenant 2 creado: uid=${t2TenantId} slug="${T2_SLUG}"`);

    // 2. Usuario admin para tenant 2 (clave en texto plano — se bcryptea en el primer login)
    const [usr] = await conn.execute(
      `INSERT INTO b2c_usuario (usu_nombre, usu_login, usu_clave, usu_tipo, usu_estado, tenant_id)
       VALUES (?, ?, ?, 'A', 'A', ?)`,
      ['Admin T2 Test', T2_ADMIN, T2_PASS, t2TenantId]
    );
    t2UserId = usr.insertId;
    console.log(`  👤 Usuario admin_t2test creado: uid=${t2UserId}`);

    // 3. Cliente en tenant 2
    const [cli] = await conn.execute(
      `INSERT INTO b2c_cliente
         (cli_razon_social, cli_identificacion, cli_telefono, cli_estado, tenant_id)
       VALUES ('Cliente Prueba T2', '900999001', '3001000001', 'A', ?)`,
      [t2TenantId]
    );
    t2ClienteId = cli.insertId;
    console.log(`  🏢 Cliente T2 creado: uid=${t2ClienteId}`);

    // 4. Orden en tenant 2
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const [ord] = await conn.execute(
      `INSERT INTO b2c_orden
         (uid_cliente, ord_consecutivo, ord_estado, ord_fecha, tenant_id)
       VALUES (?, 9999999, 'A', ?, ?)`,
      [t2ClienteId, today, t2TenantId]
    );
    t2OrdenId = ord.insertId;
    console.log(`  📋 Orden T2 creada: uid=${t2OrdenId}`);

    console.log('  ✅  Setup completo');
  } finally {
    conn.release();
  }
}

// ── Cleanup: borrar todo lo creado por el setup ─────────────────────────────────
async function cleanup() {
  section('CLEANUP', 'Eliminar datos de prueba del tenant 2');
  const conn = await db.getConnection();
  try {
    if (t2OrdenId)   await conn.execute(`DELETE FROM b2c_orden     WHERE uid_orden   = ?`, [t2OrdenId]);
    if (t2ClienteId) await conn.execute(`DELETE FROM b2c_cliente   WHERE uid_cliente = ?`, [t2ClienteId]);
    if (t2UserId)    await conn.execute(`DELETE FROM b2c_usuario   WHERE uid_usuario = ?`, [t2UserId]);
    if (t2TenantId)  await conn.execute(`DELETE FROM b2c_tenant    WHERE uid_tenant  = ?`, [t2TenantId]);
    console.log('  ✅  Datos de prueba eliminados');
  } catch (e) {
    console.warn('  ⚠️  Error en cleanup:', e.message);
  } finally {
    conn.release();
  }
}

// ── Sección 1: Config de branding aislada por tenant ───────────────────────────
async function testBrandingIsolation() {
  section(1, 'Config de branding aislada por tenant');

  // Tenant 1 (Host: localhost)
  const r1 = await httpReq('GET', '/api/tenant/config', null, null, 'localhost');
  if (r1.status === 200 && r1.json?.colorPrimary === '#1d3557') {
    ok('Tenant 1 devuelve su color primario', `colorPrimary=${r1.json.colorPrimary}`);
  } else {
    fail('Tenant 1 devuelve su color primario', `HTTP ${r1.status} json=${JSON.stringify(r1.json)}`);
  }

  // Tenant 2 (Host: t2test)
  const r2 = await httpReq('GET', '/api/tenant/config', null, null, T2_SLUG);
  if (r2.status === 200 && r2.json?.colorPrimary === T2_COLOR) {
    ok('Tenant 2 devuelve su color primario', `colorPrimary=${r2.json.colorPrimary}`);
  } else {
    fail('Tenant 2 devuelve su color primario', `HTTP ${r2.status} color=${r2.json?.colorPrimary} (esperaba ${T2_COLOR})`);
  }

  // Nombres distintos
  if (r1.json?.nombre !== r2.json?.nombre) {
    ok('Los tenants tienen nombres diferentes', `"${r1.json?.nombre}" vs "${r2.json?.nombre}"`);
  } else {
    fail('Los tenants tienen nombres diferentes', `ambos responden "${r1.json?.nombre}"`);
  }
}

// ── Sección 2: Login tenant 2 ──────────────────────────────────────────────────
let cookiesT1Admin = '';
let cookiesT2Admin = '';

async function testLoginTenant2() {
  section(2, 'Login tenant 2 exitoso');

  // Login tenant 1 admin (Host: localhost)
  try {
    cookiesT1Admin = await login(CONFIG.adminUser, CONFIG.adminPass, 'localhost');
    const me = await httpReq('GET', '/me', null, cookiesT1Admin, 'localhost');
    const tipo = me.json?.user?.tipo;
    if (me.status === 200 && ['A','F','T'].includes(tipo)) {
      ok('Login tenant 1 admin', `tipo=${tipo} tenant=${me.json?.user?.tenant_id}`);
    } else {
      fail('Login tenant 1 admin', `HTTP ${me.status}`);
      cookiesT1Admin = '';
    }
  } catch (e) {
    fail('Login tenant 1 admin', e.message);
  }

  // Login tenant 2 admin (Host: t2test)
  try {
    cookiesT2Admin = await login(T2_ADMIN, T2_PASS, T2_SLUG);
    const me = await httpReq('GET', '/me', null, cookiesT2Admin, T2_SLUG);
    const tipo = me.json?.user?.tipo;
    const tid  = me.json?.user?.tenant_id;
    if (me.status === 200 && tipo === 'A' && tid === t2TenantId) {
      ok('Login tenant 2 admin', `tipo=${tipo} tenant_id=${tid} ✓`);
    } else {
      fail('Login tenant 2 admin', `HTTP ${me.status} tipo=${tipo} tenant_id=${tid}`);
      cookiesT2Admin = '';
    }
  } catch (e) {
    fail('Login tenant 2 admin', e.message);
  }
}

// ── Sección 3: Sesión cruzada bloqueada ────────────────────────────────────────
async function testCrossTenantSession() {
  section(3, 'Sesión cruzada bloqueada');

  if (!cookiesT1Admin) {
    console.log('  ⚠️  Sin sesión T1 admin — skipped');
    return;
  }
  if (!cookiesT2Admin) {
    console.log('  ⚠️  Sin sesión T2 admin — skipped');
    return;
  }

  // Cookie T1 usada con Host: t2test → debe ser rechazada (401)
  const r1 = await httpReq('GET', '/me', null, cookiesT1Admin, T2_SLUG);
  if (r1.status === 401) {
    ok('Cookie T1 rechazada en tenant 2', `HTTP 401 ✓ — cross-tenant bloqueado`);
  } else {
    fail('Cookie T1 rechazada en tenant 2', `HTTP ${r1.status} — esperaba 401`);
  }

  // Cookie T2 usada con Host: localhost → debe ser rechazada (401)
  const r2 = await httpReq('GET', '/me', null, cookiesT2Admin, 'localhost');
  if (r2.status === 401) {
    ok('Cookie T2 rechazada en tenant 1', `HTTP 401 ✓ — cross-tenant bloqueado`);
  } else {
    fail('Cookie T2 rechazada en tenant 1', `HTTP ${r2.status} — esperaba 401`);
  }

  // Re-login para obtener sesiones frescas (las anteriores fueron destruidas por sessionMatchesTenant)
  cookiesT1Admin = '';
  cookiesT2Admin = '';
  try {
    cookiesT1Admin = await login(CONFIG.adminUser, CONFIG.adminPass, 'localhost');
    ok('Re-login T1 admin tras sesión cruzada', 'sesión restaurada ✓');
  } catch (e) {
    fail('Re-login T1 admin', e.message);
  }
  try {
    cookiesT2Admin = await login(T2_ADMIN, T2_PASS, T2_SLUG);
    ok('Re-login T2 admin tras sesión cruzada', 'sesión restaurada ✓');
  } catch (e) {
    fail('Re-login T2 admin', e.message);
  }

  // Prueba adicional: una sesión T2 no puede ver /api/orders con Host: localhost
  if (cookiesT2Admin) {
    const fresh2 = await login(T2_ADMIN, T2_PASS, T2_SLUG);
    const r3 = await httpReq('GET', '/api/orders?search=&page=1', null, fresh2, 'localhost');
    if (r3.status === 401) {
      ok('Sesión T2 rechazada en /api/orders del tenant 1', `HTTP 401 ✓`);
    } else {
      fail('Sesión T2 rechazada en /api/orders del tenant 1', `HTTP ${r3.status} — esperaba 401`);
    }
  }
}

// ── Sección 4: Tenant 2 no ve datos del tenant 1 ──────────────────────────────
async function testT2CannotSeeT1Data() {
  section(4, 'Tenant 2 no ve datos del tenant 1');

  if (!cookiesT2Admin) {
    console.log('  ⚠️  Sin sesión T2 admin — skipped');
    return;
  }

  // Órdenes: tenant 2 ve 0 órdenes (su única orden 9999999 aún no está en
  // b2c_cotizacion_maquina, así que /api/orders busca en b2c_orden con tenant_id=2)
  const orders = await httpReq('GET', '/api/orders?search=&page=1', null, cookiesT2Admin, T2_SLUG);
  if (orders.status === 200) {
    const list  = Array.isArray(orders.json) ? orders.json : (orders.json?.orders || []);
    const hasT1 = list.some(o => o.tenant_id === 1 || o.tenant_id === undefined && o.uid_orden < t2OrdenId);
    if (!hasT1) {
      ok('Tenant 2 no ve órdenes del tenant 1', `${list.length} orden(es) visible(s) — todas de T2`);
    } else {
      fail('Tenant 2 ve órdenes del tenant 1', `${list.length} órdenes, algunas de otro tenant`);
    }
  } else {
    fail('GET /api/orders como T2', `HTTP ${orders.status}`);
  }

  // Clientes: tenant 2 solo ve sus propios clientes
  const clientes = await httpReq('GET', '/api/clientes/search?q=a&by=nombre', null, cookiesT2Admin, T2_SLUG);
  if (clientes.status === 200 && Array.isArray(clientes.json)) {
    const hasT1Client = clientes.json.some(c => c.tenant_id === 1);
    if (!hasT1Client) {
      ok('Tenant 2 no ve clientes del tenant 1', `${clientes.json.length} cliente(s) visible(s) — todos de T2`);
    } else {
      fail('Tenant 2 ve clientes del tenant 1', `${clientes.json.length} clientes, algunos de otro tenant`);
    }
  } else {
    fail('GET /api/clientes/search como T2', `HTTP ${clientes.status}`);
  }

  // Dashboard: KPIs del tenant 2 deben estar vacíos (0 órdenes de datos reales)
  const dash = await httpReq('GET', '/api/dashboard', null, cookiesT2Admin, T2_SLUG);
  if (dash.status === 200 && dash.json?.kpis) {
    const kpis = dash.json.kpis;
    // No debe tener KPIs con datos del tenant 1
    const totalT2 = Object.values(kpis).reduce((s, v) => s + Number(v || 0), 0);
    ok('Dashboard T2 responde con sus propios KPIs', `total acumulado=${totalT2} (aislado de T1)`);
  } else {
    fail('GET /api/dashboard como T2', `HTTP ${dash.status}`);
  }

  // Funcionarios: tenant 2 no ve los funcionarios del tenant 1
  const funcs = await httpReq('GET', '/api/funcionarios', null, cookiesT2Admin, T2_SLUG);
  if (funcs.status === 200 && Array.isArray(funcs.json)) {
    const hasT1Func = funcs.json.some(f => f.tenant_id === 1);
    if (!hasT1Func) {
      ok('Tenant 2 no ve funcionarios del tenant 1', `${funcs.json.length} funcionario(s) — todos de T2`);
    } else {
      fail('Tenant 2 ve funcionarios del tenant 1', `${funcs.json.length} funcionarios contaminados`);
    }
  } else {
    fail('GET /api/funcionarios como T2', `HTTP ${funcs.status}`);
  }
}

// ── Sección 5: Tenant 1 no ve datos del tenant 2 ──────────────────────────────
async function testT1CannotSeeT2Data() {
  section(5, 'Tenant 1 no ve datos del tenant 2');

  if (!cookiesT1Admin) {
    console.log('  ⚠️  Sin sesión T1 admin — skipped');
    return;
  }

  // Buscar el cliente del tenant 2 desde tenant 1 — no debe aparecer
  const clientes = await httpReq('GET', '/api/clientes/search?q=900999001&by=nombre', null, cookiesT1Admin, 'localhost');
  if (clientes.status === 200 && Array.isArray(clientes.json)) {
    const found = clientes.json.find(c => c.cli_identificacion === '900999001');
    if (!found) {
      ok('Tenant 1 no encuentra el cliente del tenant 2', `0 resultados para identificación T2 ✓`);
    } else {
      fail('Tenant 1 VE el cliente del tenant 2', `encontrado uid=${found.uid_cliente}`);
    }
  } else {
    fail('GET /api/clientes/search como T1', `HTTP ${clientes.status}`);
  }

  // Verificar que la orden T2 no aparece en búsqueda de T1
  const orders = await httpReq('GET', '/api/orders?search=9999999&page=1', null, cookiesT1Admin, 'localhost');
  if (orders.status === 200) {
    const list  = Array.isArray(orders.json) ? orders.json : (orders.json?.orders || []);
    const found = list.find(o => String(o.uid_orden) === String(t2OrdenId));
    if (!found) {
      ok('Tenant 1 no ve la orden del tenant 2', `uid_orden=${t2OrdenId} invisible desde T1 ✓`);
    } else {
      fail('Tenant 1 VE la orden del tenant 2', `uid_orden=${t2OrdenId} es visible — FUGA DE DATOS`);
    }
  } else {
    fail('GET /api/orders como T1', `HTTP ${orders.status}`);
  }

  // Intentar acceder al detalle de la orden T2 desde sesión T1 — debe devolver 404
  const det = await httpReq('GET', `/api/orders/${t2OrdenId}/detalle`, null, cookiesT1Admin, 'localhost');
  if (det.status === 404) {
    ok('Detalle de orden T2 inaccesible desde T1', `HTTP 404 ✓ — no encontrada en tenant 1`);
  } else if (det.status === 200 && det.json?.orden) {
    fail('Detalle de orden T2 visible desde T1', `HTTP 200 — FUGA DE DATOS uid_orden=${t2OrdenId}`);
  } else {
    // 404 o error es el resultado esperado
    ok('Detalle de orden T2 inaccesible desde T1', `HTTP ${det.status}`);
  }

  // Verificar que los funcionarios del T2 no aparecen en T1
  const funcs = await httpReq('GET', '/api/funcionarios', null, cookiesT1Admin, 'localhost');
  if (funcs.status === 200 && Array.isArray(funcs.json)) {
    const found = funcs.json.find(f => String(f.uid_usuario) === String(t2UserId));
    if (!found) {
      ok('Tenant 1 no ve el admin del tenant 2', `uid=${t2UserId} invisible desde T1 ✓`);
    } else {
      fail('Tenant 1 VE el admin del tenant 2', `uid=${t2UserId} expuesto — FUGA DE DATOS`);
    }
  } else {
    fail('GET /api/funcionarios como T1', `HTTP ${funcs.status}`);
  }
}

// ── Sección 6: Hostname desconocido → 404 ─────────────────────────────────────
async function testUnknownTenant() {
  section(6, 'Hostname desconocido devuelve 404');

  const r = await httpReq('GET', '/api/tenant/config', null, null, 'inexistente-taller.com');
  if (r.status === 404) {
    ok('Hostname sin tenant devuelve 404', `HTTP 404 ✓`);
  } else {
    fail('Hostname sin tenant devuelve 404', `HTTP ${r.status} — esperaba 404`);
  }

  const r2 = await httpReq('GET', '/api/orders?search=&page=1', null, null, 'inexistente-taller.com');
  if (r2.status === 404) {
    ok('/api/orders con hostname desconocido → 404', `HTTP 404 ✓`);
  } else {
    fail('/api/orders con hostname desconocido → 404', `HTTP ${r2.status}`);
  }
}

// ── Sección 7: Superadmin ve los dos tenants ────────────────────────────────────
async function testSuperadminSeesAll() {
  section(7, 'Superadmin ve todos los tenants');

  if (!CONFIG.superadminSecret) {
    console.log('  ⚠️  Sin --superadmin-secret — skipped (configura SUPERADMIN_SECRET para ejecutar)');
    return;
  }

  // Login superadmin
  const loginR = await httpReq('POST', '/superadmin/api/login',
    { password: CONFIG.superadminSecret }, null, 'localhost');
  if (loginR.status !== 200 || !loginR.json?.success) {
    fail('Superadmin login', `HTTP ${loginR.status} — ${loginR.json?.error || 'fallo'}`);
    return;
  }
  const saCookies = loginR.setCookie;
  ok('Superadmin login', 'HTTP 200 ✓');

  // Listar tenants
  const listR = await httpReq('GET', '/superadmin/api/tenants', null, saCookies, 'localhost');
  if (listR.status === 200 && Array.isArray(listR.json)) {
    const hasT1 = listR.json.some(t => t.uid_tenant === 1);
    const hasT2 = listR.json.some(t => t.uid_tenant === t2TenantId);
    if (hasT1 && hasT2) {
      ok('Superadmin ve tenant 1 y tenant 2', `${listR.json.length} tenant(s) listado(s)`);
    } else {
      fail('Superadmin ve ambos tenants', `T1=${hasT1} T2(${t2TenantId})=${hasT2}`);
    }
  } else {
    fail('GET /superadmin/api/tenants', `HTTP ${listR.status}`);
  }

  // Logout superadmin
  await httpReq('POST', '/superadmin/api/logout', null, saCookies, 'localhost');
}

// ── Resumen ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   ISOLATION TEST — aislamiento multi-tenant              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  URL:     ${CONFIG.url}`);
  console.log(`  Admin T1: ${CONFIG.adminUser}`);
  console.log(`  Tenant 2 slug: ${T2_SLUG}`);

  let setupOk = false;
  try {
    await setup();
    setupOk = true;
  } catch (e) {
    console.error('\n💥 Setup falló:', e.message);
    process.exit(1);
  }

  try {
    await testBrandingIsolation();
    await testLoginTenant2();
    await testCrossTenantSession();
    await testT2CannotSeeT1Data();
    await testT1CannotSeeT2Data();
    await testUnknownTenant();
    await testSuperadminSeesAll();
  } finally {
    if (setupOk) await cleanup();
  }

  const total = passed + failed;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTADO: ${passed}/${total} tests de aislamiento pasaron`
    .padEnd(58) + '║');
  if (failed === 0) {
    console.log('║  ✅  AISLAMIENTO COMPLETO — ninguna fuga de datos         ║');
  } else {
    console.log(`║  ❌  ${failed} test(s) fallaron`.padEnd(58) + '║');
    results.filter(r => !r.ok).forEach(r => {
      console.log(`║     • ${(r.name + ': ' + r.detail).slice(0,54)}`.padEnd(58) + '║');
    });
  }
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  await db.end().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async e => {
  console.error('\n💥 Error inesperado:', e.message, e.stack);
  await cleanup().catch(() => {});
  await db.end().catch(() => {});
  process.exit(1);
});
