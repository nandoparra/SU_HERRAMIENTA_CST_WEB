'use strict';
const express = require('express');
const router  = express.Router();
const { requireInterno } = require('../middleware/auth');
const { alegraGet }      = require('../utils/alegra-client');
const log = require('../utils/logger');

router.use(requireInterno);

function requireAdmin(req, res, next) {
  if (req.session.user.tipo !== 'A') {
    return res.status(403).json({ error: 'Solo administradores pueden acceder a esta función' });
  }
  next();
}

// Verifica que las credenciales de Alegra estén configuradas y funcionando
router.get('/internal/alegra/test-connection', requireAdmin, async (req, res) => {
  if (!process.env.ALEGRA_USER || !process.env.ALEGRA_TOKEN) {
    return res.status(400).json({
      connected: false,
      error: 'Variables ALEGRA_USER y ALEGRA_TOKEN no están configuradas en el servidor',
    });
  }
  try {
    const company = await alegraGet('/company');
    res.json({
      connected: true,
      company: {
        name:           company.name,
        identification: company.identification,
        email:          company.email,
        regime:         company.regime,
      },
    });
  } catch (e) {
    log.warn({ err: e.message }, '⚠️ Alegra test-connection falló');
    res.status(e.status === 401 ? 401 : 502).json({
      connected: false,
      error: e.status === 401
        ? 'Credenciales inválidas — verifica ALEGRA_USER y ALEGRA_TOKEN'
        : `Error conectando con Alegra: ${e.message}`,
    });
  }
});

module.exports = router;
