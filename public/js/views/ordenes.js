import { api } from '../api.js';
import {
  esc, money, qty, can, toast, notifyError, modal, dataTable, tagFor,
  dateTime, rangeSelector, bindRange, promptReason, today
} from '../ui.js';
import { printTicket } from './pos.js';

let query = { status: 'paid', range: 'today' };

export async function render(host, params) {
  await load(host);
  if (params.id) openDetail(Number(params.id), host);
}

async function load(host) {
  let rows;
  try {
    rows = await api.get('/orders', {
      status: query.status,
      from: query.from || rangeFrom(query.range),
      to: query.to || today()
    });
  } catch (e) { return notifyError(e); }

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Ventas</h2>
        <div class="row wrap">
          <select id="statusSel" style="width:auto">
            <option value="paid"${query.status === 'paid' ? ' selected' : ''}>Pagadas</option>
            <option value="open"${query.status === 'open' ? ' selected' : ''}>Abiertas</option>
            <option value="bill_requested"${query.status === 'bill_requested' ? ' selected' : ''}>Cuenta pedida</option>
            <option value="void"${query.status === 'void' ? ' selected' : ''}>Anuladas</option>
          </select>
          ${rangeSelector(query.range || 'custom')}
        </div>
      </div>

      <div class="row-between mb small muted">
        <span>${rows.length} venta(s)</span>
        <span>Total: <strong>${money(rows.reduce((s, r) => s + (r.status === 'void' ? 0 : r.total), 0))}</strong></span>
      </div>

      ${dataTable([
    { label: '#', render: r => `<strong>${esc(r.number)}</strong>` },
    { label: 'Fecha', render: r => dateTime(r.closed_at || r.created_at) },
    { label: 'Mesa', render: r => esc(r.table_name || 'Mostrador') },
    { label: 'Mesero', render: r => esc(r.waiter_name || '—') },
    { label: 'Items', num: true, render: r => qty(r.items_count) },
    { label: 'Estado', render: r => tagFor(r.status) },
    { label: 'Total', num: true, render: r => `<strong>${money(r.total)}</strong>` },
    { label: '', render: r => `<button class="btn btn-sm" data-open="${r.id}">Ver</button>` }
  ], rows, { empty: 'No hay ventas con estos filtros.' })}
    </div>`;

  host.querySelector('#statusSel').onchange = e => { query.status = e.target.value; load(host); };
  bindRange(host, q => { query = { ...query, ...q, range: q.range || null }; load(host); });
  host.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openDetail(Number(b.dataset.open), host));
}

function rangeFrom(range) {
  const d = new Date();
  if (range === 'today') return today();
  if (range === 'yesterday') { d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  if (range === 'week') d.setDate(d.getDate() - 6);
  else if (range === 'month') d.setDate(1);
  else if (range === 'last30') d.setDate(d.getDate() - 29);
  else if (range === 'year') d.setMonth(0, 1);
  else return '2000-01-01';
  return d.toISOString().slice(0, 10);
}

async function openDetail(id, host) {
  let order;
  try { order = await api.get(`/orders/${id}`); }
  catch (e) { return notifyError(e); }

  const m = modal({
    title: `Venta #${order.number}`,
    size: 'wide',
    body: `
      <div class="grid grid-3 mb">
        <div><div class="tiny dim">Estado</div>${tagFor(order.status)}</div>
        <div><div class="tiny dim">Mesa</div>${esc(order.table_name || 'Mostrador')}</div>
        <div><div class="tiny dim">Mesero</div>${esc(order.waiter_name || '—')}</div>
        <div><div class="tiny dim">Abierta</div>${esc(dateTime(order.opened_at))}</div>
        <div><div class="tiny dim">Cerrada</div>${esc(dateTime(order.closed_at))}</div>
        <div><div class="tiny dim">Personas</div>${esc(order.guests)}</div>
      </div>

      ${order.status === 'void' ? `<div class="banner danger">
        Anulada: ${esc(order.void_reason)}</div>` : ''}

      ${dataTable([
      { key: 'product_name', label: 'Producto' },
      { label: 'Cant.', num: true, render: i => qty(i.quantity) },
      { label: 'Precio', num: true, render: i => money(i.unit_price) },
      { label: 'Total', num: true, render: i => money(i.total) }
    ], order.items)}

      <div class="card mt" style="background:var(--carbon)">
        <div class="row-between small"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
        ${order.discount_amount > 0 ? `<div class="row-between small">
          <span>Descuento ${order.discount_reason ? '· ' + esc(order.discount_reason) : ''}</span>
          <span class="pos-neg">-${money(order.discount_amount)}</span></div>` : ''}
        ${order.tax_amount > 0 ? `<div class="row-between small"><span>Impuestos</span><span>${money(order.tax_amount)}</span></div>` : ''}
        <div class="row-between" style="font-size:19px;font-weight:600;color:var(--oro);margin-top:6px">
          <span>Total</span><span>${money(order.total)}</span></div>
      </div>

      ${order.payments.length ? `<div class="mt">
        <div class="tiny dim mb">Pagos</div>
        ${order.payments.map(p => `<div class="row-between small" style="padding:5px 0;border-bottom:1px solid var(--borde)">
          <span>${esc(p.method_name)} ${p.reference ? `<span class="dim">· ${esc(p.reference)}</span>` : ''}</span>
          <span>${money(p.amount)}</span></div>`).join('')}
      </div>` : ''}`,
    buttons: [
      { label: 'Cerrar' },
      { label: 'Imprimir', action: () => printTicket(order) },
      ...(order.status !== 'void' && can('orders.void') ? [{
        label: 'Anular', kind: 'btn-danger',
        action: close => {
          close();
          promptReason({
            title: `Anular venta #${order.number}`,
            label: 'Motivo de la anulacion',
            confirmLabel: 'Anular venta',
            onConfirm: async reason => {
              try {
                await api.post(`/orders/${order.id}/void`, { reason });
                toast('Venta anulada. El inventario fue devuelto.');
                load(host);
              } catch (e) { notifyError(e); }
            }
          });
        }
      }] : []),
      ...(['open', 'bill_requested'].includes(order.status) && can('pos.use') ? [{
        label: 'Abrir en POS', kind: 'btn-primary',
        action: close => { close(); location.hash = `#/pos?order=${order.id}`; }
      }] : [])
    ]
  });
}
