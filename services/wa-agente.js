'use strict';
const { getClient, withTimeout } = require('../utils/ia');
const log = require('../utils/logger');

// ── Constantes ────────────────────────────────────────────────────────────────

const WA_AGENTE_MODEL       = process.env.WA_AGENTE_MODEL || 'claude-haiku-4-5-20251001';
const WA_AGENTE_TIMEOUT_MS  = 15_000;
const WA_AGENTE_MAX_HISTORIAL = 20;

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

// TTL de estados de identificación y ventana de intentos: 30 minutos
const ESTADO_EXPIRY_MS = 30 * 60 * 1000;

// ── Helpers de nombre y teléfono ──────────────────────────────────────────────

/**
 * Muestra los primeros 4 caracteres del nombre + '***'.
 * Si el nombre tiene ≤ 4 caracteres lo muestra completo (sin truncar ni rellenar).
 */
function maskName(nombre) {
  if (!nombre) return '***';
  const n = nombre.trim();
  return n.length <= 4 ? n : n.slice(0, 4) + '***';
}

/**
 * Normaliza el número de Baileys ("573104650437") a 10 dígitos colombianos ("3104650437").
 */
function normalizePhone(senderPhone) {
  const digits = String(senderPhone).replace(/\D/g, '');
  const sin57 = digits.startsWith('57') ? digits.slice(2) : digits;
  return sin57.slice(-10);
}

// ── Estado de identificación (b2c_wa_estado_identificacion) ──────────────────

function isEstadoExpired(estadoDesde) {
  if (!estadoDesde) return true;
  return (Date.now() - new Date(estadoDesde).getTime()) > ESTADO_EXPIRY_MS;
}

function isIntentosExpired(estadoIdent) {
  if (!estadoIdent.intentos_reset) return true;
  return (Date.now() - new Date(estadoIdent.intentos_reset).getTime()) > ESTADO_EXPIRY_MS;
}

async function getEstadoIdent(conn, waPhone, tenantId) {
  const [[row]] = await conn.execute(
    `SELECT estado, estado_desde, uid_cliente_pendiente, intentos_id, intentos_reset
     FROM b2c_wa_estado_identificacion
     WHERE tenant_id = ? AND wa_sender = ?`,
    [tenantId, waPhone]
  );
  return row || {
    estado: 'normal', estado_desde: null,
    uid_cliente_pendiente: null, intentos_id: 0, intentos_reset: null,
  };
}

async function upsertEstado(conn, waPhone, tenantId, fields) {
  await conn.execute(
    `INSERT INTO b2c_wa_estado_identificacion
       (tenant_id, wa_sender, estado, estado_desde, uid_cliente_pendiente, intentos_id, intentos_reset)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       estado                = VALUES(estado),
       estado_desde          = VALUES(estado_desde),
       uid_cliente_pendiente = VALUES(uid_cliente_pendiente),
       intentos_id           = VALUES(intentos_id),
       intentos_reset        = VALUES(intentos_reset)`,
    [
      tenantId, waPhone,
      fields.estado                ?? 'normal',
      fields.estado_desde          ?? null,
      fields.uid_cliente_pendiente ?? null,
      fields.intentos_id           ?? 0,
      fields.intentos_reset        ?? null,
    ]
  );
}

async function resetEstadoIdent(conn, waPhone, tenantId) {
  await conn.execute(
    `DELETE FROM b2c_wa_estado_identificacion WHERE tenant_id = ? AND wa_sender = ?`,
    [tenantId, waPhone]
  );
}

// ── Búsqueda de cliente ───────────────────────────────────────────────────────

async function findClienteByPhone(conn, senderPhone, tenantId) {
  const phone10 = normalizePhone(senderPhone);

  // Búsqueda primaria por teléfono colombiano
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

  // Fallback 1 — mapping persistente LID → teléfono o uid_cliente
  const [[lidMapping]] = await conn.execute(
    `SELECT wa_phone, uid_cliente FROM b2c_wa_lid_mapping WHERE wa_lid = ? AND tenant_id = ? LIMIT 1`,
    [senderPhone, tenantId]
  );
  if (lidMapping) {
    if (lidMapping.wa_phone) {
      const realPhone10 = normalizePhone(lidMapping.wa_phone);
      if (realPhone10.length >= 9) {
        const [rows] = await conn.execute(
          `SELECT c.uid_cliente, c.cli_razon_social, c.cli_contacto, c.cli_identificacion
           FROM b2c_cliente c
           WHERE c.tenant_id = ?
             AND (
               REPLACE(REPLACE(REPLACE(c.cli_telefono,      ' ', ''), '-', ''), '+57', '') LIKE ?
               OR REPLACE(REPLACE(REPLACE(c.cli_tel_contacto,' ', ''), '-', ''), '+57', '') LIKE ?
             )
           LIMIT 1`,
          [tenantId, `%${realPhone10}`, `%${realPhone10}`]
        );
        if (rows[0]) return rows[0];
      }
    }
    // Fallback 1b — LID mapeado a uid_cliente sin wa_phone. El cliente fue identificado
    // previamente (por Phase 3 o tras confirmar su cédula). Devuelve contexto completo
    // porque la identidad ya fue establecida en una sesión anterior.
    if (lidMapping.uid_cliente) {
      const [[row]] = await conn.execute(
        `SELECT uid_cliente, cli_razon_social, cli_contacto, cli_identificacion
         FROM b2c_cliente WHERE uid_cliente = ? AND tenant_id = ?`,
        [lidMapping.uid_cliente, tenantId]
      );
      if (row) return row;
    }
  }

  // Fallback 2 — pendiente activo por wa_phone o wa_lid
  const [byLid] = await conn.execute(
    `SELECT c.uid_cliente, c.cli_razon_social, c.cli_contacto, c.cli_identificacion
     FROM b2c_wa_autorizacion_pendiente wap
     JOIN b2c_orden o ON o.uid_orden = wap.uid_orden
     JOIN b2c_cliente c ON c.uid_cliente = o.uid_cliente AND c.tenant_id = ?
     WHERE (wap.wa_phone = ? OR wap.wa_lid = ?) AND wap.tenant_id = ?
     LIMIT 1`,
    [tenantId, senderPhone, senderPhone, tenantId]
  );
  return byLid[0] || null;
}

/**
 * Identifica al cliente extrayendo cédula/NIT u orden del texto libre.
 * Fallback 3 — solo se invoca cuando findClienteByPhone no encontró nada.
 * Incluye cli_telefono para evaluar si el teléfono puede anclarse al LID.
 */
async function findClienteByTexto(conn, texto, tenantId) {
  const textLimpio = String(texto || '').replace(/[.\-]/g, ' ');

  // 1. Cédula / NIT: 6-12 dígitos consecutivos
  const cedulaMatch = textLimpio.match(/\b(\d{6,12})\b/);
  if (cedulaMatch) {
    const cedula = cedulaMatch[1];
    const [[row]] = await conn.execute(
      `SELECT c.uid_cliente, c.cli_razon_social, c.cli_contacto,
              c.cli_identificacion, c.cli_telefono
       FROM b2c_cliente c
       WHERE c.tenant_id = ?
         AND REPLACE(REPLACE(c.cli_identificacion, '.', ''), '-', '') = ?
       LIMIT 1`,
      [tenantId, cedula]
    );
    if (row) return row;
  }

  // 2. Número de orden: "#8400" o "orden 8400"
  const ordenMatch = texto.match(/(?:#(\d{2,6})|(?:orden|pedido)\s*#?\s*(\d{2,6}))/i);
  if (ordenMatch) {
    const consecutivo = parseInt(ordenMatch[1] || ordenMatch[2], 10);
    const [[row]] = await conn.execute(
      `SELECT c.uid_cliente, c.cli_razon_social, c.cli_contacto,
              c.cli_identificacion, c.cli_telefono
       FROM b2c_orden o
       JOIN b2c_cliente c
            ON c.uid_cliente = o.uid_cliente AND c.tenant_id = o.tenant_id
       WHERE o.ord_consecutivo = ? AND o.tenant_id = ?
       LIMIT 1`,
      [consecutivo, tenantId]
    );
    if (row) return row;
  }

  return null;
}

// ── buildContextoCliente ──────────────────────────────────────────────────────

/**
 * Construye el contexto del cliente para el agente IA.
 *
 * Retorna uno de tres valores:
 *   - null                          → cliente no identificado
 *   - { confirmacionPendiente:true, uid_cliente, cliente:{nombre,identificacion} }
 *                                   → identificado por texto, esperando confirmación (P1-3)
 *   - { cliente, ordenesActivas, historial, cotizacionPendiente }
 *                                   → contexto completo listo para Claude
 */
async function buildContextoCliente(conn, senderPhone, tenantId, textoCliente = '') {
  let cliente = await findClienteByPhone(conn, senderPhone, tenantId);

  if (!cliente && textoCliente) {
    const clienteByTexto = await findClienteByTexto(conn, textoCliente, tenantId);
    if (clienteByTexto) {
      // Identificado por cédula/orden — requiere confirmación antes de revelar contexto
      // completo (P1-3). El mapping LID→cliente se guarda DESPUÉS de la confirmación.
      return {
        confirmacionPendiente: true,
        uid_cliente: clienteByTexto.uid_cliente,
        cliente: {
          nombre:         maskName(clienteByTexto.cli_razon_social || clienteByTexto.cli_contacto || ''),
          identificacion: clienteByTexto.cli_identificacion,
        },
      };
    }
  }

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

  const ordenesConDetalle = await Promise.all(ordenes.map(async (o) => {
    const [maquinas] = await conn.execute(
      `SELECT h.her_nombre, h.her_marca, ho.her_estado, ho.hor_observaciones, cm.subtotal
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
        her_nombre:        m.her_nombre,
        her_marca:         m.her_marca,
        her_estado:        m.her_estado,
        estadoLabel:       ESTADOS_LABEL[m.her_estado] || m.her_estado,
        hor_observaciones: m.hor_observaciones || null,
        subtotal:          m.subtotal != null ? Number(m.subtotal) : null,
      })),
    };
  }));

  // Historial: últimas 3 órdenes entregadas
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

  // Cotización WA pendiente de autorizar
  const [[cotizPendiente]] = await conn.execute(
    `SELECT wap.uid_orden, o.ord_consecutivo, co.total
     FROM b2c_wa_autorizacion_pendiente wap
     JOIN b2c_orden o ON o.uid_orden = wap.uid_orden
     LEFT JOIN b2c_cotizacion_orden co
            ON CAST(co.uid_orden AS CHAR) = CAST(wap.uid_orden AS CHAR)
     WHERE (wap.wa_phone = ? OR wap.wa_lid = ?)
       AND wap.estado IN ('esperando_opcion','esperando_maquinas')
     LIMIT 1`,
    [senderPhone, senderPhone]
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
      '', 'COTIZACIÓN PENDIENTE DE AUTORIZAR:',
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
        if (m.hor_observaciones) {
          lines.push(`    Diagnóstico técnico: "${m.hor_observaciones}"`);
        }
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
- Inventar o suponer diagnósticos, repuestos, precios, fechas de entrega ni ningún dato que no esté explícitamente en el CONTEXTO ACTUAL DEL CLIENTE. Si no tienes el dato, dilo con claridad y remite al ${TALLER_PHONE}.

Si el cliente pregunta algo fuera de tu alcance, indícale amablemente que se comunique al ${TALLER_PHONE}.

CONTEXTO ACTUAL DEL CLIENTE:
${contextText}`;
}

// ── Máquina de estado de identificación ──────────────────────────────────────

/**
 * Maneja la confirmación de identidad cuando estado = 'esperando_confirmacion'.
 * Retorna:
 *   - string: respuesta a enviar (no llama a Claude)
 *   - null: usuario confirmó ("sí") — mapping guardado, estado reseteado,
 *           continuar con flujo normal en responderConIA
 */
async function handleConfirmacion(conn, waPhone, tenantId, textoCliente, estadoIdent) {
  const texto = textoCliente.trim().toLowerCase();
  const isYes = /^(s[íi]|si|claro|correcto|yes|ok|dale|sip|bueno|afirmativo)$/.test(texto);
  const isNo  = /^(no|nope|negativo|nada|nunca)$/.test(texto);

  if (isYes) {
    // Guardar mapping LID→uid_cliente para que Fallback 1b lo encuentre en el futuro
    conn.execute(
      `INSERT INTO b2c_wa_lid_mapping (tenant_id, wa_lid, wa_phone, uid_cliente)
       VALUES (?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE uid_cliente = VALUES(uid_cliente)`,
      [tenantId, waPhone, estadoIdent.uid_cliente_pendiente]
    ).catch(() => {});
    await resetEstadoIdent(conn, waPhone, tenantId);
    return null; // señal: continuar con flujo normal (buildContextoCliente → Fallback 1b)
  }

  if (isNo) {
    await upsertEstado(conn, waPhone, tenantId, {
      estado:                  'esperando_cedula',
      estado_desde:            estadoIdent.estado_desde,
      uid_cliente_pendiente:   null,
      intentos_id:             estadoIdent.intentos_id,
      intentos_reset:          estadoIdent.intentos_reset,
    });
    return `Entendido. ¿Me puede dar el número correcto de cédula o NIT? — Asistente SU HERRAMIENTA`;
  }

  // Ni sí ni no — re-preguntar
  const [[row]] = await conn.execute(
    `SELECT cli_razon_social, cli_contacto FROM b2c_cliente WHERE uid_cliente = ? AND tenant_id = ?`,
    [estadoIdent.uid_cliente_pendiente, tenantId]
  );
  const nombre = maskName(row?.cli_razon_social || row?.cli_contacto || '');
  return `¿Es [${nombre}]? Por favor responda *sí* o *no*. — Asistente SU HERRAMIENTA`;
}

/**
 * Maneja el caso donde el cliente no pudo ser identificado.
 * Gestiona el flujo esperando_cedula: solicita identificación, cuenta intentos,
 * aplica FALLBACK si se supera el límite.
 */
async function handleNoIdentificado(conn, waPhone, tenantId, textoCliente, estadoIdent) {
  const estadoActual = (estadoIdent.estado !== 'normal' && isEstadoExpired(estadoIdent.estado_desde))
    ? 'normal'
    : estadoIdent.estado;

  const hasSixDigits = /\d{6,}/.test(textoCliente);

  if (estadoActual === 'esperando_cedula') {
    if (hasSixDigits) {
      // El texto parece una cédula/NIT pero no matcheó en BD — contar intento
      const intExpired = isIntentosExpired(estadoIdent);
      const currentIntentos = intExpired ? 0 : (estadoIdent.intentos_id || 0);
      const newIntentos = currentIntentos + 1;
      const intentosReset = intExpired ? new Date() : (estadoIdent.intentos_reset || new Date());

      await upsertEstado(conn, waPhone, tenantId, {
        estado:        'esperando_cedula',
        estado_desde:  estadoIdent.estado_desde || new Date(),
        intentos_id:   newIntentos,
        intentos_reset: intentosReset,
      });

      if (newIntentos >= 5) {
        // Límite alcanzado — cortar flujo automático
        // Nota: esta mitigación es por wa_sender. Alguien con múltiples
        // números/cuentas WA puede evadirla iniciando desde otro número.
        await resetEstadoIdent(conn, waPhone, tenantId);
        return FALLBACK_MSG;
      }

      const restantes = 5 - newIntentos;
      return (
        `No encontré esa identificación en nuestro sistema. ` +
        `Por favor verifíquela e inténtelo de nuevo ` +
        `(${restantes} intento${restantes === 1 ? '' : 's'} restante${restantes === 1 ? '' : 's'}). ` +
        `Para asistencia directa comuníquese al *${TALLER_PHONE}*. — Asistente SU HERRAMIENTA`
      );
    }
    // Texto sin dígitos — recordatorio sin contar intento
    return `Para consultar sus equipos necesito su número de *cédula o NIT*. ¿Me lo puede indicar? — Asistente SU HERRAMIENTA`;
  }

  // Estado normal o expirado — primer contacto sin identificación
  await upsertEstado(conn, waPhone, tenantId, {
    estado:        'esperando_cedula',
    estado_desde:  new Date(),
    intentos_id:   0,
    intentos_reset: null,
  });
  return (
    `Hola, soy el asistente virtual de *SU HERRAMIENTA CST* 🔧\n\n` +
    `Para consultarle la información de sus equipos, necesito su número de *cédula o NIT*. ` +
    `¿Me lo puede indicar?`
  );
}

// ── responderConIA ─────────────────────────────────────────────────────────────

/**
 * Genera una respuesta IA para el mensaje del cliente.
 * Incluye máquina de estado de identificación (P0-2/P1-3):
 *   normal             → flujo estándar
 *   esperando_cedula   → solicitar cédula/NIT, contar intentos fallidos
 *   esperando_confirmacion → pedir "sí/no" para verificar identidad
 *
 * Siempre retorna un string — nunca lanza excepción.
 */
async function responderConIA(conn, senderPhone, tenantId, textoCliente) {
  // 0. Estado de identificación (P0-2/P1-3)
  const estadoIdent = await getEstadoIdent(conn, senderPhone, tenantId);

  // 0a. Manejar confirmación pendiente (estado no expirado)
  if (estadoIdent.estado === 'esperando_confirmacion' && !isEstadoExpired(estadoIdent.estado_desde)) {
    const confResp = await handleConfirmacion(conn, senderPhone, tenantId, textoCliente, estadoIdent);
    if (confResp !== null) {
      // Respuesta de la máquina de estado — sin historial ni Claude
      return confResp;
    }
    // null = usuario confirmó. Mapping LID→cliente ya guardado; buildContextoCliente
    // encontrará al cliente via Fallback 1b en el siguiente paso.
  }

  // 1. Lazy cleanup: borrar historial con más de 24h
  await conn.execute(
    `DELETE FROM b2c_wa_conversacion
     WHERE wa_phone = ? AND tenant_id = ?
       AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [senderPhone, tenantId]
  );

  // 2. Construir contexto del cliente
  const contexto = await buildContextoCliente(conn, senderPhone, tenantId, textoCliente);

  // 2a. Identificado por texto — pedir confirmación de identidad (P1-3)
  if (contexto && contexto.confirmacionPendiente) {
    await upsertEstado(conn, senderPhone, tenantId, {
      estado:                'esperando_confirmacion',
      estado_desde:          new Date(),
      uid_cliente_pendiente: contexto.uid_cliente,
      intentos_id:           estadoIdent.intentos_id || 0,
      intentos_reset:        estadoIdent.intentos_reset || null,
    });
    return (
      `¿Es [${contexto.cliente.nombre}]? ` +
      `Responda *sí* para ver sus equipos. — Asistente SU HERRAMIENTA`
    );
  }

  // 2b. Cliente no identificado — flujo de solicitud de cédula (P0-2)
  if (!contexto) {
    return await handleNoIdentificado(conn, senderPhone, tenantId, textoCliente, estadoIdent);
  }

  // 3. Contexto completo — resetear estado si había uno activo
  if (estadoIdent.estado !== 'normal') {
    await resetEstadoIdent(conn, senderPhone, tenantId);
  }

  // 4. Leer historial reciente (últimos 20, subquery DESC reordenada ASC — fix P0-4)
  const [histMsgs] = await conn.execute(
    `SELECT rol, contenido FROM (
       SELECT rol, contenido, uid_mensaje
       FROM b2c_wa_conversacion
       WHERE wa_phone = ? AND tenant_id = ?
       ORDER BY uid_mensaje DESC
       LIMIT ${WA_AGENTE_MAX_HISTORIAL}
     ) t ORDER BY t.uid_mensaje ASC`,
    [senderPhone, tenantId]
  );

  // 5. System prompt con contexto del cliente
  const systemPrompt = buildSystemPrompt(formatContexto(contexto));

  // 6. Armar messages: historial + mensaje actual
  //    Si el último historial es 'user' (par incompleto por crash previo), descartarlo.
  const histFiltrado = histMsgs.map(m => ({ role: m.rol, content: m.contenido }));
  if (histFiltrado.length && histFiltrado[histFiltrado.length - 1].role === 'user') {
    histFiltrado.pop();
  }
  const messages = [...histFiltrado, { role: 'user', content: textoCliente }];

  // 7. Llamar Claude con timeout 15s
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

  // 8. Persistir intercambio (P1-2: user siempre, assistant solo si exitoIA)
  await conn.execute(
    `INSERT INTO b2c_wa_conversacion (tenant_id, wa_phone, rol, contenido) VALUES (?, ?, 'user', ?)`,
    [tenantId, senderPhone, textoCliente]
  );
  if (exitoIA) {
    await conn.execute(
      `INSERT INTO b2c_wa_conversacion (tenant_id, wa_phone, rol, contenido) VALUES (?, ?, 'assistant', ?)`,
      [tenantId, senderPhone, respuesta]
    );
  }

  return respuesta;
}

module.exports = { buildContextoCliente, normalizePhone, responderConIA };
