'use strict';
const fs = require('fs');
const path = require('path');
const { db } = require('./connection');
const env = require('../config/env');

(async () => {
  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(env.BACKUP_DIR, `elchupe-${stamp}.db`);
  await db.backup(file);
  console.log('Copia de seguridad creada: ' + file);
})();
