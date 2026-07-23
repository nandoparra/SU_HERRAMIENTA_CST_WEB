'use strict';
// SEC-12: Control de acceso por rol.
// requireInterno (A/F/T) era el único gate para ~87 endpoints.
// Se agrega requireAdminFuncionario (A/F) y requireAdmin (A) para restringir
// endpoints que técnicos y/o funcionarios no deben poder usar.
//
// Tests unitarios (corren sin servidor): middlewares + lógica inline de estados.
// Tests de integración (requieren servidor + DB): 403 explícito por router.

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  requireAdminFuncionario,
  requireAdmin,
} = require('../middleware/auth');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeReq({ tipo, url = '/api/test', tenant = 1, pwdMustChange = false } = {}) {
  return {
    session: tipo
      ? { user: { tipo, tenant_id: tenant, pwd_must_change: pwdMustChange }, destroy: (cb) => cb() }
      : { user: null, destroy: (cb) => cb() },
    originalUrl: url,
    path: url,
    xhr: false,
    headers: {},
    tenant: { uid_tenant: tenant },
  };
}

function makeRes() {
  const res = {
    _status: null,
    _json: null,
    _redirect: null,
    status(code) {
      res._status = code;
      return { json(body) { res._json = body; } };
    },
    redirect(url) { res._redirect = url; },
  };
  return res;
}

function makeNext() {
  let called = false;
  const fn = () => { called = true; };
  Object.defineProperty(fn, 'called', { get: () => called });
  return fn;
}

// ── requireAdminFuncionario — tests unitarios ─────────────────────────────────

describe('requireAdminFuncionario — middleware unitario', () => {
  it('tipo T en ruta /api/ → 403 JSON', () => {
    const req = makeReq({ tipo: 'T', url: '/api/orders/1/assign-technician' });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.strictEqual(res._status, 403);
    assert.ok(res._json?.error, 'debe incluir campo error');
    assert.ok(!next.called, 'next NO debe haber sido llamado');
  });

  it('tipo C (cliente) en ruta /api/ → 403', () => {
    const req = makeReq({ tipo: 'C', url: '/api/recibos' });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.strictEqual(res._status, 403);
    assert.ok(!next.called);
  });

  it('sin sesión en /api/ → 401', () => {
    const req = makeReq({ tipo: null, url: '/api/funcionarios' });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.strictEqual(res._status, 401);
    assert.ok(!next.called);
  });

  it('tipo T en ruta HTML → redirect (no JSON)', () => {
    const req = makeReq({ tipo: 'T', url: '/crear-orden.html' });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.ok(res._redirect, 'debe redirigir');
    assert.strictEqual(res._status, null, 'no debe llamar a .status()');
    assert.ok(!next.called);
  });

  it('tipo A → next()', () => {
    const req = makeReq({ tipo: 'A', url: '/api/recibos' });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.ok(next.called, 'next debe haber sido llamado para tipo A');
    assert.strictEqual(res._status, null);
  });

  it('tipo F → next()', () => {
    const req = makeReq({ tipo: 'F', url: '/api/cotizaciones/pendientes' });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.ok(next.called, 'next debe haber sido llamado para tipo F');
    assert.strictEqual(res._status, null);
  });

  it('pwd_must_change=true en /api/ → 403 con mensaje de contraseña', () => {
    const req = makeReq({ tipo: 'F', url: '/api/recibos', pwdMustChange: true });
    const res = makeRes();
    const next = makeNext();
    requireAdminFuncionario(req, res, next);
    assert.strictEqual(res._status, 403);
    assert.ok(res._json?.error?.includes('contraseña'), `error esperado "contraseña", recibido: ${res._json?.error}`);
    assert.ok(!next.called);
  });
});

// ── requireAdmin — tests unitarios ────────────────────────────────────────────

describe('requireAdmin — middleware unitario', () => {
  it('tipo F → 403 Solo administradores', () => {
    const req = makeReq({ tipo: 'F', url: '/api/health' });
    const res = makeRes();
    const next = makeNext();
    requireAdmin(req, res, next);
    assert.strictEqual(res._status, 403);
    assert.ok(res._json?.error?.includes('administrador'), `error inesperado: ${res._json?.error}`);
    assert.ok(!next.called);
  });

  it('tipo T → 403', () => {
    const req = makeReq({ tipo: 'T', url: '/api/health' });
    const res = makeRes();
    const next = makeNext();
    requireAdmin(req, res, next);
    assert.strictEqual(res._status, 403);
    assert.ok(!next.called);
  });

  it('sin sesión → 401', () => {
    const req = makeReq({ tipo: null, url: '/api/health' });
    const res = makeRes();
    const next = makeNext();
    requireAdmin(req, res, next);
    assert.strictEqual(res._status, 401);
    assert.ok(!next.called);
  });

  it('tipo A → next()', () => {
    const req = makeReq({ tipo: 'A', url: '/api/health' });
    const res = makeRes();
    const next = makeNext();
    requireAdmin(req, res, next);
    assert.ok(next.called, 'next debe haber sido llamado para tipo A');
    assert.strictEqual(res._status, null);
  });
});

// ── restricción de estados para técnico en PATCH /equipment-order/:id/status ──
// La lógica inline en routes/orders.js es:
//   const ESTADOS_TECNICO = ['pendiente_revision', 'revisada', 'reparada'];
//   if (tipo === 'T' && !ESTADOS_TECNICO.includes(status)) → 403
// Se prueba aquí como función pura para documentar el contrato sin servidor.

describe('restricción de estados técnico — PATCH individual /status', () => {
  const ESTADOS_TECNICO = ['pendiente_revision', 'revisada', 'reparada'];

  function estadoPermitido(tipo, estado) {
    if (tipo === 'T') return ESTADOS_TECNICO.includes(estado);
    return true;
  }

  it('T + pendiente_revision → permitido', () => {
    assert.ok(estadoPermitido('T', 'pendiente_revision'));
  });

  it('T + revisada → permitido', () => {
    assert.ok(estadoPermitido('T', 'revisada'));
  });

  it('T + reparada → permitido', () => {
    assert.ok(estadoPermitido('T', 'reparada'));
  });

  it('T + cotizada → bloqueado', () => {
    assert.ok(!estadoPermitido('T', 'cotizada'));
  });

  it('T + autorizada → bloqueado', () => {
    assert.ok(!estadoPermitido('T', 'autorizada'));
  });

  it('T + no_autorizada → bloqueado', () => {
    assert.ok(!estadoPermitido('T', 'no_autorizada'));
  });

  it('T + entregada → bloqueado (tiene endpoint dedicado /entregar)', () => {
    assert.ok(!estadoPermitido('T', 'entregada'));
  });

  it('A + cotizada → permitido (sin restricción por rol)', () => {
    assert.ok(estadoPermitido('A', 'cotizada'));
  });

  it('F + no_autorizada → permitido', () => {
    assert.ok(estadoPermitido('F', 'no_autorizada'));
  });
});

// ── tests de integración (requieren servidor corriendo en localhost:3001) ─────
// Clasificación: INTEGRATION — fallan sin servidor (ECONNREFUSED esperado).
// Cubren un endpoint representativo por router restringido.
// Ver nota en CLAUDE.md sección "Clasificación de tests".

const BASE = 'http://localhost:3001/api';

async function loginAs(login, clave) {
  const r = await fetch(`http://localhost:3001/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: login, password: clave }),
    redirect: 'manual',
  });
  const setCookie = r.headers.get('set-cookie') || '';
  const match = setCookie.match(/(connect\.sid=[^;]+)/);
  return match ? match[1] : null;
}

async function req403(cookie, method, path) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: method !== 'GET' ? JSON.stringify({}) : undefined,
  });
  return r.status;
}

// Credenciales: técnico debe existir con tipo T — usar el de prueba local.
// Ajustar login/clave según entorno de test.
const TEC_LOGIN = process.env.TEST_TEC_LOGIN || 'JSALAZAR';
const TEC_PASS  = process.env.TEST_TEC_PASS  || '123456';
const FUN_LOGIN = process.env.TEST_FUN_LOGIN || 'MZAPATA';
const FUN_PASS  = process.env.TEST_FUN_PASS  || '123456';

describe('SEC-12 integración — técnico bloqueado (requiere servidor)', () => {
  let cookieTec = null;

  it('setup: login como técnico', async () => {
    cookieTec = await loginAs(TEC_LOGIN, TEC_PASS);
    assert.ok(cookieTec, 'debe obtener cookie de sesión técnico');
  });

  // orders.js — asignación técnico
  it('T PATCH /equipment-order/1/assign-technician → 403', async () => {
    const status = await req403(cookieTec, 'PATCH', '/equipment-order/1/assign-technician');
    assert.strictEqual(status, 403);
  });

  // orders-notificaciones.js
  it('T POST /orders/1/notify-parts → 403', async () => {
    const status = await req403(cookieTec, 'POST', '/orders/1/notify-parts');
    assert.strictEqual(status, 403);
  });

  // quote.js
  it('T POST /quotes/machine → 403', async () => {
    const status = await req403(cookieTec, 'POST', '/quotes/machine');
    assert.strictEqual(status, 403);
  });

  it('T GET /quote/catalog → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/quote/catalog');
    assert.strictEqual(status, 403);
  });

  // crear-orden.js
  it('T POST /crear-orden/cliente → 403', async () => {
    const status = await req403(cookieTec, 'POST', '/crear-orden/cliente');
    assert.strictEqual(status, 403);
  });

  // pdf.js
  it('T GET /orders/1/pdf/quote → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/orders/1/pdf/quote');
    assert.strictEqual(status, 403);
  });

  // whatsapp.js
  it('T POST /whatsapp/reset → 403', async () => {
    const status = await req403(cookieTec, 'POST', '/whatsapp/reset');
    assert.strictEqual(status, 403);
  });

  it('T POST /whatsapp/send → 403', async () => {
    const status = await req403(cookieTec, 'POST', '/whatsapp/send');
    assert.strictEqual(status, 403);
  });

  // recibos.js
  it('T GET /recibos → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/recibos');
    assert.strictEqual(status, 403);
  });

  // dashboard.js — KPIs
  it('T GET /dashboard → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/dashboard');
    assert.strictEqual(status, 403);
  });

  // dashboard.js — funcionarios
  it('T GET /funcionarios → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/funcionarios');
    assert.strictEqual(status, 403);
  });

  // dashboard.js — inventario
  it('T GET /inventario → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/inventario');
    assert.strictEqual(status, 403);
  });

  // dashboard.js — cotizaciones pendientes
  it('T GET /cotizaciones/pendientes → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/cotizaciones/pendientes');
    assert.strictEqual(status, 403);
  });

  // financiero.js
  it('T GET /financiero/config → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/financiero/config');
    assert.strictEqual(status, 403);
  });

  // wa-conversaciones.js
  it('T GET /wa/conversaciones → 403', async () => {
    const status = await req403(cookieTec, 'GET', '/wa/conversaciones');
    assert.strictEqual(status, 403);
  });

  // fotos-recepcion
  it('T POST /orders/1/fotos-recepcion/1 → 403', async () => {
    const status = await req403(cookieTec, 'POST', '/orders/1/fotos-recepcion/1');
    assert.strictEqual(status, 403);
  });

  it('T DELETE /orders/fotos-recepcion/1 → 403', async () => {
    const status = await req403(cookieTec, 'DELETE', '/orders/fotos-recepcion/1');
    assert.strictEqual(status, 403);
  });
});

describe('SEC-12 integración — funcionario bloqueado en admin-only (requiere servidor)', () => {
  let cookieFun = null;

  it('setup: login como funcionario', async () => {
    cookieFun = await loginAs(FUN_LOGIN, FUN_PASS);
    assert.ok(cookieFun, 'debe obtener cookie de sesión funcionario');
  });

  it('F GET /health → bloqueado (302 redirect o 403 — /health no es ruta /api/)', async () => {
    // /health no está bajo /api/ → requireAdmin redirige con 302 en vez de retornar 403 JSON.
    // Ambos comportamientos deniegan acceso al funcionario: 302 redirige lejos, 403 devuelve error.
    const r = await fetch(`http://localhost:3001/health`, {
      headers: { Cookie: cookieFun },
      redirect: 'manual',
    });
    assert.ok(r.status === 302 || r.status === 403,
      `esperado 302 (redirect) o 403, recibido ${r.status}`);
  });
});

describe('SEC-12 integración — técnico SÍ puede acceder a sus endpoints (requiere servidor)', () => {
  let cookieTec = null;

  it('setup: login como técnico', async () => {
    cookieTec = await loginAs(TEC_LOGIN, TEC_PASS);
    assert.ok(cookieTec, 'debe obtener cookie');
  });

  it('T GET /orders → requireInterno pasa al técnico (no bloqueado por requireAdminFuncionario)', async () => {
    const r = await fetch(`${BASE}/orders`, { headers: { Cookie: cookieTec } });
    // 200/400: acceso OK. 403 por pwd_must_change: requireInterno pasó (correcto).
    // Si r.status === 403 verificamos que NO sea "Acceso denegado" (eso indicaría bug).
    if (r.status === 403) {
      const body = await r.json().catch(() => ({}));
      assert.ok(!body.error?.toLowerCase().includes('denegado'),
        `requireAdminFuncionario bloqueó /orders al técnico incorrectamente: ${body.error}`);
    } else {
      assert.ok(r.status === 200 || r.status === 400, `esperado 200/400, recibido ${r.status}`);
    }
  });

  it('T GET /clientes/search?q=test → requireInterno pasa al técnico', async () => {
    const r = await fetch(`${BASE}/clientes/search?q=test`, { headers: { Cookie: cookieTec } });
    if (r.status === 403) {
      const body = await r.json().catch(() => ({}));
      assert.ok(!body.error?.toLowerCase().includes('denegado'),
        `requireAdminFuncionario bloqueó /clientes/search al técnico incorrectamente: ${body.error}`);
    } else {
      assert.ok(r.status === 200, `esperado 200, recibido ${r.status}`);
    }
  });

  it('T GET /whatsapp/status → requireInterno pasa al técnico', async () => {
    const r = await fetch(`${BASE}/whatsapp/status`, { headers: { Cookie: cookieTec } });
    if (r.status === 403) {
      const body = await r.json().catch(() => ({}));
      assert.ok(!body.error?.toLowerCase().includes('denegado'),
        `requireAdminFuncionario bloqueó /whatsapp/status al técnico incorrectamente: ${body.error}`);
    } else {
      assert.ok(r.status === 200, `esperado 200, recibido ${r.status}`);
    }
  });
});
