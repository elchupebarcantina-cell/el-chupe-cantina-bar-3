'use strict';
const express = require('express');
const { db, tx } = require('../db/connection');
const { asyncH, fail } = require('../utils/http');
const v = require('../utils/validate');
const { requirePerm } = require('../middleware/auth');
const { audit, describeChanges } = require('../middleware/audit');
const partners = require('../services/partners');

const router = express.Router();

// =====================================================================
// Reglas del beneficio
// =====================================================================
router.get('/partners/rules', requirePerm('partners.view', 'pos.use'), (req, res) => {
  res.json({ ...partners.rules(), month: partners.monthName() });
});

router.put('/partners/rules', requirePerm('partners.manage'), asyncH((req, res) => {
  const before = partners.rules();
  const pct = v.num(req.body.pct, 'porcentaje de descuento', { min: 0.5, max: 100 });
  const uses = v.int(req.body.uses, 'usos por mes', { min: 1, max: 31 });
  db.prepare('UPDATE business_settings SET partner_discount_pct = ?, partner_monthly_uses = ? WHERE id = 1')
    .run(pct, uses);
  audit(req, {
    action: 'update', entity: 'business_settings', entityId: 1,
    description: `Beneficio de socios: ${before.pct}% x${before.uses} al mes -> ${pct}% x${uses} al mes`
  });
  res.json(partners.rules());
}));

// =====================================================================
// Socios
// =====================================================================
router.get('/partners', requirePerm('partners.view'), (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM orders o WHERE o.partner_id = p.id AND o.status != 'void'
        AND strftime('%Y-%m', o.partner_applied_at) = strftime('%Y-%m','now','localtime')) AS used_month,
      (SELECT COALESCE(SUM(o.discount_amount),0) FROM orders o WHERE o.partner_id = p.id AND o.status = 'paid'
        AND strftime('%Y-%m', o.partner_applied_at) = strftime('%Y-%m','now','localtime')) AS discount_month,
      (SELECT COUNT(*) FROM orders o WHERE o.partner_id = p.id AND o.status = 'paid') AS uses_total,
      (SELECT COALESCE(SUM(o.discount_amount),0) FROM orders o WHERE o.partner_id = p.id AND o.status = 'paid') AS discount_total,
      (SELECT MAX(o.partner_applied_at) FROM orders o WHERE o.partner_id = p.id AND o.status != 'void') AS last_use
    FROM partners p
    ${search ? 'WHERE p.name LIKE ? OR p.document LIKE ? OR p.phone LIKE ?' : ''}
    ORDER BY p.is_active DESC, p.name LIMIT 1000`);
  res.json({
    rules: { ...partners.rules(), month: partners.monthName() },
    partners: search ? rows.all(search, search, search) : rows.all()
  });
});

// Consulta rapida desde la pantalla de venta (meseros incluidos)
router.get('/partners/lookup', requirePerm('pos.use', 'orders.edit', 'partners.view'), asyncH((req, res) => {
  res.json(partners.lookup(req.query.document));
}));

router.get('/partners/:id', requirePerm('partners.view'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const p = db.prepare('SELECT * FROM partners WHERE id = ?').get(id);
  if (!p) fail('El socio no existe.', 404);
  p.used_month = partners.usesThisMonth(id);
  p.orders = db.prepare(`
    SELECT o.id, o.number, o.status, o.partner_applied_at, o.closed_at, o.subtotal, o.discount_amount, o.total,
      t.name AS table_name, u.name AS waiter_name
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN users u ON u.id = o.waiter_id
    WHERE o.partner_id = ?
    ORDER BY o.partner_applied_at DESC LIMIT 100`).all(id);
  res.json(p);
}));

function partnerData(body, current = {}) {
  const document = body.document !== undefined ? partners.normalizeDoc(body.document) : current.document;
  if (!document) fail('La cedula es obligatoria.');
  if (document.length < 4 || document.length > 20) fail('La cedula debe tener entre 4 y 20 caracteres.');
  return {
    name: v.str(body.name ?? current.name, 'nombre', { max: 120 }),
    document,
    phone: body.phone !== undefined ? v.str(body.phone, 'telefono', { required: false, max: 40 }) : (current.phone ?? null),
    notes: body.notes !== undefined ? v.str(body.notes, 'observaciones', { required: false, max: 500 }) : (current.notes ?? null),
    is_active: body.is_active === undefined ? (current.is_active ?? 1) : v.bool(body.is_active)
  };
}

function assertDocFree(document, exceptId = 0) {
  const other = db.prepare('SELECT id, name FROM partners WHERE document = ? AND id != ?').get(document, exceptId);
  if (other) fail(`La cedula ${document} ya esta registrada a nombre de ${other.name}.`);
}

router.post('/partners', requirePerm('partners.manage'), asyncH((req, res) => {
  const d = partnerData(req.body);
  assertDocFree(d.document);
  const id = db.prepare(`INSERT INTO partners (name, document, phone, notes, is_active)
    VALUES (@name,@document,@phone,@notes,@is_active)`).run(d).lastInsertRowid;
  audit(req, { action: 'create', entity: 'partners', entityId: id, description: `Socio "${d.name}" (CC ${d.document}) agregado` });
  res.status(201).json(db.prepare('SELECT * FROM partners WHERE id = ?').get(id));
}));

/**
 * Carga varios socios de una vez. Cada linea: "cedula, nombre" o "nombre, cedula"
 * (tambien acepta tabulador o punto y coma, para pegar desde Excel).
 * Las cedulas que ya existen se saltan sin tocar nada.
 */
router.post('/partners/bulk', requirePerm('partners.manage'), asyncH((req, res) => {
  const text = String(req.body.text || '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) fail('Pega al menos una linea con cedula y nombre.');
  if (lines.length > 500) fail('Maximo 500 socios por carga.');

  const result = { created: [], skipped: [], errors: [] };
  tx(() => {
    const ins = db.prepare('INSERT INTO partners (name, document, phone) VALUES (?,?,?)');
    const exists = db.prepare('SELECT name FROM partners WHERE document = ?');
    lines.forEach((line, i) => {
      const parts = line.split(/[,;\t]/).map(x => x.trim()).filter(Boolean);
      // El primer numero es la cedula; un segundo numero, si viene, es el telefono.
      const numeros = parts.filter(x => /^[\d.\s+()-]{4,}$/.test(x));
      const doc = partners.normalizeDoc(numeros[0]);
      const phone = numeros[1] ? numeros[1].slice(0, 40) : null;
      const name = parts.filter(x => !numeros.includes(x)).join(' ').trim();
      if (!doc || doc.length < 4 || doc.length > 20) return result.errors.push(`Linea ${i + 1}: no encontre una cedula valida`);
      if (!name) return result.errors.push(`Linea ${i + 1}: falta el nombre`);
      const ex = exists.get(doc);
      if (ex) return result.skipped.push(`${doc} (ya estaba: ${ex.name})`);
      ins.run(name.slice(0, 120), doc, phone);
      result.created.push(`${name} (${doc})`);
    });
  });
  if (result.created.length) {
    audit(req, { action: 'create', entity: 'partners', description: `Carga de socios: ${result.created.length} agregado(s)` });
  }
  res.json(result);
}));

router.put('/partners/:id', requirePerm('partners.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare('SELECT * FROM partners WHERE id = ?').get(id);
  if (!before) fail('El socio no existe.', 404);
  const d = partnerData(req.body, before);
  assertDocFree(d.document, id);
  db.prepare(`UPDATE partners SET name=@name, document=@document, phone=@phone, notes=@notes,
    is_active=@is_active, updated_at=datetime('now','localtime') WHERE id=${id}`).run(d);
  audit(req, { action: 'update', entity: 'partners', entityId: id, description: `Socio ${d.name}: ` + describeChanges(before, d) });
  res.json(db.prepare('SELECT * FROM partners WHERE id = ?').get(id));
}));

router.delete('/partners/:id', requirePerm('partners.manage'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const p = db.prepare('SELECT * FROM partners WHERE id = ?').get(id);
  if (!p) fail('El socio no existe.', 404);
  const used = db.prepare('SELECT COUNT(*) c FROM orders WHERE partner_id = ?').get(id).c;
  if (used > 0) fail('Este socio ya tiene compras con descuento. No se borra para no perder el historial: desactivalo.');
  db.prepare('DELETE FROM partners WHERE id = ?').run(id);
  audit(req, { action: 'delete', entity: 'partners', entityId: id, description: `Socio "${p.name}" (CC ${p.document}) eliminado` });
  res.json({ ok: true });
}));

// =====================================================================
// Aplicar o quitar el beneficio en una cuenta
// =====================================================================
router.post('/orders/:id/partner', requirePerm('orders.create', 'orders.edit'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const r = partners.apply(id, req.body.document, req.user.id);
  audit(req, {
    action: 'discount', entity: 'orders', entityId: id,
    description: `${req.user.name} aplico descuento de socio (${r.pct}%) a ${r.partner.name} CC ${r.partner.document} ` +
      `en la orden #${r.order.number}: -$${r.order.discount_amount}. Uso ${r.used} de ${r.limit} de ${r.month}`
  });
  res.json(r);
}));

router.delete('/orders/:id/partner', requirePerm('orders.create', 'orders.edit'), asyncH((req, res) => {
  const id = v.int(req.params.id, 'id');
  const before = db.prepare(`SELECT o.number, p.name, p.document FROM orders o
    JOIN partners p ON p.id = o.partner_id WHERE o.id = ?`).get(id);
  const order = partners.remove(id);
  audit(req, {
    action: 'discount', entity: 'orders', entityId: id,
    description: `${req.user.name} quito el descuento de socio de ${before?.name} CC ${before?.document} en la orden #${order.number}`
  });
  res.json(order);
}));

module.exports = router;
