'use strict';
const express = require('express');
const { db, tx } = require('../db/connection');
const { asyncH, fail } = require('../utils/http');
const v = require('../utils/validate');
const { requirePerm } = require('../middleware/auth');
const { audit, describeChanges } = require('../middleware/audit');
const inventory = require('../services/inventory');

const router = express.Router();

// =====================================================================
// Categorias
// =====================================================================
router.get('/categories', requirePerm('products.view', 'pos.use'), (req, res) => {
  res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products
    FROM categories c ORDER BY c.sort_order, c.name`).all());
});

router.post('/categories', requirePerm('products.manage'), asyncH((req, res) => {
  const name = v.str(req.body.name, 'nombre', { max: 60 });
  const station = v.oneOf(req.body.station || 'bar', 'estacion', ['bar', 'kitchen', 'none']);
  const color = v.str(req.body.color || '#B8873D', 'color', { max: 20 });
  const sort = v.int(req.body.sort_order, 'orden', { required: false, def: 0 });
  const exists = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (exists) fail('Ya existe una categoria con ese nombre.');
  const id = db.prepare('INSERT INTO categories (name, color, station, sort_order) VALUES (?,?,?,?)')
    .run(name, color, station, sort).lastInsertRowid;
  audit(req, { action: 'create', entity: 'categories', entityId: id, description: `Categoria "${name}" creada` });
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
}));

router.put('/categories/:id', requirePerm('products.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!before) fail('La categoria no existe.', 404);
  const data = {
    name: v.str(req.body.name ?? before.name, 'nombre', { max: 60 }),
    color: v.str(req.body.color ?? before.color, 'color', { max: 20 }),
    station: v.oneOf(req.body.station ?? before.station, 'estacion', ['bar', 'kitchen', 'none']),
    sort_order: v.int(req.body.sort_order ?? before.sort_order, 'orden', { required: false }),
    is_active: req.body.is_active === undefined ? before.is_active : v.bool(req.body.is_active)
  };
  db.prepare(`UPDATE categories SET name=@name, color=@color, station=@station,
    sort_order=@sort_order, is_active=@is_active WHERE id=${id}`).run(data);
  audit(req, {
    action: 'update', entity: 'categories', entityId: id,
    description: describeChanges(before, data), oldValue: before, newValue: data
  });
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
}));

router.delete('/categories/:id', requirePerm('products.delete'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const used = db.prepare('SELECT COUNT(*) c FROM products WHERE category_id = ?').get(id).c;
  if (used > 0) fail(`No puedes eliminar la categoria: tiene ${used} producto(s). Desactivala en su lugar.`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'categories', entityId: id, description: 'Categoria eliminada' });
  res.json({ ok: true });
}));

// =====================================================================
// Productos
// =====================================================================
const productSelect = `
  SELECT p.*, c.name AS category_name, c.color AS category_color,
         c.station AS category_station, t.rate AS tax_rate, t.name AS tax_name,
         s.name AS supplier_name,
         (SELECT COUNT(*) FROM recipe_items ri WHERE ri.product_id = p.id) AS recipe_count
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN taxes t ON t.id = p.tax_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id`;

router.get('/products', requirePerm('products.view', 'pos.use'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.search) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)');
    const q = `%${req.query.search}%`;
    params.push(q, q, q);
  }
  if (req.query.category_id) { where.push('p.category_id = ?'); params.push(Number(req.query.category_id)); }
  if (req.query.type) { where.push('p.type = ?'); params.push(req.query.type); }
  if (req.query.sellable === '1') where.push("p.type != 'supply'");
  if (req.query.active !== '0') where.push('p.is_active = 1');
  if (req.query.favorites === '1') where.push('p.is_favorite = 1');

  const sql = `${productSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.sort_order, p.name LIMIT ${Math.min(Number(req.query.limit) || 500, 2000)}`;
  const rows = db.prepare(sql).all(...params);

  const canSeeCost = req.user.role_code === 'super_admin' || req.user.permissions.includes('products.cost');
  res.json(rows.map(r => {
    r.station = r.station || r.category_station || 'bar';
    if (!canSeeCost) delete r.cost;
    return r;
  }));
});

router.get('/products/:id', requirePerm('products.view'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const product = db.prepare(`${productSelect} WHERE p.id = ?`).get(id);
  if (!product) fail('El producto no existe.', 404);
  product.recipe = db.prepare(`SELECT ri.id, ri.ingredient_id, ri.quantity,
      p.name, p.unit, p.cost, p.stock
    FROM recipe_items ri JOIN products p ON p.id = ri.ingredient_id
    WHERE ri.product_id = ? ORDER BY p.name`).all(id);
  product.computed_cost = inventory.unitCost(id);
  res.json(product);
}));

function readProduct(body, current = {}) {
  const type = v.oneOf(body.type ?? current.type ?? 'simple', 'tipo', ['simple', 'recipe', 'supply']);
  return {
    code: v.str(body.code ?? current.code, 'codigo', { max: 40 }),
    barcode: body.barcode ? v.str(body.barcode, 'codigo de barras', { max: 60 }) : (current.barcode ?? null),
    name: v.str(body.name ?? current.name, 'nombre', { max: 120 }),
    description: body.description !== undefined
      ? v.str(body.description, 'descripcion', { required: false, max: 500 }) : (current.description ?? null),
    category_id: body.category_id ? v.int(body.category_id, 'categoria') : (current.category_id ?? null),
    supplier_id: body.supplier_id ? v.int(body.supplier_id, 'proveedor') : (current.supplier_id ?? null),
    type,
    cost: v.num(body.cost ?? current.cost ?? 0, 'costo', { required: false, min: 0 }),
    price: v.num(body.price ?? current.price ?? 0, 'precio de venta', { required: false, min: 0 }),
    tax_id: body.tax_id ? v.int(body.tax_id, 'impuesto') : (current.tax_id ?? 1),
    unit: v.str(body.unit ?? current.unit ?? 'und', 'unidad', { max: 12 }),
    min_stock: v.num(body.min_stock ?? current.min_stock ?? 0, 'stock minimo', { required: false, min: 0 }),
    track_stock: body.track_stock === undefined
      ? (current.track_stock ?? (type === 'recipe' ? 0 : 1)) : v.bool(body.track_stock),
    station: body.station ? v.oneOf(body.station, 'estacion', ['bar', 'kitchen', 'none']) : (current.station ?? null),
    image_path: body.image_path !== undefined ? body.image_path : (current.image_path ?? null),
    is_favorite: body.is_favorite === undefined ? (current.is_favorite ?? 0) : v.bool(body.is_favorite),
    is_active: body.is_active === undefined ? (current.is_active ?? 1) : v.bool(body.is_active)
  };
}

router.post('/products', requirePerm('products.manage'), asyncH((req, res) => {
  const data = readProduct(req.body);
  if (db.prepare('SELECT id FROM products WHERE code = ?').get(data.code)) {
    fail(`Ya existe un producto con el codigo "${data.code}".`);
  }
  const initialStock = v.num(req.body.stock, 'stock inicial', { required: false, min: 0, def: 0 });

  const id = tx(() => {
    const newId = db.prepare(`INSERT INTO products
      (code, barcode, name, description, category_id, supplier_id, type, cost, price, tax_id,
       unit, stock, min_stock, track_stock, station, image_path, is_favorite, is_active)
      VALUES (@code,@barcode,@name,@description,@category_id,@supplier_id,@type,@cost,@price,@tax_id,
       @unit,0,@min_stock,@track_stock,@station,@image_path,@is_favorite,@is_active)`)
      .run(data).lastInsertRowid;
    if (initialStock > 0 && data.track_stock) {
      inventory.move({
        productId: newId, type: 'initial', direction: 'in', quantity: initialStock,
        unitCost: data.cost, reason: 'Stock inicial', userId: req.user.id
      });
    }
    return newId;
  });

  audit(req, { action: 'create', entity: 'products', entityId: id, description: `Producto "${data.name}" creado`, newValue: data });
  res.status(201).json(db.prepare(`${productSelect} WHERE p.id = ?`).get(id));
}));

router.put('/products/:id', requirePerm('products.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!before) fail('El producto no existe.', 404);
  const data = readProduct(req.body, before);
  const dup = db.prepare('SELECT id FROM products WHERE code = ? AND id != ?').get(data.code, id);
  if (dup) fail(`Ya existe otro producto con el codigo "${data.code}".`);

  db.prepare(`UPDATE products SET code=@code, barcode=@barcode, name=@name, description=@description,
    category_id=@category_id, supplier_id=@supplier_id, type=@type, cost=@cost, price=@price,
    tax_id=@tax_id, unit=@unit, min_stock=@min_stock, track_stock=@track_stock, station=@station,
    image_path=@image_path, is_favorite=@is_favorite, is_active=@is_active,
    updated_at=datetime('now','localtime') WHERE id=${id}`).run(data);

  audit(req, {
    action: 'update', entity: 'products', entityId: id,
    description: `${req.user.name} modifico "${before.name}": ` + describeChanges(before, data,
      { price: 'precio', cost: 'costo', name: 'nombre', min_stock: 'stock minimo' }),
    oldValue: before, newValue: data
  });
  res.json(db.prepare(`${productSelect} WHERE p.id = ?`).get(id));
}));

router.delete('/products/:id', requirePerm('products.delete'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) fail('El producto no existe.', 404);
  const sold = db.prepare('SELECT COUNT(*) c FROM order_items WHERE product_id = ?').get(id).c;
  if (sold > 0) fail('Este producto tiene ventas registradas. Desactivalo en lugar de eliminarlo.');
  const inRecipe = db.prepare('SELECT COUNT(*) c FROM recipe_items WHERE ingredient_id = ?').get(id).c;
  if (inRecipe > 0) fail('Este producto es ingrediente de una receta. Quitalo de las recetas primero.');
  tx(() => {
    db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM inventory_movements WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  });
  audit(req, { action: 'delete', entity: 'products', entityId: id, description: `Producto "${product.name}" eliminado`, oldValue: product });
  res.json({ ok: true });
}));

// =====================================================================
// Recetas
// =====================================================================
router.put('/products/:id/recipe', requirePerm('recipes.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) fail('El producto no existe.', 404);
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  tx(() => {
    db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(id);
    const ins = db.prepare('INSERT INTO recipe_items (product_id, ingredient_id, quantity) VALUES (?,?,?)');
    for (const it of items) {
      const ingId = v.int(it.ingredient_id, 'ingrediente');
      const qty = v.num(it.quantity, 'cantidad', { min: 0.0001 });
      if (ingId === id) fail('Un producto no puede ser ingrediente de si mismo.');
      const ing = db.prepare('SELECT id FROM products WHERE id = ?').get(ingId);
      if (!ing) fail('Uno de los ingredientes no existe.');
      ins.run(id, ingId, qty);
    }
    const type = items.length > 0 ? 'recipe' : (product.type === 'recipe' ? 'simple' : product.type);
    db.prepare('UPDATE products SET type = ?, track_stock = ? WHERE id = ?')
      .run(type, type === 'recipe' ? 0 : product.track_stock, id);
    db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(inventory.unitCost(id), id);
  });

  audit(req, {
    action: 'update', entity: 'recipes', entityId: id,
    description: `Receta de "${product.name}" actualizada (${items.length} ingredientes)`
  });
  res.json(db.prepare(`${productSelect} WHERE p.id = ?`).get(id));
}));

router.post('/recipes/refresh-costs', requirePerm('recipes.manage'), asyncH((req, res) => {
  const count = inventory.refreshRecipeCosts();
  audit(req, { action: 'update', entity: 'recipes', description: `Costos recalculados en ${count} recetas` });
  res.json({ updated: count });
}));

// =====================================================================
// Proveedores
// =====================================================================
router.get('/suppliers', requirePerm('suppliers.view', 'products.view'), (req, res) => {
  res.json(db.prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM purchases pu WHERE pu.supplier_id = s.id) AS purchases,
    (SELECT COALESCE(SUM(pu.total),0) FROM purchases pu WHERE pu.supplier_id = s.id AND pu.status='received') AS purchased_total
    FROM suppliers s ORDER BY s.name`).all());
});

router.post('/suppliers', requirePerm('suppliers.manage'), asyncH((req, res) => {
  const d = supplierData(req.body);
  const id = db.prepare(`INSERT INTO suppliers (name, company, document, phone, whatsapp, email, address, notes)
    VALUES (@name,@company,@document,@phone,@whatsapp,@email,@address,@notes)`).run(d).lastInsertRowid;
  audit(req, { action: 'create', entity: 'suppliers', entityId: id, description: `Proveedor "${d.name}" creado` });
  res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
}));

router.put('/suppliers/:id', requirePerm('suppliers.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!before) fail('El proveedor no existe.', 404);
  const d = supplierData(req.body, before);
  d.is_active = req.body.is_active === undefined ? before.is_active : v.bool(req.body.is_active);
  db.prepare(`UPDATE suppliers SET name=@name, company=@company, document=@document, phone=@phone,
    whatsapp=@whatsapp, email=@email, address=@address, notes=@notes, is_active=@is_active
    WHERE id=${id}`).run(d);
  audit(req, { action: 'update', entity: 'suppliers', entityId: id, description: describeChanges(before, d) });
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
}));

router.delete('/suppliers/:id', requirePerm('suppliers.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const used = db.prepare('SELECT COUNT(*) c FROM purchases WHERE supplier_id = ?').get(id).c;
  if (used > 0) fail('El proveedor tiene compras registradas. Desactivalo en lugar de eliminarlo.');
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'suppliers', entityId: id, description: 'Proveedor eliminado' });
  res.json({ ok: true });
}));

function supplierData(body, current = {}) {
  return {
    name: v.str(body.name ?? current.name, 'nombre', { max: 120 }),
    company: body.company !== undefined ? v.str(body.company, 'empresa', { required: false, max: 120 }) : (current.company ?? null),
    document: body.document !== undefined ? v.str(body.document, 'identificacion', { required: false, max: 40 }) : (current.document ?? null),
    phone: body.phone !== undefined ? v.str(body.phone, 'telefono', { required: false, max: 40 }) : (current.phone ?? null),
    whatsapp: body.whatsapp !== undefined ? v.str(body.whatsapp, 'whatsapp', { required: false, max: 40 }) : (current.whatsapp ?? null),
    email: body.email ? v.email(body.email, 'correo', { required: false }) : (current.email ?? null),
    address: body.address !== undefined ? v.str(body.address, 'direccion', { required: false, max: 200 }) : (current.address ?? null),
    notes: body.notes !== undefined ? v.str(body.notes, 'observaciones', { required: false, max: 500 }) : (current.notes ?? null)
  };
}

// =====================================================================
// Clientes
// =====================================================================
router.get('/customers', requirePerm('customers.view'), (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS visits,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS spent,
      (SELECT MAX(o.closed_at) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS last_visit
    FROM customers c
    ${search ? 'WHERE c.name LIKE ? OR c.document LIKE ? OR c.phone LIKE ?' : ''}
    ORDER BY c.name LIMIT 500`);
  res.json(search ? rows.all(search, search, search) : rows.all());
});

router.get('/customers/:id', requirePerm('customers.view'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) fail('El cliente no existe.', 404);
  customer.orders = db.prepare(`SELECT id, number, closed_at, total FROM orders
    WHERE customer_id = ? AND status = 'paid' ORDER BY closed_at DESC LIMIT 50`).all(id);
  res.json(customer);
}));

router.post('/customers', requirePerm('customers.manage'), asyncH((req, res) => {
  const d = customerData(req.body);
  const id = db.prepare(`INSERT INTO customers (name, document, phone, email, birthdate, notes)
    VALUES (@name,@document,@phone,@email,@birthdate,@notes)`).run(d).lastInsertRowid;
  audit(req, { action: 'create', entity: 'customers', entityId: id, description: `Cliente "${d.name}" creado` });
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
}));

router.put('/customers/:id', requirePerm('customers.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!before) fail('El cliente no existe.', 404);
  const d = customerData(req.body, before);
  db.prepare(`UPDATE customers SET name=@name, document=@document, phone=@phone, email=@email,
    birthdate=@birthdate, notes=@notes WHERE id=${id}`).run(d);
  audit(req, { action: 'update', entity: 'customers', entityId: id, description: describeChanges(before, d) });
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
}));

router.delete('/customers/:id', requirePerm('customers.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const used = db.prepare('SELECT COUNT(*) c FROM orders WHERE customer_id = ?').get(id).c;
  if (used > 0) fail('El cliente tiene ventas asociadas y no puede eliminarse.');
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'customers', entityId: id, description: 'Cliente eliminado' });
  res.json({ ok: true });
}));

function customerData(body, current = {}) {
  return {
    name: v.str(body.name ?? current.name, 'nombre', { max: 120 }),
    document: body.document !== undefined ? v.str(body.document, 'documento', { required: false, max: 40 }) : (current.document ?? null),
    phone: body.phone !== undefined ? v.str(body.phone, 'telefono', { required: false, max: 40 }) : (current.phone ?? null),
    email: body.email ? v.email(body.email, 'correo', { required: false }) : (current.email ?? null),
    birthdate: body.birthdate !== undefined ? v.dateStr(body.birthdate, 'fecha de nacimiento') : (current.birthdate ?? null),
    notes: body.notes !== undefined ? v.str(body.notes, 'observaciones', { required: false, max: 500 }) : (current.notes ?? null)
  };
}

// =====================================================================
// Impuestos y metodos de pago
// =====================================================================
router.get('/taxes', (req, res) => res.json(db.prepare('SELECT * FROM taxes ORDER BY rate').all()));

router.get('/payment-methods', (req, res) => {
  res.json(db.prepare('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort_order, name').all());
});

router.post('/payment-methods', requirePerm('settings.manage'), asyncH((req, res) => {
  const name = v.str(req.body.name, 'nombre', { max: 60 });
  const code = v.str(req.body.code || name.toLowerCase().replace(/\s+/g, '_'), 'codigo', { max: 30 });
  const type = v.oneOf(req.body.type || 'other', 'tipo', ['cash', 'card', 'transfer', 'other']);
  if (db.prepare('SELECT id FROM payment_methods WHERE code = ? OR name = ?').get(code, name)) {
    fail('Ya existe un metodo de pago con ese nombre o codigo.');
  }
  const id = db.prepare(`INSERT INTO payment_methods (name, code, type, affects_cash, sort_order)
    VALUES (?,?,?,?,?)`).run(name, code, type, v.bool(req.body.affects_cash),
    v.int(req.body.sort_order, 'orden', { required: false, def: 50 })).lastInsertRowid;
  audit(req, { action: 'create', entity: 'payment_methods', entityId: id, description: `Metodo de pago "${name}" creado` });
  res.status(201).json(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id));
}));

router.put('/payment-methods/:id', requirePerm('settings.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  if (!before) fail('El metodo de pago no existe.', 404);
  const d = {
    name: v.str(req.body.name ?? before.name, 'nombre', { max: 60 }),
    type: v.oneOf(req.body.type ?? before.type, 'tipo', ['cash', 'card', 'transfer', 'other']),
    affects_cash: req.body.affects_cash === undefined ? before.affects_cash : v.bool(req.body.affects_cash),
    is_active: req.body.is_active === undefined ? before.is_active : v.bool(req.body.is_active),
    sort_order: v.int(req.body.sort_order ?? before.sort_order, 'orden', { required: false })
  };
  db.prepare(`UPDATE payment_methods SET name=@name, type=@type, affects_cash=@affects_cash,
    is_active=@is_active, sort_order=@sort_order WHERE id=${id}`).run(d);
  audit(req, { action: 'update', entity: 'payment_methods', entityId: id, description: describeChanges(before, d) });
  res.json(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id));
}));

module.exports = router;
