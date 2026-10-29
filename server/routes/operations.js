'use strict';
const express = require('express');
const { db } = require('../db/connection');
const { asyncH, fail } = require('../utils/http');
const v = require('../utils/validate');
const { requirePerm, has } = require('../middleware/auth');
const { audit, describeChanges } = require('../middleware/audit');
const orders = require('../services/orders');

const router = express.Router();

// =====================================================================
// Zonas
// =====================================================================
router.get('/zones', requirePerm('tables.view', 'pos.use'), (req, res) => {
  res.json(db.prepare(`SELECT z.*, (SELECT COUNT(*) FROM tables t WHERE t.zone_id = z.id) AS tables
    FROM zones z WHERE z.is_active = 1 ORDER BY z.sort_order, z.name`).all());
});

router.post('/zones', requirePerm('tables.manage'), asyncH((req, res) => {
  const name = v.str(req.body.name, 'nombre', { max: 60 });
  const id = db.prepare('INSERT INTO zones (name, sort_order) VALUES (?,?)')
    .run(name, v.int(req.body.sort_order, 'orden', { required: false, def: 0 })).lastInsertRowid;
  audit(req, { action: 'create', entity: 'zones', entityId: id, description: `Zona "${name}" creada` });
  res.status(201).json(db.prepare('SELECT * FROM zones WHERE id = ?').get(id));
}));

router.put('/zones/:id', requirePerm('tables.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
  if (!before) fail('La zona no existe.', 404);
  const name = v.str(req.body.name ?? before.name, 'nombre', { max: 60 });
  const sort = v.int(req.body.sort_order ?? before.sort_order, 'orden', { required: false });
  db.prepare('UPDATE zones SET name = ?, sort_order = ? WHERE id = ?').run(name, sort, id);
  audit(req, { action: 'update', entity: 'zones', entityId: id, description: describeChanges(before, { name, sort_order: sort }) });
  res.json(db.prepare('SELECT * FROM zones WHERE id = ?').get(id));
}));

router.delete('/zones/:id', requirePerm('tables.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const count = db.prepare('SELECT COUNT(*) c FROM tables WHERE zone_id = ?').get(id).c;
  if (count > 0) fail(`La zona tiene ${count} mesa(s). Eliminalas o muevelas primero.`);
  db.prepare('DELETE FROM zones WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'zones', entityId: id, description: 'Zona eliminada' });
  res.json({ ok: true });
}));

// =====================================================================
// Mesas
// =====================================================================
router.get('/tables', requirePerm('tables.view', 'pos.use'), (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, z.name AS zone_name, z.sort_order AS zone_order,
      o.id AS order_id, o.number AS order_number, o.total AS order_total,
      o.opened_at AS order_opened_at, o.guests,
      u.name AS waiter_name,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
    FROM tables t
    JOIN zones z ON z.id = t.zone_id
    LEFT JOIN orders o ON o.table_id = t.id AND o.status IN ('open','bill_requested')
    LEFT JOIN users u ON u.id = o.waiter_id
    WHERE t.is_active = 1
    ORDER BY z.sort_order, z.name, t.sort_order, t.name`).all();
  res.json(rows);
});

router.post('/tables', requirePerm('tables.manage'), asyncH((req, res) => {
  const zoneId = v.int(req.body.zone_id, 'zona');
  if (!db.prepare('SELECT id FROM zones WHERE id = ?').get(zoneId)) fail('La zona no existe.', 404);
  const name = v.str(req.body.name, 'nombre', { max: 40 });
  const seats = v.int(req.body.seats, 'puestos', { required: false, def: 4, min: 1, max: 50 });
  const id = db.prepare('INSERT INTO tables (zone_id, name, seats, sort_order) VALUES (?,?,?,?)')
    .run(zoneId, name, seats, v.int(req.body.sort_order, 'orden', { required: false, def: 0 })).lastInsertRowid;
  audit(req, { action: 'create', entity: 'tables', entityId: id, description: `Mesa "${name}" creada` });
  res.status(201).json(db.prepare('SELECT * FROM tables WHERE id = ?').get(id));
}));

router.put('/tables/:id', requirePerm('tables.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  if (!before) fail('La mesa no existe.', 404);
  const d = {
    zone_id: v.int(req.body.zone_id ?? before.zone_id, 'zona'),
    name: v.str(req.body.name ?? before.name, 'nombre', { max: 40 }),
    seats: v.int(req.body.seats ?? before.seats, 'puestos', { min: 1, max: 50 }),
    sort_order: v.int(req.body.sort_order ?? before.sort_order, 'orden', { required: false }),
    is_active: req.body.is_active === undefined ? before.is_active : v.bool(req.body.is_active)
  };
  db.prepare(`UPDATE tables SET zone_id=@zone_id, name=@name, seats=@seats,
    sort_order=@sort_order, is_active=@is_active WHERE id=${id}`).run(d);
  audit(req, { action: 'update', entity: 'tables', entityId: id, description: describeChanges(before, d) });
  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(id));
}));

router.put('/tables/:id/status', requirePerm('tables.view'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const status = v.oneOf(req.body.status, 'estado', ['available', 'occupied', 'bill_requested', 'reserved']);
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  if (!table) fail('La mesa no existe.', 404);
  const active = db.prepare("SELECT id FROM orders WHERE table_id = ? AND status IN ('open','bill_requested')").get(id);
  if (active && status === 'available') fail('La mesa tiene una cuenta abierta. Cobra o anula la cuenta primero.');
  db.prepare('UPDATE tables SET status = ? WHERE id = ?').run(status, id);
  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(id));
}));

router.delete('/tables/:id', requirePerm('tables.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const active = db.prepare("SELECT id FROM orders WHERE table_id = ? AND status IN ('open','bill_requested')").get(id);
  if (active) fail('La mesa tiene una cuenta abierta.');
  db.prepare('DELETE FROM tables WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'tables', entityId: id, description: 'Mesa eliminada' });
  res.json({ ok: true });
}));

// =====================================================================
// Ordenes
// =====================================================================
router.get('/orders', requirePerm('orders.view'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('o.status = ?'); params.push(req.query.status); }
  else where.push("o.status IN ('open','bill_requested')");
  if (req.query.waiter_id) { where.push('o.waiter_id = ?'); params.push(Number(req.query.waiter_id)); }
  if (req.query.from) { where.push('date(o.created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(o.created_at) <= ?'); params.push(req.query.to); }

  res.json(db.prepare(`
    SELECT o.*, t.name AS table_name, u.name AS waiter_name, c.name AS customer_name,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = o.waiter_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.id DESC LIMIT ${Math.min(Number(req.query.limit) || 200, 1000)}`).all(...params));
});

router.get('/orders/:id', requirePerm('orders.view'), asyncH((req, res) => {
  res.json(orders.full(v.int(req.params.id, 'id')));
}));

router.post('/orders', requirePerm('orders.create'), asyncH((req, res) => {
  const order = orders.open({
    tableId: req.body.table_id ? v.int(req.body.table_id, 'mesa') : null,
    waiterId: req.body.waiter_id ? v.int(req.body.waiter_id, 'mesero') : req.user.id,
    customerId: req.body.customer_id ? v.int(req.body.customer_id, 'cliente') : null,
    guests: v.int(req.body.guests, 'personas', { required: false, def: 1, min: 1, max: 100 }),
    type: v.oneOf(req.body.type || 'table', 'tipo', ['table', 'counter', 'takeaway']),
    notes: req.body.notes || null
  });
  audit(req, {
    action: 'create', entity: 'orders', entityId: order.id,
    description: `Orden #${order.number} abierta${order.table_name ? ' en ' + order.table_name : ''}`
  });
  res.status(201).json(order);
}));

router.post('/orders/:id/items', requirePerm('orders.create', 'orders.edit'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const order = orders.addItem(id, {
    productId: v.int(req.body.product_id, 'producto'),
    quantity: v.num(req.body.quantity, 'cantidad', { required: false, def: 1, min: 0.001 }),
    notes: req.body.notes ? v.str(req.body.notes, 'observacion', { max: 200 }) : null,
    userId: req.user.id
  });
  res.json(order);
}));

router.put('/orders/:id/items/:itemId', requirePerm('orders.edit'), asyncH((req, res) => {
  const order = orders.updateItem(v.int(req.params.id, 'id'), v.int(req.params.itemId, 'item'), {
    quantity: req.body.quantity !== undefined ? v.num(req.body.quantity, 'cantidad', { min: 0.001 }) : undefined,
    notes: req.body.notes !== undefined ? (req.body.notes || null) : undefined,
    userId: req.user.id
  });
  res.json(order);
}));

router.delete('/orders/:id/items/:itemId', requirePerm('orders.edit'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const itemId = v.int(req.params.itemId, 'item');
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(itemId);
  // Si ya fue enviado a cocina/bar, requiere permiso explicito
  if (item?.sent_at && !has(req.user, 'orders.remove_item')) {
    fail('Ese producto ya fue enviado a produccion. Pide autorizacion para retirarlo.', 403);
  }
  const order = orders.removeItem(id, itemId, {
    userId: req.user.id,
    reason: req.body.reason || 'Producto retirado de la orden'
  });
  audit(req, {
    action: 'delete', entity: 'order_items', entityId: itemId,
    description: `${req.user.name} retiro "${item?.product_name}" (x${item?.quantity}) de la orden #${order.number}`
  });
  res.json(order);
}));

router.put('/orders/:id', requirePerm('orders.edit'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const fields = [];
  const params = [];
  if (req.body.customer_id !== undefined) { fields.push('customer_id = ?'); params.push(req.body.customer_id || null); }
  if (req.body.guests !== undefined) { fields.push('guests = ?'); params.push(v.int(req.body.guests, 'personas', { min: 1 })); }
  if (req.body.notes !== undefined) { fields.push('notes = ?'); params.push(req.body.notes || null); }
  if (fields.length === 0) fail('No enviaste ningun cambio.');
  params.push(id);
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(orders.full(id));
}));

router.post('/orders/:id/discount', requirePerm('orders.discount'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const type = req.body.type ? v.oneOf(req.body.type, 'tipo', ['percent', 'amount', 'courtesy']) : null;
  const value = type === 'courtesy' ? 0 : v.num(req.body.value, 'valor', { required: false, def: 0, min: 0 });

  // Limite configurable para meseros
  const cfg = db.prepare('SELECT waiter_discount_limit FROM business_settings WHERE id = 1').get();
  if (req.user.role_code === 'mesero' && cfg.waiter_discount_limit >= 0) {
    const current = orders.full(id);
    const amount = type === 'percent' ? current.subtotal * (value / 100)
      : type === 'courtesy' ? current.subtotal : value;
    if (amount > cfg.waiter_discount_limit) {
      fail(`Como mesero solo puedes aplicar descuentos hasta $${cfg.waiter_discount_limit.toLocaleString('es-CO')}. Pide autorizacion.`, 403);
    }
  }

  const order = orders.applyDiscount(id, {
    type, value,
    reason: req.body.reason ? v.str(req.body.reason, 'motivo', { max: 200 }) : null,
    userId: req.user.id
  });
  audit(req, {
    action: 'discount', entity: 'orders', entityId: id,
    description: `${req.user.name} aplico descuento de $${order.discount_amount} en la orden #${order.number}. Motivo: ${req.body.reason || 'no indicado'}`
  });
  res.json(order);
}));

router.post('/orders/:id/request-bill', requirePerm('orders.edit', 'orders.create'), asyncH((req, res) => {
  res.json(orders.requestBill(v.int(req.params.id, 'id')));
}));

router.post('/orders/:id/send', requirePerm('orders.create', 'orders.edit'), asyncH((req, res) => {
  res.json(orders.sendToStations(v.int(req.params.id, 'id')));
}));

router.post('/orders/:id/transfer-table', requirePerm('orders.transfer'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const target = v.int(req.body.table_id, 'mesa destino');
  const order = orders.transferTable(id, target);
  audit(req, {
    action: 'transfer', entity: 'orders', entityId: id,
    description: `Orden #${order.number} trasladada a ${order.table_name}`
  });
  res.json(order);
}));

router.post('/orders/:id/transfer-waiter', requirePerm('orders.transfer'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const order = orders.transferWaiter(id, v.int(req.body.waiter_id, 'mesero'));
  audit(req, {
    action: 'transfer', entity: 'orders', entityId: id,
    description: `Orden #${order.number} asignada a ${order.waiter_name}`
  });
  res.json(order);
}));

router.post('/orders/:id/merge', requirePerm('orders.transfer'), asyncH((req, res) => {
  const target = v.int(req.params.id, 'id');
  const source = v.int(req.body.source_order_id, 'cuenta origen');
  const order = orders.mergeOrders(source, target);
  audit(req, {
    action: 'merge', entity: 'orders', entityId: target,
    description: `Cuenta ${source} unida a la orden #${order.number}`
  });
  res.json(order);
}));

router.post('/orders/:id/split', requirePerm('orders.transfer'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const result = orders.splitOrder(id, {
    itemIds: (req.body.item_ids || []).map(x => v.int(x, 'item')),
    targetTableId: req.body.table_id ? v.int(req.body.table_id, 'mesa destino') : null,
    waiterId: req.user.id
  });
  audit(req, {
    action: 'split', entity: 'orders', entityId: id,
    description: `Cuenta #${result.original.number} dividida: se creo la #${result.created.number}`
  });
  res.json(result);
}));

router.post('/orders/:id/payments', requirePerm('orders.pay'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const result = orders.addPayment(id, {
    paymentMethodId: v.int(req.body.payment_method_id, 'metodo de pago'),
    amount: v.num(req.body.amount, 'valor', { min: 0.01 }),
    received: req.body.received !== undefined && req.body.received !== null
      ? v.num(req.body.received, 'recibido', { min: 0 }) : null,
    reference: req.body.reference ? v.str(req.body.reference, 'referencia', { max: 100 }) : null,
    userId: req.user.id
  });
  audit(req, {
    action: 'payment', entity: 'orders', entityId: id,
    description: `Pago de $${req.body.amount} en la orden #${result.order.number}` +
      (result.order.status === 'paid' ? ' (cuenta cerrada)' : ' (pago parcial)')
  });
  res.json(result);
}));

router.post('/orders/:id/void', requirePerm('orders.void'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const reason = v.str(req.body.reason, 'motivo', { min: 4, max: 300 });
  const order = orders.voidOrder(id, { reason, userId: req.user.id });
  audit(req, {
    action: 'void', entity: 'orders', entityId: id,
    description: `${req.user.name} anulo la venta #${order.number} por $${order.total}. Motivo: ${reason}`
  });
  res.json(order);
}));

// =====================================================================
// KDS: pantalla de cocina y bar
// =====================================================================
router.get('/kds', requirePerm('kds.view'), (req, res) => {
  const station = req.query.station;
  const params = [];
  let filter = '';
  if (station && station !== 'all') { filter = 'AND oi.station = ?'; params.push(station); }
  const rows = db.prepare(`
    SELECT oi.id, oi.order_id, oi.product_name, oi.quantity, oi.notes, oi.station,
           oi.kds_status, oi.sent_at, o.number AS order_number,
           t.name AS table_name, u.name AS waiter_name
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = o.waiter_id
    WHERE o.status IN ('open','bill_requested')
      AND oi.sent_at IS NOT NULL
      AND oi.kds_status != 'delivered'
      AND oi.station != 'none' ${filter}
    ORDER BY oi.sent_at ASC`).all(...params);
  res.json(rows);
});

router.put('/kds/:itemId', requirePerm('kds.view'), asyncH((req, res) => {
  const itemId = v.int(req.params.itemId, 'item');
  const status = v.oneOf(req.body.status, 'estado', ['pending', 'preparing', 'ready', 'delivered']);
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(itemId);
  if (!item) fail('El producto no existe.', 404);
  db.prepare('UPDATE order_items SET kds_status = ? WHERE id = ?').run(status, itemId);
  res.json({ ok: true, id: itemId, status });
}));

// =====================================================================
// Comandas por estacion
// =====================================================================
router.get('/orders/:id/tickets/:station', requirePerm('orders.view'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const station = v.oneOf(req.params.station, 'estacion', ['bar', 'kitchen']);
  const order = orders.full(id);
  res.json({
    order: { number: order.number, table_name: order.table_name, waiter_name: order.waiter_name, opened_at: order.opened_at },
    station,
    items: order.items.filter(i => i.station === station)
  });
}));

module.exports = router;
