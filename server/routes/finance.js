'use strict';
const express = require('express');
const { db, tx } = require('../db/connection');
const { asyncH, fail } = require('../utils/http');
const v = require('../utils/validate');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const inventory = require('../services/inventory');
const cash = require('../services/cash');
const { r2, rc } = require('../utils/money');

const router = express.Router();

// =====================================================================
// Inventario
// =====================================================================
router.get('/inventory', requirePerm('inventory.view'), (req, res) => {
  const where = ['p.is_active = 1'];
  const params = [];
  if (req.query.search) {
    where.push('(p.name LIKE ? OR p.code LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.category_id) { where.push('p.category_id = ?'); params.push(Number(req.query.category_id)); }
  if (req.query.alert === '1') where.push('(p.stock <= 0 OR (p.min_stock > 0 AND p.stock <= p.min_stock))');
  if (req.query.tracked !== '0') where.push('p.track_stock = 1');

  res.json(db.prepare(`
    SELECT p.id, p.code, p.name, p.unit, p.stock, p.min_stock, p.cost, p.price, p.type,
           c.name AS category_name, (p.stock * p.cost) AS stock_value,
           CASE WHEN p.stock <= 0 THEN 'out'
                WHEN p.min_stock > 0 AND p.stock <= p.min_stock THEN 'low'
                ELSE 'ok' END AS level
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY (p.stock <= 0) DESC, p.name`).all(...params));
});

router.get('/inventory/alerts', requirePerm('inventory.view', 'dashboard.view'), (req, res) => {
  res.json(inventory.alerts());
});

router.get('/inventory/kardex/:productId', requirePerm('inventory.view'), asyncH((req, res) => {
  const id = v.int(req.params.productId, 'producto');
  const product = db.prepare('SELECT id, code, name, unit, stock, cost FROM products WHERE id = ?').get(id);
  if (!product) fail('El producto no existe.', 404);
  res.json({
    product,
    movements: inventory.kardex(id, { from: req.query.from, to: req.query.to })
  });
}));

router.post('/inventory/movements', requirePerm('inventory.manage'), asyncH((req, res) => {
  const productId = v.int(req.body.product_id, 'producto');
  const type = v.oneOf(req.body.type, 'tipo de movimiento',
    ['adjustment', 'loss', 'damage', 'internal', 'return', 'purchase']);
  const direction = v.oneOf(req.body.direction, 'direccion', ['in', 'out']);
  const quantity = v.num(req.body.quantity, 'cantidad', { min: 0.0001 });
  const reason = v.str(req.body.reason, 'motivo', { max: 300 });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) fail('El producto no existe.', 404);

  const result = tx(() => inventory.move({
    productId, type, direction, quantity, reason, userId: req.user.id,
    unitCost: req.body.unit_cost !== undefined ? v.num(req.body.unit_cost, 'costo', { min: 0 }) : null,
    referenceType: 'manual'
  }));

  audit(req, {
    action: 'inventory', entity: 'products', entityId: productId,
    description: `${req.user.name} registro ${direction === 'in' ? 'entrada' : 'salida'} de ${quantity} ${product.unit} de "${product.name}" (${type}). Saldo: ${result.balance}. Motivo: ${reason}`,
    oldValue: { stock: product.stock }, newValue: { stock: result.balance }
  });
  res.json({ ok: true, balance: result.balance });
}));

/** Ajuste directo a un conteo fisico. */
router.post('/inventory/count', requirePerm('inventory.manage'), asyncH((req, res) => {
  const productId = v.int(req.body.product_id, 'producto');
  const counted = v.num(req.body.counted, 'cantidad contada', { min: 0 });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) fail('El producto no existe.', 404);

  const diff = r2(counted - product.stock);
  if (diff === 0) return res.json({ ok: true, balance: product.stock, message: 'El conteo coincide con el sistema.' });

  const result = tx(() => inventory.move({
    productId, type: 'adjustment', direction: diff > 0 ? 'in' : 'out', quantity: Math.abs(diff),
    reason: req.body.reason || `Ajuste por conteo fisico (sistema ${product.stock}, contado ${counted})`,
    userId: req.user.id, referenceType: 'count', force: true
  }));

  audit(req, {
    action: 'inventory', entity: 'products', entityId: productId,
    description: `Conteo fisico de "${product.name}": sistema ${product.stock} -> contado ${counted} (diferencia ${diff})`
  });
  res.json({ ok: true, balance: result.balance, difference: diff });
}));

// =====================================================================
// Compras
// =====================================================================
router.get('/purchases', requirePerm('purchases.view'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.from) { where.push('p.purchase_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('p.purchase_date <= ?'); params.push(req.query.to); }
  if (req.query.supplier_id) { where.push('p.supplier_id = ?'); params.push(Number(req.query.supplier_id)); }
  res.json(db.prepare(`
    SELECT p.*, s.name AS supplier_name, u.name AS user_name, pm.name AS method_name,
      (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS items_count
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.purchase_date DESC, p.id DESC LIMIT 300`).all(...params));
});

router.get('/purchases/:id', requirePerm('purchases.view'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const purchase = db.prepare(`SELECT p.*, s.name AS supplier_name, u.name AS user_name
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(id);
  if (!purchase) fail('La compra no existe.', 404);
  purchase.items = db.prepare(`SELECT pi.*, pr.name AS product_name, pr.code, pr.unit
    FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
    WHERE pi.purchase_id = ?`).all(id);
  res.json(purchase);
}));

router.post('/purchases', requirePerm('purchases.manage'), asyncH((req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) fail('Agrega al menos un producto a la compra.');

  const supplierId = req.body.supplier_id ? v.int(req.body.supplier_id, 'proveedor') : null;
  const methodId = req.body.payment_method_id ? v.int(req.body.payment_method_id, 'metodo de pago') : null;
  const invoice = req.body.invoice_number ? v.str(req.body.invoice_number, 'numero de factura', { max: 60 }) : null;
  const date = v.dateStr(req.body.purchase_date, 'fecha', { def: new Date().toISOString().slice(0, 10) });
  const updateCost = req.body.update_cost === undefined ? true : !!req.body.update_cost;

  const result = tx(() => {
    let subtotal = 0;
    let taxAmount = 0;
    const rows = [];

    for (const raw of items) {
      const productId = v.int(raw.product_id, 'producto');
      const quantity = v.num(raw.quantity, 'cantidad', { min: 0.0001 });
      const unitCost = v.num(raw.unit_cost, 'costo unitario', { min: 0 });
      const taxRate = v.num(raw.tax_rate, 'impuesto', { required: false, def: 0, min: 0, max: 100 });
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (!product) fail('Uno de los productos no existe.');
      const lineTotal = r2(quantity * unitCost);
      subtotal += lineTotal;
      taxAmount += r2(lineTotal * (taxRate / 100));
      rows.push({ productId, quantity, unitCost, taxRate, lineTotal, product });
    }

    const total = rc(subtotal + taxAmount);
    const purchaseId = db.prepare(`INSERT INTO purchases
      (supplier_id, invoice_number, payment_method_id, subtotal, tax_amount, total, notes, user_id, purchase_date)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      supplierId, invoice, methodId, r2(subtotal), r2(taxAmount), total,
      req.body.notes || null, req.user.id, date).lastInsertRowid;

    const insItem = db.prepare(`INSERT INTO purchase_items
      (purchase_id, product_id, quantity, unit_cost, tax_rate, total) VALUES (?,?,?,?,?,?)`);

    for (const r of rows) {
      insItem.run(purchaseId, r.productId, r.quantity, r.unitCost, r.taxRate, r.lineTotal);
      inventory.move({
        productId: r.productId, type: 'purchase', direction: 'in', quantity: r.quantity,
        unitCost: r.unitCost, reason: `Compra${invoice ? ' factura ' + invoice : ''}`,
        referenceType: 'purchase', referenceId: purchaseId, userId: req.user.id
      });
      if (updateCost && r.unitCost > 0 && r.unitCost !== r.product.cost) {
        db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(r.unitCost, r.productId);
      }
    }

    inventory.refreshRecipeCosts();

    // Si la compra se pago en efectivo desde la caja, se registra la salida
    if (methodId) {
      const method = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(methodId);
      const register = cash.currentRegister();
      if (method?.affects_cash && register) {
        db.prepare(`INSERT INTO cash_movements
          (cash_register_id, user_id, type, amount, concept, reference_type, reference_id, payment_method_id)
          VALUES (?,?,'expense',?,?,'purchase',?,?)`).run(
          register.id, req.user.id, -total, `Compra a proveedor${invoice ? ' ' + invoice : ''}`,
          purchaseId, methodId);
      }
    }

    return purchaseId;
  });

  audit(req, {
    action: 'create', entity: 'purchases', entityId: result,
    description: `${req.user.name} registro una compra por ${items.length} producto(s)`
  });
  res.status(201).json(db.prepare('SELECT * FROM purchases WHERE id = ?').get(result));
}));

router.post('/purchases/:id/void', requirePerm('purchases.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const reason = v.str(req.body.reason, 'motivo', { min: 4, max: 300 });
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
  if (!purchase) fail('La compra no existe.', 404);
  if (purchase.status === 'void') fail('Esta compra ya estaba anulada.');

  tx(() => {
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id);
    for (const it of items) {
      inventory.move({
        productId: it.product_id, type: 'return', direction: 'out', quantity: it.quantity,
        reason: 'Anulacion de compra: ' + reason, referenceType: 'purchase', referenceId: id,
        userId: req.user.id, force: true
      });
    }
    db.prepare("UPDATE purchases SET status = 'void', notes = COALESCE(notes,'') || ' | ANULADA: ' || ? WHERE id = ?")
      .run(reason, id);
  });

  audit(req, { action: 'void', entity: 'purchases', entityId: id, description: `Compra anulada: ${reason}` });
  res.json({ ok: true });
}));

// =====================================================================
// Caja
// =====================================================================
router.get('/cash/current', requirePerm('cash.view'), (req, res) => {
  const reg = cash.currentRegister();
  res.json(reg ? cash.summary(reg.id) : null);
});

router.get('/cash/registers', requirePerm('cash.view'), (req, res) => {
  res.json(db.prepare(`SELECT c.*, uo.name AS opened_by_name, uc.name AS closed_by_name
    FROM cash_registers c
    LEFT JOIN users uo ON uo.id = c.opened_by
    LEFT JOIN users uc ON uc.id = c.closed_by
    ORDER BY c.id DESC LIMIT 100`).all());
});

router.get('/cash/registers/:id', requirePerm('cash.view'), asyncH((req, res) => {
  res.json(cash.summary(v.int(req.params.id, 'id')));
}));

router.post('/cash/open', requirePerm('cash.open'), asyncH((req, res) => {
  const amount = v.num(req.body.opening_amount, 'base inicial', { required: false, def: 0, min: 0 });
  const summary = cash.open({ openingAmount: amount, userId: req.user.id, notes: req.body.notes || null });
  audit(req, {
    action: 'cash_open', entity: 'cash_registers', entityId: summary.id,
    description: `${req.user.name} abrio caja con base de $${amount}`
  });
  res.status(201).json(summary);
}));

router.post('/cash/close', requirePerm('cash.close'), asyncH((req, res) => {
  const counted = v.num(req.body.counted_amount, 'efectivo contado', { min: 0 });
  const summary = cash.close({ countedAmount: counted, userId: req.user.id, notes: req.body.notes || null });
  audit(req, {
    action: 'cash_close', entity: 'cash_registers', entityId: summary.id,
    description: `${req.user.name} cerro caja. Esperado $${summary.expected_amount}, contado $${summary.counted_amount}, diferencia $${summary.difference}`
  });
  res.json(summary);
}));

router.post('/cash/movements', requirePerm('cash.movement'), asyncH((req, res) => {
  const type = v.oneOf(req.body.type, 'tipo', ['income', 'withdrawal']);
  const amount = v.num(req.body.amount, 'valor', { min: 0.01 });
  const concept = v.str(req.body.concept, 'concepto', { max: 200 });
  const summary = cash.movement({ type, amount, concept, userId: req.user.id });
  audit(req, {
    action: 'cash_movement', entity: 'cash_registers', entityId: summary.id,
    description: `${type === 'income' ? 'Ingreso' : 'Retiro'} de $${amount}: ${concept}`
  });
  res.json(summary);
}));

// =====================================================================
// Gastos
// =====================================================================
router.get('/expense-categories', requirePerm('expenses.view'), (req, res) => {
  res.json(db.prepare('SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY name').all());
});

router.post('/expense-categories', requirePerm('expenses.manage'), asyncH((req, res) => {
  const name = v.str(req.body.name, 'nombre', { max: 60 });
  if (db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(name)) {
    fail('Ya existe una categoria de gasto con ese nombre.');
  }
  const id = db.prepare('INSERT INTO expense_categories (name) VALUES (?)').run(name).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id));
}));

router.get('/expenses', requirePerm('expenses.view'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.from) { where.push('e.expense_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('e.expense_date <= ?'); params.push(req.query.to); }
  if (req.query.category_id) { where.push('e.expense_category_id = ?'); params.push(Number(req.query.category_id)); }
  res.json(db.prepare(`
    SELECT e.*, ec.name AS category_name, pm.name AS method_name, u.name AS user_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
    LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
    LEFT JOIN users u ON u.id = e.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.expense_date DESC, e.id DESC LIMIT 500`).all(...params));
});

router.post('/expenses', requirePerm('expenses.manage'), asyncH((req, res) => {
  const description = v.str(req.body.description, 'descripcion', { max: 200 });
  const amount = v.num(req.body.amount, 'valor', { min: 0.01 });
  const categoryId = req.body.expense_category_id ? v.int(req.body.expense_category_id, 'categoria') : null;
  const methodId = req.body.payment_method_id ? v.int(req.body.payment_method_id, 'metodo de pago') : null;
  const date = v.dateStr(req.body.expense_date, 'fecha', { def: new Date().toISOString().slice(0, 10) });

  const id = tx(() => {
    const register = cash.currentRegister();

    /**
     * Si no se dijo como se pago, se asume EFECTIVO.
     *
     * En un bar la plata de un gasto sale del cajon: el domicilio del hielo,
     * la propina del que trajo los limones, los oficios varios. Dar por hecho
     * "efectivo" es lo que pasa en la vida real, y ademas es lo unico que hace
     * que el gasto se reste al cerrar caja. Si se dejara sin metodo, el gasto
     * quedaria invisible para el arqueo y las cuentas no cuadrarian.
     */
    let method = methodId ? db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(methodId) : null;

    if (!method) {
      method = db.prepare(`SELECT * FROM payment_methods
        WHERE affects_cash = 1 AND is_active = 1 ORDER BY sort_order LIMIT 1`).get() || null;
    }

    const metodoFinal = method ? method.id : null;

    if (method?.affects_cash && !register) fail('No hay caja abierta para registrar un gasto en efectivo. Abre la caja primero.');

    const expenseId = db.prepare(`INSERT INTO expenses
      (expense_category_id, description, amount, payment_method_id, cash_register_id, receipt_path, user_id, expense_date)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      categoryId, description, rc(amount), metodoFinal,
      method?.affects_cash && register ? register.id : null,
      req.body.receipt_path || null, req.user.id, date).lastInsertRowid;

    if (method?.affects_cash && register) {
      db.prepare(`INSERT INTO cash_movements
        (cash_register_id, user_id, type, amount, concept, reference_type, reference_id, payment_method_id)
        VALUES (?,?,'expense',?,?,'expense',?,?)`).run(
        register.id, req.user.id, -rc(amount), 'Gasto: ' + description, expenseId, metodoFinal);
    }
    return expenseId;
  });

  audit(req, {
    action: 'create', entity: 'expenses', entityId: id,
    description: `${req.user.name} registro un gasto de $${amount}: ${description}`
  });
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
}));

router.delete('/expenses/:id', requirePerm('expenses.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  if (!expense) fail('El gasto no existe.', 404);
  const reg = db.prepare('SELECT status FROM cash_registers WHERE id = ?').get(expense.cash_register_id);
  if (reg && reg.status === 'closed') fail('No puedes eliminar un gasto de una caja ya cerrada.');
  tx(() => {
    db.prepare("DELETE FROM cash_movements WHERE reference_type = 'expense' AND reference_id = ?").run(id);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  });
  audit(req, {
    action: 'delete', entity: 'expenses', entityId: id,
    description: `Gasto eliminado: ${expense.description} ($${expense.amount})`, oldValue: expense
  });
  res.json({ ok: true });
}));

module.exports = router;
