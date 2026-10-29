'use strict';
const env = require('../config/env');

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.reset < now) buckets.delete(key);
}, 60000).unref();

/** Limitador simple en memoria por IP + ruta. */
function rateLimit({ max = 60, windowMin = env.RATE_LIMIT_WINDOW_MIN, message } = {}) {
  const windowMs = windowMin * 60 * 1000;
  return (req, res, next) => {
    const key = `${req.ip}|${req.baseUrl}${req.path}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      const mins = Math.ceil((b.reset - now) / 60000);
      return next(Object.assign(
        new Error(message || `Demasiados intentos. Espera ${mins} minuto(s) e intenta de nuevo.`),
        { status: 429, expose: true }));
    }
    next();
  };
}

module.exports = { rateLimit };
