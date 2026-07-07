'use strict';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

/**
 * Construye el header Authorization Basic para Alegra.
 * Acepta user/token explícitos (para multi-tenant) o lee las env vars globales.
 */
function buildAuthHeader(user, token) {
  const u = user  || process.env.ALEGRA_USER  || '';
  const t = token || process.env.ALEGRA_TOKEN || '';
  if (!u || !t) {
    throw new Error('Credenciales de Alegra no configuradas (ALEGRA_USER / ALEGRA_TOKEN)');
  }
  return 'Basic ' + Buffer.from(`${u}:${t}`).toString('base64');
}

async function alegraGet(path, opts = {}) {
  const resp = await fetch(`${ALEGRA_BASE}${path}`, {
    method:  'GET',
    headers: {
      'Authorization': buildAuthHeader(opts.user, opts.token),
      'Accept':        'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err      = new Error(`Alegra ${resp.status}: ${body?.message || resp.statusText}`);
    err.status     = resp.status;
    err.alegraBody = body;
    throw err;
  }
  return body;
}

async function alegraPost(path, data, opts = {}) {
  const resp = await fetch(`${ALEGRA_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Authorization': buildAuthHeader(opts.user, opts.token),
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body:   JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err      = new Error(`Alegra ${resp.status}: ${body?.message || resp.statusText}`);
    err.status     = resp.status;
    err.alegraBody = body;
    throw err;
  }
  return body;
}

module.exports = { alegraGet, alegraPost, buildAuthHeader };
