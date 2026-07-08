'use strict';

// Estados con equipo aún en el taller (no finalizados)
const ESTADOS_ACTIVOS =
  `'pendiente_revision','revisada','cotizada','autorizada','reparada'`;

const ESTADOS_LABEL = {
  pendiente_revision: 'Pendiente de revisión',
  revisada:          'Revisada — pendiente de cotización',
  cotizada:          'Cotizada — pendiente de autorizar',
  autorizada:        'Autorizada — en reparación',
  reparada:          'Reparada — lista para recoger ✅',
  entregada:         'Entregada',
  no_autorizada:     'No autorizada',
};

/**
 * Normaliza el número de Baileys ("573104650437") a 10 dígitos colombianos ("3104650437").
 */
function normalizePhone(senderPhone) {
  const digits = String(senderPhone).replace(/\D/g, '');
  const sin57 = digits.startsWith('57') ? digits.slice(2) : digits;
  return sin57.slice(-10);
}

/**
 * Busca al cliente por teléfono (cli_telefono o cli_tel_contacto).
 * Ignora espacios, guiones y prefijo +57 en el campo guardado en BD.
 */
async function findClienteByPhone(conn, senderPhone, tenantId) {
  const phone10 = normalizePhone(senderPhone);
  if (phone10.length < 9) return null;

  const [rows] = await conn.execute(
    `SELECT c.uid_cliente, c.cli_razon_social, c.cli_contacto, c.cli_identificacion
     FROM b2c_cliente c
     WHERE c.tenant_id = ?
       AND (
         REPLACE(REPLACE(REPLACE(c.cli_telefono,      ' ', ''), '-', ''), '+57', '') LIKE ?
         OR REPLACE(REPLACE(REPLACE(c.cli_tel_contacto,' ', ''), '-', ''), '+57', '') LIKE ?
       )
     LIMIT 1`,
    [tenantId, `%${phone10}`, `%${phone10}`]
  );
  return rows[0] || null;
}

/**
 * Construye el contexto completo del cliente para el agente IA.
 *
 * Retorna null si el número no corresponde a ningún cliente registrado.
 *
 * @param {object} conn — conexión MySQL activa
 * @param {string} senderPhone — número de Baileys (ej: "573104650437")
 * @param {number} tenantId
 * @returns {object|null}
 *   {
 *     cliente:             { nombre, identificacion },
 *     ordenesActivas:      [{ consecutivo, fecha, maquinas: [{ her_nombre, her_marca, her_estado, subtotal }] }],
 *     historial:           [{ ord_consecutivo, ord_fecha, total_maquinas }],
 *     cotizacionPendiente: { uid_orden, ord_consecutivo, total } | null,
 *   }
 */
async function buildContextoCliente(conn, senderPhone, tenantId) {
  const cliente = await findClienteByPhone(conn, senderPhone, tenantId);
  if (!cliente) return null;

  const nombre = cliente.cli_razon_social || cliente.cli_contacto || 'Cliente';

  // ── Órdenes con al menos una máquina en estado activo ────────────────────
  const [ordenes] = await conn.execute(
    `SELECT o.uid_orden, o.ord_consecutivo, o.ord_fecha
     FROM b2c_orden o
     WHERE o.uid_cliente = ? AND o.tenant_id = ?
       AND EXISTS (
         SELECT 1 FROM b2c_herramienta_orden ho
         WHERE ho.uid_orden = o.uid_orden
           AND ho.her_estado IN (${ESTADOS_ACTIVOS})
       )
     ORDER BY o.uid_orden DESC
     LIMIT 5`,
    [cliente.uid_cliente, tenantId]
  );

  // ── Máquinas por orden activa (con cotización si existe) ──────────────────
  const ordenesConDetalle = await Promise.all(ordenes.map(async (o) => {
    const [maquinas] = await conn.execute(
      `SELECT h.her_nombre, h.her_marca, ho.her_estado, cm.subtotal
       FROM b2c_herramienta_orden ho
       JOIN b2c_herramienta h ON h.uid_herramienta = ho.uid_herramienta
       LEFT JOIN b2c_cotizacion_maquina cm
              ON CAST(cm.uid_herramienta_orden AS CHAR) = CAST(ho.uid_herramienta_orden AS CHAR)
       WHERE ho.uid_orden = ?
         AND ho.her_estado IN (${ESTADOS_ACTIVOS})
       ORDER BY ho.uid_herramienta_orden`,
      [o.uid_orden]
    );

    // Convertir ord_fecha YYYYMMDD → DD/MM/YYYY
    const raw = String(o.ord_fecha);
    const dm = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    const fechaLeg = dm ? `${dm[3]}/${dm[2]}/${dm[1]}` : raw;

    return {
      consecutivo: o.ord_consecutivo,
      fecha:       fechaLeg,
      maquinas:    maquinas.map(m => ({
        her_nombre: m.her_nombre,
        her_marca:  m.her_marca,
        her_estado: m.her_estado,
        estadoLabel: ESTADOS_LABEL[m.her_estado] || m.her_estado,
        subtotal:   m.subtotal != null ? Number(m.subtotal) : null,
      })),
    };
  }));

  // ── Historial: últimas 3 órdenes con máquinas entregadas ─────────────────
  const [historial] = await conn.execute(
    `SELECT o.ord_consecutivo, o.ord_fecha,
            COUNT(ho.uid_herramienta_orden) AS total_maquinas
     FROM b2c_orden o
     JOIN b2c_herramienta_orden ho
          ON ho.uid_orden = o.uid_orden AND ho.her_estado = 'entregada'
     WHERE o.uid_cliente = ? AND o.tenant_id = ?
     GROUP BY o.uid_orden
     ORDER BY o.uid_orden DESC
     LIMIT 3`,
    [cliente.uid_cliente, tenantId]
  );

  // ── Cotización WA pendiente de autorizar ──────────────────────────────────
  const [[cotizPendiente]] = await conn.execute(
    `SELECT wap.uid_orden, o.ord_consecutivo, co.total
     FROM b2c_wa_autorizacion_pendiente wap
     JOIN b2c_orden o ON o.uid_orden = wap.uid_orden
     LEFT JOIN b2c_cotizacion_orden co
            ON CAST(co.uid_orden AS CHAR) = CAST(wap.uid_orden AS CHAR)
     WHERE wap.wa_phone = ?
       AND wap.estado IN ('esperando_opcion','esperando_maquinas')
     LIMIT 1`,
    [senderPhone]
  );

  return {
    cliente:             { nombre, identificacion: cliente.cli_identificacion },
    ordenesActivas:      ordenesConDetalle,
    historial,
    cotizacionPendiente: cotizPendiente || null,
  };
}

module.exports = { buildContextoCliente, normalizePhone };
