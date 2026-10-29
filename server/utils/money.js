'use strict';

/** Redondea a 2 decimales evitando errores de coma flotante. */
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Redondea al peso mas cercano (COP no usa centavos). */
const rc = n => Math.round(Number(n));

module.exports = { r2, rc };
