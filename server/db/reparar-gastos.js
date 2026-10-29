'use strict';
/**
 * Repara los gastos que quedaron sueltos de la caja.
 *
 * Hasta la version 1.4.2, un gasto anotado sin decir como se pago quedaba sin
 * metodo de pago y sin caja asociada. La consecuencia era que ese gasto se veia
 * en la pantalla de Gastos pero NO se restaba al cerrar caja, y el arqueo daba
 * de mas.
 *
 * Este comando:
 *   1. Busca los gastos sin caja asociada.
 *   2. Los conecta con la caja que estaba abierta en ese momento.
 *   3. Les pone metodo de pago "efectivo" (que es de donde salio la plata).
 *   4. Crea el movimiento de caja que faltaba.
 *   5. Recalcula el esperado y la diferencia de las cajas ya cerradas.
 *
 * Es seguro correrlo varias veces: lo que ya esta bien no se toca.
 *
 * Uso:
 *   npm run reparar          -> muestra que encontro, SIN cambiar nada
 *   npm run reparar -- --si  -> aplica los cambios
 */
const { db, tx } = require('./connection');
const { rc, r2 } = require('../utils/money');

const APLICAR = process.argv.includes('--si') || process.argv.includes('--aplicar');

const money = n => '$' + Math.round(n).toLocaleString('es-CO');

function main() {
  const efectivo = db.prepare(`SELECT * FROM payment_methods
    WHERE affects_cash = 1 AND is_active = 1 ORDER BY sort_order LIMIT 1`).get();

  if (!efectivo) {
    console.error('\n  No hay ningun metodo de pago de efectivo configurado.');
    console.error('  Crealo en Ajustes > Metodos de pago y vuelve a correr esto.\n');
    process.exit(1);
  }

  const sueltos = db.prepare(`SELECT * FROM expenses
    WHERE cash_register_id IS NULL ORDER BY id`).all();

  if (sueltos.length === 0) {
    console.log('\n  Todo en orden: no hay gastos sueltos.\n');
    return;
  }

  console.log(`\n  Encontre ${sueltos.length} gasto(s) que no estaban conectados a ninguna caja.\n`);

  const conectados = [];
  const sinCaja = [];

  for (const g of sueltos) {
    // La caja que estaba abierta cuando se anoto el gasto
    const caja = db.prepare(`SELECT * FROM cash_registers
      WHERE opened_at <= ?
        AND (closed_at IS NULL OR closed_at >= ?)
      ORDER BY id DESC LIMIT 1`).get(g.created_at, g.created_at);

    if (caja) conectados.push({ gasto: g, caja });
    else sinCaja.push(g);
  }

  if (conectados.length) {
    console.log('  SE VAN A CONECTAR:\n');
    conectados.forEach(({ gasto, caja }) => {
      console.log(`    ${gasto.expense_date}  ${gasto.description.padEnd(28).slice(0, 28)} ` +
        `${money(gasto.amount).padStart(12)}   -> caja #${caja.id} (${caja.status === 'open' ? 'abierta' : 'cerrada'})`);
    });
    const suma = conectados.reduce((s, c) => s + c.gasto.amount, 0);
    console.log(`\n    Total que se va a empezar a restar del arqueo: ${money(suma)}\n`);
  }

  if (sinCaja.length) {
    console.log('  NO SE PUEDEN CONECTAR (no habia caja abierta en ese momento):\n');
    sinCaja.forEach(g => {
      console.log(`    ${g.expense_date}  ${g.description.padEnd(28).slice(0, 28)} ${money(g.amount).padStart(12)}`);
    });
    console.log('\n    Estos quedan como gastos del negocio y si cuentan en los reportes,');
    console.log('    pero no afectan ningun arqueo porque no salieron de una caja abierta.\n');
  }

  if (!APLICAR) {
    console.log('  --------------------------------------------------------------');
    console.log('  Esto fue solo una revision. No se cambio nada.');
    console.log('  Para aplicarlo de verdad:   npm run reparar -- --si');
    console.log('  --------------------------------------------------------------\n');
    return;
  }

  const cajasTocadas = new Set();

  tx(() => {
    for (const { gasto, caja } of conectados) {
      db.prepare(`UPDATE expenses
        SET cash_register_id = ?, payment_method_id = COALESCE(payment_method_id, ?)
        WHERE id = ?`).run(caja.id, efectivo.id, gasto.id);

      // El movimiento de caja que nunca se creo
      const yaExiste = db.prepare(`SELECT id FROM cash_movements
        WHERE reference_type = 'expense' AND reference_id = ?`).get(gasto.id);

      if (!yaExiste) {
        db.prepare(`INSERT INTO cash_movements
          (cash_register_id, user_id, type, amount, concept, reference_type, reference_id, payment_method_id, created_at)
          VALUES (?,?,'expense',?,?,'expense',?,?,?)`).run(
          caja.id, gasto.user_id, -rc(gasto.amount),
          'Gasto: ' + gasto.description, gasto.id, efectivo.id, gasto.created_at);
      }

      cajasTocadas.add(caja.id);
    }

    // Recalcular las cajas cerradas que cambiaron
    for (const id of cajasTocadas) {
      const caja = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(id);
      if (caja.status !== 'closed') continue;

      const cashSales = db.prepare(`SELECT COALESCE(SUM(p.amount),0) t FROM payments p
        JOIN payment_methods pm ON pm.id = p.payment_method_id
        WHERE p.cash_register_id = ? AND p.is_void = 0 AND pm.affects_cash = 1`).get(id).t;

      const mv = db.prepare(`SELECT type, COALESCE(SUM(amount),0) total FROM cash_movements
        WHERE cash_register_id = ? GROUP BY type`).all(id);
      const porTipo = Object.fromEntries(mv.map(m => [m.type, m.total]));

      const gastos = db.prepare(`SELECT COALESCE(SUM(e.amount),0) t FROM expenses e
        LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
        WHERE e.cash_register_id = ?
          AND (pm.affects_cash = 1 OR e.payment_method_id IS NULL)`).get(id).t;

      const retiros = Math.abs(porTipo.withdrawal || 0);
      const extra = r2((porTipo.income || 0) - caja.opening_amount);
      const devoluciones = Math.abs(porTipo.refund || 0);

      const esperado = rc(caja.opening_amount + cashSales + extra - retiros - gastos - devoluciones);
      const diferencia = caja.counted_amount === null ? null : rc(caja.counted_amount - esperado);

      db.prepare('UPDATE cash_registers SET expected_amount = ?, difference = ? WHERE id = ?')
        .run(esperado, diferencia, id);

      console.log(`  Caja #${id} recalculada:  esperado ${money(caja.expected_amount)} -> ${money(esperado)}` +
        (diferencia !== null ? `  |  diferencia ahora: ${money(diferencia)}` : ''));
    }

    db.prepare(`INSERT INTO audit_logs (action, entity, description)
      VALUES ('update', 'expenses', ?)`).run(
      `Reparacion: ${conectados.length} gasto(s) conectados a su caja`);
  });

  console.log(`\n  Listo. ${conectados.length} gasto(s) conectados.`);
  console.log('  De ahora en adelante los arqueos ya restan los gastos.\n');
}

main();
