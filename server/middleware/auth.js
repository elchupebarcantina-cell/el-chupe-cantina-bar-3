'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../db/connection');
const env = require('../config/env');
const { fail } = require('../utils/http');

const COOKIE = 'chupe_session';

/**
 * La cookie se marca como "secure" solo cuando la conexion viene de verdad por
 * HTTPS. Es importante que dependa de la conexion y no del entorno: en el local
 * los meseros entran por http://192.168.x.x desde la tablet, y una cookie
 * "secure" sobre HTTP simplemente no se guarda, dejandolos sin poder entrar.
 * Cuando el sistema se publica en internet con HTTPS, se activa sola.
 */
function esHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function opcionesCookie(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: esHttps(req),
    path: '/'
  };
}

function issueToken(res, user, req = res.req) {
  const token = jwt.sign(
    { uid: user.id, role: user.role_code },
    env.JWT_SECRET,
    { expiresIn: `${env.SESSION_HOURS}h` }
  );
  res.cookie(COOKIE, token, {
    ...opcionesCookie(req),
    maxAge: env.SESSION_HOURS * 3600 * 1000
  });
  return token;
}

function clearToken(res, req = res.req) {
  res.clearCookie(COOKIE, opcionesCookie(req));
}

const userQuery = db.prepare(`
  SELECT u.id, u.name, u.email, u.is_active, u.role_id, r.code AS role_code, r.name AS role_name
  FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`);

const permQuery = db.prepare(`
  SELECT p.code FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`);

function loadUser(id) {
  const user = userQuery.get(id);
  if (!user || !user.is_active) return null;
  user.permissions = permQuery.all(user.role_id).map(r => r.code);
  return user;
}

/** Exige sesion valida. */
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return next(Object.assign(new Error('Tu sesion no esta activa. Inicia sesion de nuevo.'),
    { status: 401, expose: true }));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = loadUser(payload.uid);
    if (!user) {
      clearToken(res);
      return next(Object.assign(new Error('Tu usuario ya no esta activo.'), { status: 401, expose: true }));
    }
    req.user = user;
    next();
  } catch (e) {
    clearToken(res);
    next(Object.assign(new Error('Tu sesion expiro. Inicia sesion de nuevo.'), { status: 401, expose: true }));
  }
}

const has = (user, code) => user.role_code === 'super_admin' || user.permissions.includes(code);

/** Exige uno o mas permisos. */
function requirePerm(...codes) {
  return (req, res, next) => {
    if (!req.user) return next(Object.assign(new Error('Sesion requerida.'), { status: 401, expose: true }));
    const ok = codes.some(c => has(req.user, c));
    if (!ok) return next(Object.assign(
      new Error('No tienes permisos para realizar esta accion.'), { status: 403, expose: true }));
    next();
  };
}

module.exports = { issueToken, clearToken, requireAuth, requirePerm, loadUser, has, COOKIE };
