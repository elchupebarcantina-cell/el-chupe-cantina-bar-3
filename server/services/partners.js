'use strict';
/**
 * Socios: descuento exclusivo para las personas que invirtieron en el negocio.
 *
 * Reglas:
 *  - Cada socio se identifica por su cedula.
 *  - Tiene un porcentaje de descuento (por defecto 5%) sobre la cuenta.
 *  - Lo puede usar un numero limitado de veces por mes (por defecto 2).
 *  - El cupo se cuenta por mes calendario: el dia 1 se renueva solo.
 *  - Un uso se gasta en el momento de aplicarlo a una cuenta. Si esa cuenta
 *    se anula, o se le quita el beneficio, el uso se devuelve.
 */
const { db, tx } = require('../db/connection');
const { fail } = require('../utils/http');
const orders = require('./orders');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Deja la cedula solo con numeros y letras: "1.073.777.762" -> "1073777762". */
function normalizeDoc(value) {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function rules() {
  const s = db.prepare('SELECT partner_discount_pct, partner_monthly_uses FROM business_settings WHERE id = 1').get();
  return { pct: s.partner_discount_pct, uses: s.partner_monthly_uses };
}

/** Mes actual como 'AAAA-MM' en la hora local del servidor. */
function currentMonth() {
  return db.prepare("SELECT strftime('%Y-%m','now','localtime') AS m").get().m;
}

/** Texto amable del mes: "octubre". */
function monthName(ym = currentMonth()) {
  return MESES[Number(ym.slice(5, 7)) - 1];
}

/** Nombre del mes siguiente, para decir cuando se renueva. */
function nextMonthName(ym = currentMonth()) {
  return MESES[Number(ym.slice(5, 7)) % 12];
}

/** Cuantas veces uso el beneficio este mes (las cuentas anuladas no cuentan). */
function usesThisMonth(partnerId) {
  return db.prepare(`SELECT COUNT(*) c FROM orders
    WHERE partner_id = ? AND status != 'void'
      AND strftime('%Y-%m', partner_applied_at) = strftime('%Y-%m','now','localtime')`).get(partnerId).c;
}

function status(partner) {
  const r = rules();
  const used = usesThisMonth(partner.id);
  return {
    partner: { id: partner.id, name: partner.name, document: partner.document, is_active: partner.is_active },
    used,
    limit: r.uses,
    remaining: Math.max(0, r.uses - used),
    pct: r.pct,
    month: monthName(),
    renews: nextMonthName()
  };
}

/** Busca un socio por cedula y dice cuantos usos le quedan este mes. */
function lookup(document) {
  const doc = normalizeDoc(document);
  if (!doc) fail('Escribe la cedula del socio.');
  const partner = db.prepare('SELECT * FROM partners WHERE document = ?').get(doc);
  if (!partner) fail(`La cedula ${doc} no esta registrada como socio.`, 404);
  if (!partner.is_active) fail(`${partner.name} esta inactivo como socio. El administrador lo puede reactivar.`);
  return status(partner);
}

/** Aplica el descuento de socio a una cuenta abierta. */
function apply(orderId, document, userId) {
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) fail('La orden no existe.', 404);
    if (order.status === 'paid') fail('Esta cuenta ya fue pagada y no se puede modificar.');
    if (order.status === 'void') fail('Esta venta esta anulada.');

    const info = lookup(document);
    const p = info.partner;

    if (order.partner_id === p.id) fail(`${p.name} ya tiene el descuento aplicado en esta cuenta.`);
    if (order.partner_id) fail('Esta cuenta ya tiene el descuento de otro socio. Quitalo primero.');
    if (order.discount_type) {
      fail('Esta cuenta ya tiene otro descuento. Los descuentos no se suman: quita el actual primero.');
    }
    if (info.remaining <= 0) {
      fail(`${p.name} ya uso sus ${info.limit} descuentos de ${info.month}. Se le renuevan el 1 de ${info.renews}.`);
    }

    db.prepare(`UPDATE orders SET partner_id = ?, partner_applied_at = datetime('now','localtime'),
      discount_type = 'percent', discount_value = ?, discount_reason = ?, discount_by = ?
      WHERE id = ?`).run(p.id, info.pct, `Socio: ${p.name} · CC ${p.document}`, userId, orderId);

    const updated = orders.recalc(orderId);
    return { order: updated, partner: p, used: info.used + 1, limit: info.limit, pct: info.pct, month: info.month };
  });
}

/** Quita el beneficio de socio de una cuenta. El uso se devuelve. */
function remove(orderId) {
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) fail('La orden no existe.', 404);
    if (!order.partner_id) fail('Esta cuenta no tiene descuento de socio.');
    if (order.status === 'paid') fail('Esta cuenta ya fue pagada y no se puede modificar.');
    if (order.status === 'void') fail('Esta venta esta anulada.');
    db.prepare(`UPDATE orders SET partner_id = NULL, partner_applied_at = NULL,
      discount_type = NULL, discount_value = 0, discount_reason = NULL, discount_by = NULL
      WHERE id = ?`).run(orderId);
    return orders.recalc(orderId);
  });
}

module.exports = { normalizeDoc, rules, currentMonth, monthName, usesThisMonth, lookup, apply, remove };
