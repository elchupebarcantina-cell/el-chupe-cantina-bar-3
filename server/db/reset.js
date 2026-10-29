'use strict';
const fs = require('fs');
const env = require('../config/env');

for (const suffix of ['', '-wal', '-shm']) {
  const file = env.DB_PATH + suffix;
  if (fs.existsSync(file)) { fs.unlinkSync(file); console.log('Eliminado: ' + file); }
}
console.log('Base de datos borrada. Ejecuta: npm run setup');
