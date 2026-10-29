'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const root = path.join(__dirname, '..', '..');

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: process.env.JWT_SECRET || 'cambia-esta-clave-en-produccion',
  SESSION_HOURS: parseInt(process.env.SESSION_HOURS || '12', 10),
  DB_PATH: process.env.DB_PATH
    ? path.resolve(root, process.env.DB_PATH)
    : path.join(root, 'data', 'elchupe.db'),
  // En internet estas carpetas apuntan a un disco que no se borra al actualizar
  BACKUP_DIR: process.env.BACKUP_DIR
    ? path.resolve(root, process.env.BACKUP_DIR)
    : path.join(root, 'backups'),
  UPLOAD_DIR: process.env.UPLOAD_DIR
    ? path.resolve(root, process.env.UPLOAD_DIR)
    : path.join(root, 'public', 'uploads'),
  PUBLIC_DIR: path.join(root, 'public'),
  ROOT: root,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@elchupe.local',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_NAME: process.env.ADMIN_NAME || 'Super Administrador',
  RATE_LIMIT_WINDOW_MIN: parseInt(process.env.RATE_LIMIT_WINDOW_MIN || '10', 10),
  RATE_LIMIT_MAX_LOGIN: parseInt(process.env.RATE_LIMIT_MAX_LOGIN || '10', 10),
  TZ: process.env.TZ || 'America/Bogota'
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'cambia-esta-clave-en-produccion') {
  console.error('\n[EL CHUPE] ERROR: define JWT_SECRET en el archivo .env antes de usar produccion.\n');
  process.exit(1);
}

module.exports = env;
