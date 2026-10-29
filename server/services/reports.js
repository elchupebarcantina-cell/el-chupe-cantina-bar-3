'use strict';
const { db } = require('../db/connection');
const { r2 } = require('../utils/money');
const { bounds } = require('../utils/dates');

const PAID = "o.status = 'paid'";

/** Metricas principales para un rango. */
function kpis(range) {
  const { start, end } = bounds(range);
  const base = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS sales,
           COALESCE(SUM(o.discount_amount),0) AS discounts,
           COALESCE(SUM(o.tax_amount),0) AS taxes
    FROM orders o WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?`).get(start, end);

  const cost = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity * oi.unit_cost),0) AS cost
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?`).get(start, end).cost;

  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses
    WHERE expense_date BETWEEN ? AND ?`).get(range.from, range.to).t;

  const voided = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM orders
    WHERE status = 'void' AND voided_at BETWEEN ? AND ?`).get(start, end);

  const sales = r2(base.sales);
  const grossProfit = r2(sales - cost);

  return {
    sales,
    orders: base.orders,
    average_ticket: base.orders ? r2(sales / base.orders) : 0,
    discounts: r2(base.discounts),
    taxes: r2(base.taxes),
    cost: r2(cost),
    gross_profit: grossProfit,
    margin_pct: sales > 0 ? r2((grossProfit / sales) * 100) : 0,
    expenses: r2(expenses),
    net_profit: r2(grossProfit - expenses),
    voided_count: voided.c,
    voided_total: r2(voided.t)
  };
}

const topProducts = (range, { limit = 10, asc = false } = {}) => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT oi.product_id, oi.product_name, c.name AS category,
           SUM(oi.quantity) AS quantity, SUM(oi.total) AS total,
           SUM(oi.quantity * oi.unit_cost) AS cost
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY oi.product_id
    ORDER BY quantity ${asc ? 'ASC' : 'DESC'}
    LIMIT ?`).all(start, end, limit);
};

const byCategory = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT COALESCE(c.name,'Sin categoria') AS name, c.color,
           SUM(oi.quantity) AS quantity, SUM(oi.total) AS total
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY c.id ORDER BY total DESC`).all(start, end);
};

const byWaiter = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT u.id, COALESCE(u.name,'Sin asignar') AS name,
           COUNT(o.id) AS orders, COALESCE(SUM(o.total),0) AS total,
           COUNT(DISTINCT o.table_id) AS tables
    FROM orders o LEFT JOIN users u ON u.id = o.waiter_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY o.waiter_id ORDER BY total DESC`).all(start, end)
    .map(r => ({ ...r, average_ticket: r.orders ? r2(r.total / r.orders) : 0 }));
};

const byPaymentMethod = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT pm.name, pm.code, COUNT(p.id) AS count, COALESCE(SUM(p.amount),0) AS total
    FROM payments p
    JOIN payment_methods pm ON pm.id = p.payment_method_id
    JOIN orders o ON o.id = p.order_id
    WHERE p.is_void = 0 AND ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY pm.id ORDER BY total DESC`).all(start, end);
};

const byTable = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT COALESCE(t.name,'Mostrador') AS name, COALESCE(z.name,'-') AS zone,
           COUNT(o.id) AS orders, COALESCE(SUM(o.total),0) AS total
    FROM orders o LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN zones z ON z.id = t.zone_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY o.table_id ORDER BY total DESC`).all(start, end);
};

/** Serie diaria de ventas para graficas. */
const salesByDay = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT date(o.closed_at) AS day, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS total
    FROM orders o WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY day ORDER BY day`).all(start, end);
};

/** Ventas por hora del dia. */
const salesByHour = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT strftime('%H', o.closed_at) AS hour, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS total
    FROM orders o WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY hour ORDER BY hour`).all(start, end);
};

const salesByMonth = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT strftime('%Y-%m', o.closed_at) AS month, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS total
    FROM orders o WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY month ORDER BY month`).all(start, end);
};

/** Rentabilidad producto a producto. */
const profitability = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT oi.product_name, SUM(oi.quantity) AS quantity,
           SUM(oi.total) AS revenue,
           SUM(oi.quantity * oi.unit_cost) AS cost,
           SUM(oi.total) - SUM(oi.quantity * oi.unit_cost) AS profit
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    GROUP BY oi.product_id ORDER BY profit DESC`).all(start, end)
    .map(r => ({ ...r, margin_pct: r.revenue > 0 ? r2((r.profit / r.revenue) * 100) : 0 }));
};

const expensesReport = range => db.prepare(`
  SELECT e.*, ec.name AS category_name, pm.name AS method_name, u.name AS user_name
  FROM expenses e
  LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
  LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
  LEFT JOIN users u ON u.id = e.user_id
  WHERE e.expense_date BETWEEN ? AND ?
  ORDER BY e.expense_date DESC, e.id DESC`).all(range.from, range.to);

const discountsReport = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT o.number, o.closed_at, o.discount_type, o.discount_value, o.discount_amount,
           o.discount_reason, o.total, u.name AS authorized_by, t.name AS table_name
    FROM orders o LEFT JOIN users u ON u.id = o.discount_by
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.discount_amount > 0 AND o.closed_at BETWEEN ? AND ?
    ORDER BY o.closed_at DESC`).all(start, end);
};

const voidsReport = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT o.number, o.voided_at, o.void_reason, o.total, u.name AS voided_by,
           w.name AS waiter_name, t.name AS table_name
    FROM orders o LEFT JOIN users u ON u.id = o.voided_by
    LEFT JOIN users w ON w.id = o.waiter_id
    LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'void' AND o.voided_at BETWEEN ? AND ?
    ORDER BY o.voided_at DESC`).all(start, end);
};

const purchasesReport = range => db.prepare(`
  SELECT p.*, s.name AS supplier_name, u.name AS user_name, pm.name AS method_name
  FROM purchases p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.purchase_date BETWEEN ? AND ? AND p.status = 'received'
  ORDER BY p.purchase_date DESC`).all(range.from, range.to);

const inventoryReport = () => db.prepare(`
  SELECT p.id, p.code, p.name, p.unit, p.stock, p.min_stock, p.cost, p.price, p.type,
         c.name AS category, (p.stock * p.cost) AS stock_value
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.is_active = 1 AND p.track_stock = 1
  ORDER BY c.sort_order, p.name`).all();

const movementsReport = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT m.*, p.name AS product_name, p.code, p.unit, u.name AS user_name
    FROM inventory_movements m
    JOIN products p ON p.id = m.product_id
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.created_at BETWEEN ? AND ?
    ORDER BY m.created_at DESC, m.id DESC LIMIT 2000`).all(start, end);
};

const salesReport = range => {
  const { start, end } = bounds(range);
  return db.prepare(`
    SELECT o.id, o.number, o.closed_at, o.subtotal, o.discount_amount, o.tax_amount, o.total,
           t.name AS table_name, u.name AS waiter_name, c.name AS customer_name,
           (SELECT GROUP_CONCAT(pm.name, ', ') FROM payments p
             JOIN payment_methods pm ON pm.id = p.payment_method_id
             WHERE p.order_id = o.id AND p.is_void = 0) AS methods
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = o.waiter_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${PAID} AND o.closed_at BETWEEN ? AND ?
    ORDER BY o.closed_at DESC`).all(start, end);
};

const cashReport = range => db.prepare(`
  SELECT c.*, uo.name AS opened_by_name, uc.name AS closed_by_name
  FROM cash_registers c
  LEFT JOIN users uo ON uo.id = c.opened_by
  LEFT JOIN users uc ON uc.id = c.closed_by
  WHERE date(c.opened_at) BETWEEN ? AND ?
  ORDER BY c.id DESC`).all(range.from, range.to);

module.exports = {
  kpis, topProducts, byCategory, byWaiter, byPaymentMethod, byTable,
  salesByDay, salesByHour, salesByMonth, profitability,
  expensesReport, discountsReport, voidsReport, purchasesReport,
  inventoryReport, movementsReport, salesReport, cashReport
};
