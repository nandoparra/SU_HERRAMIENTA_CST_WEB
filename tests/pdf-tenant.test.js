'use strict';
/**
 * tests/pdf-tenant.test.js
 *
 * Verifica que los datos de empresa en los PDFs provienen del tenant,
 * nunca de valores hardcodeados. Prueba resolveCompany() directamente
 * (función pura exportada de utils/pdf-generator.js).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { resolveCompany } = require('../utils/pdf-generator');

// Datos hardcodeados del antiguo COMPANY — ninguno debe aparecer en salida
const DATOS_PROHIBIDOS = {
  name:    'HERNANDO PARRA ZAPATA',
  nit:     'NIT 9862087-1',
  address: 'calle 21 No 10 02 - Pereira',
  phone:   '3104650437',
  website: 'www.suherramienta.com',
  email:   'suherramientapereira@gmail.com',
};

// ── 1. Aislamiento por tenant ─────────────────────────────────────────────────

describe('resolveCompany — aislamiento por tenant', () => {

  const tenantA = {
    ten_nombre:           'Taller Alfa',
    ten_nit:              'NIT 800111222-3',
    ten_direccion:        'Cra 5 No 10-20 Bogotá',
    ten_telefono_empresa: '3001112233',
    ten_email:            'alfa@taller.com',
    ten_website:          'www.talleralfa.com',
  };

  const tenantB = {
    ten_nombre:           'Taller Beta',
    ten_nit:              'NIT 900333444-5',
    ten_direccion:        'Av 7 No 50-60 Medellín',
    ten_telefono_empresa: '3114445566',
    ten_email:            'beta@taller.com',
    ten_website:          'www.tallerbeta.com',
  };

  test('Tenant A devuelve sus propios datos', () => {
    const c = resolveCompany(tenantA);
    assert.equal(c.name,    tenantA.ten_nombre);
    assert.equal(c.nit,     tenantA.ten_nit);
    assert.equal(c.address, tenantA.ten_direccion);
    assert.equal(c.phone,   tenantA.ten_telefono_empresa);
    assert.equal(c.email,   tenantA.ten_email);
    assert.equal(c.website, tenantA.ten_website);
  });

  test('Tenant B devuelve sus propios datos', () => {
    const c = resolveCompany(tenantB);
    assert.equal(c.name,    tenantB.ten_nombre);
    assert.equal(c.nit,     tenantB.ten_nit);
    assert.equal(c.address, tenantB.ten_direccion);
    assert.equal(c.phone,   tenantB.ten_telefono_empresa);
    assert.equal(c.email,   tenantB.ten_email);
    assert.equal(c.website, tenantB.ten_website);
  });

  test('A y B producen datos distintos — sin cruce', () => {
    const ca = resolveCompany(tenantA);
    const cb = resolveCompany(tenantB);
    assert.notEqual(ca.name,    cb.name);
    assert.notEqual(ca.nit,     cb.nit);
    assert.notEqual(ca.address, cb.address);
    assert.notEqual(ca.phone,   cb.phone);
    assert.notEqual(ca.email,   cb.email);
    assert.notEqual(ca.website, cb.website);
  });

});

// ── 2. Datos faltantes — placeholder visible, nunca fallback hardcodeado ──────

describe('resolveCompany — datos faltantes', () => {

  test('Tenant sin NIT muestra placeholder, no el NIT de SU HERRAMIENTA', () => {
    const c = resolveCompany({ ten_nombre: 'Taller X', ten_nit: null });
    assert.notEqual(c.nit, DATOS_PROHIBIDOS.nit,
      'No debe caer al NIT hardcodeado');
    assert.ok(c.nit.length > 0, 'El placeholder no debe ser cadena vacía');
  });

  test('Tenant sin dirección muestra placeholder, no la dirección de SU HERRAMIENTA', () => {
    const c = resolveCompany({ ten_nombre: 'Taller X' });
    assert.notEqual(c.address, DATOS_PROHIBIDOS.address);
    assert.ok(c.address.length > 0);
  });

  test('Tenant sin teléfono empresa pero con WA usa ten_wa_number (cascada aprobada)', () => {
    const c = resolveCompany({
      ten_nombre:           'Taller X',
      ten_telefono_empresa: null,
      ten_wa_number:        '3209998877',
    });
    assert.equal(c.phone, '3209998877');
    assert.notEqual(c.phone, DATOS_PROHIBIDOS.phone);
  });

  test('Tenant sin teléfono de ningún tipo muestra placeholder, no el de SU HERRAMIENTA', () => {
    const c = resolveCompany({ ten_nombre: 'Taller X', ten_telefono_empresa: null, ten_wa_number: null });
    assert.notEqual(c.phone, DATOS_PROHIBIDOS.phone);
    assert.ok(c.phone.length > 0);
  });

  test('Tenant sin email devuelve cadena vacía (no aparece línea en PDF)', () => {
    const c = resolveCompany({ ten_nombre: 'Taller X', ten_email: null });
    assert.notEqual(c.email, DATOS_PROHIBIDOS.email);
    // email y website vacíos son aceptables — no se renderizan en el PDF
    assert.equal(typeof c.email, 'string');
  });

  test('Tenant sin website devuelve cadena vacía', () => {
    const c = resolveCompany({ ten_nombre: 'Taller X', ten_website: null });
    assert.notEqual(c.website, DATOS_PROHIBIDOS.website);
    assert.equal(typeof c.website, 'string');
  });

  test('Ningún campo del tenant vacío cae a los valores hardcodeados de SU HERRAMIENTA', () => {
    const c = resolveCompany({ ten_nombre: 'Taller Sin Datos' });
    assert.notEqual(c.name,    DATOS_PROHIBIDOS.name);
    assert.notEqual(c.nit,     DATOS_PROHIBIDOS.nit);
    assert.notEqual(c.address, DATOS_PROHIBIDOS.address);
    assert.notEqual(c.phone,   DATOS_PROHIBIDOS.phone);
    assert.notEqual(c.email,   DATOS_PROHIBIDOS.email);
    assert.notEqual(c.website, DATOS_PROHIBIDOS.website);
  });

});

// ── 3. ten_nombre siempre presente ───────────────────────────────────────────

describe('resolveCompany — ten_nombre', () => {

  test('ten_nombre se usa como name sin modificación', () => {
    const c = resolveCompany({ ten_nombre: 'Mi Taller S.A.S.' });
    assert.equal(c.name, 'Mi Taller S.A.S.');
  });

  test('ten_nombre vacío usa placeholder (no el nombre de SU HERRAMIENTA)', () => {
    const c = resolveCompany({ ten_nombre: '' });
    assert.notEqual(c.name, DATOS_PROHIBIDOS.name);
  });

});
