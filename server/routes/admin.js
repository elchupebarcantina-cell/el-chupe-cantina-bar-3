'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { db, tx } = require('../db/connection');
const { asyncH, fail } = require('../utils/http');
const v = require('../utils/validate');
const { requirePerm } = require('../middleware/auth');
const { audit, describeChanges } = require('../middleware/audit');
const reports = require('../services/reports');
const inventory = require('../services/inventory');
const cash = require('../services/cash');
const { resolveRange } = require('../utils/dates');
const env = require('../config/env');

const router = express.Router();

// =====================================================================
// Usuarios, roles y permisos
// =====================================================================
router.get('/users', requirePerm('users.view'), (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, u.email, u.document, u.phone, u.is_active,
    u.last_login_at, u.created_at, r.id AS role_id, r.name AS role_name, r.code AS role_code
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name`).all());
});

router.get('/users/waiters', requirePerm('orders.view', 'pos.use'), (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.is_active = 1 AND r.code IN ('mesero','cajero','admin','super_admin') ORDER BY u.name`).all());
});

router.post('/users', requirePerm('users.manage'), asyncH((req, res) => {
  const name = v.str(req.body.name, 'nombre', { max: 120 });
  const email = v.email(req.body.email, 'correo');
  const password = v.str(req.body.password, 'contrasena', { min: 8, max: 200 });
  const roleId = v.int(req.body.role_id, 'rol');
  const pin = req.body.pin ? v.str(req.body.pin, 'PIN', { min: 4, max: 8 }) : null;

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail('Ya existe un usuario con ese correo.');
  if (pin && db.prepare('SELECT id FROM users WHERE pin = ?').get(pin)) fail('Ese PIN ya esta en uso por otro usuario.');
  if (!db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId)) fail('El rol no existe.', 404);

  const id = db.prepare(`INSERT INTO users (role_id, name, email, document, phone, pin, password_hash)
    VALUES (?,?,?,?,?,?,?)`).run(roleId, name, email,
    req.body.document || null, req.body.phone || null, pin, bcrypt.hashSync(password, 12)).lastInsertRowid;

  audit(req, { action: 'create', entity: 'users', entityId: id, description: `Usuario "${name}" creado` });
  res.status(201).json(db.prepare('SELECT id, name, email, role_id FROM users WHERE id = ?').get(id));
}));

router.put('/users/:id', requirePerm('users.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!before) fail('El usuario no existe.', 404);

  const d = {
    name: v.str(req.body.name ?? before.name, 'nombre', { max: 120 }),
    email: v.email(req.body.email ?? before.email, 'correo'),
    document: req.body.document !== undefined ? (req.body.document || null) : before.document,
    phone: req.body.phone !== undefined ? (req.body.phone || null) : before.phone,
    role_id: v.int(req.body.role_id ?? before.role_id, 'rol'),
    pin: req.body.pin !== undefined ? (req.body.pin || null) : before.pin,
    is_active: req.body.is_active === undefined ? before.is_active : v.bool(req.body.is_active)
  };

  const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(d.email, id);
  if (dup) fail('Ya existe otro usuario con ese correo.');
  if (d.pin) {
    const dupPin = db.prepare('SELECT id FROM users WHERE pin = ? AND id != ?').get(d.pin, id);
    if (dupPin) fail('Ese PIN ya esta en uso por otro usuario.');
  }
  if (id === req.user.id && !d.is_active) fail('No puedes desactivar tu propio usuario.');

  db.prepare(`UPDATE users SET name=@name, email=@email, document=@document, phone=@phone,
    role_id=@role_id, pin=@pin, is_active=@is_active, updated_at=datetime('now','localtime') WHERE id=${id}`).run(d);

  if (req.body.password) {
    const pwd = v.str(req.body.password, 'contrasena', { min: 8, max: 200 });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pwd, 12), id);
  }

  audit(req, {
    action: 'update', entity: 'users', entityId: id,
    description: `${req.user.name} modifico al usuario "${before.name}": ` + describeChanges(before, d)
  });
  res.json(db.prepare('SELECT id, name, email, role_id, is_active FROM users WHERE id = ?').get(id));
}));

router.delete('/users/:id', requirePerm('users.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  if (id === req.user.id) fail('No puedes eliminar tu propio usuario.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) fail('El usuario no existe.', 404);
  const hasOrders = db.prepare('SELECT COUNT(*) c FROM orders WHERE waiter_id = ?').get(id).c;
  if (hasOrders > 0) fail('El usuario tiene ventas registradas. Desactivalo en lugar de eliminarlo.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'users', entityId: id, description: `Usuario "${user.name}" eliminado` });
  res.json({ ok: true });
}));

router.get('/roles', requirePerm('users.view'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all();
  const perms = db.prepare(`SELECT rp.role_id, p.code FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id`).all();
  res.json(roles.map(r => ({
    ...r,
    users: db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ?').get(r.id).c,
    permissions: perms.filter(p => p.role_id === r.id).map(p => p.code)
  })));
});

router.get('/permissions', requirePerm('users.view'), (req, res) => {
  res.json(db.prepare('SELECT * FROM permissions ORDER BY module, name').all());
});

router.post('/roles', requirePerm('users.manage'), asyncH((req, res) => {
  const name = v.str(req.body.name, 'nombre', { max: 60 });
  const code = v.str(req.body.code || name.toLowerCase().replace(/\s+/g, '_'), 'codigo', { max: 40 });
  if (db.prepare('SELECT id FROM roles WHERE code = ?').get(code)) fail('Ya existe un rol con ese codigo.');
  const id = db.prepare('INSERT INTO roles (code, name, description) VALUES (?,?,?)')
    .run(code, name, req.body.description || null).lastInsertRowid;
  audit(req, { action: 'create', entity: 'roles', entityId: id, description: `Rol "${name}" creado` });
  res.status(201).json(db.prepare('SELECT * FROM roles WHERE id = ?').get(id));
}));

router.put('/roles/:id/permissions', requirePerm('users.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!role) fail('El rol no existe.', 404);
  if (role.code === 'super_admin') fail('El rol Super Administrador siempre tiene todos los permisos.');
  const codes = Array.isArray(req.body.permissions) ? req.body.permissions : [];

  tx(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
    const get = db.prepare('SELECT id FROM permissions WHERE code = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?,?)');
    codes.forEach(c => { const p = get.get(c); if (p) ins.run(id, p.id); });
  });

  audit(req, {
    action: 'update', entity: 'roles', entityId: id,
    description: `Permisos del rol "${role.name}" actualizados (${codes.length} permisos)`
  });
  res.json({ ok: true, permissions: codes });
}));

// =====================================================================
// Configuracion del negocio
// =====================================================================
router.get('/settings', requirePerm('settings.view'), (req, res) => {
  res.json(db.prepare('SELECT * FROM business_settings WHERE id = 1').get());
});

router.put('/settings', requirePerm('settings.manage'), asyncH((req, res) => {
  const before = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const d = {
    name: v.str(req.body.name ?? before.name, 'nombre', { max: 80 }),
    legal_name: req.body.legal_name !== undefined ? (req.body.legal_name || null) : before.legal_name,
    nit: req.body.nit !== undefined ? (req.body.nit || null) : before.nit,
    phone: req.body.phone !== undefined ? (req.body.phone || null) : before.phone,
    address: req.body.address !== undefined ? (req.body.address || null) : before.address,
    city: req.body.city ?? before.city,
    email: req.body.email !== undefined ? (req.body.email || null) : before.email,
    logo_path: req.body.logo_path ?? before.logo_path,
    currency: v.str(req.body.currency ?? before.currency, 'moneda', { max: 10 }),
    currency_symbol: v.str(req.body.currency_symbol ?? before.currency_symbol, 'simbolo', { max: 5 }),
    decimals: v.int(req.body.decimals ?? before.decimals, 'decimales', { min: 0, max: 4 }),
    timezone: v.str(req.body.timezone ?? before.timezone, 'zona horaria', { max: 60 }),
    default_tax_id: req.body.default_tax_id ?? before.default_tax_id,
    prices_include_tax: req.body.prices_include_tax === undefined
      ? before.prices_include_tax : v.bool(req.body.prices_include_tax),
    service_charge_pct: v.num(req.body.service_charge_pct ?? before.service_charge_pct,
      'porcentaje de servicio', { min: 0, max: 100 }),
    ticket_width: v.oneOf(req.body.ticket_width ?? before.ticket_width, 'ancho de ticket', ['58mm', '80mm']),
    ticket_footer: req.body.ticket_footer !== undefined ? (req.body.ticket_footer || null) : before.ticket_footer,
    allow_negative_stock: req.body.allow_negative_stock === undefined
      ? before.allow_negative_stock : v.bool(req.body.allow_negative_stock),
    waiter_discount_limit: v.num(req.body.waiter_discount_limit ?? before.waiter_discount_limit,
      'limite de descuento para meseros', { min: 0 })
  };

  db.prepare(`UPDATE business_settings SET name=@name, legal_name=@legal_name, nit=@nit, phone=@phone,
    address=@address, city=@city, email=@email, logo_path=@logo_path, currency=@currency,
    currency_symbol=@currency_symbol, decimals=@decimals, timezone=@timezone, default_tax_id=@default_tax_id,
    prices_include_tax=@prices_include_tax, service_charge_pct=@service_charge_pct, ticket_width=@ticket_width,
    ticket_footer=@ticket_footer, allow_negative_stock=@allow_negative_stock,
    waiter_discount_limit=@waiter_discount_limit, updated_at=datetime('now','localtime') WHERE id=1`).run(d);

  audit(req, {
    action: 'update', entity: 'business_settings', entityId: 1,
    description: 'Configuracion del negocio actualizada: ' + describeChanges(before, d)
  });
  res.json(db.prepare('SELECT * FROM business_settings WHERE id = 1').get());
}));

// =====================================================================
// Auditoria
// =====================================================================
router.get('/audit', requirePerm('audit.view'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.entity) { where.push('entity = ?'); params.push(req.query.entity); }
  if (req.query.action) { where.push('action = ?'); params.push(req.query.action); }
  if (req.query.user_id) { where.push('user_id = ?'); params.push(Number(req.query.user_id)); }
  if (req.query.from) { where.push('date(created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(created_at) <= ?'); params.push(req.query.to); }
  if (req.query.search) { where.push('description LIKE ?'); params.push(`%${req.query.search}%`); }

  res.json(db.prepare(`SELECT * FROM audit_logs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ${Math.min(Number(req.query.limit) || 200, 1000)}`).all(...params));
});

router.get('/login-attempts', requirePerm('audit.view'), (req, res) => {
  res.json(db.prepare('SELECT * FROM login_attempts ORDER BY id DESC LIMIT 200').all());
});

// =====================================================================
// Dashboard
// =====================================================================
router.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
  const range = resolveRange(req.query);
  // La jornada manda sobre la medianoche: arranca al abrir caja y termina al cerrarla.
  const shift = cash.shiftRange();
  const day = resolveRange({ range: 'today' });
  const yesterday = resolveRange({ range: 'yesterday' });
  const week = resolveRange({ range: 'week' });
  const month = resolveRange({ range: 'month' });

  const tables = db.prepare(`SELECT status, COUNT(*) c FROM tables WHERE is_active = 1 GROUP BY status`).all();
  const tableStats = Object.fromEntries(tables.map(t => [t.status, t.c]));

  res.json({
    range,
    shift: reports.kpis(shift),
    shift_info: {
      status: shift.status,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      register_id: shift.register_id
    },
    shift_top_products: reports.topProducts(shift, { limit: 8 }),
    shift_by_payment: reports.byPaymentMethod(shift),
    shift_by_waiter: reports.byWaiter(shift),
    day: reports.kpis(day),
    yesterday: reports.kpis(yesterday),
    week: reports.kpis(week),
    month: reports.kpis(month),
    expenses_recent: reports.expensesReport(month).slice(0, 8),
    // Para saber si el negocio ya esta configurado o si hay que guiar al usuario
    setup: {
      products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
      tables: db.prepare('SELECT COUNT(*) c FROM tables').get().c,
      users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      logo: !!db.prepare('SELECT logo_path FROM business_settings WHERE id = 1').get()?.logo_path,
      named: (db.prepare('SELECT name FROM business_settings WHERE id = 1').get()?.name || '') !== 'EL CHUPE',
      sales: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").get().c
    },
    period: reports.kpis(range),
    top_products: reports.topProducts(range, { limit: 8 }),
    slow_products: reports.topProducts(range, { limit: 8, asc: true }),
    by_category: reports.byCategory(range),
    by_waiter: reports.byWaiter(range),
    by_payment: reports.byPaymentMethod(range),
    sales_by_day: reports.salesByDay(resolveRange({ range: 'last30' })),
    sales_by_hour: reports.salesByHour(range),
    tables: {
      total: Object.values(tableStats).reduce((a, b) => a + b, 0),
      available: tableStats.available || 0,
      occupied: tableStats.occupied || 0,
      bill_requested: tableStats.bill_requested || 0,
      reserved: tableStats.reserved || 0
    },
    alerts: inventory.alerts().slice(0, 20),
    open_orders: db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM orders
      WHERE status IN ('open','bill_requested')`).get(),
    cash: cash.currentRegister() ? cash.summary(cash.currentRegister().id) : null
  });
});

// =====================================================================
// Reportes
// =====================================================================
const REPORTS = {
  sales: r => reports.salesReport(r),
  products: r => reports.topProducts(r, { limit: 500 }),
  slow_products: r => reports.topProducts(r, { limit: 500, asc: true }),
  categories: r => reports.byCategory(r),
  waiters: r => reports.byWaiter(r),
  payments: r => reports.byPaymentMethod(r),
  tables: r => reports.byTable(r),
  by_day: r => reports.salesByDay(r),
  by_hour: r => reports.salesByHour(r),
  by_month: r => reports.salesByMonth(r),
  profitability: r => reports.profitability(r),
  expenses: r => reports.expensesReport(r),
  discounts: r => reports.discountsReport(r),
  voids: r => reports.voidsReport(r),
  purchases: r => reports.purchasesReport(r),
  inventory: () => reports.inventoryReport(),
  movements: r => reports.movementsReport(r),
  cash: r => reports.cashReport(r)
};

router.get('/reports/:type', requirePerm('reports.view'), asyncH((req, res) => {
  const type = req.params.type;
  if (!REPORTS[type]) fail('Ese reporte no existe.', 404);
  if (['profitability'].includes(type) &&
    !(req.user.role_code === 'super_admin' || req.user.permissions.includes('reports.profit'))) {
    fail('No tienes permisos para ver la rentabilidad.', 403);
  }
  const range = resolveRange(req.query);
  const rows = REPORTS[type](range);

  if (req.query.format === 'csv') {
    if (!(req.user.role_code === 'super_admin' || req.user.permissions.includes('reports.export'))) {
      fail('No tienes permisos para exportar reportes.', 403);
    }
    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="elchupe-${type}-${range.from}_${range.to}.csv"`);
    return res.send('\uFEFF' + csv);
  }

  res.json({ range, type, kpis: reports.kpis(range), rows });
}));

function toCsv(rows) {
  if (!rows.length) return 'sin datos';
  const headers = Object.keys(rows[0]);
  const esc = val => {
    if (val === null || val === undefined) return '';
    const s = String(val).replace(/"/g, '""');
    return /[";\n]/.test(s) ? `"${s}"` : s;
  };
  return [headers.join(';'), ...rows.map(r => headers.map(h => esc(r[h])).join(';'))].join('\n');
}

// =====================================================================
// Busqueda global
// =====================================================================
router.get('/search', asyncH((req, res) => {
  const q = v.str(req.query.q, 'busqueda', { min: 2, max: 60 });
  const like = `%${q}%`;
  const can = c => req.user.role_code === 'super_admin' || req.user.permissions.includes(c);

  const result = { products: [], orders: [], tables: [], customers: [], suppliers: [] };

  if (can('products.view') || can('pos.use')) {
    result.products = db.prepare(`SELECT id, code, name, price, stock, unit FROM products
      WHERE is_active = 1 AND (name LIKE ? OR code LIKE ? OR barcode LIKE ?) LIMIT 10`).all(like, like, like);
  }
  if (can('orders.view')) {
    result.orders = db.prepare(`SELECT o.id, o.number, o.status, o.total, o.closed_at, t.name AS table_name
      FROM orders o LEFT JOIN tables t ON t.id = o.table_id
      WHERE CAST(o.number AS TEXT) LIKE ? ORDER BY o.id DESC LIMIT 10`).all(like);
  }
  if (can('tables.view')) {
    result.tables = db.prepare(`SELECT t.id, t.name, t.status, z.name AS zone_name
      FROM tables t JOIN zones z ON z.id = t.zone_id WHERE t.name LIKE ? LIMIT 10`).all(like);
  }
  if (can('customers.view')) {
    result.customers = db.prepare(`SELECT id, name, phone, document FROM customers
      WHERE name LIKE ? OR document LIKE ? OR phone LIKE ? LIMIT 10`).all(like, like, like);
  }
  if (can('suppliers.view')) {
    result.suppliers = db.prepare(`SELECT id, name, company, phone FROM suppliers
      WHERE name LIKE ? OR company LIKE ? LIMIT 10`).all(like, like);
  }
  res.json(result);
}));

// =====================================================================
// Copias de seguridad
// =====================================================================
router.get('/backups', requirePerm('backup.manage'), (req, res) => {
  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });
  const files = fs.readdirSync(env.BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(env.BACKUP_DIR, f));
      return { filename: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(files);
});

router.post('/backups', requirePerm('backup.manage'), asyncH(async (req, res) => {
  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `elchupe-${stamp}.db`;
  await db.backup(path.join(env.BACKUP_DIR, filename));
  audit(req, { action: 'backup', entity: 'system', description: `Copia de seguridad creada: ${filename}` });
  res.status(201).json({ filename });
}));

router.get('/backups/:filename', requirePerm('backup.manage'), asyncH((req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^elchupe-[\w-]+\.db$/.test(filename)) fail('Nombre de archivo no valido.');
  const full = path.join(env.BACKUP_DIR, filename);
  if (!fs.existsSync(full)) fail('La copia no existe.', 404);
  res.download(full);
}));

router.delete('/backups/:filename', requirePerm('backup.manage'), asyncH((req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^elchupe-[\w-]+\.db$/.test(filename)) fail('Nombre de archivo no valido.');
  const full = path.join(env.BACKUP_DIR, filename);
  if (!fs.existsSync(full)) fail('La copia no existe.', 404);
  fs.unlinkSync(full);
  audit(req, { action: 'delete', entity: 'system', description: `Copia de seguridad eliminada: ${filename}` });
  res.json({ ok: true });
}));

module.exports = router;
