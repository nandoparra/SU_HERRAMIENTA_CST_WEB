'use strict';
const crypto = require('crypto');

/**
 * Enmascara un número de teléfono para la vista de lista.
 * Muestra primeros 3 + '****' + últimos 3 dígitos.
 * Strips prefijo 57 si el número tiene 12 dígitos.
 */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const local  = digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
  if (local.length < 7) return local;
  return local.slice(0, 3) + '****' + local.slice(-3);
}

/**
 * Genera un token opaco y determinístico para identificar una conversación
 * en las URLs del endpoint de detalle, sin exponer el teléfono.
 * Usa HMAC-SHA256 con SESSION_SECRET como clave.
 */
function makeConversacionToken(tenantId, phone, secret) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${tenantId}:${phone}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Resuelve un token de conversación al número de teléfono original.
 * Consulta todos los phones distintos del tenant y compara HMACs.
 * O(N) donde N = números únicos del tenant — aceptable para el volumen actual.
 * Retorna el phone (string) o null si no hay match.
 */
async function resolveConversacionToken(token, conn, tenantId, secret) {
  const [rows] = await conn.execute(
    `SELECT DISTINCT wa_phone FROM b2c_wa_conversacion WHERE tenant_id = ?`,
    [tenantId]
  );
  for (const { wa_phone } of rows) {
    if (makeConversacionToken(tenantId, wa_phone, secret) === token) {
      return wa_phone;
    }
  }
  return null;
}

module.exports = { maskPhone, makeConversacionToken, resolveConversacionToken };
