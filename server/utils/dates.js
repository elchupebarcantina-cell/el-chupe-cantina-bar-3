'use strict';

const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoDateTime = d => `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Rango [desde, hasta] en texto SQL a partir de un preset o fechas explicitas. */
function resolveRange(query = {}) {
  const today = new Date();

  if (query.from && query.to) {
    return { from: String(query.from).slice(0, 10), to: String(query.to).slice(0, 10) };
  }

  const preset = query.range || 'today';
  const end = isoDate(today);
  const start = new Date(today);

  switch (preset) {
    case 'today': break;
    case 'yesterday': start.setDate(start.getDate() - 1); return { from: isoDate(start), to: isoDate(start) };
    case 'week': start.setDate(start.getDate() - 6); break;
    case 'month': start.setDate(1); break;
    case 'last30': start.setDate(start.getDate() - 29); break;
    case 'year': start.setMonth(0, 1); break;
    case 'all': return { from: '1970-01-01', to: end };
    default: break;
  }
  return { from: isoDate(start), to: end };
}

/**
 * Convierte el rango a limites datetime inclusivos.
 * Si el rango ya trae start/end con hora exacta (por ejemplo una jornada de
 * caja que arranco a las 6:02 p.m.), se respetan tal cual.
 */
function bounds(range) {
  if (range.start && range.end) return { start: range.start, end: range.end };
  return { start: `${range.from} 00:00:00`, end: `${range.to} 23:59:59` };
}

module.exports = { resolveRange, bounds, isoDate, isoDateTime };
