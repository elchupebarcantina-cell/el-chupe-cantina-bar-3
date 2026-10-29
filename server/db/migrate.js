'use strict';
/**
 * Migraciones: crean o amplian las tablas SIN borrar datos.
 *
 * - Cada archivo de migrations/ se aplica una sola vez y queda anotado.
 * - Las migraciones solo agregan (tablas y columnas nuevas). Nunca borran.
 * - Si la base ya tiene informacion y hay cambios por aplicar, antes de tocar
 *   nada se guarda una copia completa en la carpeta de copias de seguridad.
 * - Cada migracion va dentro de una transaccion: si algo falla, la base queda
 *   exactamente como estaba.
 *
 * Se ejecuta solo al arrancar el sistema, asi que actualizar una sede es
 * reemplazar los archivos y volver a arrancar.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./connection');
const env = require('../config/env');

const dir = path.join(__dirname, 'migrations');

function pendientes() {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  const applied = new Set(db.prepare('SELECT filename FROM migrations').all().map(r => r.filename));
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().filter(f => !applied.has(f));
}

/** True si la base ya tiene un negocio funcionando (no es una instalacion nueva). */
function tieneDatos() {
  try { return db.prepare('SELECT COUNT(*) c FROM users').get().c > 0; }
  catch (e) { return false; }
}

/** Copia completa de la base antes de modificar su estructura. */
function copiaPrevia(archivos) {
  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(env.BACKUP_DIR, `antes-de-actualizar-${stamp}.db`);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  console.log(`  Copia de seguridad antes de actualizar: ${destino}`);
  console.log(`  (cambios por aplicar: ${archivos.join(', ')})`);
  return destino;
}

function migrar({ conCopia = true } = {}) {
  const files = pendientes();
  if (files.length === 0) return 0;

  if (conCopia && tieneDatos()) copiaPrevia(files);

  let count = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(file);
      db.exec('COMMIT');
      console.log('  aplicada: ' + file);
      count++;
    } catch (err) {
      db.exec('ROLLBACK');
      const e = new Error(`La actualizacion ${file} fallo y se deshizo. Tus datos quedaron intactos. Detalle: ${err.message}`);
      e.migracion = file;
      throw e;
    }
  }
  return count;
}

module.exports = { migrar, pendientes };

if (require.main === module) {
  try {
    const count = migrar();
    console.log(count === 0 ? 'Base de datos ya estaba al dia.' : count + ' migracion(es) aplicada(s).');
  } catch (e) {
    console.error('  FALLO: ' + e.message);
    process.exit(1);
  }
}
