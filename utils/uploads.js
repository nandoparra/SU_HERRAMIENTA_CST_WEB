'use strict';
const path = require('path');
const fs   = require('fs');
const { fileTypeFromFile } = require('file-type');

// En Railway: UPLOADS_PATH=/data/uploads (Volume montado en /data)
// En local:   usa public/uploads por defecto
const UPLOADS_DIR = process.env.UPLOADS_PATH
  ? process.env.UPLOADS_PATH
  : path.join(__dirname, '..', 'public', 'uploads');

async function checkMagicBytes(filePath, allowed) {
  const result = await fileTypeFromFile(filePath).catch(() => null);
  const ok = result && allowed.some(a => result.mime === a || result.mime.startsWith(a));
  if (!ok) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    throw new Error('Tipo de archivo no permitido');
  }
}

module.exports = { UPLOADS_DIR, checkMagicBytes };
