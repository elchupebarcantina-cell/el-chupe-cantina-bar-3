'use strict';
/**
 * Capa de acceso a la base de datos.
 *
 * Usa el SQLite que viene incluido dentro de Node.js (node:sqlite), disponible
 * desde Node 22.5. No necesita compilar nada, asi que la instalacion nunca
 * depende de node-gyp, Python ni Visual Studio.
 *
 * Si el equipo tiene un Node mas viejo, cae automaticamente a better-sqlite3
 * cuando este instalado.
 *
 * Hacia afuera ambos motores se ven igual: db.prepare().run/get/all,
 * db.exec, db.pragma, db.transaction y db.backup.
 */
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });

// ---------------------------------------------------------------------------
//  Eleccion del motor
// ---------------------------------------------------------------------------
let db = null;
let motor = null;

// En Node 22.x el modulo integrado avisa que es experimental. Es un aviso
// informativo que confunde al usuario del local, asi que lo ocultamos.
const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const tipo = typeof resto[0] === 'string' ? resto[0] : (resto[0] && resto[0].type);
  if (tipo === 'ExperimentalWarning' && String(aviso).includes('SQLite')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

// 1) SQLite integrado de Node
try {
  const { DatabaseSync } = require('node:sqlite');
  db = wrapNodeSqlite(new DatabaseSync(env.DB_PATH));
  motor = 'node:sqlite';
} catch (e) {
  // 2) better-sqlite3, si esta compilado en este equipo
  try {
    const Database = require('better-sqlite3');
    db = new Database(env.DB_PATH);
    motor = 'better-sqlite3';
  } catch (e2) {
    console.error(`
  No pude abrir la base de datos.

  Este sistema necesita Node.js 22.5 o superior, que ya trae SQLite incluido.
  Tienes instalado: ${process.version}

  Descarga la version LTS desde https://nodejs.org, instalala y vuelve a
  ejecutar el instalador.
`);
    process.exit(1);
  }
}

process.emitWarning = avisoOriginal;

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ---------------------------------------------------------------------------
//  Adaptador para node:sqlite
// ---------------------------------------------------------------------------
function wrapNodeSqlite(raw) {
  // node:sqlite devuelve objetos sin prototipo. Los pasamos a objetos normales
  // para que se comporten igual que los de better-sqlite3 en todo el codigo.
  const plain = row => (row == null ? row : Object.assign({}, row));

  let nivel = 0; // profundidad de transacciones anidadas

  return {
    motor: 'node:sqlite',

    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => plain(stmt.get(...args)),
        all: (...args) => stmt.all(...args).map(plain)
      };
    },

    exec(sql) {
      return raw.exec(sql);
    },

    /**
     * Acepta las dos formas de better-sqlite3:
     *   pragma('foreign_keys = ON')  -> aplica el ajuste
     *   pragma('journal_mode')       -> devuelve el valor actual
     */
    pragma(texto) {
      if (String(texto).includes('=')) return raw.exec(`PRAGMA ${texto}`);
      return raw.prepare(`PRAGMA ${texto}`).all().map(plain);
    },

    /**
     * Devuelve una funcion que corre fn dentro de una transaccion.
     * Si algo falla, revierte todo. Soporta transacciones anidadas usando
     * puntos de guardado, igual que better-sqlite3.
     */
    transaction(fn) {
      return (...args) => {
        const anidada = nivel > 0;
        const marca = `sp_${nivel}`;

        raw.exec(anidada ? `SAVEPOINT ${marca}` : 'BEGIN');
        nivel++;

        try {
          const resultado = fn(...args);
          nivel--;
          raw.exec(anidada ? `RELEASE ${marca}` : 'COMMIT');
          return resultado;
        } catch (err) {
          nivel--;
          try {
            raw.exec(anidada ? `ROLLBACK TO ${marca}; RELEASE ${marca}` : 'ROLLBACK');
          } catch (e) {
            // Si el rollback tambien falla, prevalece el error original.
          }
          throw err;
        }
      };
    },

    /** Copia de seguridad en caliente. VACUUM INTO deja un archivo consistente. */
    async backup(destino) {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      if (fs.existsSync(destino)) fs.unlinkSync(destino);
      raw.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
      return { totalPages: 0, remainingPages: 0 };
    },

    close() {
      try { raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* nada */ }
      return raw.close();
    }
  };
}

/** Ejecuta fn dentro de una transaccion. Revierte todo si algo falla. */
function tx(fn) {
  return db.transaction(fn)();
}

module.exports = { db, tx, motor };
