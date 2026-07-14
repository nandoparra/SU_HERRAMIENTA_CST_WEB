'use strict';

// Qué estados puede establecer cada rol en operaciones masivas.
// 'entregada' NO está aquí — requiere firma y tiene su propio endpoint (bulk-entregar).
const BULK_ESTADOS_PERMITIDOS = {
  A: ['revisada', 'cotizada', 'autorizada', 'no_autorizada', 'reparada'],
  F: ['revisada', 'cotizada', 'autorizada', 'no_autorizada', 'reparada'],
  T: ['revisada'],
};

// Estados de origen válidos para cada estado destino.
// Previene retrocesos: una máquina en 'reparada' no puede volver a 'revisada' por bulk.
// 'entregada' incluido aquí solo para uso de bulk-entregar.
const ESTADOS_ORIGEN_VALIDOS = {
  revisada:      ['pendiente_revision'],
  cotizada:      ['revisada'],
  autorizada:    ['cotizada'],
  no_autorizada: ['cotizada'],
  reparada:      ['autorizada'],
  entregada:     ['reparada'],
};

module.exports = { BULK_ESTADOS_PERMITIDOS, ESTADOS_ORIGEN_VALIDOS };
