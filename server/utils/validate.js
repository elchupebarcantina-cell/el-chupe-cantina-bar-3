'use strict';
const { fail } = require('./http');

const str = (v, field, { required = true, max = 255, min = 1 } = {}) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (required) fail(`El campo "${field}" es obligatorio.`);
    return null;
  }
  if (s.length < min) fail(`"${field}" debe tener al menos ${min} caracteres.`);
  if (s.length > max) fail(`"${field}" no puede superar ${max} caracteres.`);
  return s;
};

const num = (v, field, { required = true, min = null, max = null, def = 0 } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) fail(`El campo "${field}" es obligatorio.`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`"${field}" debe ser un numero valido.`);
  if (min !== null && n < min) fail(`"${field}" no puede ser menor que ${min}.`);
  if (max !== null && n > max) fail(`"${field}" no puede ser mayor que ${max}.`);
  return n;
};

const int = (v, field, opts = {}) => Math.trunc(num(v, field, opts));

const bool = v => (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;

const oneOf = (v, field, allowed, { required = true, def = null } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) fail(`El campo "${field}" es obligatorio.`);
    return def;
  }
  if (!allowed.includes(v)) fail(`Valor no valido para "${field}".`);
  return v;
};

const email = (v, field = 'correo', opts = {}) => {
  const s = str(v, field, opts);
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail('El correo no tiene un formato valido.');
  return s ? s.toLowerCase() : null;
};

const dateStr = (v, field, { required = false, def = null } = {}) => {
  if (!v) { if (required) fail(`El campo "${field}" es obligatorio.`); return def; }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`"${field}" debe tener formato AAAA-MM-DD.`);
  return s;
};

module.exports = { str, num, int, bool, oneOf, email, dateStr };
