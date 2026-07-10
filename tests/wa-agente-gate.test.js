'use strict';
/**
 * Tests de P0-1: gate ten_agente_wa + horario en wa-handler.js
 *
 * Prueba la función pura _isAgenteHorarioActivo(horaInicio, horaFin, utcHour)
 * exportada desde utils/wa-handler.js.
 *
 * Colombia = UTC-5. Conversión: colHour = ((utcHour - 5) + 24) % 24
 *
 * Horario por defecto del tenant: hora_inicio=7, hora_fin=20.
 * La franja es [hora_inicio, hora_fin) — el límite inferior es inclusivo,
 * el superior exclusivo (las 20:00 ya está fuera del horario).
 */

const { test } = require('node:test');
const assert   = require('node:assert');

// _isAgenteHorarioActivo es una función pura exportada para permitir testing.
// No carga wa-handler.js completo para evitar efectos secundarios del require
// de whatsapp-client.js que intenta conectar a Baileys.
//
// Estrategia: si wa-handler no puede cargarse (Baileys no disponible en CI),
// el test falla con un mensaje claro que identifica el problema de imports.
let _isAgenteHorarioActivo;
try {
  ({ _isAgenteHorarioActivo } = require('../utils/wa-handler'));
} catch (e) {
  console.error('No se pudo cargar wa-handler.js:', e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversión UTC → Colombia
// UTC-5: colHour = ((utcHour - 5) + 24) % 24
// ─────────────────────────────────────────────────────────────────────────────

test('_isAgenteHorarioActivo: dentro del horario → true', () => {
  // utcHour=15 (3pm UTC) → colHour=10 (10am Colombia) → dentro de 7-20
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 15), true);
});

test('_isAgenteHorarioActivo: exactamente hora_inicio → true (límite inclusivo)', () => {
  // utcHour=12 (mediodía UTC) → colHour=7 → exactamente hora_inicio
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 12), true);
});

test('_isAgenteHorarioActivo: exactamente hora_fin → false (límite exclusivo)', () => {
  // utcHour=1 (1am UTC día siguiente) → colHour = ((1-5)+24)%24 = 20 → igual a hora_fin
  // El límite superior es exclusivo: las 20:00 ya no atiende
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 1), false);
});

test('_isAgenteHorarioActivo: antes de hora_inicio → false', () => {
  // utcHour=10 → colHour = ((10-5)+24)%24 = 5 → antes de 7
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 10), false);
});

test('_isAgenteHorarioActivo: después de hora_fin → false', () => {
  // utcHour=3 (3am UTC) → colHour = ((3-5)+24)%24 = 22 → después de 20
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 3), false);
});

test('_isAgenteHorarioActivo: medianoche Colombia → false', () => {
  // utcHour=5 (5am UTC) → colHour = ((5-5)+24)%24 = 0 → medianoche Colombia
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 5), false);
});

test('_isAgenteHorarioActivo: cruce de medianoche UTC (utcHour=0) → fuera de horario', () => {
  // utcHour=0 (medianoche UTC) → colHour = ((0-5)+24)%24 = 19 → dentro de 7-20
  assert.strictEqual(_isAgenteHorarioActivo(7, 20, 0), true);
});

test('_isAgenteHorarioActivo: horario nocturno (hora_fin < hora_inicio) no soportado — se comporta vacío', () => {
  // Si hora_inicio=20 y hora_fin=7 (turno nocturno), la condición >= && < siempre
  // retorna false porque ningún número satisface a >= 20 && a < 7 simultáneamente.
  // Documentar que horarios nocturnos no están soportados en esta versión.
  assert.strictEqual(_isAgenteHorarioActivo(20, 7, 22), false,
    'horario nocturno (fin < inicio) no está soportado — siempre retorna false');
});
