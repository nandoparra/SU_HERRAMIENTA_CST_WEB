'use strict';
const { alegraGet, alegraPost } = require('../utils/alegra-client');

const ALEGRA_SERVICIO_ID = parseInt(process.env.ALEGRA_SERVICIO_ID || '1435', 10);

/**
 * Detecta si la identificación es NIT o CC basado en formato colombiano.
 * NIT: contiene guion (ej: "9862087-1") o tiene <= 9 dígitos (empresa sin dígito de verificación)
 * CC: 10 dígitos sin guion (cédula de ciudadanía)
 */
function detectTipoId(identificacion) {
  const raw = String(identificacion).trim();
  if (raw.includes('-')) return 'NIT';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? 'CC' : 'NIT';
}

async function findOrCreateContact({ identificacion, nombre, telefono }) {
  const digitsId = String(identificacion).replace(/\D/g, '');

  // Buscar por identificación exacta (comparando solo dígitos)
  const results = await alegraGet(`/contacts?term=${encodeURIComponent(digitsId)}&limit=10`);
  if (Array.isArray(results)) {
    const match = results.find(c => {
      const idAlg = String(c.identificationObject?.number || c.identification || '').replace(/\D/g, '');
      return idAlg === digitsId;
    });
    if (match) return match.id;
  }

  const tipoId = detectTipoId(identificacion);

  const payload = {
    name: nombre || identificacion,
    identificationObject: { type: tipoId, number: digitsId },
    type: ['client'],
  };
  if (telefono) {
    const digits = String(telefono).replace(/\D/g, '').replace(/^57/, '').slice(-10);
    if (digits.length === 10) payload.phonePrimary = digits;
  }

  const created = await alegraPost('/contacts', payload);
  return created.id;
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
async function generarFactura({ orden, cliente, maquinas }) {
  const contactId = await findOrCreateContact({
    identificacion: cliente.cli_identificacion,
    nombre: cliente.cli_razon_social || cliente.cli_contacto || cliente.cli_identificacion,
    telefono: cliente.cli_telefono,
  });

  const today = new Date().toISOString().slice(0, 10);

  const items = maquinas
    .filter(m => Number(m.subtotal) > 0)
    .map(m => ({
      id: ALEGRA_SERVICIO_ID,
      price: Number(m.subtotal),
      quantity: 1,
      description: [m.her_nombre, m.her_marca].filter(Boolean).join(' ') || 'Reparación',
    }));

  if (!items.length) {
    const err = new Error('No hay máquinas con cotización para facturar');
    err.status = 400;
    throw err;
  }

  const invoice = await alegraPost('/invoices', {
    date: today,
    dueDate: today,
    client: { id: contactId },
    items,
    observations: `Orden de servicio #${orden.ord_consecutivo}`,
  });

  return {
    alegraId: invoice.id,
    url: invoice.shareLink || invoice.url || null,
  };
}

module.exports = { generarFactura };
