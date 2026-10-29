import { api } from '../api.js';
import { esc, qty, notifyError, elapsed, toast } from '../ui.js';

let station = 'all';

export async function render(host) {
  await paint(host);
  // El temporizador se guarda aqui adentro, no en una variable compartida:
  // si dos pantallas se montan seguidas, cada una apaga el suyo y no el ajeno.
  const reloj = setInterval(() => {
    // Si esta pantalla ya no esta visible, el temporizador se apaga solo.
    if (!host.isConnected) return clearInterval(reloj);
    paint(host, true);
  }, 12000);
  return () => clearInterval(reloj);
}

async function paint(host, silent = false) {
  let items;
  try { items = await api.get('/kds', { station }); }
  catch (e) { if (!silent) notifyError(e); return; }

  const groups = ['pending', 'preparing', 'ready'];
  const labels = { pending: 'Pendientes', preparing: 'En preparacion', ready: 'Listos para entregar' };

  host.innerHTML = `
    <div class="card-head">
      <div class="cat-strip">
        ${[['all', 'Todo'], ['kitchen', 'Cocina'], ['bar', 'Bar']].map(([v, l]) =>
    `<button class="cat-chip ${station === v ? 'active' : ''}" data-st="${v}">${l}</button>`).join('')}
      </div>
      <span class="small dim">${items.length} producto(s) en curso · se actualiza solo</span>
    </div>

    ${items.length === 0 ? `<div class="card"><div class="empty">
      <strong>Nada pendiente</strong>Cuando los meseros envien ordenes apareceran aqui.</div></div>` : ''}

    ${groups.map(g => {
    const list = items.filter(i => i.kds_status === g);
    if (list.length === 0) return '';
    return `<section class="zone-block">
        <div class="zone-title">${labels[g]} · ${list.length}</div>
        <div class="kds-grid">${list.map(card).join('')}</div>
      </section>`;
  }).join('')}`;

  host.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { station = b.dataset.st; paint(host); });

  host.querySelectorAll('[data-advance]').forEach(b => b.onclick = async () => {
    try {
      await api.put(`/kds/${b.dataset.advance}`, { status: b.dataset.next });
      paint(host);
    } catch (e) { notifyError(e); }
  });
}

function card(i) {
  const next = { pending: ['preparing', 'Empezar'], preparing: ['ready', 'Marcar listo'], ready: ['delivered', 'Entregado'] }[i.kds_status];
  return `<article class="kds-card ${i.kds_status}">
    <div class="kds-head">
      <strong>${esc(i.table_name || 'Mostrador')}</strong>
      <span class="small dim">#${esc(i.order_number)} · ${esc(elapsed(i.sent_at))}</span>
    </div>
    <div class="kds-body">
      <div class="kds-product">${qty(i.quantity)} × ${esc(i.product_name)}</div>
      ${i.notes ? `<div class="small" style="color:var(--ambar);margin-top:5px">→ ${esc(i.notes)}</div>` : ''}
      <div class="small dim mt">${i.station === 'kitchen' ? 'Cocina' : 'Bar'} · ${esc(i.waiter_name || '')}</div>
    </div>
    <div class="kds-actions">
      <button class="btn btn-sm btn-ok btn-block" data-advance="${i.id}" data-next="${next[0]}">${next[1]}</button>
    </div>
  </article>`;
}
