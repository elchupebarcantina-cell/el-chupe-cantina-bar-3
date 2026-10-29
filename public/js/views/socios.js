import { api } from '../api.js';
import {
  esc, money, can, toast, notifyError, modal, formModal, confirmAction,
  dataTable, dateTime, debounce, ayuda
} from '../ui.js';

let search = '';

export async function render(host) { await load(host); }

async function load(host) {
  let data;
  try { data = await api.get('/partners', { search }); }
  catch (e) { return notifyError(e); }

  const { rules, partners } = data;
  const activos = partners.filter(p => p.is_active);
  const usosMes = partners.reduce((s, p) => s + p.used_month, 0);
  const descMes = partners.reduce((s, p) => s + p.discount_month, 0);
  const manage = can('partners.manage');

  host.innerHTML = `
    ${ayuda('¿Qué es esta pantalla?', [
    'Aquí están los <strong>socios</strong>: las personas que invirtieron en El Chupe.',
    `Cada socio tiene <strong>${esc(rules.pct)}% de descuento</strong> en su cuenta, <strong>${esc(rules.uses)} veces al mes</strong>.`,
    'Para usarlo, la mesera abre la cuenta, toca <strong>★ Socio</strong> y escribe la cédula. El sistema hace el descuento solo.',
    'El cupo se <strong>renueva solo el día 1 de cada mes</strong>. No tienes que hacer nada.',
    'Para agregar socios toca <strong>Agregar socio</strong>, o <strong>Agregar varios</strong> si tienes la lista en Excel.'
  ], 'Si anulan una cuenta que tenía el descuento, o se lo quitan antes de cobrar, el socio recupera ese uso del mes.')}

    <div class="grid grid-kpi mb">
      ${kpi('Socios activos', String(activos.length), partners.length > activos.length ? `${partners.length - activos.length} inactivo(s)` : 'pueden usar el descuento')}
      ${kpi('Beneficio', `${rules.pct}%`, `${rules.uses} veces al mes por socio`)}
      ${kpi(`Usos en ${rules.month}`, String(usosMes), 'cuentas con descuento de socio')}
      ${kpi(`Descuento dado en ${rules.month}`, money(descMes), 'en cuentas ya cobradas')}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Socios</h2>
        <div class="row wrap">
          ${manage ? `
            <button class="btn" id="rules">Cambiar beneficio</button>
            <button class="btn" id="bulk">Agregar varios</button>
            <button class="btn btn-primary" id="new">Agregar socio</button>` : ''}
        </div>
      </div>
      <input type="search" id="search" class="mb" placeholder="Buscar por nombre, cédula o teléfono…"
        value="${esc(search)}" style="max-width:320px">
      ${dataTable([
    { label: 'Nombre', render: p => `<strong>${esc(p.name)}</strong>${p.is_active ? '' : ' <span class="tag">inactivo</span>'}` },
    { key: 'document', label: 'Cédula' },
    { label: 'Teléfono', render: p => esc(p.phone || '—') },
    {
      label: `Usos ${rules.month}`, render: p => {
        const lleno = p.used_month >= rules.uses;
        return `<span class="${lleno ? 'pos-neg' : ''}"><strong>${p.used_month}</strong> de ${rules.uses}</span>`;
      }
    },
    { label: 'Descuento del mes', num: true, render: p => money(p.discount_month) },
    { label: 'Descuento total', num: true, render: p => money(p.discount_total) },
    { label: 'Último uso', render: p => p.last_use ? dateTime(p.last_use) : '—' },
    { label: '', render: p => `<button class="btn btn-sm" data-open="${p.id}">Ver</button>` }
  ], partners, {
    empty: search ? 'Ningún socio coincide con la búsqueda.' : 'Todavía no hay socios.',
    emptyHint: !search && manage ? ' Toca "Agregar socio" para empezar.' : ''
  })}
    </div>`;

  const input = host.querySelector('#search');
  input.oninput = debounce(() => { search = input.value.trim(); load(host); }, 300);

  const on = (id, fn) => { const el = host.querySelector('#' + id); if (el) el.onclick = fn; };
  on('new', () => editPartner(null, host));
  on('bulk', () => bulkModal(host));
  on('rules', () => rulesModal(rules, host));

  host.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPartner(Number(b.dataset.open), rules, host));
}

function fields(p) {
  return [
    { name: 'name', label: 'Nombre completo', required: true, value: p?.name || '' },
    { name: 'document', label: 'Cédula', required: true, value: p?.document || '', placeholder: 'Solo números', help: 'Es lo que la mesera va a digitar al cobrar.' },
    { name: 'phone', label: 'Teléfono', value: p?.phone || '' },
    ...(p ? [{ name: 'is_active', label: 'Socio activo (puede usar el descuento)', type: 'checkbox', value: !!p.is_active, full: true }] : []),
    { name: 'notes', label: 'Observaciones', type: 'textarea', value: p?.notes || '', full: true, placeholder: 'Monto invertido, fecha de ingreso, lo que quieras anotar…' }
  ];
}

function editPartner(p, host) {
  formModal({
    title: p ? `Editar ${p.name}` : 'Agregar socio',
    fields: fields(p),
    submitLabel: p ? 'Guardar cambios' : 'Agregar socio',
    onSubmit: async (values, close) => {
      if (p) await api.put(`/partners/${p.id}`, values);
      else await api.post('/partners', values);
      close();
      toast(p ? 'Socio actualizado.' : 'Socio agregado. Ya puede usar su descuento.');
      load(host);
    }
  });
}

function bulkModal(host) {
  modal({
    title: 'Agregar varios socios',
    size: 'wide',
    body: `
      <p class="small muted mb">Pega la lista con <strong>un socio por línea</strong>: primero la cédula y después el nombre.
        Si quieres, al final el teléfono. Puedes copiar las columnas directo desde Excel.</p>
      <div class="field">
        <textarea id="bulkText" rows="10" placeholder="1073777762, Juan Pérez&#10;52987654, Laura Céspedes, 3016667788&#10;1013456789	Andrés Molina"></textarea>
      </div>
      <p class="small dim">Las cédulas que ya estén registradas se saltan sin cambiar nada.</p>
      <div id="bulkResult"></div>`,
    buttons: [
      { label: 'Cerrar' },
      {
        label: 'Agregar', kind: 'btn-primary',
        action: async (close, root) => {
          const text = root.querySelector('#bulkText').value;
          if (!text.trim()) return toast('Pega la lista primero.', 'warn');
          try {
            const r = await api.post('/partners/bulk', { text });
            const box = root.querySelector('#bulkResult');
            box.innerHTML = `
              <div class="banner mt">${r.created.length} socio(s) agregado(s)
                ${r.skipped.length ? ` · ${r.skipped.length} ya estaban` : ''}
                ${r.errors.length ? ` · ${r.errors.length} con problemas` : ''}</div>
              ${r.errors.length ? `<div class="small pos-neg">${r.errors.map(esc).join('<br>')}</div>` : ''}
              ${r.skipped.length ? `<div class="small dim mt">${r.skipped.map(esc).join('<br>')}</div>` : ''}`;
            if (r.created.length) {
              root.querySelector('#bulkText').value = '';
              toast(`${r.created.length} socio(s) agregado(s).`);
              load(host);
            }
          } catch (e) { notifyError(e); }
        }
      }
    ]
  });
}

function rulesModal(rules, host) {
  formModal({
    title: 'Beneficio de los socios',
    size: 'narrow',
    fields: [
      { name: 'pct', label: 'Porcentaje de descuento', type: 'number', value: rules.pct, min: 0.5, max: 100, step: '0.5', required: true },
      { name: 'uses', label: 'Veces por mes', type: 'number', value: rules.uses, min: 1, max: 31, step: '1', required: true, help: 'El cupo se renueva solo el día 1 de cada mes.' }
    ],
    onSubmit: async (values, close) => {
      await api.put('/partners/rules', values);
      close();
      toast('Beneficio actualizado. Aplica desde la próxima cuenta.');
      load(host);
    }
  });
}

async function openPartner(id, rules, host) {
  let p;
  try { p = await api.get(`/partners/${id}`); }
  catch (e) { return notifyError(e); }

  const estado = { paid: 'Pagada', void: 'Anulada (no cuenta)', open: 'Abierta', bill_requested: 'Pidió la cuenta' };

  modal({
    title: p.name,
    size: 'wide',
    body: `
      <div class="grid grid-3 mb">
        <div><div class="tiny dim">Cédula</div>${esc(p.document)}</div>
        <div><div class="tiny dim">Teléfono</div>${esc(p.phone || '—')}</div>
        <div><div class="tiny dim">Este mes</div><strong>${p.used_month} de ${rules.uses}</strong> usos
          ${p.is_active ? '' : ' · <span class="pos-neg">inactivo</span>'}</div>
      </div>
      ${p.notes ? `<p class="small muted mb">${esc(p.notes)}</p>` : ''}
      <div class="card-head"><h2>Compras con descuento</h2></div>
      ${dataTable([
      { label: 'Venta', render: o => '#' + esc(o.number) },
      { label: 'Fecha', render: o => dateTime(o.partner_applied_at) },
      { label: 'Mesa', render: o => esc(o.table_name || 'Mostrador') },
      { label: 'Atendió', render: o => esc(o.waiter_name || '—') },
      { label: 'Estado', render: o => esc(estado[o.status] || o.status) },
      { label: 'Descuento', num: true, render: o => money(o.discount_amount) },
      { label: 'Pagó', num: true, render: o => money(o.total) }
    ], p.orders, { empty: 'Todavía no ha usado su descuento.' })}`,
    buttons: [
      ...(can('partners.manage') && p.orders.length === 0 ? [{
        label: 'Eliminar', kind: 'btn-danger',
        action: close => {
          close();
          confirmAction({
            title: 'Eliminar socio', danger: true, confirmLabel: 'Eliminar',
            message: `Se elimina a ${p.name} de la lista de socios.`,
            onConfirm: async () => {
              try { await api.del(`/partners/${p.id}`); toast('Socio eliminado.'); load(host); }
              catch (e) { notifyError(e); }
            }
          });
        }
      }] : []),
      { label: 'Cerrar' },
      ...(can('partners.manage') ? [{
        label: 'Editar', kind: 'btn-primary',
        action: close => { close(); editPartner(p, host); }
      }] : [])
    ]
  });
}

function kpi(label, value, sub) {
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(value)}</div>
    <div class="kpi-sub">${esc(sub)}</div>
  </div>`;
}
