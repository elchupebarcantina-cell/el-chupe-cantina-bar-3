'use strict';
/**
 * Cambia la contrasena de un usuario desde la linea de comandos.
 *
 * Sirve cuando nadie puede entrar al sistema: se olvido la clave del
 * administrador, o alguien se fue de la empresa con la unica cuenta activa.
 *
 * Uso:
 *   npm run clave                          -> lista los usuarios
 *   npm run clave -- correo@ejemplo.com NuevaClave123
 *   npm run clave -- correo@ejemplo.com NuevaClave123 --pin 4821
 */
const bcrypt = require('bcryptjs');
const { db } = require('./connection');

const args = process.argv.slice(2).filter(a => a !== '--');
const correo = args[0];
const clave = args[1];

const pinIdx = args.indexOf('--pin');
const pin = pinIdx !== -1 ? args[pinIdx + 1] : null;

function listar() {
  const usuarios = db.prepare(`
    SELECT u.email, u.name, r.name AS rol, u.is_active
    FROM users u JOIN roles r ON r.id = u.role_id
    ORDER BY u.id`).all();

  if (usuarios.length === 0) {
    console.log('\n  No hay usuarios en la base de datos.');
    console.log('  Ejecuta:  npm run seed\n');
    return;
  }

  console.log('\n  USUARIOS DEL SISTEMA\n');
  usuarios.forEach(u => {
    console.log(`    ${u.email.padEnd(30)} ${u.name.padEnd(24)} ${u.rol}${u.is_active ? '' : '  (inactivo)'}`);
  });
  console.log('\n  Para cambiarle la clave a alguno:');
  console.log('    npm run clave -- ' + usuarios[0].email + ' MiClaveNueva123\n');
}

function cambiar() {
  const usuario = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(correo);

  if (!usuario) {
    console.error(`\n  No existe ningun usuario con el correo "${correo}".`);
    listar();
    process.exit(1);
  }

  if (clave.length < 8) {
    console.error('\n  La contrasena debe tener al menos 8 caracteres.\n');
    process.exit(1);
  }

  if (pin && !/^\d{4,8}$/.test(pin)) {
    console.error('\n  El PIN debe ser de 4 a 8 digitos.\n');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(clave, 12);

  if (pin) {
    const ocupado = db.prepare('SELECT id FROM users WHERE pin = ? AND id != ?').get(pin, usuario.id);
    if (ocupado) {
      console.error('\n  Ese PIN ya lo tiene otro usuario. Escoge otro.\n');
      process.exit(1);
    }
    db.prepare('UPDATE users SET password_hash = ?, pin = ?, is_active = 1 WHERE id = ?')
      .run(hash, pin, usuario.id);
  } else {
    db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?')
      .run(hash, usuario.id);
  }

  db.prepare(`INSERT INTO audit_logs (user_id, action, entity, description)
    VALUES (?, 'update', 'users', ?)`)
    .run(usuario.id, `Contrasena cambiada desde la consola del servidor`);

  console.log(`\n  Listo. La contrasena de ${usuario.name} quedo cambiada.`);
  console.log(`    Correo:      ${usuario.email}`);
  console.log(`    Contrasena:  ${clave}`);
  if (pin) console.log(`    PIN rapido:  ${pin}`);
  console.log('\n  Entra al sistema y cambiala de nuevo desde Ajustes > Mi cuenta.\n');
}

if (!correo || !clave) listar();
else cambiar();
