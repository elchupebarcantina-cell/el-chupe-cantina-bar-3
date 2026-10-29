'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const { db } = require('./db/connection');
const { requireAuth } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();

// Detras de un proxy (Railway, Render, Nginx, Cloudflare) hay que confiar en las
// cabeceras que reenvia para saber la IP real del cliente y si la conexion
// original venia por HTTPS. Sin esto, las cookies seguras no funcionan.
if (process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------------
// Actualizacion automatica de la base (sin borrar datos)
// ---------------------------------------------------------------------
// Si esta version trae tablas o columnas nuevas, se agregan aqui. Antes se
// guarda una copia completa de la base. Ventas, compras, inventario, caja y
// todo lo demas se conservan tal cual.
try {
  const tablasBase = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='business_settings'").get().c;
  if (tablasBase > 0) {
    require('./db/migrate').migrar();
    const { tx } = require('./db/connection');
    tx(() => require('./db/seed').syncPermissions());

    // Sede nueva con inventario de arranque (variable INVENTARIO_INICIAL=salitre).
    // Solo se carga si la sede no tiene productos, y una sola vez.
    if (process.env.INVENTARIO_INICIAL) {
      const r = require('./db/inventario-inicial').cargar(process.env.INVENTARIO_INICIAL);
      if (r.omitido) console.log(`  Inventario inicial: no se cargo (${r.motivo}).`);
      else console.log(`  Inventario inicial "${r.clave}" cargado: ${r.categorias} categorias, ${r.productos} productos, ${r.unidades} unidades.`);
    }
  }
} catch (e) {
  console.error('\n[EL CHUPE] No se pudo actualizar la base de datos.');
  console.error(e.message + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Verificacion previa: la base debe estar migrada
// ---------------------------------------------------------------------
try {
  db.prepare('SELECT 1 FROM business_settings WHERE id = 1').get();
} catch (e) {
  console.error('\n[EL CHUPE] La base de datos no esta lista.');
  console.error('Ejecuta primero:  npm run setup\n');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Cabeceras de seguridad
// ---------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'"
  ].join('; '));
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Proteccion basica contra CSRF: peticiones que modifican datos deben venir del mismo origen
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // clientes sin navegador (curl, apps)
  const host = req.headers.host;
  try {
    if (new URL(origin).host !== host) {
      return res.status(403).json({ error: 'Peticion bloqueada por seguridad (origen no valido).' });
    }
  } catch (e) { /* origen malformado: se ignora y sigue la validacion normal */ }
  next();
});

// ---------------------------------------------------------------------
// Rutas de la API
// ---------------------------------------------------------------------
app.use('/api', rateLimit({ max: 3000, windowMin: 10 }));
app.use('/api/auth', require('./routes/auth'));
app.get('/api/version', (req, res) => {
  const pkg = require('../package.json');
  res.json({ version: pkg.version, build: pkg.build });
});
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'EL CHUPE POS', version: '1.0.0' }));

app.use('/api', requireAuth, require('./routes/catalog'));
app.use('/api', requireAuth, require('./routes/operations'));
app.use('/api', requireAuth, require('./routes/finance'));
app.use('/api', requireAuth, require('./routes/admin'));
app.use('/api', requireAuth, require('./routes/uploads'));
app.use('/api', requireAuth, require('./routes/partners'));


// ---------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
/**
 * Archivos estaticos.
 *
 * Se usa 'no-cache' (que no es lo mismo que no guardar): el navegador guarda
 * copia pero SIEMPRE le pregunta al servidor si cambio. Si no cambio responde
 * un 304 diminuto, asi que sigue siendo rapido. Esto evita el problema de que
 * despues de actualizar el sistema quede corriendo la version vieja de la
 * interfaz contra el servidor nuevo.
 */
const BUILD = require('../package.json').build;

/**
 * Los archivos de la interfaz se sirven bajo /v/<version>/.
 *
 * Cada version del sistema estrena direccion, asi que despues de actualizar el
 * navegador esta OBLIGADO a pedir los archivos nuevos: los viejos quedaron en
 * otra ruta que ya nadie solicita. Elimina de raiz el problema clasico de
 * "actualice pero sigue saliendo la pantalla vieja".
 *
 * Como la direccion ya identifica la version, aqui si conviene un cache largo:
 * carga instantaneo y siempre correcto.
 */
app.use('/v/:build', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}, express.static(env.PUBLIC_DIR, { index: false }));

// Imagenes subidas por el usuario (logo). Siempre se revalidan porque el
// nombre del archivo no cambia cuando se reemplaza.
app.use('/uploads', express.static(env.UPLOAD_DIR, {
  etag: true,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache')
}));

// Recursos sueltos (logo de respaldo, favicon) sin version en la ruta.
app.use(express.static(env.PUBLIC_DIR, {
  index: false,
  etag: true,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache')
}));

/**
 * La pagina principal se arma en cada peticion con la version actual y nunca
 * se guarda en cache. Es el unico archivo que el navegador vuelve a pedir
 * siempre, y desde ahi se entera de que version debe cargar.
 */
const plantillaIndex = fs.readFileSync(path.join(env.PUBLIC_DIR, 'index.html'), 'utf8');
const paginaIndex = plantillaIndex.replace(/__BUILD__/g, BUILD);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.type('html').send(paginaIndex);
});

app.use(notFound);
app.use(errorHandler);

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
const server = app.listen(env.PORT, env.HOST, () => {
  const settings = db.prepare('SELECT name FROM business_settings WHERE id = 1').get();
  console.log('');
  console.log('  ' + (settings?.name || 'EL CHUPE') + ' - Sistema POS');
  console.log('  ------------------------------------------');
  console.log('  Entorno:    ' + env.NODE_ENV);
  console.log('  Escuchando: http://localhost:' + env.PORT);
  console.log('  En red:     http://<ip-del-equipo>:' + env.PORT);
  console.log('  Base:       ' + env.DB_PATH);
  console.log('');
});

function shutdown(signal) {
  console.log(`\nCerrando (${signal})...`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
