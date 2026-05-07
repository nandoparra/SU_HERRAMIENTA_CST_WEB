'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { calcularRentabilidad, generarSugerencias } = require('../services/financiero');

const CFG_DEFAULT = {
  cf_utilidad_objetivo_min: 60000,
  cf_utilidad_objetivo_opt: 85000,
  cf_margen_objetivo_rep:   0.5,
};

// ── calcularRentabilidad ─────────────────────────────────────────────────────

test('venta solo mano de obra — rentable', () => {
  const r = calcularRentabilidad({
    manoObra: 80000, items: [], configFinanciera: CFG_DEFAULT,
  });
  assert.equal(r.ven_mano_obra,          80000);
  assert.equal(r.ven_costo_repuestos,    0);
  assert.equal(r.ven_utilidad_repuestos, 0);
  assert.equal(r.ven_utilidad_total,     80000);
  assert.equal(r.ven_es_rentable,        1);
  assert.equal(r.ven_diferencia_utilidad, 20000); // 80000 - 60000
});

test('venta solo mano de obra — NO rentable', () => {
  const r = calcularRentabilidad({
    manoObra: 40000, items: [], configFinanciera: CFG_DEFAULT,
  });
  assert.equal(r.ven_utilidad_total,      40000);
  assert.equal(r.ven_es_rentable,         0);
  assert.equal(r.ven_diferencia_utilidad, -20000);
});

test('mano de obra como ítem de línea prevalece sobre campo manoObra', () => {
  const items = [
    { vi_tipo: 'mano_obra', vi_precio_unitario: 70000, vi_cantidad: 1, vi_costo_unitario: 0 },
  ];
  const r = calcularRentabilidad({ manoObra: 999, items, configFinanciera: CFG_DEFAULT });
  assert.equal(r.ven_mano_obra,      70000);
  assert.equal(r.ven_utilidad_total, 70000);
  assert.equal(r.ven_es_rentable,    1);
});

test('repuestos con costo — margen calculado correctamente', () => {
  // venta 100.000, costo 50.000 → margen 50%
  const items = [
    { vi_tipo: 'repuesto', vi_precio_unitario: 100000, vi_cantidad: 1, vi_costo_unitario: 50000 },
  ];
  const r = calcularRentabilidad({ manoObra: 0, items, configFinanciera: CFG_DEFAULT });
  assert.equal(r.ven_costo_repuestos,    50000);
  assert.equal(r.ven_utilidad_repuestos, 50000);
  assert.equal(r.ven_margen_repuestos,   0.5);
  assert.equal(r.ven_utilidad_total,     50000);
  assert.equal(r.ven_es_rentable,        0); // 50000 < 60000
});

test('repuestos sin costo unitario → utilidad_repuestos = venta total', () => {
  const items = [
    { vi_tipo: 'repuesto', vi_precio_unitario: 30000, vi_cantidad: 2, vi_costo_unitario: 0 },
  ];
  const r = calcularRentabilidad({ manoObra: 0, items, configFinanciera: CFG_DEFAULT });
  assert.equal(r.ven_costo_repuestos,    0);
  assert.equal(r.ven_utilidad_repuestos, 60000);
  assert.equal(r.ven_utilidad_total,     60000);
  assert.equal(r.ven_es_rentable,        1); // == mínimo
});

test('venta mixta mano_obra + repuesto', () => {
  const items = [
    { vi_tipo: 'mano_obra', vi_precio_unitario: 35000, vi_cantidad: 1, vi_costo_unitario: 0 },
    { vi_tipo: 'repuesto',  vi_precio_unitario: 80000, vi_cantidad: 1, vi_costo_unitario: 40000 },
  ];
  const r = calcularRentabilidad({ manoObra: 0, items, configFinanciera: CFG_DEFAULT });
  assert.equal(r.ven_mano_obra,          35000);
  assert.equal(r.ven_utilidad_repuestos, 40000); // 80k - 40k
  assert.equal(r.ven_utilidad_total,     75000); // 35k + 40k
  assert.equal(r.ven_es_rentable,        1);     // 75000 >= 60000
});

// ── generarSugerencias ───────────────────────────────────────────────────────

test('generarSugerencias retorna vacío si es rentable', () => {
  const r = calcularRentabilidad({ manoObra: 80000, items: [], configFinanciera: CFG_DEFAULT });
  const s = generarSugerencias({ resultado: r, config: CFG_DEFAULT });
  assert.deepEqual(s, []);
});

test('generarSugerencias retorna al menos 2 ítems si no es rentable', () => {
  const r = calcularRentabilidad({ manoObra: 20000, items: [], configFinanciera: CFG_DEFAULT });
  const s = generarSugerencias({ resultado: r, config: CFG_DEFAULT });
  assert.ok(s.length >= 2, `Esperaba ≥2 sugerencias, recibí ${s.length}`);
  assert.ok(s[0].includes('$'), 'Primera sugerencia debe incluir monto en COP');
});
