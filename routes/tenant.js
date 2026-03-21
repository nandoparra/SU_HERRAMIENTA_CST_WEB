'use strict';
const express = require('express');
const router  = express.Router();

/**
 * GET /api/tenant/config — público (sin auth).
 * Devuelve la configuración de branding del tenant activo.
 * Usado por tenant-init.js en el frontend para aplicar colores y logo.
 */
router.get('/tenant/config', (req, res) => {
  const t = req.tenant;
  if (!t) return res.status(404).json({ error: 'Tenant no encontrado' });

  res.json({
    nombre:       t.ten_nombre        || 'SU HERRAMIENTA CST',
    colorPrimary: t.ten_color_primary || '#1d3557',
    colorAccent:  t.ten_color_accent  || '#e63946',
    logo: t.ten_logo ? `/assets/tenant-logos/${t.ten_logo}` : null,
  });
});

module.exports = router;
