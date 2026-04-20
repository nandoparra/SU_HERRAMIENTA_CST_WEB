'use strict';
const log = require('./logger');

/**
 * Registra una acción en b2c_audit_log.
 * NUNCA propaga errores — un fallo de auditoría no debe interrumpir la operación principal.
 *
 * @param {object} db         Pool mysql2/promise
 * @param {object} params
 *   tenantId    {number}
 *   userId      {number|null}   uid_usuario del actor (null para acciones de sistema)
 *   accion      {string}        'login_ok', 'orden_creada', 'estado_cambiado', etc.
 *   entidad     {string}        'orden', 'cotizacion', 'cliente', 'usuario', 'superadmin'
 *   uidEntidad  {number|string|null}
 *   datosAntes  {object|null}
 *   datosDespues{object|null}
 *   ip          {string}
 */
async function logAudit(db, { tenantId, userId, accion, entidad, uidEntidad, datosAntes, datosDespues, ip }) {
  try {
    const conn = await db.getConnection();
    try {
      await conn.execute(
        `INSERT INTO b2c_audit_log
           (tenant_id, uid_usuario, accion, entidad, uid_entidad, datos_antes, datos_despues, ip_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId   ?? null,
          userId     ?? null,
          String(accion),
          String(entidad),
          uidEntidad ?? null,
          datosAntes   ? JSON.stringify(datosAntes)   : null,
          datosDespues ? JSON.stringify(datosDespues) : null,
          String(ip || ''),
        ]
      );
    } finally {
      conn.release();
    }
  } catch (e) {
    // Fallar silenciosamente: el audit log nunca debe bloquear la operación principal
    log.warn({ err: e.message, accion, entidad }, 'audit log: INSERT falló (no crítico)');
  }
}

module.exports = { logAudit };
