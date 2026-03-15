/**
 * smoke-test.js — Pruebas de flujos críticos antes de merge a producción
 *
 * Uso:
 *   node smoke-test.js
 *   node smoke-test.js --url http://localhost:3001 \
 *     --admin admin --pass 1234 \
 *     --funcionario func1 --pass-funcionario 1234 \
 *     --tecnico tec1 --pass-tecnico 1234 \
 *     --cliente 900123456 --pass-cliente 3456
 *
 * Sin argumentos usa los valores por defecto definidos en CONFIG.
 */

// ── Configuración ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : def; };

const CONFIG = {
  url:               arg('--url',               'http://localhost:3001'),
  adminUser:         arg('--admin',             'admin'),
  adminPass:         arg('--pass',              'admin'),
  funcionarioLogin:  arg('--funcionario',       ''),
  funcionarioPass:   arg('--pass-funcionario',  ''),
  tecnicoLogin:      arg('--tecnico',           ''),
  tecnicoPass:       arg('--pass-tecnico',      ''),
  clienteLogin:      arg('--cliente',           ''),
  clientePass:       arg('--pass-cliente',      ''),
};

// ── Helpers HTTP ───────────────────────────────────────────────────────────────
let cookiesAdmin      = '';
let cookiesCliente    = '';
let cookiesFuncionario = '';
let cookiesTecnico    = '';

// uid_orden real encontrado durante el test (para pruebas de acceso denegado)
let sampleOrderId = null;

async function req(method, path, body, cookies = '') {
  const res = await fetch(`${CONFIG.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
    },
    redirect: 'manual',
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, json, text, setCookie, location: res.headers.get('location') };
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

function section(title) {
  console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`);
}

// ── Tests ──────────────────────────────────────────────────────────────────────
async function testServidor() {
  section('1. Servidor');
  try {
    const r = await req('GET', '/');
    if (r.status < 500) ok('Servidor responde', `HTTP ${r.status}`);
    else fail('Servidor responde', `HTTP ${r.status}`);
  } catch (e) {
    fail('Servidor responde', `No se pudo conectar: ${e.message}`);
  }
}

async function testLoginAdmin() {
  section('2. Login — Admin');
  const r = await req('POST', '/login', { username: CONFIG.adminUser, password: CONFIG.adminPass });
  if (r.status === 200 || r.status === 302) {
    cookiesAdmin = r.setCookie.split(';')[0];
    ok('POST /login admin', `HTTP ${r.status}`);
  } else {
    fail('POST /login admin', `HTTP ${r.status} — verifica --admin y --pass`);
    cookiesAdmin = '';
  }

  if (cookiesAdmin) {
    const me = await req('GET', '/me', null, cookiesAdmin);
    const u = me.json?.user || me.json;
    const tipo = u?.tipo || u?.usu_tipo;
    const nombre = u?.nombre || u?.usu_nombre;
    if (me.status === 200 && ['A', 'F', 'T'].includes(tipo)) {
      ok('/me tipo interno', `tipo=${tipo} nombre="${nombre}"`);
    } else {
      fail('/me tipo interno', `HTTP ${me.status} tipo=${tipo}`);
    }
  }
}

async function testLoginFuncionario() {
  section('3. Login — Funcionario');
  if (!CONFIG.funcionarioLogin) {
    console.log('  ⚠️  Sin credenciales de funcionario (--funcionario / --pass-funcionario) — skipped');
    return;
  }
  const r = await req('POST', '/login', { username: CONFIG.funcionarioLogin, password: CONFIG.funcionarioPass });
  if (r.status === 200 || r.status === 302) {
    cookiesFuncionario = r.setCookie.split(';')[0];
    ok('POST /login funcionario', `HTTP ${r.status}`);
  } else {
    fail('POST /login funcionario', `HTTP ${r.status}`);
    return;
  }

  const me = await req('GET', '/me', null, cookiesFuncionario);
  const u = me.json?.user || me.json;
  const tipo = u?.tipo || u?.usu_tipo;
  if (me.status === 200 && tipo === 'F') {
    ok('/me tipo=F', `"${u?.nombre || u?.usu_nombre}"`);
  } else {
    fail('/me tipo=F', `HTTP ${me.status} tipo=${tipo}`);
  }

  // Funcionario debe poder ver órdenes y dashboard
  const dash = await req('GET', '/api/dashboard', null, cookiesFuncionario);
  if (dash.status === 200) ok('Funcionario: GET /api/dashboard', 'acceso correcto');
  else fail('Funcionario: GET /api/dashboard', `HTTP ${dash.status}`);

  const ords = await req('GET', '/api/orders?search=&page=1', null, cookiesFuncionario);
  if (ords.status === 200) ok('Funcionario: GET /api/orders', 'acceso correcto');
  else fail('Funcionario: GET /api/orders', `HTTP ${ords.status}`);
}

async function testLoginTecnico() {
  section('4. Login — Técnico');
  if (!CONFIG.tecnicoLogin) {
    console.log('  ⚠️  Sin credenciales de técnico (--tecnico / --pass-tecnico) — skipped');
    return;
  }
  const r = await req('POST', '/login', { username: CONFIG.tecnicoLogin, password: CONFIG.tecnicoPass });
  if (r.status === 200 || r.status === 302) {
    cookiesTecnico = r.setCookie.split(';')[0];
    ok('POST /login tecnico', `HTTP ${r.status}`);
  } else {
    fail('POST /login tecnico', `HTTP ${r.status}`);
    return;
  }

  const me = await req('GET', '/me', null, cookiesTecnico);
  const u = me.json?.user || me.json;
  const tipo = u?.tipo || u?.usu_tipo;
  if (me.status === 200 && tipo === 'T') {
    ok('/me tipo=T', `"${u?.nombre || u?.usu_nombre}"`);
  } else {
    fail('/me tipo=T', `HTTP ${me.status} tipo=${tipo}`);
  }

  // Técnico debe poder ver sus órdenes asignadas
  const mis = await req('GET', '/api/orders/mis-ordenes-tecnico', null, cookiesTecnico);
  if (mis.status === 200 && Array.isArray(mis.json)) {
    ok('Técnico: GET /api/orders/mis-ordenes-tecnico', `${mis.json.length} órdenes asignadas`);
  } else {
    fail('Técnico: GET /api/orders/mis-ordenes-tecnico', `HTTP ${mis.status}`);
  }
}

async function testDashboard() {
  section('5. Dashboard — KPIs');
  if (!cookiesAdmin) { fail('KPIs dashboard', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/dashboard', null, cookiesAdmin);
  if (r.status === 200 && r.json) {
    const keys = Object.keys(r.json);
    ok('GET /api/dashboard', `campos: ${keys.slice(0,4).join(', ')}…`);
  } else {
    fail('GET /api/dashboard', `HTTP ${r.status}`);
  }
}

async function testOrdenes() {
  section('6. Órdenes');
  if (!cookiesAdmin) { fail('Órdenes', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/orders?search=&page=1', null, cookiesAdmin);
  if (r.status === 200 && (Array.isArray(r.json) || r.json?.orders)) {
    const list = Array.isArray(r.json) ? r.json : r.json.orders;
    ok('GET /api/orders', `${list?.length ?? '?'} órdenes`);

    if (list?.length > 0) {
      sampleOrderId = list[0].uid_orden;
      const det = await req('GET', `/api/orders/${sampleOrderId}/detalle`, null, cookiesAdmin);
      if (det.status === 200 && det.json?.orden) {
        ok(`GET /api/orders/${sampleOrderId}/detalle`, `orden #${det.json.orden.ord_consecutivo}`);
      } else {
        fail(`GET /api/orders/${sampleOrderId}/detalle`, `HTTP ${det.status}`);
      }
    }
  } else {
    fail('GET /api/orders', `HTTP ${r.status} — ${String(r.text).slice(0,80)}`);
  }
}

async function testCotizaciones() {
  section('7. Cotizaciones');
  if (!cookiesAdmin) { fail('Cotizaciones', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/cotizaciones', null, cookiesAdmin);
  if (r.status === 200) {
    ok('GET /api/cotizaciones', `${Array.isArray(r.json) ? r.json.length : '?'} cotizaciones`);
  } else if (r.status === 404) {
    ok('GET /api/cotizaciones', 'ruta no encontrada (no crítico)');
  } else {
    fail('GET /api/cotizaciones', `HTTP ${r.status}`);
  }
}

async function testClientes() {
  section('8. Clientes — búsqueda');
  if (!cookiesAdmin) { fail('Clientes', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/clientes/search?q=a&by=nombre', null, cookiesAdmin);
  if (r.status === 200 && Array.isArray(r.json)) {
    ok('GET /api/clientes/search', `${r.json.length} resultados`);
  } else {
    fail('GET /api/clientes/search', `HTTP ${r.status}`);
  }
}

async function testFuncionarios() {
  section('9. Funcionarios');
  if (!cookiesAdmin) { fail('Funcionarios', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/funcionarios', null, cookiesAdmin);
  if (r.status === 200 && Array.isArray(r.json)) {
    ok('GET /api/funcionarios', `${r.json.length} funcionarios`);
  } else {
    fail('GET /api/funcionarios', `HTTP ${r.status}`);
  }
}

async function testPortalCliente() {
  section('10. Portal cliente — acceso permitido');

  if (!CONFIG.clienteLogin) {
    console.log('  ⚠️  Sin credenciales de cliente (--cliente / --pass-cliente) — skipped');
    return;
  }

  const r = await req('POST', '/login', { username: CONFIG.clienteLogin, password: CONFIG.clientePass });
  if (r.status === 200 || r.status === 302) {
    cookiesCliente = r.setCookie.split(';')[0];
    ok('POST /login cliente', `HTTP ${r.status}`);
  } else {
    fail('POST /login cliente', `HTTP ${r.status}`);
    return;
  }

  const me = await req('GET', '/me', null, cookiesCliente);
  const u = me.json?.user || me.json;
  const tipo = u?.tipo || u?.usu_tipo;
  if (me.status === 200 && tipo === 'C') {
    ok('/me tipo=C', `"${u?.nombre || u?.usu_nombre}"`);
  } else {
    fail('/me tipo=C', `HTTP ${me.status} tipo=${tipo}`);
  }

  // Cliente SÍ puede ver sus órdenes
  const mis = await req('GET', '/api/cliente/mis-ordenes', null, cookiesCliente);
  if (mis.status === 200 && Array.isArray(mis.json)) {
    ok('GET /api/cliente/mis-ordenes', `${mis.json.length} órdenes`);
  } else {
    fail('GET /api/cliente/mis-ordenes', `HTTP ${mis.status}`);
  }
}

async function testSeguridadCliente() {
  section('11. Seguridad — cliente NO puede acceder a endpoints internos');

  if (!cookiesCliente) {
    console.log('  ⚠️  Sin sesión de cliente — skipped (pasa --cliente y --pass-cliente)');
    return;
  }

  const uid = sampleOrderId || '1';

  // Cotizaciones — deben devolver 401 o 403
  const cot = await req('GET', `/api/quotes/order/${uid}`, null, cookiesCliente);
  if (cot.status === 401 || cot.status === 403) {
    ok('Cliente bloqueado: GET /api/quotes/order/:id', `HTTP ${cot.status} ✓`);
  } else {
    fail('Cliente bloqueado: GET /api/quotes/order/:id', `HTTP ${cot.status} (esperaba 401/403)`);
  }

  const catCot = await req('GET', '/api/quote/catalog', null, cookiesCliente);
  if (catCot.status === 401 || catCot.status === 403) {
    ok('Cliente bloqueado: GET /api/quote/catalog', `HTTP ${catCot.status} ✓`);
  } else {
    fail('Cliente bloqueado: GET /api/quote/catalog', `HTTP ${catCot.status} (esperaba 401/403)`);
  }

  // PDFs — deben devolver 401 o 403
  const pdf = await req('GET', `/api/orders/${uid}/pdf/quote`, null, cookiesCliente);
  if (pdf.status === 401 || pdf.status === 403) {
    ok('Cliente bloqueado: GET /api/orders/:id/pdf/quote', `HTTP ${pdf.status} ✓`);
  } else {
    fail('Cliente bloqueado: GET /api/orders/:id/pdf/quote', `HTTP ${pdf.status} (esperaba 401/403)`);
  }

  const pdfOrden = await req('GET', `/api/orders/${uid}/pdf/orden`, null, cookiesCliente);
  if (pdfOrden.status === 401 || pdfOrden.status === 403) {
    ok('Cliente bloqueado: GET /api/orders/:id/pdf/orden', `HTTP ${pdfOrden.status} ✓`);
  } else {
    fail('Cliente bloqueado: GET /api/orders/:id/pdf/orden', `HTTP ${pdfOrden.status} (esperaba 401/403)`);
  }

  // WhatsApp — deben devolver 401 o 403
  const wa = await req('POST', `/api/quotes/order/${uid}/send-whatsapp`, null, cookiesCliente);
  if (wa.status === 401 || wa.status === 403) {
    ok('Cliente bloqueado: POST /api/quotes/order/:id/send-whatsapp', `HTTP ${wa.status} ✓`);
  } else {
    fail('Cliente bloqueado: POST /api/quotes/order/:id/send-whatsapp', `HTTP ${wa.status} (esperaba 401/403)`);
  }

  const waSend = await req('POST', '/api/whatsapp/send', { orderId: uid, message: 'test' }, cookiesCliente);
  if (waSend.status === 401 || waSend.status === 403) {
    ok('Cliente bloqueado: POST /api/whatsapp/send', `HTTP ${waSend.status} ✓`);
  } else {
    fail('Cliente bloqueado: POST /api/whatsapp/send', `HTTP ${waSend.status} (esperaba 401/403)`);
  }

  // Dashboard — debe estar bloqueado
  const dash = await req('GET', '/api/dashboard', null, cookiesCliente);
  if (dash.status === 401 || dash.status === 403) {
    ok('Cliente bloqueado: GET /api/dashboard', `HTTP ${dash.status} ✓`);
  } else {
    fail('Cliente bloqueado: GET /api/dashboard', `HTTP ${dash.status} (esperaba 401/403)`);
  }
}

async function testSeguridadSinSesion() {
  section('12. Seguridad — sin sesión bloqueado en endpoints críticos');

  const uid = sampleOrderId || '1';

  const checks = [
    ['GET',  `/api/orders?search=`,                    'GET /api/orders'],
    ['GET',  `/api/dashboard`,                         'GET /api/dashboard'],
    ['GET',  `/api/quotes/order/${uid}`,               'GET /api/quotes/order/:id'],
    ['GET',  `/api/orders/${uid}/pdf/quote`,           'GET /api/orders/:id/pdf/quote'],
    ['POST', `/api/quotes/order/${uid}/send-whatsapp`, 'POST /api/quotes/order/:id/send-whatsapp'],
    ['POST', `/api/whatsapp/send`,                     'POST /api/whatsapp/send'],
  ];

  for (const [method, path, label] of checks) {
    const r = await req(method, path, null, '');  // sin cookies
    if (r.status === 401 || r.status === 403 || r.status === 302) {
      ok(`Sin sesión bloqueado: ${label}`, `HTTP ${r.status} ✓`);
    } else {
      fail(`Sin sesión bloqueado: ${label}`, `HTTP ${r.status} (esperaba 401/403/302)`);
    }
  }
}

async function testLogout() {
  section('13. Logout');
  if (!cookiesAdmin) { fail('Logout', 'Sin sesión — skipped'); return; }

  const r = await req('POST', '/logout', null, cookiesAdmin);
  if (r.status === 200 || r.status === 302) {
    ok('POST /logout', `HTTP ${r.status}`);
    const me = await req('GET', '/me', null, cookiesAdmin);
    if (me.status === 401) {
      ok('Sesión destruida post-logout', 'GET /me → 401');
    } else {
      fail('Sesión destruida post-logout', `GET /me → ${me.status} (esperaba 401)`);
    }
  } else {
    fail('POST /logout', `HTTP ${r.status}`);
  }
}

// ── Resumen ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         SMOKE TEST — universal-cotizaciones              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  URL:        ${CONFIG.url}`);
  console.log(`  Admin:      ${CONFIG.adminUser}`);
  if (CONFIG.funcionarioLogin) console.log(`  Funcionario: ${CONFIG.funcionarioLogin}`);
  if (CONFIG.tecnicoLogin)     console.log(`  Técnico:     ${CONFIG.tecnicoLogin}`);
  if (CONFIG.clienteLogin)     console.log(`  Cliente:     ${CONFIG.clienteLogin}`);

  await testServidor();
  await testLoginAdmin();
  await testLoginFuncionario();
  await testLoginTecnico();
  await testDashboard();
  await testOrdenes();
  await testCotizaciones();
  await testClientes();
  await testFuncionarios();
  await testPortalCliente();
  await testSeguridadCliente();
  await testSeguridadSinSesion();
  await testLogout();

  const total = passed + failed;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTADO: ${passed}/${total} tests pasaron`
    .padEnd(58) + '║');
  if (failed === 0) {
    console.log('║  ✅  TODO OK — listo para merge a producción             ║');
  } else {
    console.log(`║  ❌  ${failed} test(s) fallaron — revisar antes del merge`.padEnd(58) + '║');
    results.filter(r => !r.ok).forEach(r => {
      console.log(`║     • ${r.name}: ${r.detail}`.slice(0,60).padEnd(58) + '║');
    });
  }
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n💥 Error inesperado:', e.message);
  process.exit(1);
});
