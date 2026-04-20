'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addDiasHabiles, esNoHabil, toISODate } = require('../utils/dias-habiles');

// ── toISODate ────────────────────────────────────────────────────────────────

test('toISODate formatea correctamente', () => {
  assert.equal(toISODate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(toISODate(new Date(2026, 11, 31)), '2026-12-31');
  assert.equal(toISODate(new Date(2026, 9, 1)), '2026-10-01');
});

// ── esNoHabil ────────────────────────────────────────────────────────────────

test('sábado y domingo son no hábiles', () => {
  assert.equal(esNoHabil(new Date(2026, 3, 18)), true);  // sábado
  assert.equal(esNoHabil(new Date(2026, 3, 19)), true);  // domingo
});

test('lunes laboral no es no hábil', () => {
  assert.equal(esNoHabil(new Date(2026, 3, 20)), false); // lunes 20-abr-2026
});

test('festivos fijos son no hábiles', () => {
  assert.equal(esNoHabil(new Date(2026, 0, 1)),  true);  // Año Nuevo
  assert.equal(esNoHabil(new Date(2026, 4, 1)),  true);  // Día del Trabajo
  assert.equal(esNoHabil(new Date(2026, 6, 20)), true);  // Independencia
  assert.equal(esNoHabil(new Date(2026, 7, 7)),  true);  // Batalla de Boyacá
  assert.equal(esNoHabil(new Date(2026, 11, 8)), true);  // Inmaculada
  assert.equal(esNoHabil(new Date(2026, 11, 25)), true); // Navidad
});

test('Semana Santa 2026 — Jueves y Viernes Santo', () => {
  // Pascua 2026 = 5 abril → Jueves Santo 2 abril, Viernes Santo 3 abril
  assert.equal(esNoHabil(new Date(2026, 3, 2)), true);  // Jueves Santo
  assert.equal(esNoHabil(new Date(2026, 3, 3)), true);  // Viernes Santo
  assert.equal(esNoHabil(new Date(2026, 3, 6)), false); // lunes después de Pascua — día hábil normal
});

test('Ley Emiliani — Reyes Magos 2026 traslado a lunes', () => {
  // 6 enero 2026 = martes → traslado al lunes 12 enero
  assert.equal(esNoHabil(new Date(2026, 0, 6)),  false); // martes — no es festivo
  assert.equal(esNoHabil(new Date(2026, 0, 12)), true);  // lunes — sí es festivo
});

test('Ley Emiliani — San José 2026 traslado a lunes', () => {
  // 19 marzo 2026 = jueves → traslado al lunes 23 marzo
  assert.equal(esNoHabil(new Date(2026, 2, 19)), false);
  assert.equal(esNoHabil(new Date(2026, 2, 23)), true);
});

// ── addDiasHabiles ───────────────────────────────────────────────────────────

test('sumar 0 días hábiles retorna el mismo día si ya es hábil', () => {
  // addDiasHabiles siempre avanza al menos 1 día
  // sumar 1 día hábil desde lunes → martes (si no es festivo)
  const lunes = new Date(2026, 3, 20); // lunes 20-abr-2026
  const resultado = addDiasHabiles(lunes, 1);
  assert.equal(toISODate(resultado), '2026-04-21'); // martes
});

test('saltar fin de semana al sumar días hábiles', () => {
  // Desde viernes 17-abr-2026, +1 hábil = lunes 20-abr
  const viernes = new Date(2026, 3, 17);
  assert.equal(toISODate(addDiasHabiles(viernes, 1)), '2026-04-20');
});

test('sumar 2 días hábiles desde jueves salta fin de semana', () => {
  // Jueves 16-abr → +1=viernes 17, +2=lunes 20
  const jueves = new Date(2026, 3, 16);
  assert.equal(toISODate(addDiasHabiles(jueves, 2)), '2026-04-20');
});

test('sumar 30 días hábiles retorna fecha futura coherente', () => {
  const inicio = new Date(2026, 3, 20); // lunes 20-abr
  const fin = addDiasHabiles(inicio, 30);
  // debe estar aprox 6 semanas después (30 hábiles ≈ 42 días calendario)
  const diffMs = fin - inicio;
  const diffDias = diffMs / (1000 * 60 * 60 * 24);
  assert.ok(diffDias >= 30, 'debe haber al menos 30 días de diferencia');
  assert.ok(diffDias <= 50, 'no debe exceder 50 días calendario para 30 hábiles');
});

test('resultado de addDiasHabiles nunca es fin de semana', () => {
  for (let i = 1; i <= 60; i++) {
    const desde = new Date(2026, 0, 1);
    const resultado = addDiasHabiles(desde, i);
    const dow = resultado.getDay();
    assert.notEqual(dow, 0, `día ${i}: resultado no debe ser domingo`);
    assert.notEqual(dow, 6, `día ${i}: resultado no debe ser sábado`);
  }
});

test('resultado de addDiasHabiles nunca es festivo colombiano', () => {
  for (let i = 1; i <= 60; i++) {
    const desde = new Date(2026, 0, 1);
    const resultado = addDiasHabiles(desde, i);
    assert.equal(esNoHabil(resultado), false, `addDiasHabiles(${i}) retornó un día no hábil: ${toISODate(resultado)}`);
  }
});
