'use strict';

/**
 * Retorna el uid_tenant del request, con fallback a 1 (tenant por defecto).
 * Centraliza el patrón req.tenant?.uid_tenant ?? 1 que aparecía en ~40 lugares.
 *
 * @param {import('express').Request} req
 * @returns {number}
 */
function getTenantId(req) {
  return Number(req.tenant?.uid_tenant ?? 1);
}

module.exports = { getTenantId };
