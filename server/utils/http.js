'use strict';

/** Error de negocio: su mensaje SI se muestra al usuario. */
class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

const fail = (msg, status = 400, code) => { throw new AppError(msg, status, code); };

/** Envuelve un handler async para que los errores lleguen al middleware. */
const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, fail, asyncH };
