'use strict';
/**
 * Tests para el fileFilter de firma en bulk-entregar.
 *
 * Clase de bug detectada: typo en string de comparación de MIME type
 * ('image\png' vs 'image/png') que causa que el fileFilter rechace
 * SIEMPRE el archivo, sin tocar la BD ni dar error claro al usuario.
 *
 * Dos capas:
 *   1. Unitario: llama _firmaMimeFilter directo — sin servidor, sin BD.
 *   2. Integración multer real: levanta un Express mínimo con el uploader
 *      real, sube un PNG de 67 bytes, verifica que el handler se alcanza.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const path   = require('node:path');

// PNG mínimo válido — 1×1 píxel blanco (67 bytes, magic bytes reales)
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==',
  'base64'
);

// ── 1. Tests unitarios de _firmaMimeFilter ────────────────────────────────────

describe('firmaMimeFilter — unitario (sin servidor)', () => {
  let firmaMimeFilter;

  test('exporta _firmaMimeFilter desde orders-fotos.js', () => {
    const mod = require('../routes/orders-fotos');
    assert.ok(typeof mod._firmaMimeFilter === 'function',
      '_firmaMimeFilter debe exportarse para poder testearse');
    firmaMimeFilter = mod._firmaMimeFilter;
  });

  test('acepta image/png (el tipo correcto)', (t, done) => {
    const mod = require('../routes/orders-fotos');
    mod._firmaMimeFilter({}, { mimetype: 'image/png' }, (err, ok) => {
      assert.strictEqual(err, null, 'No debe haber error con image/png');
      assert.strictEqual(ok, true, 'Debe aceptar el archivo');
      done();
    });
  });

  test('rechaza image/jpeg', (t, done) => {
    const mod = require('../routes/orders-fotos');
    mod._firmaMimeFilter({}, { mimetype: 'image/jpeg' }, (err) => {
      assert.ok(err instanceof Error, 'Debe retornar un Error');
      done();
    });
  });

  test('rechaza image/gif', (t, done) => {
    const mod = require('../routes/orders-fotos');
    mod._firmaMimeFilter({}, { mimetype: 'image/gif' }, (err) => {
      assert.ok(err instanceof Error, 'Debe retornar un Error');
      done();
    });
  });

  // Documenta exactamente el bug que se corrigió:
  // 'image\png' en JS = 'imagepng' (la \ antes de p no es escape reconocido)
  test('el string del bug "image\\png" NO es igual a "image/png" (documenta el typo)', () => {
    // eslint-disable-next-line no-useless-escape
    const bugString = 'image\png'; // intencional — documenta el bug
    assert.notStrictEqual(bugString, 'image/png',
      'Confirma que el typo original producía una comparación siempre falsa');
    assert.strictEqual(bugString, 'imagepng',
      'image\\png en JS equivale a "imagepng" — nunca coincide con el MIME real');
  });
});

// ── 2. Test de integración con multer real ────────────────────────────────────

describe('firmaMimeFilter — integración con multer real (sin BD, sin auth)', () => {
  /**
   * Levanta un Express mínimo con uploadFirmaBulk.single('firma') y una
   * ruta de prueba que responde { reached: true } si multer dejó pasar el
   * archivo. Sin auth, sin BD — solo verifica que el fileFilter no rechaza.
   *
   * Si el fileFilter tiene el bug ('image\png'), multer llama next(error)
   * antes de que el handler corra y la respuesta sería un error 500/400,
   * no { reached: true }.
   */
  let server;
  let port;
  let uploadedFilePath; // para limpiar después del test

  // Requiere que uploadFirmaBulk esté exportado
  test('uploadFirmaBulk exportado desde orders-fotos.js', () => {
    const mod = require('../routes/orders-fotos');
    assert.ok(typeof mod.uploadFirmaBulk?.single === 'function',
      'uploadFirmaBulk debe exportarse para la prueba de integración');
  });

  test('PNG real pasa el fileFilter y llega al handler', async () => {
    const express = require('express');
    const mod     = require('../routes/orders-fotos');

    const app = express();

    // Ruta mínima: solo multer + handler de prueba
    app.post('/test-firma', mod.uploadFirmaBulk.single('firma'), (req, res) => {
      uploadedFilePath = req.file?.path; // guardamos para limpiar
      res.json({
        reached:  true,
        mimetype: req.file?.mimetype ?? null,
        hasFile:  !!req.file,
      });
    });

    // Error handler para que los errores de multer se devuelvan como JSON
    // (sin esto, Express devuelve HTML de error y r.json() falla)
    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
      res.status(err.status || 500).json({ error: err.message });
    });

    await new Promise(resolve => {
      server = http.createServer(app);
      server.listen(0, resolve);
    });
    port = server.address().port;

    const fd = new FormData();
    fd.append('firma', new Blob([MINIMAL_PNG], { type: 'image/png' }), 'firma.png');

    const r = await fetch(`http://localhost:${port}/test-firma`, {
      method: 'POST',
      body: fd,
    });

    assert.strictEqual(r.status, 200,
      `El fileFilter debe aceptar el PNG — respuesta esperada 200, recibida ${r.status}`);

    const d = await r.json();
    assert.strictEqual(d.reached, true,
      'El handler debe ejecutarse cuando el fileFilter acepta el archivo');
    assert.strictEqual(d.hasFile, true,
      'req.file debe estar presente después de que multer acepte el PNG');
    assert.strictEqual(d.mimetype, 'image/png',
      'El mimetype registrado por multer debe ser image/png');
  });

  test('archivo con MIME incorrecto (image/jpeg) es rechazado por el fileFilter', async () => {
    // Usamos el mismo servidor levantado en el test anterior
    if (!server) return; // si el test anterior falló, skip

    const fd = new FormData();
    // Mismo buffer PNG pero enviado con mimetype incorrecto
    fd.append('firma', new Blob([MINIMAL_PNG], { type: 'image/jpeg' }), 'firma.jpg');

    const r = await fetch(`http://localhost:${port}/test-firma`, {
      method: 'POST',
      body: fd,
    });

    // El fileFilter rechaza → error handler → no 200
    assert.notStrictEqual(r.status, 200,
      'Un archivo con MIME incorrecto NO debe llegar al handler (status debe ser ≠ 200)');
  });

  // Limpieza: cerrar servidor y borrar archivo temporal subido
  test('cleanup — cerrar servidor de prueba', async () => {
    if (uploadedFilePath) {
      try { require('node:fs').unlinkSync(uploadedFilePath); } catch {}
    }
    if (server) await new Promise(resolve => server.close(resolve));
  });
});
