'use strict';
const { db, tx } = require('../db/connection');
const { fail } = require('../utils/http');
const { rc, r2 } = require('../utils/money');
const { isoDate } = require('../utils/dates');

/** Caja abierta actualmente, o null. */
function currentRegister() {
  return db.prepare("SELECT * FROM cash_registers WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() || null;
}

function requireOpen() {
  const reg = currentRegister();
  if (!reg) fail('No hay una caja abierta. Abre la caja para continuar.');
  return reg;
}

/** Abre una caja con base inicial. */
function open({ openingAmount, userId, notes = null }) {
  return tx(() => {
    if (currentRegister()) fail('Ya hay una caja abierta. Cierrala antes de abrir otra.');
    if (openingAmount < 0) fail('La base inicial no puede ser negativa.');
    const id = db.prepare(`INSERT INTO cash_registers (opened_by, opening_amount, notes)
      VALUES (?,?,?)`).run(userId, rc(openingAmount), notes).lastInsertRowid;
    db.prepare(`INSERT INTO cash_movements (cash_register_id, user_id, type, amount, concept)
      VALUES (?,?,'income',?, 'Base inicial')`).run(id, userId, rc(openingAmount));
    return summary(id);
  });
}

/** Registra ingreso adicional o retiro. */
function movement({ type, amount, concept, userId, paymentMethodId = null }) {
  return tx(() => {
    const reg = requireOpen();
    if (!['income', 'withdrawal'].includes(type)) fail('Tipo de movimiento no valido.');
    if (amount <= 0) fail('El valor debe ser mayor que cero.');
    if (!concept || !String(concept).trim()) fail('Escribe el concepto del movimiento.');
    const signed = type === 'withdrawal' ? -rc(amount) : rc(amount);
    db.prepare(`INSERT INTO cash_movements
      (cash_register_id, user_id, type, amount, concept, payment_method_id)
      VALUES (?,?,?,?,?,?)`).run(reg.id, userId, type, signed, String(concept).trim(), paymentMethodId);
    return summary(reg.id);
  });
}

/** Totales de una caja: ventas por metodo, efectivo esperado, gastos, retiros. */
function summary(registerId) {
  const reg = db.prepare(`SELECT c.*, uo.name AS opened_by_name, uc.name AS closed_by_name
    FROM cash_registers c
    LEFT JOIN users uo ON uo.id = c.opened_by
    LEFT JOIN users uc ON uc.id = c.closed_by
    WHERE c.id = ?`).get(registerId);
  if (!reg) fail('La caja no existe.', 404);

  const byMethod = db.prepare(`
    SELECT pm.id, pm.name, pm.code, pm.affects_cash,
           COALESCE(SUM(p.amount),0) AS total, COUNT(p.id) AS count
    FROM payment_methods pm
    LEFT JOIN payments p ON p.payment_method_id = pm.id
         AND p.cash_register_id = ? AND p.is_void = 0
    GROUP BY pm.id ORDER BY pm.sort_order`).all(registerId);

  const salesTotal = r2(byMethod.reduce((s, m) => s + m.total, 0));
  const cashSales = r2(byMethod.filter(m => m.affects_cash).reduce((s, m) => s + m.total, 0));

  const mv = db.prepare(`SELECT type, COALESCE(SUM(amount),0) total FROM cash_movements
    WHERE cash_register_id = ? GROUP BY type`).all(registerId);
  const byType = Object.fromEntries(mv.map(m => [m.type, m.total]));

  /**
   * Gastos que salieron del cajon durante este turno.
   *
   * Se usa LEFT JOIN a proposito: un gasto anotado sin metodo de pago tambien
   * salio del efectivo. Con un JOIN normal esas filas se descartaban y el
   * arqueo quedaba cuadrando de mas. Ahora cuenta tanto los marcados como
   * efectivo como los que quedaron sin marcar.
   */
  const expenses = db.prepare(`SELECT COALESCE(SUM(e.amount),0) total FROM expenses e
    LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
    WHERE e.cash_register_id = ?
      AND (pm.affects_cash = 1 OR e.payment_method_id IS NULL)`).get(registerId).total;

  // Detalle de esos gastos, para poder revisar el arqueo linea por linea.
  const expenseList = db.prepare(`SELECT e.id, e.description, e.amount, e.expense_date,
      ec.name AS category_name, pm.name AS method_name, u.name AS user_name
    FROM expenses e
    LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
    LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.cash_register_id = ?
      AND (pm.affects_cash = 1 OR e.payment_method_id IS NULL)
    ORDER BY e.id DESC`).all(registerId);

  /**
   * Gastos del turno que NO salieron del cajon: los que se pagaron por
   * transferencia, tarjeta o cualquier metodo que no mueve efectivo.
   * No se restan del arqueo (la plata nunca estuvo en el cajon), pero se
   * muestran aparte para que la cuenta se entienda y nadie los busque.
   */
  const otherExpenses = db.prepare(`SELECT COALESCE(SUM(e.amount),0) total FROM expenses e
    JOIN payment_methods pm ON pm.id = e.payment_method_id
    WHERE pm.affects_cash = 0
      AND date(e.expense_date) BETWEEN date(?) AND date(COALESCE(?, 'now', 'localtime'))`)
    .get(reg.opened_at, reg.closed_at).total;

  const otherExpenseList = db.prepare(`SELECT e.id, e.description, e.amount, e.expense_date,
      ec.name AS category_name, pm.name AS method_name
    FROM expenses e
    JOIN payment_methods pm ON pm.id = e.payment_method_id
    LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
    WHERE pm.affects_cash = 0
      AND date(e.expense_date) BETWEEN date(?) AND date(COALESCE(?, 'now', 'localtime'))
    ORDER BY e.id DESC`).all(reg.opened_at, reg.closed_at);

  const withdrawals = Math.abs(byType.withdrawal || 0);
  const extraIncome = r2((byType.income || 0) - reg.opening_amount);
  const refunds = Math.abs(byType.refund || 0);

  const expected = rc(reg.opening_amount + cashSales + extraIncome - withdrawals - expenses - refunds);

  const orders = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM orders
    WHERE cash_register_id = ? AND status = 'paid'`).get(registerId);

  return {
    ...reg,
    sales_total: salesTotal,
    cash_sales: cashSales,
    extra_income: extraIncome,
    withdrawals,
    expenses: r2(expenses),
    expense_list: expenseList,
    other_expenses: r2(otherExpenses),
    other_expense_list: otherExpenseList,
    refunds,
    expected_amount: reg.status === 'closed' ? reg.expected_amount : expected,
    orders_count: orders.c,
    orders_total: r2(orders.t),
    by_method: byMethod,
    movements: db.prepare(`SELECT m.*, u.name AS user_name, pm.name AS method_name
      FROM cash_movements m
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN payment_methods pm ON pm.id = m.payment_method_id
      WHERE m.cash_register_id = ? ORDER BY m.id DESC`).all(registerId)
  };
}

/** Cierra la caja comparando efectivo contado contra esperado. */
function close({ countedAmount, userId, notes = null }) {
  return tx(() => {
    const reg = requireOpen();
    const openOrders = db.prepare(`SELECT COUNT(*) c FROM orders
      WHERE cash_register_id = ? AND status IN ('open','bill_requested')`).get(reg.id).c;
    if (openOrders > 0) {
      fail(`Hay ${openOrders} cuenta(s) sin cobrar. Cierralas antes de cerrar la caja.`);
    }
    if (countedAmount < 0) fail('El efectivo contado no puede ser negativo.');

    const s = summary(reg.id);
    const difference = rc(countedAmount - s.expected_amount);

    db.prepare(`UPDATE cash_registers SET closed_by = ?, counted_amount = ?, expected_amount = ?,
      difference = ?, status = 'closed', closed_at = datetime('now','localtime'),
      notes = COALESCE(NULLIF(?, ''), notes) WHERE id = ?`)
      .run(userId, rc(countedAmount), s.expected_amount, difference, notes || '', reg.id);

    return summary(reg.id);
  });
}

/**
 * Rango de la jornada de trabajo, definido por la caja y no por la medianoche.
 *
 * En una cantina la venta de las 11 p.m. y la de la 1 a.m. son del mismo dia
 * de trabajo. Por eso "hoy" arranca cuando se abre la caja y termina cuando se
 * cierra, no a las 12 de la noche.
 *
 *  - Con caja abierta  -> desde la apertura hasta este momento (en vivo).
 *  - Sin caja abierta  -> la ultima jornada cerrada, para poder revisarla.
 *  - Si nunca se ha abierto caja -> el dia calendario, como respaldo.
 */
function shiftRange() {
  const abierta = currentRegister();

  if (abierta) {
    return {
      start: abierta.opened_at,
      end: '9999-12-31 23:59:59',
      from: abierta.opened_at.slice(0, 10),
      to: isoDate(new Date()),
      register_id: abierta.id,
      opened_at: abierta.opened_at,
      closed_at: null,
      status: 'open'
    };
  }

  const ultima = db.prepare(
    "SELECT * FROM cash_registers WHERE status = 'closed' ORDER BY id DESC LIMIT 1"
  ).get();

  if (ultima) {
    return {
      start: ultima.opened_at,
      end: ultima.closed_at,
      from: ultima.opened_at.slice(0, 10),
      to: ultima.closed_at.slice(0, 10),
      register_id: ultima.id,
      opened_at: ultima.opened_at,
      closed_at: ultima.closed_at,
      status: 'closed'
    };
  }

  const hoy = isoDate(new Date());
  return {
    start: `${hoy} 00:00:00`, end: `${hoy} 23:59:59`,
    from: hoy, to: hoy,
    register_id: null, opened_at: null, closed_at: null, status: 'none'
  };
}

module.exports = { currentRegister, requireOpen, open, close, movement, summary, shiftRange };
