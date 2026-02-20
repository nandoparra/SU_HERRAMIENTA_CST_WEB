'use strict';

/**
 * Recibe un campo de teléfono que puede contener varios números separados
 * por espacios, barras, comas, guiones, puntos y coma, etc.
 * Devuelve un array de chatIds de WhatsApp ("57XXXXXXXXXX@c.us")
 * con solo números móviles colombianos válidos (10 dígitos que empiezan por 3).
 * Números fijos (7 dígitos) y cualquier otro formato se descartan silenciosamente.
 */
function parseColombianPhones(raw) {
  if (!raw) return [];

  // Separar por cualquier secuencia de caracteres no numéricos
  const segments = String(raw).split(/[^0-9]+/).filter(Boolean);

  const chatIds = new Set();
  for (const seg of segments) {
    let num = seg;
    // Quitar prefijo internacional 57 si ya viene incluido
    if (num.startsWith('57') && num.length === 12) {
      num = num.slice(2);
    }
    // Móvil colombiano: exactamente 10 dígitos empezando por 3
    if (num.length === 10 && num.startsWith('3')) {
      chatIds.add(`57${num}@c.us`);
    }
  }

  return Array.from(chatIds);
}

module.exports = { parseColombianPhones };
