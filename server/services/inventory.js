'use strict';
const { db } = require('../db/connection');
const { fail } = require('../utils/http');
const { r2 } = require('../utils/money');

const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
const getSetting = db.prepare('SELECT allow_negative_stock FROM business_settings WHERE id = 1');
const insertMovement = db.prepare(`INSERT INTO inventory_movements
  (product_id, type, direction, quantity, balance, unit_cost, reason, reference_type, reference_id, user_id)
  VALUES (@product_id,@type,@direction,@quantity,@balance,@unit_cost,@reason,@reference_type,@reference_id,@user_id)`);
const updateStock = db.prepare('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?');
const recipeOf = db.prepare(`
  SELECT ri.ingredient_id, ri.quantity, p.name, p.stock, p.unit, p.cost, p.track_stock
  FROM recipe_items ri JOIN products p ON p.id = ri.ingredient_id
  WHERE ri.product_id = ?`);

/**
 * Aplica un movimiento de inventario y actualiza el saldo del producto.
 * Debe llamarse SIEMPRE dentro de una transaccion.
 */
function move({ productId, type, direction, quantity, unitCost = null, reason = null,
  referenceType = null, referenceId = null, userId = null, force = false }) {

  const product = getProduct.get(productId);
  if (!product) fail('El producto no existe.', 404);
  if (quantity <= 0) fail('La cantidad debe ser mayor que cero.');

  if (!product.track_stock && type !== 'adjustment') {
    return { skipped: true, balance: product.stock };
  }

  const delta = direction === 'in' ? quantity : -quantity;
  const balance = r2(product.stock + delta);

  if (balance < 0 && !force) {
    const allowNegative = getSetting.get()?.allow_negative_stock;
    if (!allowNegative) {
      fail(`No hay suficiente inventario de "${product.name}". Disponible: ${r2(product.stock)} ${product.unit}.`);
    }
  }

  updateStock.run(balance, productId);
  insertMovement.run({
    product_id: productId,
    type,
    direction,
    quantity: r2(quantity),
    balance,
    unit_cost: unitCost === null ? product.cost : r2(unitCost),
    reason,
    reference_type: referenceType,
    reference_id: referenceId,
    user_id: userId
  });

  return { skipped: false, balance };
}

/**
 * Convierte una venta de producto en la lista real de descuentos de inventario.
 * Un producto tipo receta descuenta sus ingredientes; uno simple, su propio stock.
 */
function explode(productId, quantity) {
  const product = getProduct.get(productId);
  if (!product) fail('El producto no existe.', 404);

  if (product.type === 'recipe') {
    const items = recipeOf.all(productId);
    if (items.length === 0) return [];
    return items
      .filter(i => i.track_stock)
      .map(i => ({ productId: i.ingredient_id, name: i.name, quantity: r2(i.quantity * quantity), unit: i.unit }));
  }

  if (!product.track_stock) return [];
  return [{ productId: product.id, name: product.name, quantity: r2(quantity), unit: product.unit }];
}

/** Descuenta inventario por la venta de un producto (incluye recetas). */
function consumeForSale(productId, quantity, { referenceId, userId, reason = 'Venta' }) {
  for (const line of explode(productId, quantity)) {
    move({
      productId: line.productId, type: 'sale', direction: 'out', quantity: line.quantity,
      reason, referenceType: 'order', referenceId, userId
    });
  }
}

/** Devuelve inventario al anular una venta. */
function returnForVoid(productId, quantity, { referenceId, userId, reason = 'Anulacion de venta' }) {
  for (const line of explode(productId, quantity)) {
    move({
      productId: line.productId, type: 'void_return', direction: 'in', quantity: line.quantity,
      reason, referenceType: 'order', referenceId, userId, force: true
    });
  }
}

/** Verifica disponibilidad sin escribir nada. Devuelve lista de faltantes. */
function checkAvailability(productId, quantity) {
  const missing = [];
  for (const line of explode(productId, quantity)) {
    const p = getProduct.get(line.productId);
    if (p && p.stock < line.quantity) {
      missing.push({ name: line.name, needed: line.quantity, available: r2(p.stock), unit: line.unit });
    }
  }
  return missing;
}

/** Costo unitario real de un producto (suma de ingredientes si es receta). */
function unitCost(productId) {
  const product = getProduct.get(productId);
  if (!product) return 0;
  if (product.type !== 'recipe') return product.cost;
  const row = db.prepare(`SELECT COALESCE(SUM(ri.quantity * p.cost),0) c
    FROM recipe_items ri JOIN products p ON p.id = ri.ingredient_id WHERE ri.product_id = ?`).get(productId);
  return r2(row.c);
}

/** Recalcula y guarda el costo de todos los productos con receta. */
function refreshRecipeCosts() {
  const rows = db.prepare("SELECT id FROM products WHERE type = 'recipe'").all();
  const upd = db.prepare('UPDATE products SET cost = ? WHERE id = ?');
  rows.forEach(r => upd.run(unitCost(r.id), r.id));
  return rows.length;
}

/** Productos en alerta: agotados o bajo el minimo. */
function alerts() {
  return db.prepare(`
    SELECT id, code, name, unit, stock, min_stock, type,
      CASE WHEN stock <= 0 THEN 'out' ELSE 'low' END AS level
    FROM products
    WHERE is_active = 1 AND track_stock = 1
      AND (stock <= 0 OR (min_stock > 0 AND stock <= min_stock))
    ORDER BY (stock <= 0) DESC, stock ASC`).all();
}

/** Kardex cronologico de un producto. */
function kardex(productId, { from, to } = {}) {
  const params = [productId];
  let where = 'WHERE m.product_id = ?';
  if (from) { where += ' AND date(m.created_at) >= ?'; params.push(from); }
  if (to) { where += ' AND date(m.created_at) <= ?'; params.push(to); }
  return db.prepare(`
    SELECT m.*, u.name AS user_name
    FROM inventory_movements m
    LEFT JOIN users u ON u.id = m.user_id
    ${where}
    ORDER BY m.created_at ASC, m.id ASC`).all(...params);
}

module.exports = {
  move, explode, consumeForSale, returnForVoid, checkAvailability,
  unitCost, refreshRecipeCosts, alerts, kardex
};
