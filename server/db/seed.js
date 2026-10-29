'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, tx } = require('./connection');
const env = require('../config/env');

// ---------------------------------------------------------------------
// Catalogo de permisos
// ---------------------------------------------------------------------
const PERMISSIONS = [
  ['dashboard.view', 'Ver dashboard', 'Dashboard'],

  ['pos.use', 'Usar POS', 'POS'],
  ['orders.view', 'Ver ordenes', 'Ordenes'],
  ['orders.create', 'Crear ordenes', 'Ordenes'],
  ['orders.edit', 'Modificar ordenes', 'Ordenes'],
  ['orders.remove_item', 'Eliminar productos de una orden', 'Ordenes'],
  ['orders.transfer', 'Cambiar, unir y transferir mesas', 'Ordenes'],
  ['orders.void', 'Anular ventas', 'Ordenes'],
  ['orders.discount', 'Aplicar descuentos', 'Ordenes'],
  ['orders.pay', 'Registrar pagos', 'Ordenes'],

  ['tables.view', 'Ver mesas', 'Mesas'],
  ['tables.manage', 'Administrar mesas y zonas', 'Mesas'],

  ['products.view', 'Ver productos', 'Productos'],
  ['products.manage', 'Crear y editar productos', 'Productos'],
  ['products.delete', 'Eliminar productos', 'Productos'],
  ['products.cost', 'Ver costos y margenes', 'Productos'],
  ['recipes.manage', 'Administrar recetas', 'Productos'],

  ['inventory.view', 'Ver inventario y kardex', 'Inventario'],
  ['inventory.manage', 'Registrar movimientos de inventario', 'Inventario'],

  ['purchases.view', 'Ver compras', 'Compras'],
  ['purchases.manage', 'Registrar compras', 'Compras'],
  ['suppliers.view', 'Ver proveedores', 'Compras'],
  ['suppliers.manage', 'Administrar proveedores', 'Compras'],

  ['cash.view', 'Ver caja', 'Caja'],
  ['cash.open', 'Abrir caja', 'Caja'],
  ['cash.close', 'Cerrar caja', 'Caja'],
  ['cash.movement', 'Registrar ingresos y retiros', 'Caja'],

  ['expenses.view', 'Ver gastos', 'Gastos'],
  ['expenses.manage', 'Registrar gastos', 'Gastos'],

  ['customers.view', 'Ver clientes', 'Clientes'],
  ['customers.manage', 'Administrar clientes', 'Clientes'],

  ['partners.view', 'Ver socios y sus descuentos', 'Socios'],
  ['partners.manage', 'Agregar y editar socios', 'Socios'],

  ['kds.view', 'Ver pantalla de cocina y bar', 'Cocina'],

  ['reports.view', 'Ver reportes', 'Reportes'],
  ['reports.profit', 'Ver utilidades y rentabilidad', 'Reportes'],
  ['reports.export', 'Exportar reportes', 'Reportes'],

  ['users.view', 'Ver usuarios', 'Usuarios'],
  ['users.manage', 'Administrar usuarios y roles', 'Usuarios'],

  ['audit.view', 'Ver auditoria', 'Seguridad'],
  ['settings.view', 'Ver configuracion', 'Configuracion'],
  ['settings.manage', 'Modificar configuracion', 'Configuracion'],
  ['backup.manage', 'Copias de seguridad', 'Configuracion']
];

const ROLES = [
  { code: 'super_admin', name: 'Super Administrador', description: 'Acceso total al sistema', perms: '*' },
  {
    code: 'admin', name: 'Administrador', description: 'Administracion general',
    perms: PERMISSIONS.map(p => p[0]).filter(c => c !== 'users.manage' || true)
  },
  {
    code: 'cajero', name: 'Cajero', description: 'Caja, cobros y facturacion',
    perms: ['dashboard.view', 'pos.use', 'orders.view', 'orders.create', 'orders.edit', 'orders.remove_item',
      'orders.transfer', 'orders.discount', 'orders.pay', 'tables.view', 'products.view',
      'cash.view', 'cash.open', 'cash.close', 'cash.movement', 'expenses.view', 'expenses.manage',
      'customers.view', 'customers.manage', 'kds.view', 'reports.view', 'inventory.view', 'partners.view']
  },
  {
    code: 'mesero', name: 'Mesero', description: 'Mesas y toma de ordenes',
    perms: ['pos.use', 'orders.view', 'orders.create', 'orders.edit', 'tables.view',
      'products.view', 'customers.view', 'kds.view']
  },
  {
    code: 'inventario', name: 'Inventario', description: 'Productos, compras e inventario',
    perms: ['dashboard.view', 'products.view', 'products.manage', 'products.cost', 'recipes.manage',
      'inventory.view', 'inventory.manage', 'purchases.view', 'purchases.manage',
      'suppliers.view', 'suppliers.manage', 'reports.view', 'reports.export']
  },
  {
    code: 'contabilidad', name: 'Contabilidad', description: 'Informes financieros',
    perms: ['dashboard.view', 'reports.view', 'reports.profit', 'reports.export', 'orders.view',
      'products.view', 'products.cost', 'inventory.view', 'purchases.view', 'expenses.view',
      'cash.view', 'audit.view', 'partners.view']
  }
];

const CATEGORIES = [
  ['Cervezas', '#C9A227', 'bar', 1],
  ['Cocteles', '#B8873D', 'bar', 2],
  ['Licores', '#8E6B2F', 'bar', 3],
  ['Cafes', '#7A5230', 'bar', 4],
  ['Bebidas', '#5F8C7B', 'bar', 5],
  ['Comidas', '#C7583C', 'kitchen', 6],
  ['Snacks', '#D08A50', 'kitchen', 7],
  ['Promociones', '#E8C583', 'bar', 8],
  ['Insumos', '#5A5148', 'none', 99]
];

const PAYMENT_METHODS = [
  ['Efectivo', 'cash', 'cash', 1, 1],
  ['Tarjeta debito', 'debit', 'card', 0, 2],
  ['Tarjeta credito', 'credit', 'card', 0, 3],
  ['Transferencia', 'transfer', 'transfer', 0, 4],
  ['Nequi', 'nequi', 'transfer', 0, 5],
  ['Daviplata', 'daviplata', 'transfer', 0, 6],
  ['QR', 'qr', 'other', 0, 7]
];

const EXPENSE_CATEGORIES = ['Compras', 'Servicios', 'Transporte', 'Nomina', 'Mantenimiento', 'Publicidad', 'Otros'];

const ZONES = [
  ['Zona principal', ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa 5', 'Mesa 6']],
  ['Terraza', ['Mesa 7', 'Mesa 8', 'Mesa 9', 'Mesa 10']],
  ['Barra', ['Puesto 1', 'Puesto 2', 'Puesto 3', 'Puesto 4']]
];

// Insumos (type=supply) y productos de venta
const SUPPLIES = [
  ['INS-001', 'Ron blanco', 'ml', 0.09, 3000, 700],
  ['INS-002', 'Tequila blanco', 'ml', 0.14, 2000, 700],
  ['INS-003', 'Aguardiente', 'ml', 0.08, 3000, 700],
  ['INS-004', 'Jarabe de azucar', 'ml', 0.02, 2000, 500],
  ['INS-005', 'Limon', 'und', 400, 120, 30],
  ['INS-006', 'Hierbabuena', 'gr', 30, 300, 80],
  ['INS-007', 'Soda', 'ml', 0.004, 10000, 2000],
  ['INS-008', 'Cafe molido', 'gr', 45, 3000, 500],
  ['INS-009', 'Leche', 'ml', 0.004, 8000, 2000],
  ['INS-010', 'Triple sec', 'ml', 0.11, 1500, 400],
  ['INS-011', 'Sal', 'gr', 3, 2000, 300],
  ['INS-012', 'Hielo', 'gr', 1, 30000, 5000]
];

const SIMPLE_PRODUCTS = [
  ['CER-001', 'Cerveza Poker', 'Cervezas', 2200, 6000, 60, 12],
  ['CER-002', 'Cerveza Aguila', 'Cervezas', 2200, 6000, 60, 12],
  ['CER-003', 'Corona', 'Cervezas', 3800, 10000, 36, 12],
  ['CER-004', 'Club Colombia', 'Cervezas', 2900, 8000, 48, 12],
  ['LIC-001', 'Botella Aguardiente 750', 'Licores', 42000, 95000, 12, 3],
  ['LIC-002', 'Botella Ron Viejo de Caldas 750', 'Licores', 48000, 110000, 8, 3],
  ['LIC-003', 'Media de Tequila', 'Licores', 55000, 120000, 6, 2],
  ['BEB-001', 'Agua sin gas', 'Bebidas', 900, 3000, 48, 12],
  ['BEB-002', 'Gaseosa personal', 'Bebidas', 1500, 4000, 48, 12],
  ['BEB-003', 'Jugo natural', 'Bebidas', 1800, 7000, 30, 10],
  ['COM-001', 'Picada personal', 'Comidas', 12000, 28000, 0, 0],
  ['COM-002', 'Hamburguesa de la casa', 'Comidas', 9000, 24000, 0, 0],
  ['COM-003', 'Nachos con carne', 'Comidas', 7500, 22000, 0, 0],
  ['SNK-001', 'Papas fritas', 'Snacks', 2500, 9000, 0, 0],
  ['SNK-002', 'Mani', 'Snacks', 1200, 5000, 40, 10],
  ['PRO-001', 'Balde 5 cervezas', 'Promociones', 11000, 26000, 0, 0]
];

const RECIPE_PRODUCTS = [
  {
    code: 'COC-001', name: 'Mojito', category: 'Cocteles', price: 22000, station: 'bar',
    items: [['INS-001', 60], ['INS-005', 1], ['INS-004', 20], ['INS-006', 5], ['INS-007', 100], ['INS-012', 150]]
  },
  {
    code: 'COC-002', name: 'Margarita', category: 'Cocteles', price: 25000, station: 'bar',
    items: [['INS-002', 50], ['INS-010', 25], ['INS-005', 1], ['INS-011', 2], ['INS-012', 150]]
  },
  {
    code: 'COC-003', name: 'Chupe de la casa', category: 'Cocteles', price: 28000, station: 'bar',
    items: [['INS-002', 45], ['INS-003', 30], ['INS-004', 20], ['INS-005', 1], ['INS-012', 150]]
  },
  {
    code: 'CAF-001', name: 'Cafe americano', category: 'Cafes', price: 5000, station: 'bar',
    items: [['INS-008', 18]]
  },
  {
    code: 'CAF-002', name: 'Capuchino', category: 'Cafes', price: 8000, station: 'bar',
    items: [['INS-008', 18], ['INS-009', 150]]
  },
  {
    code: 'CAF-003', name: 'Cafe con leche', category: 'Cafes', price: 6500, station: 'bar',
    items: [['INS-008', 14], ['INS-009', 180]]
  }
];

function randomPassword() {
  return crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '9x';
}

// Con --demo se cargan productos, mesas y recetas de ejemplo para practicar.
// Sin la bandera, el sistema queda LIMPIO: listo para cargar tu propia carta.
const CON_DEMO = process.argv.includes('--demo') || process.env.SEED_DEMO === '1';

/**
 * Crea los permisos y roles que falten y le da a cada rol del sistema sus
 * permisos. No toca usuarios, ventas ni nada mas. Se llama tambien al arrancar
 * el servidor, para que una actualizacion con permisos nuevos funcione de una.
 */
function syncPermissions() {
  // Permisos
  const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (code, name, module) VALUES (?,?,?)');
  PERMISSIONS.forEach(p => insPerm.run(p[0], p[1], p[2]));

  // Roles
  const insRole = db.prepare('INSERT OR IGNORE INTO roles (code, name, description, is_system) VALUES (?,?,?,1)');
  const getRole = db.prepare('SELECT id FROM roles WHERE code = ?');
  const getPerm = db.prepare('SELECT id FROM permissions WHERE code = ?');
  const linkRP = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?,?)');

  for (const r of ROLES) {
    insRole.run(r.code, r.name, r.description);
    const roleId = getRole.get(r.code).id;
    const codes = r.perms === '*' ? PERMISSIONS.map(p => p[0]) : r.perms;
    for (const c of codes) {
      const p = getPerm.get(c);
      if (p) linkRP.run(roleId, p.id);
    }
  }
}

function run() {
  const already = db.prepare("SELECT COUNT(*) c FROM users").get().c;

  const out = tx(() => {
    syncPermissions();

    // Impuestos
    db.prepare('INSERT OR IGNORE INTO taxes (id, name, rate) VALUES (1, ?, 0)').run('Exento');
    db.prepare('INSERT OR IGNORE INTO taxes (id, name, rate) VALUES (2, ?, 8)').run('Impoconsumo 8%');
    db.prepare('INSERT OR IGNORE INTO taxes (id, name, rate) VALUES (3, ?, 19)').run('IVA 19%');

    // Configuracion
    db.prepare(`INSERT OR IGNORE INTO business_settings
      (id, name, legal_name, city, currency, currency_symbol, timezone, default_tax_id, ticket_footer)
      VALUES (1, 'EL CHUPE', 'EL CHUPE CANTINA', 'Bogota', 'COP', '$', 'America/Bogota', 1,
      'Gracias por visitarnos. EL CHUPE CANTINA')`).run();

    // Metodos de pago
    const insPM = db.prepare('INSERT OR IGNORE INTO payment_methods (name, code, type, affects_cash, sort_order) VALUES (?,?,?,?,?)');
    PAYMENT_METHODS.forEach(m => insPM.run(m[0], m[1], m[2], m[3], m[4]));

    // ------------------------------------------------------------------
    //  De aqui para abajo son datos de EJEMPLO. Solo entran con --demo.
    // ------------------------------------------------------------------
    if (CON_DEMO) {
      const insEC = db.prepare('INSERT OR IGNORE INTO expense_categories (name) VALUES (?)');
      EXPENSE_CATEGORIES.forEach(n => insEC.run(n));

      const insCat = db.prepare('INSERT OR IGNORE INTO categories (name, color, station, sort_order) VALUES (?,?,?,?)');
      CATEGORIES.forEach(c => insCat.run(c[0], c[1], c[2], c[3]));

      const insZone = db.prepare('INSERT INTO zones (name, sort_order) VALUES (?,?)');
      const insTable = db.prepare('INSERT INTO tables (zone_id, name, seats, sort_order) VALUES (?,?,?,?)');
      if (db.prepare('SELECT COUNT(*) c FROM zones').get().c === 0) {
        ZONES.forEach((z, zi) => {
          const zid = insZone.run(z[0], zi).lastInsertRowid;
          z[1].forEach((t, ti) => insTable.run(zid, t, 4, ti));
        });
      }
    }

    // Contador de ventas
    db.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES ('order_number', 1000)").run();

    // Productos de ejemplo (solo con --demo)
    const catId = name => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
    const insProd = db.prepare(`INSERT OR IGNORE INTO products
      (code, name, category_id, type, cost, price, unit, stock, min_stock, tax_id, station, track_stock, is_favorite)
      VALUES (@code,@name,@category_id,@type,@cost,@price,@unit,@stock,@min_stock,1,@station,@track,@fav)`);

    if (CON_DEMO && db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
      const insumosCat = catId('Insumos');
      SUPPLIES.forEach(s => insProd.run({
        code: s[0], name: s[1], category_id: insumosCat, type: 'supply',
        cost: s[3], price: 0, unit: s[2], stock: s[4], min_stock: s[5],
        station: 'none', track: 1, fav: 0
      }));

      SIMPLE_PRODUCTS.forEach(p => insProd.run({
        code: p[0], name: p[1], category_id: catId(p[2]), type: 'simple',
        cost: p[3], price: p[4], unit: 'und', stock: p[5], min_stock: p[6],
        station: null, track: p[5] > 0 || p[6] > 0 ? 1 : 0, fav: p[0].startsWith('CER') ? 1 : 0
      }));

      const insRecipe = db.prepare('INSERT OR IGNORE INTO recipe_items (product_id, ingredient_id, quantity) VALUES (?,?,?)');
      const prodByCode = code => db.prepare('SELECT id FROM products WHERE code = ?').get(code);
      RECIPE_PRODUCTS.forEach(rp => {
        insProd.run({
          code: rp.code, name: rp.name, category_id: catId(rp.category), type: 'recipe',
          cost: 0, price: rp.price, unit: 'und', stock: 0, min_stock: 0,
          station: rp.station, track: 0, fav: 1
        });
        const pid = prodByCode(rp.code).id;
        rp.items.forEach(([code, qty]) => {
          const ing = prodByCode(code);
          if (ing) insRecipe.run(pid, ing.id, qty);
        });
      });

      // Costo calculado de recetas
      const recipeProds = db.prepare("SELECT id FROM products WHERE type = 'recipe'").all();
      const calcCost = db.prepare(`SELECT COALESCE(SUM(ri.quantity * p.cost),0) c
        FROM recipe_items ri JOIN products p ON p.id = ri.ingredient_id WHERE ri.product_id = ?`);
      const updCost = db.prepare('UPDATE products SET cost = ? WHERE id = ?');
      recipeProds.forEach(rp => updCost.run(Math.round(calcCost.get(rp.id).c * 100) / 100, rp.id));

      // Movimiento inicial de inventario para trazabilidad del kardex
      const insMov = db.prepare(`INSERT INTO inventory_movements
        (product_id, type, direction, quantity, balance, unit_cost, reason, reference_type)
        VALUES (?, 'initial', 'in', ?, ?, ?, 'Carga inicial del sistema', 'seed')`);
      db.prepare('SELECT id, stock, cost FROM products WHERE stock > 0').all()
        .forEach(p => insMov.run(p.id, p.stock, p.stock, p.cost));
    }

    // Usuario administrador
    let credentials = null;
    if (already === 0) {
      const password = env.ADMIN_PASSWORD || randomPassword();
      const hash = bcrypt.hashSync(password, 12);
      const superRole = db.prepare('SELECT id FROM roles WHERE code = ?').get('super_admin').id;
      db.prepare(`INSERT INTO users (role_id, name, email, password_hash, pin)
        VALUES (?,?,?,?,?)`).run(superRole, env.ADMIN_NAME, env.ADMIN_EMAIL, hash, '1234');
      credentials = { email: env.ADMIN_EMAIL, password, generated: !env.ADMIN_PASSWORD };
    }
    return credentials;
  });

  const cuenta = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

  if (CON_DEMO) {
    console.log(`\n  Sistema cargado CON datos de ejemplo para practicar:`);
    console.log(`    ${cuenta('products')} productos · ${cuenta('tables')} mesas · ${cuenta('categories')} categorias`);
    console.log(`    Cuando termines de practicar, ejecuta:  npm run reset  y luego  npm run setup`);
  } else if (already > 0) {
    console.log(`\n  Base de datos existente: se conservo todo.`);
    console.log(`    ${cuenta('orders')} ventas · ${cuenta('products')} productos · ${cuenta('purchases')} compras · ${cuenta('expenses')} gastos · ${cuenta('customers')} clientes`);
  } else {
    console.log(`\n  Sistema LIMPIO, listo para cargar tu negocio:`);
    console.log(`    ${cuenta('products')} productos · ${cuenta('tables')} mesas · ${cuenta('customers')} clientes · ${cuenta('orders')} ventas`);
    console.log(`    Solo quedan los permisos, los roles y los metodos de pago, que el sistema necesita para funcionar.`);
    console.log(`    Si quieres practicar antes con datos de prueba:  npm run demo`);
  }
  if (out) {
    console.log('\n  ---------------------------------------------');
    console.log('   USUARIO ADMINISTRADOR');
    console.log('   Correo:      ' + out.email);
    console.log('   Contrasena:  ' + out.password);
    if (out.generated) {
      console.log('   (generada automaticamente: guardala ahora)');
    }
    console.log('   PIN rapido:  1234  (cambialo en Usuarios)');
    console.log('  ---------------------------------------------\n');
  } else {
    console.log('El usuario administrador ya existia, no se modifico.');
  }
}

module.exports = { syncPermissions };

if (require.main === module) run();
