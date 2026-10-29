'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');
const { asyncH, fail } = require('../utils/http');
const v = require('../utils/validate');
const { issueToken, clearToken, requireAuth, loadUser } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { audit } = require('../middleware/audit');
const env = require('../config/env');

const router = express.Router();

const logAttempt = db.prepare(
  'INSERT INTO login_attempts (email, ip, success, user_agent) VALUES (?,?,?,?)');

router.post('/login',
  rateLimit({ max: env.RATE_LIMIT_MAX_LOGIN, message: 'Demasiados intentos de acceso. Espera unos minutos.' }),
  asyncH((req, res) => {
    const email = v.email(req.body.email, 'correo');
    const password = v.str(req.body.password, 'contrasena', { min: 4, max: 200 });

    const row = db.prepare(`SELECT u.*, r.code AS role_code FROM users u
      JOIN roles r ON r.id = u.role_id WHERE u.email = ?`).get(email);

    const ok = row && row.is_active && bcrypt.compareSync(password, row.password_hash);
    logAttempt.run(email, req.ip, ok ? 1 : 0, (req.headers['user-agent'] || '').slice(0, 200));

    if (!ok) fail('Correo o contrasena incorrectos.', 401);

    db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(row.id);
    issueToken(res, row, req);
    const user = loadUser(row.id);
    audit({ ...req, user }, { action: 'login', entity: 'users', entityId: row.id, description: 'Inicio de sesion' });
    res.json({ user });
  }));

// Acceso rapido por PIN para meseros en tablet
router.post('/pin',
  rateLimit({ max: 20, message: 'Demasiados intentos con PIN. Espera unos minutos.' }),
  asyncH((req, res) => {
    const pin = v.str(req.body.pin, 'PIN', { min: 4, max: 8 });
    const candidates = db.prepare(`SELECT u.*, r.code AS role_code FROM users u
      JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND u.pin IS NOT NULL`).all();
    const row = candidates.find(u => u.pin === pin);
    logAttempt.run('pin:' + (row?.email || 'desconocido'), req.ip, row ? 1 : 0, 'pin');
    if (!row) fail('PIN incorrecto.', 401);
    db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(row.id);
    issueToken(res, row, req);
    res.json({ user: loadUser(row.id) });
  }));

router.post('/logout', (req, res) => { clearToken(res, req); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => {
  const cfg = db.prepare(`SELECT name, logo_path, currency_symbol, decimals, timezone,
    ticket_width, service_charge_pct, prices_include_tax, waiter_discount_limit
    FROM business_settings WHERE id = 1`).get();
  res.json({ user: req.user, settings: cfg });
});

router.post('/change-password', requireAuth, asyncH((req, res) => {
  const current = v.str(req.body.current_password, 'contrasena actual', { min: 4 });
  const next = v.str(req.body.new_password, 'contrasena nueva', { min: 8, max: 200 });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) fail('La contrasena actual no es correcta.');
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(bcrypt.hashSync(next, 12), req.user.id);
  audit(req, { action: 'update', entity: 'users', entityId: req.user.id, description: 'Cambio de contrasena' });
  res.json({ ok: true });
}));

module.exports = router;
