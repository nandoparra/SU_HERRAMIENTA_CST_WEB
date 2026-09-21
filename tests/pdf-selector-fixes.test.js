'use strict';
/**
 * Tests unitarios — feature/pdf-selector-fixes
 *
 * 1. her_referencia incluida en mName de cotización PDF (sin BD ni servidor)
 * 2. Fix 2: her_referencia en queries de pdf.js (estructural — solo verifica que
 *    los SELECT contienen el campo, sin ejecutar la query)
 * 3. Fix 3/4: lógica del selector de máquinas (helper puro)
 *
 * Todos unitarios — no requieren servidor ni BD.
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');

// ── Fix 2: her_referencia en queries de pdf.js ────────────────────────────────

test('routes/pdf.js getMachineWithItems incluye h.her_referencia en el SELECT', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../routes/pdf.js'), 'utf8'
  );
  // La query de getMachineWithItems debe seleccionar her_referencia
  const idx = src.indexOf('getMachineWithItems');
  assert.ok(idx !== -1, 'función getMachineWithItems no encontrada en pdf.js');
  const snippet = src.slice(idx, idx + 600);
  assert.ok(
    snippet.includes('h.her_referencia'),
    'getMachineWithItems no selecciona h.her_referencia'
  );
});

test('routes/pdf.js getAllMachinesWithItems incluye h.her_referencia en el SELECT', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../routes/pdf.js'), 'utf8'
  );
  const idx = src.indexOf('getAllMachinesWithItems');
  assert.ok(idx !== -1, 'función getAllMachinesWithItems no encontrada en pdf.js');
  const snippet = src.slice(idx, idx + 600);
  assert.ok(
    snippet.includes('h.her_referencia'),
    'getAllMachinesWithItems no selecciona h.her_referencia'
  );
});

// ── Fix 1: mName en pdf-generator.js incluye her_referencia ──────────────────

test('pdf-generator.js: mName incluye her_referencia (cotización standalone)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../utils/pdf-generator.js'), 'utf8'
  );
  // Buscar las construcciones de mName — deben incluir her_referencia
  const matches = [...src.matchAll(/const mName\s*=\s*\[([^\]]+)\]/g)];
  assert.ok(matches.length >= 1, 'No se encontró ninguna construcción de mName');
  for (const m of matches) {
    assert.ok(
      m[1].includes('her_referencia'),
      `mName en posición ${m.index} no incluye her_referencia: ${m[1]}`
    );
  }
});

test('pdf-generator.js: filas de máquina y subtotal NO usan truncate(mName)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../utils/pdf-generator.js'), 'utf8'
  );
  // Ya no debe haber truncate(mName, ...) en filas Subtotal
  assert.ok(
    !src.includes("truncate(mName,"),
    'Se encontró truncate(mName, ...) — el Subtotal debe usar mName completo con wrapping'
  );
});

test('pdf-generator.js: drawRow usa wrap para columna nombre en isMachine y isSubtotal', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../utils/pdf-generator.js'), 'utf8'
  );
  // El patrón actualizado debe incluir isMachine || isSubtotal en la condición wrap
  assert.ok(
    src.includes('isMachine || isSubtotal') || src.includes('isDesc || isMachine || isSubtotal'),
    'drawRow no habilita wrap para filas isMachine/isSubtotal'
  );
});

// ── Fix 1: pre-cálculo de alturas para filas de máquina ──────────────────────

test('pdf-generator.js: machineHeights Map existe en ambas instancias de generateQuotePDF', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../utils/pdf-generator.js'), 'utf8'
  );
  const count = (src.match(/const machineHeights = new Map\(\)/g) || []).length;
  assert.strictEqual(count, 2, `Se esperaban 2 instancias de machineHeights, se encontraron: ${count}`);
});

// ── Fix 3: lógica de opción de selector ──────────────────────────────────────

function buildOptionLabel(m) {
  const sub  = [
    m.her_marca    ? '— ' + m.her_marca    : '',
    m.her_serial   ? 'S/N: ' + m.her_serial   : '',
    m.her_referencia ? 'Ref: ' + m.her_referencia : '',
  ].filter(Boolean).join(' | ');
  return m.her_nombre + ' ' + (sub || '(Sin identificador)');
}

test('selector: máquina con marca + serial + referencia muestra los tres', () => {
  const label = buildOptionLabel({ her_nombre: 'DEMOLEDOR', her_marca: 'BOSCH', her_serial: 'S001', her_referencia: 'GBH2-26' });
  assert.ok(label.includes('— BOSCH'),      'falta marca');
  assert.ok(label.includes('S/N: S001'),    'falta serial');
  assert.ok(label.includes('Ref: GBH2-26'), 'falta referencia');
});

test('selector: máquina solo con serial — sin "Ref:"', () => {
  const label = buildOptionLabel({ her_nombre: 'TALADRO', her_marca: 'DEWALT', her_serial: 'DCD777', her_referencia: null });
  assert.ok(!label.includes('Ref:'), 'no debe mostrar "Ref:" si referencia es null');
  assert.ok(label.includes('S/N: DCD777'), 'debe mostrar serial');
});

test('selector: máquina sin serial ni referencia muestra "(Sin identificador)"', () => {
  const label = buildOptionLabel({ her_nombre: 'PULIDORA', her_marca: null, her_serial: null, her_referencia: null });
  assert.ok(label.includes('(Sin identificador)'), 'debe mostrar placeholder');
  assert.ok(!label.includes('S/N:'), 'no debe mostrar S/N: vacío');
  assert.ok(!label.includes('Ref:'), 'no debe mostrar Ref: vacío');
});

test('selector: serial y referencia vacíos ("") tratados como sin identificador', () => {
  // Si los tres sub-campos son vacíos/null → debe aparecer el placeholder
  const label = buildOptionLabel({ her_nombre: 'SIERRA', her_marca: null, her_serial: '', her_referencia: '' });
  assert.ok(label.includes('(Sin identificador)'), 'string vacío debe tratarse como sin identificador');
  assert.ok(!label.includes('S/N:'), 'no debe mostrar S/N: vacío');
  assert.ok(!label.includes('Ref:'), 'no debe mostrar Ref: vacío');
});
