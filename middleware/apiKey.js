function apiKeyMiddleware(req, res, next) {
  const secret = process.env.API_SECRET_KEY;
  if (!secret) return next();
  if (req.headers['x-api-key'] !== secret)
    return res.status(401).json({ error: 'API key requerida o inválida' });
  next();
}

module.exports = apiKeyMiddleware;
