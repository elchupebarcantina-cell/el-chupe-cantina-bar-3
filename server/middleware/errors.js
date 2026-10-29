'use strict';
const env = require('../config/env');

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'El recurso solicitado no existe.' });
  }
  next();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const expose = err.expose === true && status < 500;

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    console.error(err.stack || err.message);
  }

  const message = expose
    ? err.message
    : 'No fue posible completar la operacion. Intenta de nuevo.';

  const body = { error: message };
  if (env.NODE_ENV !== 'production' && !expose) body.detail = err.message;

  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
