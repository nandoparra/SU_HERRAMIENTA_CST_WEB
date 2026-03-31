const path = require('path');

// En Railway: UPLOADS_PATH=/data/uploads (Volume montado en /data)
// En local:   usa public/uploads por defecto
const UPLOADS_DIR = process.env.UPLOADS_PATH
  ? process.env.UPLOADS_PATH
  : path.join(__dirname, '..', 'public', 'uploads');

module.exports = UPLOADS_DIR;
