'use strict';
const { getClient, withTimeout } = require('../utils/ia');
const log = require('../utils/logger');

// ── Constantes ────────────────────────────────────────────────────────────────

// Usar Haiku para el agente WA: conversacional, rápido y bajo costo
const WA_AGENTE_MODEL       = process.env.WA_AGENTE_MODEL || 'claude-haiku-4-5-20251001';
const WA_AGENTE_TIMEOUT_MS  = 15_000;
const WA_AGENTE_MAX_HISTORIAL = 10;

const TALLER_PHONE = (() => {
  const raw = String(process.env.PARTS_WHATSAPP_NUMBER || '3104650437').replace(/\D/g, '');
  return raw.slice(-10);
})();

const FALLBACK_MSG =
  `En este momento no puedo responderte. Para cualquier consulta comunícate ` +
  `con nosotros directamente al ${TALLER_PHONE}. — Asistente SU HERRAMIENTA`;

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

// ── Helpers de teléfono ───────────────────────────────────────────────────────

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
 * Ignora espacios, guiones y prefijo +57 en el valor guardado en BD.
 */
async function findClienteByPhone(conn, senderPhone, tenantId) {
  const phone10 = normalizePhone(senderPhone);

  // Búsqueda primaria por teléfono colombiano (funciona para números normales)
  if (phone10.length >= 9) {
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
    if (rows[0]) return rows[0];
  }

  // Fallback LID: cuando el senderPhone es un JID LID (ej: "81186212806850"),
  // buscamos el cliente via el pendiente de autorización que guardamos con ese JID.
  const [byLid] = await conn.execute(
    `SELECT c.uid_cliente, c.cli_razon_social, c.cli_contacto, c.cli_identificacion
     FROM b2c_wa_autorizacion_pendiente wap
     JOIN b2c_orden o ON o.uid_orden = wap.uid_orden
     JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente AND c.tenant_id = ?
     WHERE wap.wa_phone = ? AND wap.tenant_id = ?
     LIMIT 1`,
    [tenantId, senderPhone, tenantId]
  );
  return byLid[0] || null;
}

// ── buildContextoCliente ──────────────────────────────────────────────────────

/**
 * Construye el contexto completo del cliente para el agente IA.
 * Retorna null si el número no corresponde a ningún cliente registrado.
 *
 * @returns {object|null}
 *   { cliente, ordenesActivas, historial, cotizacionPendiente }
 */
async function buildContextoCliente(conn, senderPhone, tenantId) {
  const cliente = await findClienteByPhone(conn, senderPhone, tenantId);
  if (!cliente) return null;

  const nombre = cliente.cli_razon_social || cliente.cli_contacto || 'Cliente';

  // Órdenes con al menos una máquina en estado activo
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

  // Detalle de máquinas por orden activa
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

    const raw = String(o.ord_fecha);
    const dm = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    const fechaLeg = dm ? `${dm[3]}/${dm[2]}/${dm[1]}` : raw;

    return {
      consecutivo: o.ord_consecutivo,
      fecha:       fechaLeg,
      maquinas:    maquinas.map(m => ({
        her_nombre:  m.her_nombre,
        her_marca:   m.her_marca,
        her_estado:  m.her_estado,
        estadoLabel: ESTADOS_LABEL[m.her_estado] || m.her_estado,
        subtotal:    m.subtotal != null ? Number(m.subtotal) : null,
      })),
    };
  }));

  // Historial: últimas 3 órdenes con máquinas entregadas
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

  // Cotización WA pendiente de autorizar para este número
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

// ── Formateo de contexto para Claude ─────────────────────────────────────────

function formatContexto(contexto) {
  if (!contexto) {
    return 'CONTEXTO: Este número no está registrado como cliente en el taller.';
  }

  const { cliente, ordenesActivas, historial, cotizacionPendiente } = contexto;
  const lines = [
    'DATOS DEL CLIENTE:',
    `- Nombre: ${cliente.nombre}`,
    `- Identificación: ${cliente.identificacion}`,
  ];

  if (cotizacionPendiente) {
    const totalStr = cotizacionPendiente.total != null
      ? `$${Number(cotizacionPendiente.total).toLocaleString('es-CO')}`
      : 'ver detalle';
    lines.push(
      '',
      'COTIZACIÓN PENDIENTE DE AUTORIZAR:',
      `- Orden #${cotizacionPendiente.ord_consecutivo} — Total: ${totalStr}`,
      '- El cliente puede responder: 1 (autorizar todo), 2 (no autorizar), 3 (parcial), 4 (hablar con asesor)',
    );
  }

  if (ordenesActivas.length) {
    lines.push('', 'ÓRDENES ACTIVAS EN EL TALLER:');
    for (const o of ordenesActivas) {
      lines.push(`- Orden #${o.consecutivo} (ingresó ${o.fecha}):`);
      for (const m of o.maquinas) {
        const marca = m.her_marca ? ` ${m.her_marca}` : '';
        const cot = m.subtotal != null
          ? ` — Cotización: $${Number(m.subtotal).toLocaleString('es-CO')}`
          : '';
        lines.push(`  • ${m.her_nombre}${marca}: ${m.estadoLabel}${cot}`);
      }
    }
  } else {
    lines.push('', 'No tiene órdenes activas en el taller en este momento.');
  }

  if (historial.length) {
    lines.push('', 'HISTORIAL RECIENTE (órdenes entregadas):');
    for (const h of historial) {
      const raw = String(h.ord_fecha);
      const dm = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
      const fecha = dm ? `${dm[3]}/${dm[2]}/${dm[1]}` : raw;
      lines.push(`- Orden #${h.ord_consecutivo} (${fecha}) — ${h.total_maquinas} equipo(s) entregado(s)`);
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(contextText) {
  return `Eres el Asistente SU HERRAMIENTA, el asistente virtual del taller SU HERRAMIENTA CST en Pereira, Colombia. Atiendes por WhatsApp a los clientes del taller de reparación de herramientas eléctricas.

TONO Y ESTILO:
- Amable, directo y profesional
- Español colombiano natural
- Máximo 3-4 líneas por respuesta
- Sin listas largas — mensajes concisos y claros

PUEDES:
- Informar el estado de las órdenes y máquinas del cliente
- Explicar cotizaciones y montos
- Recordarle al cliente que puede autorizar su cotización respondiendo 1, 2, 3 o 4
- Responder preguntas generales sobre el servicio del taller
- Dar el número de contacto del taller para temas complejos: ${TALLER_PHONE}

NO PUEDES:
- Prometer fechas de entrega
- Cambiar precios o condiciones de una cotización
- Tomar decisiones sobre reparaciones
- Hablar de otros clientes

Si el cliente pregunta algo fuera de tu alcance, indícale amablemente que se comunique al ${TALLER_PHONE}.

CONTEXTO ACTUAL DEL CLIENTE:
${contextText}`;
}

// ── responderConIA ─────────────────────────────────────────────────────────────

/**
 * Genera una respuesta IA para el mensaje del cliente.
 * Gestiona historial, llama a Claude con timeout 15s y guarda el intercambio en BD.
 * Siempre retorna un string — nunca lanza excepción.
 *
 * @param {object} conn — conexión MySQL activa
 * @param {string} senderPhone — número de Baileys (ej: "573104650437")
 * @param {number} tenantId
 * @param {string} textoCliente — texto del mensaje entrante
 * @returns {string} respuesta a enviar por WhatsApp
 */
async function responderConIA(conn, senderPhone, tenantId, textoCliente) {
  // 1. Lazy cleanup: borrar historial con más de 24h para este número
  await conn.execute(
    `DELETE FROM b2c_wa_conversacion
     WHERE wa_phone = ? AND tenant_id = ?
       AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [senderPhone, tenantId]
  );

  // 2. Leer historial reciente
  const [histMsgs] = await conn.execute(
    `SELECT rol, contenido
     FROM b2c_wa_conversacion
     WHERE wa_phone = ? AND tenant_id = ?
     ORDER BY uid_mensaje ASC
     LIMIT ${WA_AGENTE_MAX_HISTORIAL}`,
    [senderPhone, tenantId]
  );

  // 3. Construir contexto del cliente desde BD
  const contexto = await buildContextoCliente(conn, senderPhone, tenantId);
  const systemPrompt = buildSystemPrompt(formatContexto(contexto));

  // 4. Armar messages: historial + mensaje actual
  //    Si el último mensaje del historial es 'user' (par incompleto por crash previo),
  //    descartarlo para evitar dos 'user' consecutivos que Claude rechazaría.
  const histFiltrado = histMsgs.map(m => ({ role: m.rol, content: m.contenido }));
  if (histFiltrado.length && histFiltrado[histFiltrado.length - 1].role === 'user') {
    histFiltrado.pop();
  }
  const messages = [...histFiltrado, { role: 'user', content: textoCliente }];

  // 5. Llamar Claude con timeout 15s
  let respuesta;
  let exitoIA = false;
  try {
    const response = await withTimeout(
      getClient().beta.messages.create({
        model:      WA_AGENTE_MODEL,
        max_tokens: 300,
        system:     systemPrompt,
        messages,
      }),
      WA_AGENTE_TIMEOUT_MS,
      'Agente WA'
    );
    respuesta = response.content[0].text.trim();
    exitoIA = true;
  } catch (e) {
    log.warn({ err: e.message }, '⚠️ wa-agente: Claude timeout o error — enviando fallback');
    respuesta = FALLBACK_MSG;
  }

  // 6. Persistir intercambio en historial solo si Claude respondió correctamente
  if (exitoIA) {
    await conn.execute(
      `INSERT INTO b2c_wa_conversacion (tenant_id, wa_phone, rol, contenido) VALUES (?, ?, 'user', ?)`,
      [tenantId, senderPhone, textoCliente]
    );
    await conn.execute(
      `INSERT INTO b2c_wa_conversacion (tenant_id, wa_phone, rol, contenido) VALUES (?, ?, 'assistant', ?)`,
      [tenantId, senderPhone, respuesta]
    );
  }

  return respuesta;
}

module.exports = { buildContextoCliente, normalizePhone, responderConIA };
