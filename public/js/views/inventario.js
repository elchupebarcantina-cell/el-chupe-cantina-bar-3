import { api } from '../api.js';
import {
  esc, money, qty, can, toast, notifyError, modal, formModal, dataTable,
  tagFor, dateTime, debounce, ayuda
} from '../ui.js';

let filters = { search: '', alert: '' };

export async function render(host, params) {
  await load(host);
  if (params.product) openKardex(Number(params.product));
}

async function load(host) {
  let rows, categories;
  try {
    [rows, categories] = await Promise.all([
      api.get('/inventory', filters),
      api.get('/categories')
    ]);
  } catch (e) { return notifyError(e); }

  const totalValue = rows.reduce((s, r) => s + (r.stock_value || 0), 0);
  const showCost = can('products.cost');

  host.innerHTML = `
    ${ayuda('¿Cómo funciona el inventario?', [
      'Aquí ves <strong>cuánto te queda</strong> de cada cosa.',
      'Cuando vendes, el sistema descuenta solo. Si vendes un mojito, baja el ron, la hierbabuena y el hielo.',
      'Si algo se rompe o se lo tomaron, usa <strong>Registrar movimiento</strong> y anota el motivo.',
      'Una vez al mes haz un <strong>Conteo físico</strong>: cuentas lo que hay de verdad y el sistema se ajusta.'
    ], 'Las cosas en rojo o naranja son las que se están acabando. Cómpralas antes de que se agoten.')}

    <div class="card">
      <div class="card-head">
        <h2>Inventario</h2>
        <div class="row wrap">
          ${can('inventory.manage') ? `<button class="btn btn-primary" id="movement">Registrar movimiento</button>` : ''}
          ${can('inventory.manage') ? `<button class="btn" id="count">Conteo fisico</button>` : ''}
          ${can('reports.export') ? `<button class="btn btn-ghost" id="export">Exportar CSV</button>` : ''}
        </div>
      </div>

      <div class="row wrap mb">
        <input type="search" id="search" placeholder="Buscar producto…" value="${esc(filters.search)}" style="max-width:280px">
        <select id="alertFilter" style="width:auto">
          <option value="">Todo el inventario</option>
          <option value="1"${filters.alert === '1' ? ' selected' : ''}>Solo alertas</option>
        </select>
        ${showCost ? `<span class="grow right small muted">Valor del inventario: <strong>${money(totalValue)}</strong></span>` : ''}
      </div>

      ${dataTable([
    { key: 'code', label: 'Codigo' },
    { label: 'Producto', render: r => `<strong>${esc(r.name)}</strong>` },
    { label: 'Categoria', render: r => esc(r.category_name || '—') },
    { label: 'Stock', num: true, render: r => `${qty(r.stock)} ${esc(r.unit)}` },
    { label: 'Minimo', num: true, render: r => qty(r.min_stock) },
    { label: 'Estado', render: r => tagFor(r.level) },
    ...(showCost ? [{ label: 'Valor', num: true, render: r => money(r.stock_value) }] : []),
    { label: '', render: r => `<button class="btn btn-sm" data-kardex="${r.id}">Kardex</button>` }
  ], rows, { empty: 'No hay productos que coincidan.' })}
    </div>`;

  const search = host.querySelector('#search');
  search.oninput = debounce(() => { filters.search = search.value.trim(); load(host); }, 300);
  host.querySelector('#alertFilter').onchange = e => { filters.alert = e.target.value; load(host); };
  host.querySelectorAll('[data-kardex]').forEach(b => b.onclick = () => openKardex(Number(b.dataset.kardex)));

  const mv = host.querySelector('#movement');
  if (mv) mv.onclick = () => movementModal(rows, host);
  const ct = host.querySelector('#count');
  if (ct) ct.onclick = () => countModal(rows, host);
  const ex = host.querySelector('#export');
  if (ex) ex.onclick = () => api.download('/reports/inventory', { format: 'csv' }, 'elchupe-inventario.csv');
}

async function openKardex(productId) {
  let data;
  try { data = await api.get(`/inventory/kardex/${productId}`); }
  catch (e) { return notifyError(e); }

  const labels = {
    purchase: 'Compra', sale: 'Venta', adjustment: 'Ajuste', loss: 'Perdida',
    damage: 'Dano', internal: 'Consumo interno', return: 'Devolucion',
    initial: 'Inicial', void_return: 'Reintegro por anulacion'
  };

  modal({
    title: `Kardex · ${data.product.name}`,
    size: 'wide',
    body: `
      <div class="grid grid-3 mb">
        <div><div class="tiny dim">Codigo</div>${esc(data.product.code)}</div>
        <div><div class="tiny dim">Saldo actual</div><strong>${qty(data.product.stock)} ${esc(data.product.unit)}</strong></div>
        <div><div class="tiny dim">Movimientos</div>${data.movements.length}</div>
      </div>
      ${dataTable([
      { label: 'Fecha', render: m => dateTime(m.created_at) },
      { label: 'Movimiento', render: m => esc(labels[m.type] || m.type) },
      { label: 'Entrada', num: true, render: m => m.direction === 'in' ? qty(m.quantity) : '' },
      { label: 'Salida', num: true, render: m => m.direction === 'out' ? qty(m.quantity) : '' },
      { label: 'Saldo', num: true, render: m => `<strong>${qty(m.balance)}</strong>` },
      { label: 'Usuario', render: m => esc(m.user_name || 'sistema') },
      { label: 'Motivo', render: m => esc(m.reason || '') }
    ], data.movements.slice().reverse(), { empty: 'Este producto aun no tiene movimientos.' })}`
  });
}

function movementModal(rows, host) {
  formModal({
    title: 'Registrar movimiento de inventario',
    fields: [
      {
        name: 'product_id', label: 'Producto', type: 'select', required: true, full: true,
        options: rows.map(r => ({ value: r.id, label: `${r.name} (${qty(r.stock)} ${r.unit})` }))
      },
      {
        name: 'direction', label: 'Direccion', type: 'select', value: 'out',
        options: [{ value: 'in', label: 'Entrada' }, { value: 'out', label: 'Salida' }]
      },
      {
        name: 'type', label: 'Tipo', type: 'select', value: 'adjustment',
        options: [
          { value: 'adjustment', label: 'Ajuste' },
          { value: 'loss', label: 'Perdida' },
          { value: 'damage', label: 'Producto danado' },
          { value: 'internal', label: 'Consumo interno' },
          { value: 'return', label: 'Devolucion' }
        ]
      },
      { name: 'quantity', label: 'Cantidad', type: 'number', required: true, min: 0.01, step: '0.01' },
      { name: 'reason', label: 'Motivo', required: true, full: true, placeholder: 'Botella rota en barra' }
    ],
    submitLabel: 'Registrar',
    onSubmit: async (values, close) => {
      const r = await api.post('/inventory/movements', values);
      close();
      toast(`Movimiento registrado. Nuevo saldo: ${qty(r.balance)}.`);
      load(host);
    }
  });
}

function countModal(rows, host) {
  formModal({
    title: 'Conteo fisico',
    fields: [
      {
        name: 'product_id', label: 'Producto', type: 'select', required: true, full: true,
        options: rows.map(r => ({ value: r.id, label: `${r.name} — sistema: ${qty(r.stock)} ${r.unit}` }))
      },
      { name: 'counted', label: 'Cantidad contada', type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'reason', label: 'Observacion', full: true, placeholder: 'Conteo de fin de mes' }
    ],
    submitLabel: 'Ajustar al conteo',
    onSubmit: async (values, close) => {
      const r = await api.post('/inventory/count', values);
      close();
      toast(r.message || `Ajustado. Diferencia: ${qty(r.difference)}.`);
      load(host);
    }
  });
}
