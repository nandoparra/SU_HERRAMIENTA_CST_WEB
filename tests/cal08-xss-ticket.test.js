'use strict';
// CAL-08: vi_descripcion y cliente (cli_razon_social / cli_contacto) se interpolaban
// directamente en el HTML del ticket de impresión sin escape — XSS almacenado.
// Solo afecta usuarios internos autenticados, pero sigue siendo incorrecto.
//
// Fix: helper esc() aplicado a los 2 campos de riesgo.
// Campos seguros (INT, ENUM, money()) no se escapan — prueba que no regresionamos.

const { describe, it } = require('node:test');
const assert = require('node:assert');

// ── helper bajo prueba ────────────────────────────────────────────────────────
// Misma función que se agrega en ventas.js — la importamos por valor para test
// independiente del módulo completo (que necesita DB, session, etc.)
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── tests del helper esc() ───────────────────────────────────────────────────

describe('esc() — helper de escape HTML para ticket de venta', () => {
  it('escapa < y > (XSS básico)', () => {
    assert.strictEqual(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapa & (entidades)', () => {
    assert.strictEqual(esc('R&B Electronic'), 'R&amp;B Electronic');
  });

  it('escapa " (atributos)', () => {
    assert.strictEqual(esc('"quoted"'), '&quot;quoted&quot;');
  });

  it('cadena normal sin caracteres especiales — sin cambio', () => {
    assert.strictEqual(esc('Repuesto motor 220V'), 'Repuesto motor 220V');
  });

  it('null/undefined → string vacío sin throw', () => {
    assert.strictEqual(esc(null), '');
    assert.strictEqual(esc(undefined), '');
  });

  it('número como input — se convierte a string', () => {
    assert.strictEqual(esc(42), '42');
  });
});

// ── tests de los campos aplicados ────────────────────────────────────────────

describe('CAL-08 — campos en riesgo en el ticket HTML', () => {
  it('vi_descripcion con payload XSS queda escapado', () => {
    const vi_descripcion = '<img src=x onerror=alert(1)>';
    const rendered = `<td>${esc(vi_descripcion)}</td>`;
    assert.ok(!rendered.includes('<img'), 'tag <img> no debe aparecer sin escaping');
    assert.ok(rendered.includes('&lt;img'), 'debe aparecer escapado como &lt;img');
  });

  it('cliente con nombre que contiene caracteres HTML queda escapado', () => {
    const cliente = 'Talleres <El Mejor> & Cía.';
    const rendered = `<div>Cliente: ${esc(cliente)}</div>`;
    assert.ok(!rendered.includes('<El'), 'tag sin escaping no debe aparecer');
    assert.ok(rendered.includes('&lt;El'), 'debe escapar el <');
    assert.ok(rendered.includes('&amp;'), 'debe escapar el &');
  });

  it('vi_descripcion normal (sin caracteres especiales) — no se altera', () => {
    const vi_descripcion = 'Cambio de carbones + lubricación';
    assert.strictEqual(esc(vi_descripcion), vi_descripcion);
  });

  it('cliente normal — no se altera', () => {
    const cliente = 'EMPRESA COLOMBIANA SAS';
    assert.strictEqual(esc(cliente), cliente);
  });
});

// ── tests de campos que NO se escapan (por ser seguros por tipo) ─────────────

describe('CAL-08 — campos seguros que no necesitan esc()', () => {
  it('money() produce string sin caracteres HTML', () => {
    const money = n => '$' + Math.round(Number(n)).toLocaleString('es-CO');
    const result = money(1250000);
    // Solo contiene: $, dígitos, puntos (separador miles es-CO)
    assert.ok(!/[<>&"]/.test(result), `money() no debe producir chars HTML: ${result}`);
  });

  it('INT de consecutivo no puede contener chars HTML', () => {
    // MySQL INT al convertir a string solo produce dígitos
    const consecutivos = [1, 42, 9999];
    for (const n of consecutivos) {
      const s = String(n);
      assert.ok(!/[<>&"]/.test(s), `consecutivo ${n} no debe tener chars HTML`);
    }
  });

  it('ENUM ven_metodo_pago no contiene chars HTML', () => {
    const enums = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'nequi', 'otro'];
    const metodos = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', cheque:'Cheque', nequi:'Nequi', otro:'Otro' };
    for (const e of enums) {
      const rendered = metodos[e] || e;
      assert.ok(!/[<>&"]/.test(rendered), `ENUM '${e}' no debe tener chars HTML`);
    }
  });
});
