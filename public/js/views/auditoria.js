import { api } from '../api.js';
import { esc, notifyError, dataTable, dateTime, debounce, modal, tagFor } from '../ui.js';

let filters = { search: '', action: '' };

export async function render(host) { await load(host); }

async function load(host) {
  let rows, attempts;
  try {
    [rows, attempts] = await Promise.all([
      api.get('/audit', { ...filters, limit: 300 }),
      api.get('/login-attempts').catch(() => [])
    ]);
  } catch (e) { return notifyError(e); }

  const actions = ['create', 'update', 'delete', 'void', 'discount', 'payment',
    'transfer', 'merge', 'split', 'inventory', 'cash_open', 'cash_close', 'cash_movement', 'login', 'backup'];

  host.innerHTML = `
    <div class="card mb">
      <div class="card-head">
        <h2>Auditoria</h2>
        <div class="row wrap">
          <input type="search" id="search" placeholder="Buscar en la descripcion…" value="${esc(filters.search)}" style="max-width:280px">
          <select id="actionSel" style="width:auto">
            <option value="">Todas las acciones</option>
            ${actions.map(a => `<option value="${a}"${filters.action === a ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
      </div>

      ${dataTable([
    { label: 'Fecha', render: r => dateTime(r.created_at) },
    { label: 'Usuario', render: r => esc(r.user_name || 'sistema') },
    { label: 'Accion', render: r => `<span class="tag tag-mute">${esc(r.action)}</span>` },
    { key: 'entity', label: 'Modulo' },
    { label: 'Detalle', render: r => esc(r.description || '') },
    {
      label: '', render: r => (r.old_value || r.new_value)
        ? `<button class="btn btn-sm" data-detail="${r.id}">Ver</button>` : ''
    }
  ], rows, { empty: 'No hay registros de auditoria con estos filtros.' })}
    </div>

    <div class="card">
      <div class="card-head"><h2>Intentos de acceso</h2></div>
      ${dataTable([
    { label: 'Fecha', render: r => dateTime(r.created_at) },
    { key: 'email', label: 'Usuario' },
    { key: 'ip', label: 'IP' },
    {
      label: 'Resultado',
      render: r => r.success ? '<span class="tag tag-ok">Exitoso</span>' : '<span class="tag tag-danger">Fallido</span>'
    }
  ], attempts.slice(0, 60), { empty: 'Sin intentos registrados.' })}
    </div>`;

  const search = host.querySelector('#search');
  search.oninput = debounce(() => { filters.search = search.value.trim(); load(host); }, 320);
  host.querySelector('#actionSel').onchange = e => { filters.action = e.target.value; load(host); };

  host.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => {
    const r = rows.find(x => x.id === Number(b.dataset.detail));
    modal({
      title: 'Detalle del cambio',
      body: `
        <p class="mb">${esc(r.description || '')}</p>
        <div class="grid grid-2">
          <div><div class="tiny dim mb">Valor anterior</div>
            <pre class="small" style="white-space:pre-wrap;background:var(--carbon);padding:10px;border-radius:6px">${esc(pretty(r.old_value))}</pre></div>
          <div><div class="tiny dim mb">Valor nuevo</div>
            <pre class="small" style="white-space:pre-wrap;background:var(--carbon);padding:10px;border-radius:6px">${esc(pretty(r.new_value))}</pre></div>
        </div>`
    });
  });
}

function pretty(json) {
  if (!json) return '—';
  try { return JSON.stringify(JSON.parse(json), null, 2); }
  catch (e) { return json; }
}
