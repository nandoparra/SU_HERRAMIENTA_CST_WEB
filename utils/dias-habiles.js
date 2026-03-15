'use strict';

/**
 * Días hábiles colombianos — Ley 51 de 1983 + Ley Emiliani + Semana Santa
 *
 * Tres grupos de festivos:
 *   1. Fijos: siempre la misma fecha (ej. 1 ene, 20 jul, 25 dic)
 *   2. Ley Emiliani: fecha base fija, pero se trasladan al lunes siguiente
 *      si no caen en lunes (ej. Reyes Magos, San José, etc.)
 *   3. Basados en Pascua: calculados a partir del domingo de Pascua
 *      (Jueves/Viernes Santo, Ascensión, Corpus Christi, Sagrado Corazón)
 *
 * Uso:
 *   const { addDiasHabiles, esFestivo } = require('./dias-habiles');
 *   const fecha = addDiasHabiles(new Date(), 30);   // +30 días hábiles
 *   const fecha = addDiasHabiles(new Date(), 2);    // +2 días hábiles
 */

// ── Algoritmo de Meeus/Jones/Butcher para calcular Pascua ───────────────────
function pascua(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-based
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// ── Próximo lunes >= fecha dada (para Ley Emiliani) ─────────────────────────
function proximoLunes(date) {
  const d = new Date(date);
  const dow = d.getDay(); // 0=dom, 1=lun, ..., 6=sab
  if (dow === 1) return d; // ya es lunes
  const diff = dow === 0 ? 1 : 8 - dow; // días hasta el próximo lunes
  d.setDate(d.getDate() + diff);
  return d;
}

// ── Construir el Set de festivos para un año dado ────────────────────────────
function festivosDelAnio(year) {
  const festivos = new Set();

  const add = (d) => {
    festivos.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  };

  // Grupo 1 — Fijos (no se trasladan)
  const fijos = [
    [1,  1],  // Año Nuevo
    [5,  1],  // Día del Trabajo
    [7,  20], // Independencia
    [8,  7],  // Batalla de Boyacá
    [12, 8],  // Inmaculada Concepción
    [12, 25], // Navidad
  ];
  for (const [m, d] of fijos) add(new Date(year, m - 1, d));

  // Grupo 2 — Ley Emiliani (fecha base → próximo lunes)
  const emiliani = [
    [1,  6],  // Reyes Magos
    [3,  19], // San José
    [6,  29], // San Pedro y San Pablo
    [8,  15], // Asunción de la Virgen
    [10, 12], // Día de la Raza
    [11, 1],  // Todos los Santos
    [11, 11], // Independencia de Cartagena
  ];
  for (const [m, d] of emiliani) add(proximoLunes(new Date(year, m - 1, d)));

  // Grupo 3 — Basados en Pascua
  const p = pascua(year);

  // Fijos relativos a Pascua
  const addOffset = (offset) => {
    const d = new Date(p);
    d.setDate(d.getDate() + offset);
    add(d);
  };
  addOffset(-3); // Jueves Santo
  addOffset(-2); // Viernes Santo

  // Emiliani relativos a Pascua
  const addOffsetEmiliani = (offset) => {
    const d = new Date(p);
    d.setDate(d.getDate() + offset);
    add(proximoLunes(d));
  };
  addOffsetEmiliani(39); // Ascensión del Señor
  addOffsetEmiliani(60); // Corpus Christi
  addOffsetEmiliani(68); // Sagrado Corazón de Jesús

  return festivos;
}

// Cache por año para no recalcular en el mismo proceso
const _cache = {};
function getFestivos(year) {
  if (!_cache[year]) _cache[year] = festivosDelAnio(year);
  return _cache[year];
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna true si la fecha es festivo colombiano o fin de semana.
 * @param {Date} date
 */
function esNoHabil(date) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return true; // sábado o domingo
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return getFestivos(date.getFullYear()).has(key);
}

/**
 * Suma n días hábiles colombianos a una fecha.
 * @param {Date} desde  Fecha de inicio (se incluye el día siguiente hábil)
 * @param {number} n    Días hábiles a sumar
 * @returns {Date}
 */
function addDiasHabiles(desde, n) {
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  let contados = 0;
  while (contados < n) {
    d.setDate(d.getDate() + 1);
    if (!esNoHabil(d)) contados++;
  }
  return d;
}

/**
 * Formatea una Date como string YYYY-MM-DD (para INSERT MySQL DATE).
 * @param {Date} date
 */
function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

module.exports = { addDiasHabiles, esNoHabil, toISODate };
