-- =====================================================================
-- EL CHUPE — Migracion 002: socios con descuento exclusivo
--
-- Los socios (inversionistas del negocio) reciben un descuento en sus
-- compras un numero limitado de veces por mes. El cupo se renueva solo el
-- primer dia de cada mes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS partners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  document    TEXT NOT NULL UNIQUE,      -- cedula, solo numeros y letras
  phone       TEXT,
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_partners_name ON partners(name);

-- Que socio uso el beneficio en cada cuenta y cuando lo uso.
-- El mes del uso es el mes de partner_applied_at.
ALTER TABLE orders ADD COLUMN partner_id INTEGER REFERENCES partners(id);
ALTER TABLE orders ADD COLUMN partner_applied_at TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_partner ON orders(partner_id, partner_applied_at);

-- Reglas del beneficio, editables desde la pantalla de Socios
ALTER TABLE business_settings ADD COLUMN partner_discount_pct REAL NOT NULL DEFAULT 5;
ALTER TABLE business_settings ADD COLUMN partner_monthly_uses INTEGER NOT NULL DEFAULT 2;
