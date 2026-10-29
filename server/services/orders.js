'use strict';
const { db, tx } = require('../db/connection');
const { fail } = require('../utils/http');
const { r2, rc } = require('../utils/money');
const inventory = require('./inventory');
const cash = require('./cash');

const settings = () => db.prepare('SELECT * FROM business_settings WHERE id = 1').get();

const Q = {
  order: db.prepare('SELECT * FROM orders WHERE id = ?'),
  items: db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id'),
  payments: db.prepare(`SELECT p.*, pm.name AS method_name, pm.code AS method_code, u.name AS user_name
    FROM payments p JOIN payment_methods pm ON pm.id = p.payment_method_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.order_id = ? AND p.is_void = 0 ORDER BY p.id`),
  table: db.prepare('SELECT * FROM tables WHERE id = ?'),
  openOrderForTable: db.prepare("SELECT * FROM orders WHERE table_id = ? AND status IN ('open','bill_requested')"),
  product: db.prepare('SELECT * FROM products WHERE id = ?'),
  setTableStatus: db.prepare('UPDATE tables SET status = ? WHERE id = ?')
};

function nextOrderNumber() {
  db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order_number'").run();
  return db.prepare("SELECT value FROM counters WHERE name = 'order_number'").get().value;
}

/** Recalcula subtotal, descuento, impuestos, servicio y total de una orden. */
function recalc(orderId) {
  const order = Q.order.get(orderId);
  if (!order) fail('La orden no existe.', 404);
  const cfg = settings();
  const items = Q.items.all(orderId);

  let subtotal = 0;
  let taxBase = 0;
  for (const it of items) {
    const line = r2(it.quantity * it.unit_price - it.discount);
    subtotal += line;
    taxBase += line;
    db.prepare('UPDATE order_items SET total = ? WHERE id = ?').run(line, it.id);
  }
  subtotal = r2(subtotal);

  let discountAmount = 0;
  if (order.discount_type === 'percent') discountAmount = r2(subtotal * (order.discount_value / 100));
  else if (order.discount_type === 'amount') discountAmount = r2(Math.min(order.discount_value, subtotal));
  else if (order.discount_type === 'courtesy') discountAmount = subtotal;

  const afterDiscount = r2(subtotal - discountAmount);

  // Impuesto por linea, proporcional al descuento aplicado
  let taxAmount = 0;
  const factor = subtotal > 0 ? afterDiscount / subtotal : 0;
  for (const it of items) {
    if (!it.tax_rate) continue;
    const base = r2(it.total * factor);
    taxAmount += cfg.prices_include_tax
      ? r2(base - base / (1 + it.tax_rate / 100))
      : r2(base * (it.tax_rate / 100));
  }
  taxAmount = r2(taxAmount);

  const serviceAmount = cfg.service_charge_pct > 0 ? r2(afterDiscount * (cfg.service_charge_pct / 100)) : 0;
  const total = cfg.prices_include_tax
    ? rc(afterDiscount + serviceAmount)
    : rc(afterDiscount + taxAmount + serviceAmount);

  db.prepare(`UPDATE orders SET subtotal = ?, discount_amount = ?, tax_amount = ?,
    service_amount = ?, total = ? WHERE id = ?`)
    .run(subtotal, discountAmount, taxAmount, serviceAmount, total, orderId);

  return full(orderId);
}

/** Orden completa con items, pagos y datos relacionados. */
function full(orderId) {
  const order = db.prepare(`
    SELECT o.*, t.name AS table_name, z.name AS zone_name,
           u.name AS waiter_name, c.name AS customer_name,
           pa.name AS partner_name, pa.document AS partner_document
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN zones z ON z.id = t.zone_id
    LEFT JOIN users u ON u.id = o.waiter_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN partners pa ON pa.id = o.partner_id
    WHERE o.id = ?`).get(orderId);
  if (!order) fail('La orden no existe.', 404);
  order.items = Q.items.all(orderId);
  order.payments = Q.payments.all(orderId);
  order.paid_amount = r2(order.payments.reduce((s, p) => s + p.amount, 0));
  order.balance = rc(order.total - order.paid_amount);
  return order;
}

/** Abre una orden nueva. Una mesa solo puede tener una activa. */
function open({ tableId = null, waiterId, customerId = null, guests = 1, type = 'table', notes = null }) {
  return tx(() => {
    if (tableId) {
      const table = Q.table.get(tableId);
      if (!table) fail('La mesa no existe.', 404);
      if (!table.is_active) fail('Esa mesa esta inactiva.');
      const existing = Q.openOrderForTable.get(tableId);
      if (existing) fail(`La mesa "${table.name}" ya tiene una orden activa (#${existing.number}).`);
    }
    const register = cash.currentRegister();
    const number = nextOrderNumber();
    const id = db.prepare(`INSERT INTO orders
      (number, table_id, waiter_id, customer_id, cash_register_id, type, guests, notes)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(number, tableId, waiterId, customerId, register?.id || null, type, guests, notes).lastInsertRowid;
    if (tableId) Q.setTableStatus.run('occupied', tableId);
    return full(id);
  });
}

function assertEditable(order) {
  if (order.status === 'paid') fail('Esta cuenta ya fue pagada y no se puede modificar.');
  if (order.status === 'void') fail('Esta venta esta anulada.');
}

/** Agrega un producto a la orden. Verifica inventario disponible. */
function addItem(orderId, { productId, quantity = 1, notes = null, unitPrice = null, userId }) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);

    const product = Q.product.get(productId);
    if (!product) fail('El producto no existe.', 404);
    if (!product.is_active) fail(`"${product.name}" esta desactivado.`);
    if (product.type === 'supply') fail(`"${product.name}" es un insumo y no se vende directamente.`);
    if (quantity <= 0) fail('La cantidad debe ser mayor que cero.');

    const missing = inventory.checkAvailability(productId, quantity);
    if (missing.length && !settings().allow_negative_stock) {
      const m = missing[0];
      fail(`No hay suficiente inventario de "${m.name}". Necesitas ${m.needed} ${m.unit} y hay ${m.available}.`);
    }

    const tax = product.tax_id
      ? db.prepare('SELECT rate FROM taxes WHERE id = ?').get(product.tax_id)?.rate || 0 : 0;
    const station = product.station ||
      db.prepare('SELECT station FROM categories WHERE id = ?').get(product.category_id)?.station || 'bar';

    // Si ya existe el mismo producto sin enviar y sin nota, se suma
    const same = db.prepare(`SELECT * FROM order_items
      WHERE order_id = ? AND product_id = ? AND kds_status = 'pending'
        AND COALESCE(notes,'') = COALESCE(?,'') AND paid_split = 0`).get(orderId, productId, notes);

    if (same) {
      db.prepare('UPDATE order_items SET quantity = quantity + ? WHERE id = ?').run(quantity, same.id);
    } else {
      db.prepare(`INSERT INTO order_items
        (order_id, product_id, product_name, station, quantity, unit_price, unit_cost, tax_rate, notes, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        orderId, productId, product.name, station, quantity,
        unitPrice === null ? product.price : unitPrice,
        inventory.unitCost(productId), tax, notes, userId);
    }

    inventory.consumeForSale(productId, quantity, { referenceId: orderId, userId });
    if (order.table_id && order.status === 'open') Q.setTableStatus.run('occupied', order.table_id);
    return recalc(orderId);
  });
}

/** Cambia la cantidad de un item; ajusta el inventario por la diferencia. */
function updateItem(orderId, itemId, { quantity, notes, userId }) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
    if (!item) fail('El producto no esta en esta orden.', 404);

    if (quantity !== undefined && quantity !== null) {
      if (quantity <= 0) fail('La cantidad debe ser mayor que cero. Usa eliminar si quieres quitarlo.');
      const diff = r2(quantity - item.quantity);
      if (diff > 0) {
        const missing = inventory.checkAvailability(item.product_id, diff);
        if (missing.length && !settings().allow_negative_stock) {
          const m = missing[0];
          fail(`No hay suficiente inventario de "${m.name}". Disponible: ${m.available} ${m.unit}.`);
        }
        inventory.consumeForSale(item.product_id, diff, { referenceId: orderId, userId, reason: 'Aumento en orden' });
      } else if (diff < 0) {
        inventory.returnForVoid(item.product_id, Math.abs(diff), {
          referenceId: orderId, userId, reason: 'Reduccion en orden'
        });
      }
      db.prepare('UPDATE order_items SET quantity = ? WHERE id = ?').run(quantity, itemId);
    }
    if (notes !== undefined) db.prepare('UPDATE order_items SET notes = ? WHERE id = ?').run(notes, itemId);
    return recalc(orderId);
  });
}

/** Elimina un item y devuelve el inventario. */
function removeItem(orderId, itemId, { userId, reason = 'Producto retirado de la orden' }) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
    if (!item) fail('El producto no esta en esta orden.', 404);

    inventory.returnForVoid(item.product_id, item.quantity, { referenceId: orderId, userId, reason });
    db.prepare('DELETE FROM order_items WHERE id = ?').run(itemId);
    return recalc(orderId);
  });
}

/** Aplica descuento a la orden completa. */
function applyDiscount(orderId, { type, value, reason, userId }) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    if (type && !['percent', 'amount', 'courtesy'].includes(type)) fail('Tipo de descuento no valido.');
    if (type === 'percent' && (value < 0 || value > 100)) fail('El porcentaje debe estar entre 0 y 100.');
    if (type === 'amount' && value < 0) fail('El descuento no puede ser negativo.');

    // Un descuento manual reemplaza al de socio: el socio recupera ese uso del mes.
    db.prepare(`UPDATE orders SET discount_type = ?, discount_value = ?, discount_reason = ?, discount_by = ?,
      partner_id = NULL, partner_applied_at = NULL
      WHERE id = ?`).run(type || null, type ? value : 0, reason || null, userId, orderId);
    return recalc(orderId);
  });
}

/** Marca la orden como cuenta solicitada. */
function requestBill(orderId) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    db.prepare("UPDATE orders SET status = 'bill_requested' WHERE id = ?").run(orderId);
    if (order.table_id) Q.setTableStatus.run('bill_requested', order.table_id);
    return full(orderId);
  });
}

/** Mueve una cuenta completa a otra mesa. */
function transferTable(orderId, targetTableId) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    const target = Q.table.get(targetTableId);
    if (!target) fail('La mesa destino no existe.', 404);
    const busy = Q.openOrderForTable.get(targetTableId);
    if (busy && busy.id !== orderId) fail(`La mesa "${target.name}" ya tiene una orden activa.`);

    const originId = order.table_id;
    db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(targetTableId, orderId);
    if (originId && originId !== targetTableId) Q.setTableStatus.run('available', originId);
    Q.setTableStatus.run(order.status === 'bill_requested' ? 'bill_requested' : 'occupied', targetTableId);
    return full(orderId);
  });
}

/** Traslada la orden a otro mesero. */
function transferWaiter(orderId, waiterId) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    const w = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(waiterId);
    if (!w) fail('El usuario destino no existe o esta inactivo.', 404);
    db.prepare('UPDATE orders SET waiter_id = ? WHERE id = ?').run(waiterId, orderId);
    return full(orderId);
  });
}

/** Une la orden origen dentro de la orden destino. */
function mergeOrders(sourceId, targetId) {
  return tx(() => {
    if (sourceId === targetId) fail('No puedes unir una cuenta consigo misma.');
    const source = Q.order.get(sourceId);
    const target = Q.order.get(targetId);
    if (!source || !target) fail('Alguna de las cuentas no existe.', 404);
    assertEditable(source); assertEditable(target);
    if (source.paid_amount > 0) fail('La cuenta origen ya tiene pagos parciales y no se puede unir.');

    db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(targetId, sourceId);
    db.prepare("UPDATE orders SET status = 'void', void_reason = ?, closed_at = datetime('now','localtime') WHERE id = ?")
      .run(`Unida a la cuenta #${target.number}`, sourceId);
    if (source.table_id) Q.setTableStatus.run('available', source.table_id);
    recalc(targetId);
    return full(targetId);
  });
}

/** Mueve items seleccionados a una nueva cuenta (dividir mesa/cuenta). */
function splitOrder(orderId, { itemIds, targetTableId = null, waiterId }) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    assertEditable(order);
    if (!Array.isArray(itemIds) || itemIds.length === 0) fail('Selecciona al menos un producto para separar.');

    const all = Q.items.all(orderId);
    if (itemIds.length >= all.length) fail('Deja al menos un producto en la cuenta original.');

    if (targetTableId) {
      const busy = Q.openOrderForTable.get(targetTableId);
      if (busy) fail('La mesa destino ya tiene una orden activa.');
    }

    const number = nextOrderNumber();
    const newId = db.prepare(`INSERT INTO orders
      (number, table_id, waiter_id, cash_register_id, type, guests, notes)
      VALUES (?,?,?,?,?,1,?)`).run(
      number, targetTableId, waiterId || order.waiter_id, order.cash_register_id, order.type,
      `Separada de la cuenta #${order.number}`).lastInsertRowid;

    const upd = db.prepare('UPDATE order_items SET order_id = ? WHERE id = ? AND order_id = ?');
    itemIds.forEach(id => upd.run(newId, id, orderId));
    if (targetTableId) Q.setTableStatus.run('occupied', targetTableId);

    recalc(orderId);
    return { original: full(orderId), created: recalc(newId) };
  });
}

/** Registra un pago (permite pagos parciales y mixtos). Cierra la cuenta al completarse. */
function addPayment(orderId, { paymentMethodId, amount, received = null, reference = null, userId }) {
  return tx(() => {
    const order = full(orderId);
    if (order.status === 'void') fail('Esta venta esta anulada.');
    if (order.status === 'paid') fail('Esta cuenta ya fue pagada.');
    if (order.items.length === 0) fail('No puedes cobrar una cuenta sin productos.');
    if (amount <= 0) fail('El valor del pago debe ser mayor que cero.');

    const method = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND is_active = 1').get(paymentMethodId);
    if (!method) fail('El metodo de pago no existe o esta inactivo.', 404);

    const balance = order.balance;
    if (amount > balance + 0.5) {
      fail(`El pago supera el saldo pendiente ($${balance.toLocaleString('es-CO')}).`);
    }

    const register = cash.currentRegister();
    if (method.affects_cash && !register) {
      fail('No hay una caja abierta. Abre la caja antes de recibir efectivo.');
    }

    const change = received !== null && received > amount ? rc(received - amount) : 0;

    const payId = db.prepare(`INSERT INTO payments
      (order_id, payment_method_id, cash_register_id, amount, received, change_given, reference, user_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      orderId, paymentMethodId, register?.id || null, rc(amount), received, change, reference, userId
    ).lastInsertRowid;

    if (register) {
      db.prepare(`INSERT INTO cash_movements
        (cash_register_id, user_id, type, amount, concept, reference_type, reference_id, payment_method_id)
        VALUES (?,?,'sale',?,?,'order',?,?)`).run(
        register.id, userId, rc(amount), `Venta #${order.number}`, orderId, paymentMethodId);
    }

    const updated = full(orderId);
    if (updated.balance <= 0.5) {
      db.prepare(`UPDATE orders SET status = 'paid', paid_amount = ?, closed_at = datetime('now','localtime'),
        cash_register_id = COALESCE(cash_register_id, ?) WHERE id = ?`)
        .run(updated.paid_amount, register?.id || null, orderId);
      if (order.table_id) Q.setTableStatus.run('available', order.table_id);
    } else {
      db.prepare('UPDATE orders SET paid_amount = ? WHERE id = ?').run(updated.paid_amount, orderId);
    }

    return { order: full(orderId), payment_id: payId, change };
  });
}

/** Anula una venta: nunca borra, marca y devuelve inventario. */
function voidOrder(orderId, { reason, userId }) {
  return tx(() => {
    const order = full(orderId);
    if (order.status === 'void') fail('Esta venta ya estaba anulada.');
    if (!reason || !String(reason).trim()) fail('Debes indicar el motivo de la anulacion.');

    for (const it of order.items) {
      inventory.returnForVoid(it.product_id, it.quantity, {
        referenceId: orderId, userId, reason: 'Anulacion de venta #' + order.number
      });
    }

    for (const p of order.payments) {
      db.prepare('UPDATE payments SET is_void = 1 WHERE id = ?').run(p.id);
      if (p.cash_register_id) {
        db.prepare(`INSERT INTO cash_movements
          (cash_register_id, user_id, type, amount, concept, reference_type, reference_id, payment_method_id)
          VALUES (?,?,'refund',?,?,'order',?,?)`).run(
          p.cash_register_id, userId, -Math.abs(p.amount),
          `Anulacion venta #${order.number}`, orderId, p.payment_method_id);
      }
    }

    db.prepare(`UPDATE orders SET status = 'void', void_reason = ?, voided_by = ?,
      voided_at = datetime('now','localtime'), closed_at = datetime('now','localtime'), paid_amount = 0 WHERE id = ?`)
      .run(String(reason).trim(), userId, orderId);

    if (order.table_id) Q.setTableStatus.run('available', order.table_id);
    return full(orderId);
  });
}

/** Envia los productos pendientes a las estaciones (comandas). */
function sendToStations(orderId) {
  return tx(() => {
    const order = Q.order.get(orderId);
    if (!order) fail('La orden no existe.', 404);
    const pending = db.prepare(`SELECT * FROM order_items
      WHERE order_id = ? AND sent_at IS NULL AND station != 'none'`).all(orderId);
    if (pending.length === 0) fail('No hay productos nuevos por enviar.');
    db.prepare("UPDATE order_items SET sent_at = datetime('now','localtime') WHERE order_id = ? AND sent_at IS NULL")
      .run(orderId);
    return { sent: pending.length, items: pending };
  });
}

module.exports = {
  open, full, recalc, addItem, updateItem, removeItem, applyDiscount, requestBill,
  transferTable, transferWaiter, mergeOrders, splitOrder, addPayment, voidOrder, sendToStations
};
