'use strict';
/**
 * Inventario inicial de una sede nueva.
 *
 * Carga las categorias y los productos de un archivo de server/db/inventarios/
 * (por ejemplo salitre.json), con su stock de arranque registrado en el kardex
 * como "Inventario inicial".
 *
 * Seguridad:
 *  - SOLO se carga en una sede que todavia no tiene ningun producto.
 *  - Se carga UNA sola vez: queda anotado y no se repite al reiniciar.
 *  - Nunca borra ni cambia nada que ya exista.
 *
 * Uso:
 *   Railway:  variable  INVENTARIO_INICIAL=salitre   (se carga sola al arrancar)
 *   Local:    npm run inventario -- salitre
 */
const fs = require('fs');
const path = require('path');
const { db, tx } = require('./connection');

const DIR = path.join(__dirname, 'inventarios');

function disponibles() {
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
}

function leer(nombre) {
  const limpio = String(nombre || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const archivo = path.join(DIR, limpio + '.json');
  if (!limpio || !fs.existsSync(archivo)) {
    throw new Error(`No existe el inventario "${nombre}". Disponibles: ${disponibles().join(', ') || 'ninguno'}`);
  }
  return { clave: limpio, datos: JSON.parse(fs.readFileSync(archivo, 'utf8')) };
}

/**
 * Carga el inventario. Devuelve un resumen, o { omitido, motivo } si no
 * corresponde cargarlo (ya se cargo, o la sede ya tiene productos).
 */
function cargar(nombre) {
  const { clave, datos } = leer(nombre);
  const marca = 'inventario_inicial_' + clave;

  if (db.prepare('SELECT 1 FROM counters WHERE name = ?').get(marca)) {
    return { omitido: true, motivo: `el inventario "${clave}" ya se habia cargado antes` };
  }
  const productos = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (productos > 0) {
    return { omitido: true, motivo: `esta sede ya tiene ${productos} producto(s); no se toca para no mezclar inventarios` };
  }

  const inventory = require('../services/inventory');
  const admin = db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1`).get();

  return tx(() => {
    // Datos de la sede (solo si siguen con el nombre de fabrica)
    if (datos.sede) {
      const actual = db.prepare('SELECT name FROM business_settings WHERE id = 1').get();
      if (actual && actual.name === 'EL CHUPE') {
        db.prepare(`UPDATE business_settings SET name = ?, legal_name = COALESCE(?, legal_name),
          city = COALESCE(?, city) WHERE id = 1`)
          .run(datos.sede.name, datos.sede.legal_name || null, datos.sede.city || null);
      }
    }

    // Categorias
    const insCat = db.prepare(`INSERT OR IGNORE INTO categories (name, color, station, sort_order)
      VALUES (?,?,?,?)`);
    for (const c of datos.categorias || []) insCat.run(c.name, c.color || '#B8873D', c.station || 'bar', c.orden || 0);
    const catId = db.prepare('SELECT id FROM categories WHERE name = ?');

    // Productos con su stock inicial
    const insProd = db.prepare(`INSERT INTO products
      (code, name, category_id, type, cost, price, unit, stock, min_stock, track_stock, station)
      VALUES (?,?,?, 'simple', ?, ?, ?, 0, ?, 1, NULL)`);
    let unidades = 0;
    for (const p of datos.productos || []) {
      const cat = catId.get(p.categoria);
      if (!cat) throw new Error(`El producto "${p.name}" usa la categoria "${p.categoria}", que no existe en el archivo.`);
      const id = insProd.run(p.code, p.name, cat.id, p.cost || 0, p.price || 0, p.unit || 'und', p.min_stock || 0)
        .lastInsertRowid;
      if (p.stock > 0) {
        inventory.move({
          productId: id, type: 'initial', direction: 'in', quantity: p.stock,
          reason: 'Inventario inicial de la sede', userId: admin?.id || null
        });
        unidades += p.stock;
      }
    }

    db.prepare('INSERT INTO counters (name, value) VALUES (?, 1)').run(marca);
    db.prepare(`INSERT INTO audit_logs (user_id, user_name, action, entity, description)
      VALUES (?, 'sistema', 'create', 'products', ?)`)
      .run(admin?.id || null, `Inventario inicial "${clave}": ${(datos.categorias || []).length} categorias, ` +
        `${(datos.productos || []).length} productos, ${unidades} unidades`);

    return {
      clave,
      sede: datos.sede?.name || null,
      categorias: (datos.categorias || []).length,
      productos: (datos.productos || []).length,
      unidades
    };
  });
}

module.exports = { cargar, disponibles };

if (require.main === module) {
  const nombre = process.argv.slice(2).filter(a => a !== '--')[0];
  if (!nombre) {
    console.log('\n  Uso:  npm run inventario -- <nombre>');
    console.log('  Disponibles: ' + disponibles().join(', ') + '\n');
    process.exit(1);
  }
  try {
    const r = cargar(nombre);
    if (r.omitido) console.log(`\n  No se cargo nada: ${r.motivo}.\n`);
    else console.log(`\n  Inventario "${r.clave}" cargado: ${r.categorias} categorias, ` +
      `${r.productos} productos, ${r.unidades} unidades.\n`);
  } catch (e) {
    console.error('\n  ' + e.message + '\n');
    process.exit(1);
  }
}
