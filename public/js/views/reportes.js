import { api } from '../api.js';
import {
  esc, money, qty, pct, can, notifyError, dataTable, rangeSelector, bindRange,
  barChart, dateTime, dateOnly, tagFor
} from '../ui.js';

let query = { range: 'month' };
let type = 'sales';

const REPORTS = [
  ['sales', 'Ventas detalladas'],
  ['by_day', 'Ventas por dia'],
  ['by_hour', 'Ventas por hora'],
  ['by_month', 'Ventas por mes'],
  ['products', 'Productos mas vendidos'],
  ['slow_products', 'Productos menos vendidos'],
  ['categories', 'Ventas por categoria'],
  ['waiters', 'Ventas por mesero'],
  ['tables', 'Ventas por mesa'],
  ['payments', 'Metodos de pago'],
  ['profitability', 'Rentabilidad'],
  ['expenses', 'Gastos'],
  ['discounts', 'Descuentos aplicados'],
  ['voids', 'Ventas anuladas'],
  ['purchases', 'Compras'],
  ['inventory', 'Inventario actual'],
  ['movements', 'Movimientos de inventario'],
  ['cash', 'Cierres de caja']
];

const COLUMNS = {
  sales: [
    { label: 'Venta', render: r => '#' + esc(r.number) },
    { label: 'Fecha', render: r => dateTime(r.closed_at) },
    { label: 'Mesa', render: r => esc(r.table_name || 'Mostrador') },
    { label: 'Mesero', render: r => esc(r.waiter_name || '—') },
    { label: 'Pago', render: r => esc(r.methods || '—') },
    { label: 'Descuento', num: true, render: r => money(r.discount_amount) },
    { label: 'Total', num: true, render: r => `<strong>${money(r.total)}</strong>` }
  ],
  by_day: [
    { label: 'Dia', render: r => dateOnly(r.day) },
    { key: 'orders', label: 'Ordenes', num: true },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  by_hour: [
    { label: 'Hora', render: r => esc(r.hour) + ':00' },
    { key: 'orders', label: 'Ordenes', num: true },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  by_month: [
    { key: 'month', label: 'Mes' },
    { key: 'orders', label: 'Ordenes', num: true },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  products: [
    { key: 'product_name', label: 'Producto' },
    { key: 'category', label: 'Categoria' },
    { label: 'Cantidad', num: true, render: r => qty(r.quantity) },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  categories: [
    { key: 'name', label: 'Categoria' },
    { label: 'Cantidad', num: true, render: r => qty(r.quantity) },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  waiters: [
    { key: 'name', label: 'Mesero' },
    { key: 'orders', label: 'Ordenes', num: true },
    { label: 'Ticket promedio', num: true, render: r => money(r.average_ticket) },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  tables: [
    { key: 'name', label: 'Mesa' },
    { key: 'zone', label: 'Zona' },
    { key: 'orders', label: 'Ordenes', num: true },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  payments: [
    { key: 'name', label: 'Metodo' },
    { key: 'count', label: 'Pagos', num: true },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  profitability: [
    { key: 'product_name', label: 'Producto' },
    { label: 'Vendidos', num: true, render: r => qty(r.quantity) },
    { label: 'Ingresos', num: true, render: r => money(r.revenue) },
    { label: 'Costo', num: true, render: r => money(r.cost) },
    { label: 'Utilidad', num: true, render: r => `<strong>${money(r.profit)}</strong>` },
    { label: 'Margen', num: true, render: r => pct(r.margin_pct) }
  ],
  expenses: [
    { label: 'Fecha', render: r => dateOnly(r.expense_date) },
    { key: 'category_name', label: 'Categoria' },
    { key: 'description', label: 'Descripcion' },
    { label: 'Valor', num: true, render: r => money(r.amount) }
  ],
  discounts: [
    { label: 'Venta', render: r => '#' + esc(r.number) },
    { label: 'Fecha', render: r => dateTime(r.closed_at) },
    { key: 'discount_reason', label: 'Motivo' },
    { key: 'authorized_by', label: 'Autorizo' },
    { label: 'Descuento', num: true, render: r => money(r.discount_amount) },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  voids: [
    { label: 'Venta', render: r => '#' + esc(r.number) },
    { label: 'Fecha', render: r => dateTime(r.voided_at) },
    { key: 'void_reason', label: 'Motivo' },
    { key: 'voided_by', label: 'Anulo' },
    { label: 'Valor', num: true, render: r => money(r.total) }
  ],
  purchases: [
    { label: 'Fecha', render: r => dateOnly(r.purchase_date) },
    { key: 'supplier_name', label: 'Proveedor' },
    { key: 'invoice_number', label: 'Factura' },
    { label: 'Total', num: true, render: r => money(r.total) }
  ],
  inventory: [
    { key: 'code', label: 'Codigo' },
    { key: 'name', label: 'Producto' },
    { key: 'category', label: 'Categoria' },
    { label: 'Stock', num: true, render: r => `${qty(r.stock)} ${esc(r.unit)}` },
    { label: 'Costo', num: true, render: r => money(r.cost) },
    { label: 'Valor', num: true, render: r => money(r.stock_value) }
  ],
  movements: [
    { label: 'Fecha', render: r => dateTime(r.created_at) },
    { key: 'product_name', label: 'Producto' },
    { key: 'type', label: 'Tipo' },
    { label: 'Entrada', num: true, render: r => r.direction === 'in' ? qty(r.quantity) : '' },
    { label: 'Salida', num: true, render: r => r.direction === 'out' ? qty(r.quantity) : '' },
    { label: 'Saldo', num: true, render: r => qty(r.balance) },
    { key: 'user_name', label: 'Usuario' }
  ],
  cash: [
    { label: 'Apertura', render: r => dateTime(r.opened_at) },
    { label: 'Cierre', render: r => dateTime(r.closed_at) },
    { key: 'opened_by_name', label: 'Abrio' },
    { label: 'Base', num: true, render: r => money(r.opening_amount) },
    { label: 'Esperado', num: true, render: r => r.expected_amount === null ? '—' : money(r.expected_amount) },
    { label: 'Contado', num: true, render: r => r.counted_amount === null ? '—' : money(r.counted_amount) },
    { label: 'Diferencia', num: true, render: r => r.difference === null ? '—' : money(r.difference) },
    { label: 'Estado', render: r => tagFor(r.status) }
  ]
};
COLUMNS.slow_products = COLUMNS.products;

export async function render(host) { await load(host); }

async function load(host) {
  let data;
  try { data = await api.get(`/reports/${type}`, query); }
  catch (e) { return notifyError(e); }

  const showProfit = can('reports.profit');

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="row wrap">
          <select id="typeSel" style="width:auto;max-width:260px">
            ${REPORTS.filter(([v]) => v !== 'profitability' || showProfit)
      .map(([v, l]) => `<option value="${v}"${v === type ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          ${rangeSelector(query.range || 'custom')}
        </div>
        ${can('reports.export') ? `<button class="btn" id="export">Exportar CSV</button>` : ''}
      </div>

      <div class="grid grid-kpi mb">
        ${kpi('Ventas', money(data.kpis.sales))}
        ${kpi('Ordenes', String(data.kpis.orders))}
        ${kpi('Ticket promedio', money(data.kpis.average_ticket))}
        ${kpi('Descuentos', money(data.kpis.discounts))}
        ${showProfit ? kpi('Utilidad bruta', money(data.kpis.gross_profit), `Margen ${pct(data.kpis.margin_pct)}`) : ''}
        ${showProfit ? kpi('Gastos', money(data.kpis.expenses)) : ''}
        ${showProfit ? kpi('Utilidad neta', money(data.kpis.net_profit)) : ''}
        ${kpi('Anuladas', String(data.kpis.voided_count), money(data.kpis.voided_total))}
      </div>

      ${['by_day', 'by_hour', 'by_month'].includes(type) ? `<div class="mb">${barChart(
        data.rows.map(r => ({ label: String(r.day || r.hour || r.month).slice(-5), value: r.total })), { height: 220 })}</div>` : ''}

      <div class="small muted mb">${data.rows.length} registro(s) · del ${dateOnly(data.range.from)} al ${dateOnly(data.range.to)}</div>

      ${dataTable(COLUMNS[type] || autoColumns(data.rows), data.rows,
      { empty: 'No hay datos para este reporte en el periodo elegido.' })}
    </div>`;

  host.querySelector('#typeSel').onchange = e => { type = e.target.value; load(host); };
  bindRange(host, q => { query = { ...q, range: q.range || null }; load(host); });

  const ex = host.querySelector('#export');
  if (ex) ex.onclick = () => api.download(`/reports/${type}`, { ...query, format: 'csv' },
    `elchupe-${type}.csv`);
}

function autoColumns(rows) {
  if (!rows.length) return [{ label: 'Sin datos' }];
  return Object.keys(rows[0]).slice(0, 8).map(k => ({ key: k, label: k }));
}

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(value)}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
}
