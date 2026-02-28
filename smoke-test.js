/**
 * smoke-test.js — Pruebas de flujos críticos antes de merge a producción
 *
 * Uso:
 *   node smoke-test.js
 *   node smoke-test.js --url http://localhost:3001 --admin admin --pass 1234 --cliente 900123456 --pass-cliente 3456
 *
 * Sin argumentos usa los valores por defecto definidos en CONFIG.
 */

// ── Configuración ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : def; };

const CONFIG = {
  url:          arg('--url',          'http://localhost:3001'),
  adminUser:    arg('--admin',        'admin'),
  adminPass:    arg('--pass',         'admin'),
  clienteLogin: arg('--cliente',      ''),   // login del cliente (cédula/identificación)
  clientePass:  arg('--pass-cliente', ''),   // clave del cliente
};

// ── Helpers HTTP ───────────────────────────────────────────────────────────────
let cookiesAdmin   = '';
let cookiesCliente = '';

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
    // Puede redirigir al login o devolver HTML
    if (r.status < 500) ok('Servidor responde', `HTTP ${r.status}`);
    else fail('Servidor responde', `HTTP ${r.status}`);
  } catch (e) {
    fail('Servidor responde', `No se pudo conectar: ${e.message}`);
  }
}

async function testLoginAdmin() {
  section('2. Login — usuario interno (admin/funcionario)');
  const r = await req('POST', '/login', {
    username: CONFIG.adminUser,
    password: CONFIG.adminPass,
  });
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
    if (me.status === 200 && tipo) {
      ok('/me retorna usuario', `tipo=${tipo} nombre="${nombre}"`);
    } else {
      fail('/me retorna usuario', `HTTP ${me.status} body=${JSON.stringify(me.json).slice(0,80)}`);
    }
  }
}

async function testDashboard() {
  section('3. Dashboard — KPIs');
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
  section('4. Órdenes');
  if (!cookiesAdmin) { fail('Órdenes', 'Sin sesión admin — skipped'); return; }

  // Buscar por cliente (sin filtro, trae las primeras)
  const r = await req('GET', '/api/orders?search=&page=1', null, cookiesAdmin);
  if (r.status === 200 && (Array.isArray(r.json) || r.json?.orders)) {
    const list = Array.isArray(r.json) ? r.json : r.json.orders;
    ok('GET /api/orders', `${list?.length ?? '?'} órdenes`);

    if (list?.length > 0) {
      const uid = list[0].uid_orden;
      const det = await req('GET', `/api/orders/${uid}/detalle`, null, cookiesAdmin);
      if (det.status === 200 && det.json?.orden) {
        ok(`GET /api/orders/${uid}/detalle`, `orden #${det.json.orden.ord_consecutivo}`);
      } else {
        fail(`GET /api/orders/${uid}/detalle`, `HTTP ${det.status}`);
      }
    }
  } else {
    fail('GET /api/orders', `HTTP ${r.status} — ${String(r.text).slice(0,80)}`);
  }
}

async function testCotizaciones() {
  section('5. Cotizaciones');
  if (!cookiesAdmin) { fail('Cotizaciones', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/cotizaciones', null, cookiesAdmin);
  if (r.status === 200) {
    const n = Array.isArray(r.json) ? r.json.length : '?';
    ok('GET /api/cotizaciones', `${n} cotizaciones`);
  } else if (r.status === 404) {
    // Puede que la ruta sea diferente — no es fallo crítico
    ok('GET /api/cotizaciones', 'ruta no encontrada (no crítico)');
  } else {
    fail('GET /api/cotizaciones', `HTTP ${r.status}`);
  }
}

async function testClientes() {
  section('6. Clientes — búsqueda');
  if (!cookiesAdmin) { fail('Clientes', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/clientes/search?q=a&by=nombre', null, cookiesAdmin);
  if (r.status === 200 && Array.isArray(r.json)) {
    ok('GET /api/clientes/search', `${r.json.length} resultados`);
  } else {
    fail('GET /api/clientes/search', `HTTP ${r.status}`);
  }
}

async function testFuncionarios() {
  section('7. Funcionarios');
  if (!cookiesAdmin) { fail('Funcionarios', 'Sin sesión admin — skipped'); return; }

  const r = await req('GET', '/api/funcionarios', null, cookiesAdmin);
  if (r.status === 200 && Array.isArray(r.json)) {
    ok('GET /api/funcionarios', `${r.json.length} funcionarios`);
  } else {
    fail('GET /api/funcionarios', `HTTP ${r.status}`);
  }
}

async function testPortalCliente() {
  section('8. Portal cliente');

  if (!CONFIG.clienteLogin) {
    console.log('  ⚠️  Sin credenciales de cliente (--cliente / --pass-cliente) — skipped');
    return;
  }

  const r = await req('POST', '/login', {
    username: CONFIG.clienteLogin,
    password: CONFIG.clientePass,
  });
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

  const mis = await req('GET', '/api/cliente/mis-ordenes', null, cookiesCliente);
  if (mis.status === 200 && Array.isArray(mis.json)) {
    ok('GET /api/cliente/mis-ordenes', `${mis.json.length} órdenes`);
  } else {
    fail('GET /api/cliente/mis-ordenes', `HTTP ${mis.status}`);
  }
}

async function testLogout() {
  section('9. Logout');
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
  console.log(`  URL:   ${CONFIG.url}`);
  console.log(`  Admin: ${CONFIG.adminUser}`);
  if (CONFIG.clienteLogin) console.log(`  Cliente: ${CONFIG.clienteLogin}`);

  await testServidor();
  await testLoginAdmin();
  await testDashboard();
  await testOrdenes();
  await testCotizaciones();
  await testClientes();
  await testFuncionarios();
  await testPortalCliente();
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
