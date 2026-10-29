import { api } from '../api.js';
import { esc, money, can, toast, notifyError, formModal, confirmAction, dataTable } from '../ui.js';

export async function render(host) { await load(host); }

async function load(host) {
  let rows;
  try { rows = await api.get('/suppliers'); }
  catch (e) { return notifyError(e); }

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Proveedores</h2>
        ${can('suppliers.manage') ? `<button class="btn btn-primary" id="new">Nuevo proveedor</button>` : ''}
      </div>
      ${dataTable([
    { label: 'Nombre', render: s => `<strong>${esc(s.name)}</strong>${s.is_active ? '' : ' <span class="tag tag-mute">inactivo</span>'}` },
    { key: 'company', label: 'Empresa' },
    { key: 'phone', label: 'Telefono' },
    { key: 'email', label: 'Correo' },
    { key: 'purchases', label: 'Compras', num: true },
    { label: 'Comprado', num: true, render: s => money(s.purchased_total) },
    ...(can('suppliers.manage') ? [{
      label: '', render: s => `<div class="row" style="justify-content:flex-end">
        <button class="btn btn-sm" data-edit="${s.id}">Editar</button>
        <button class="btn btn-sm btn-danger" data-del="${s.id}">Eliminar</button></div>`
    }] : [])
  ], rows, { empty: 'Aun no hay proveedores registrados.' })}
    </div>`;

  const fields = s => [
    { name: 'name', label: 'Nombre', required: true, value: s?.name || '' },
    { name: 'company', label: 'Empresa', value: s?.company || '' },
    { name: 'document', label: 'Identificacion / NIT', value: s?.document || '' },
    { name: 'phone', label: 'Telefono', value: s?.phone || '' },
    { name: 'whatsapp', label: 'WhatsApp', value: s?.whatsapp || '' },
    { name: 'email', label: 'Correo', type: 'email', value: s?.email || '' },
    { name: 'address', label: 'Direccion', value: s?.address || '', full: true },
    { name: 'notes', label: 'Observaciones', type: 'textarea', value: s?.notes || '', full: true }
  ];

  const btn = host.querySelector('#new');
  if (btn) btn.onclick = () => formModal({
    title: 'Nuevo proveedor', fields: fields(null), size: 'wide',
    onSubmit: async (values, close) => { await api.post('/suppliers', values); close(); toast('Proveedor creado.'); load(host); }
  });

  host.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const s = rows.find(x => x.id === Number(b.dataset.edit));
    formModal({
      title: `Editar ${s.name}`, size: 'wide',
      fields: [...fields(s), { name: 'is_active', label: 'Proveedor activo', type: 'checkbox', value: !!s.is_active }],
      onSubmit: async (values, close) => { await api.put(`/suppliers/${s.id}`, values); close(); toast('Proveedor actualizado.'); load(host); }
    });
  });

  host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const s = rows.find(x => x.id === Number(b.dataset.del));
    confirmAction({
      title: 'Eliminar proveedor', danger: true, confirmLabel: 'Eliminar',
      message: `Se eliminara "${s.name}".`,
      onConfirm: async () => {
        try { await api.del(`/suppliers/${s.id}`); toast('Proveedor eliminado.'); load(host); }
        catch (e) { notifyError(e); }
      }
    });
  });
}
