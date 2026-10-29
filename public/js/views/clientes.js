import { api } from '../api.js';
import {
  esc, money, can, toast, notifyError, modal, formModal, confirmAction,
  dataTable, dateTime, dateOnly, debounce
} from '../ui.js';

let search = '';

export async function render(host) { await load(host); }

async function load(host) {
  let rows;
  try { rows = await api.get('/customers', { search }); }
  catch (e) { return notifyError(e); }

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Clientes</h2>
        ${can('customers.manage') ? `<button class="btn btn-primary" id="new">Nuevo cliente</button>` : ''}
      </div>
      <input type="search" id="search" class="mb" placeholder="Buscar por nombre, documento o telefono…"
        value="${esc(search)}" style="max-width:320px">
      ${dataTable([
    { label: 'Nombre', render: c => `<strong>${esc(c.name)}</strong>` },
    { key: 'document', label: 'Documento' },
    { key: 'phone', label: 'Telefono' },
    { key: 'visits', label: 'Visitas', num: true },
    { label: 'Total gastado', num: true, render: c => money(c.spent) },
    { label: 'Ultima visita', render: c => c.last_visit ? dateTime(c.last_visit) : '—' },
    { label: '', render: c => `<button class="btn btn-sm" data-open="${c.id}">Ver</button>` }
  ], rows, { empty: 'Aun no hay clientes registrados.' })}
    </div>`;

  const input = host.querySelector('#search');
  input.oninput = debounce(() => { search = input.value.trim(); load(host); }, 300);

  const fields = c => [
    { name: 'name', label: 'Nombre', required: true, value: c?.name || '' },
    { name: 'document', label: 'Documento', value: c?.document || '' },
    { name: 'phone', label: 'Telefono', value: c?.phone || '' },
    { name: 'email', label: 'Correo', type: 'email', value: c?.email || '' },
    { name: 'birthdate', label: 'Fecha de nacimiento', type: 'date', value: c?.birthdate || '' },
    { name: 'notes', label: 'Observaciones', type: 'textarea', value: c?.notes || '', full: true }
  ];

  const btn = host.querySelector('#new');
  if (btn) btn.onclick = () => formModal({
    title: 'Nuevo cliente', fields: fields(null),
    onSubmit: async (values, close) => { await api.post('/customers', values); close(); toast('Cliente creado.'); load(host); }
  });

  host.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
    const id = Number(b.dataset.open);
    try {
      const c = await api.get(`/customers/${id}`);
      modal({
        title: c.name,
        size: 'wide',
        body: `
          <div class="grid grid-3 mb">
            <div><div class="tiny dim">Documento</div>${esc(c.document || '—')}</div>
            <div><div class="tiny dim">Telefono</div>${esc(c.phone || '—')}</div>
            <div><div class="tiny dim">Correo</div>${esc(c.email || '—')}</div>
            <div><div class="tiny dim">Cumpleanos</div>${esc(c.birthdate ? dateOnly(c.birthdate) : '—')}</div>
          </div>
          ${c.notes ? `<p class="small muted mb">${esc(c.notes)}</p>` : ''}
          <div class="card-head"><h2>Historial de compras</h2></div>
          ${dataTable([
          { label: 'Venta', render: o => '#' + esc(o.number) },
          { label: 'Fecha', render: o => dateTime(o.closed_at) },
          { label: 'Total', num: true, render: o => money(o.total) }
        ], c.orders, { empty: 'Este cliente aun no tiene compras.' })}`,
        buttons: [
          { label: 'Cerrar' },
          ...(can('customers.manage') ? [{
            label: 'Editar', kind: 'btn-primary',
            action: close => {
              close();
              formModal({
                title: `Editar ${c.name}`, fields: fields(c),
                onSubmit: async (values, cl) => { await api.put(`/customers/${c.id}`, values); cl(); toast('Cliente actualizado.'); load(host); }
              });
            }
          }] : [])
        ]
      });
    } catch (e) { notifyError(e); }
  });
}
