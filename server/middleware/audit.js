'use strict';
const { db } = require('../db/connection');

const insert = db.prepare(`INSERT INTO audit_logs
  (user_id, user_name, action, entity, entity_id, description, old_value, new_value, ip)
  VALUES (?,?,?,?,?,?,?,?,?)`);

/**
 * Registra una accion en la auditoria.
 * audit(req, { action, entity, entityId, description, oldValue, newValue })
 */
function audit(req, { action, entity, entityId = null, description = null, oldValue = null, newValue = null }) {
  try {
    insert.run(
      req.user?.id || null,
      req.user?.name || 'sistema',
      action,
      entity,
      entityId,
      description,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      req.ip || null
    );
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e.message);
  }
}

/** Compara dos objetos y devuelve texto legible de los cambios. */
function describeChanges(before, after, labels = {}) {
  const parts = [];
  for (const key of Object.keys(after)) {
    if (before[key] === undefined) continue;
    if (String(before[key]) !== String(after[key])) {
      parts.push(`${labels[key] || key}: ${before[key]} -> ${after[key]}`);
    }
  }
  return parts.join(' | ');
}

module.exports = { audit, describeChanges };
