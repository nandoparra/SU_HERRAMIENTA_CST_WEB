'use strict';
const { alegraGet, alegraPost } = require('../utils/alegra-client');

const ALEGRA_SERVICIO_ID   = parseInt(process.env.ALEGRA_SERVICIO_ID        || '1435', 10);
const ALEGRA_TEMPLATE_ID   = process.env.ALEGRA_INVOICE_TEMPLATE_ID          || '30';

/**
 * Detecta el tipo de identificación colombiano basado en formato.
 * NIT: contiene guion (9862087-1) o tiene <=9 dígitos (empresa sin dígito de verificación)
 * CC: 10 dígitos sin guion (cédula de ciudadanía)
 */
function detectTipoId(identificacion) {
  const raw = String(identificacion).trim();
  if (raw.includes('-')) return 'NIT';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? 'CC' : 'NIT';
}

/**
 * Descompone nombre completo en partes para nameObject de Alegra.
 * Convención colombiana: primer nombre, segundo nombre, primer apellido, segundo apellido.
 */
function buildNameObject(nombre) {
  const parts = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 4) {
    return { firstName: parts[0], secondName: parts[1], lastName: parts[2], secondLastName: parts.slice(3).join(' ') };
  } else if (parts.length === 3) {
    return { firstName: parts[0], secondName: '', lastName: parts[1], secondLastName: parts[2] };
  } else {
    return { firstName: parts[0] || '', secondName: '', lastName: parts[1] || '', secondLastName: '' };
  }
}

async function searchContactByIdentification(digitsId) {
  const results = await alegraGet(`/contacts?identification=${encodeURIComponent(digitsId)}`);
  if (!Array.isArray(results) || !results.length) return null;
  return results[0].id;
}

async function findOrCreateContact({ identificacion, nombre, telefono }) {
  const digitsId = String(identificacion).replace(/\D/g, '');
  const tipoId = detectTipoId(identificacion);
  const kindOfPerson = tipoId === 'NIT' ? 'LEGAL_ENTITY' : 'PERSON_ENTITY';

  // 1. Buscar contacto existente primero
  const existingId = await searchContactByIdentification(digitsId);
  if (existingId) return existingId;

  // 2. No encontrado — crear
  const nombreStr = String(nombre || identificacion);
  const payload = {
    name: nombreStr,
    identificationObject: { type: tipoId, number: digitsId },
    kindOfPerson,
    regime: 'SIMPLIFIED_REGIME',
    type: ['client'],
  };
  // nameObject requerido por Alegra Colombia para personas naturales (PERSON_ENTITY)
  if (kindOfPerson === 'PERSON_ENTITY') {
    payload.nameObject = buildNameObject(nombreStr);
  }
  if (telefono) {
    const digits = String(telefono).replace(/\D/g, '').replace(/^57/, '').slice(-10);
    if (digits.length === 10) payload.phonePrimary = digits;
  }

  try {
    const created = await alegraPost('/contacts', payload);
    return created.id;
  } catch (e) {
    // Si Alegra dice que ya existe (búsqueda inicial falló por paginación o delay),
    // intentar buscar de nuevo para obtener el ID
    const msg = String(e.alegraBody?.message || e.message || '');
    if (e.status === 400 && msg.toLowerCase().includes('ya existe')) {
      const retryId = await searchContactByIdentification(digitsId);
      if (retryId) return retryId;
    }
    throw e;
  }
}

/**
 * Crea una factura en Alegra para una orden de servicio.
 *
 * @param {{ orden, cliente, maquinas }} params
 *   orden: { uid_orden, ord_consecutivo }
 *   cliente: { cli_identificacion, cli_razon_social, cli_contacto, cli_telefono }
 *   maquinas: [{ her_nombre, her_marca, subtotal }]
 * @returns {{ alegraId: number, url: string|null }}
 */
async function generarFactura({ orden, cliente, maquinas, paymentForm = 'CASH', paymentMethod = 'CASH', date }) {
  const contactId = await findOrCreateContact({
    identificacion: cliente.cli_identificacion,
    nombre: cliente.cli_razon_social || cliente.cli_contacto || cliente.cli_identificacion,
    telefono: cliente.cli_telefono,
  });

  const invoiceDate = date || new Date().toISOString().slice(0, 10);

  const items = maquinas
    .filter(m => Number(m.subtotal) > 0)
    .map(m => {
      const nombreMaquina = [m.her_nombre, m.her_marca].filter(Boolean).join(' ') || 'Reparación';
      const descripcion   = m.descripcion_trabajo
        ? `${nombreMaquina} — ${m.descripcion_trabajo}`
        : nombreMaquina;
      return {
        id: ALEGRA_SERVICIO_ID,
        price: Number(m.subtotal),
        quantity: 1,
        description: descripcion,
      };
    });

  if (!items.length) {
    const err = new Error('No hay máquinas con cotización para facturar');
    err.status = 400;
    throw err;
  }

  let invoice;
  try {
    invoice = await alegraPost('/invoices', {
      date: invoiceDate,
      dueDate: invoiceDate,
      client: { id: contactId },
      items,
      paymentForm,
      paymentMethod,
      status: 'open',
      stamp: true,
      numberTemplate: { id: ALEGRA_TEMPLATE_ID },
      observations: `Orden de servicio #${orden.ord_consecutivo}`,
    });
  } catch (e) {
    // Traducir errores comunes de timbrado DIAN a mensajes accionables
    const msg = String(e.alegraBody?.message || e.message || '').toLowerCase();
    if (msg.includes('numeraci') || msg.includes('agotad') || msg.includes('resoluci')) {
      const err = new Error('La resolución de numeración DIAN está agotada — configura un nuevo rango en Alegra antes de continuar');
      err.status = 422;
      throw err;
    }
    if (msg.includes('dian') || msg.includes('timbre') || msg.includes('stamp')) {
      const err = new Error(`Error de timbrado DIAN: ${e.alegraBody?.message || e.message}. Reintenta en unos minutos o emite manualmente desde Alegra`);
      err.status = 502;
      throw err;
    }
    if (msg.includes('habilitad') || msg.includes('no tiene') || msg.includes('electroni')) {
      const err = new Error('La cuenta de Alegra no tiene facturación electrónica habilitada — actívala en Configuración → Facturación electrónica');
      err.status = 422;
      throw err;
    }
    throw e;
  }

  return {
    alegraId: invoice.id,
    url: `https://app.alegra.com/invoice/view/id/${invoice.id}`,
  };
}

module.exports = { generarFactura };
