'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// checkMagicBytes depende de file-type (ESM), se importa dinámicamente
let checkMagicBytes;

test('UPLOADS_DIR usa UPLOADS_PATH env si está definido', async () => {
  const original = process.env.UPLOADS_PATH;
  process.env.UPLOADS_PATH = '/custom/path';
  // Limpiar cache del módulo para re-evaluar con la nueva env
  delete require.cache[require.resolve('../utils/uploads')];
  const { UPLOADS_DIR } = require('../utils/uploads');
  assert.equal(UPLOADS_DIR, '/custom/path');
  // Restaurar
  if (original === undefined) delete process.env.UPLOADS_PATH;
  else process.env.UPLOADS_PATH = original;
  delete require.cache[require.resolve('../utils/uploads')];
});

test('UPLOADS_DIR usa public/uploads por defecto cuando no hay env', async () => {
  const original = process.env.UPLOADS_PATH;
  delete process.env.UPLOADS_PATH;
  delete require.cache[require.resolve('../utils/uploads')];
  const { UPLOADS_DIR } = require('../utils/uploads');
  assert.ok(UPLOADS_DIR.endsWith(path.join('public', 'uploads')));
  if (original !== undefined) process.env.UPLOADS_PATH = original;
  delete require.cache[require.resolve('../utils/uploads')];
});

test('checkMagicBytes acepta imagen PNG válida', async () => {
  const { checkMagicBytes } = require('../utils/uploads');
  // PNG header: 89 50 4E 47 0D 0A 1A 0A
  const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.png`);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82]);
  fs.writeFileSync(tmpFile, pngHeader);
  await assert.doesNotReject(() => checkMagicBytes(tmpFile, ['image/png', 'image/jpeg']));
  // El archivo debe seguir existiendo (no fue borrado)
  assert.ok(fs.existsSync(tmpFile));
  fs.unlinkSync(tmpFile);
});

test('checkMagicBytes rechaza archivo con magic bytes inválidos y lo borra', async () => {
  const { checkMagicBytes } = require('../utils/uploads');
  const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
  // Contenido de texto plano — no tiene magic bytes de imagen
  fs.writeFileSync(tmpFile, 'esto no es una imagen');
  await assert.rejects(
    () => checkMagicBytes(tmpFile, ['image/png', 'image/jpeg']),
    /Tipo de archivo no permitido/
  );
  // El archivo debe haber sido borrado
  assert.equal(fs.existsSync(tmpFile), false);
});

test('checkMagicBytes acepta PDF válido en lista permitida', async () => {
  const { checkMagicBytes } = require('../utils/uploads');
  // PDF header: %PDF-
  const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.pdf`);
  const pdfHeader = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
  fs.writeFileSync(tmpFile, pdfHeader);
  await assert.doesNotReject(() => checkMagicBytes(tmpFile, ['application/pdf']));
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});
