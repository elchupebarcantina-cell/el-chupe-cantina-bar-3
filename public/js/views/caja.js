import { api } from '../api.js';
import {
  state, esc, money, can, toast, notifyError, modal, formModal, dataTable,
  tagFor, dateTime, printHtml, sep, ayuda
} from '../ui.js';

export async function render(host) { await load(host); }

async function load(host) {
  let current, registers;
  try {
    [current, registers] = await Promise.all([
      api.get('/cash/current'),
      api.get('/cash/registers')
    ]);
  } catch (e) { return notifyError(e); }

  const guia = ayuda('¿Para qué sirve la caja?', [
    '<strong>Al empezar el turno</strong> abres la caja y escribes con cuánta plata arrancas (la base).',
    'Durante el turno el sistema va sumando todo lo que cobras.',
    '<strong>Al terminar</strong> cierras la caja: cuentas la plata real y el sistema te dice si sobra o falta.',
    'La jornada del Resumen va desde que abres hasta que cierras, así la noche cuenta completa.'
  ], 'Sin caja abierta no se pueden cobrar cuentas. Ábrela apenas llegues.');

  host.innerHTML = guia + (current ? openView(current) : closedView());
  host.insertAdjacentHTML('beforeend', `
    <div class="card mt">
      <div class="card-head"><h2>Historial de cajas</h2></div>
      ${dataTable([
    { label: 'Apertura', render: r => dateTime(r.opened_at) },
    { label: 'Cierre', render: r => dateTime(r.closed_at) },
    { label: 'Abrio', render: r => esc(r.opened_by_name || '—') },
    { label: 'Cerro', render: r => esc(r.closed_by_name || '—') },
    { label: 'Base', num: true, render: r => money(r.opening_amount) },
    { label: 'Esperado', num: true, render: r => r.expected_amount === null ? '—' : money(r.expected_amount) },
    { label: 'Contado', num: true, render: r => r.counted_amount === null ? '—' : money(r.counted_amount) },
    {
      label: 'Diferencia', num: true,
      render: r => r.difference === null ? '—'
        : `<span class="${r.difference < 0 ? 'pos-neg' : r.difference > 0 ? 'pos-pos' : ''}">${money(r.difference)}</span>`
    },
    { label: 'Estado', render: r => tagFor(r.status) },
    { label: '', render: r => `<button class="btn btn-sm" data-reg="${r.id}">Ver</button>` }
  ], registers, { empty: 'Aun no se ha abierto ninguna caja.' })}
    </div>`);

  bind(host, current);
}

function closedView() {
  return `<div class="card caja-portada">
    <div class="caja-estado cerrada">
      <div class="caja-icono">🔒</div>
      <h2>La caja esta cerrada</h2>
      <p>Abre la caja con la base en efectivo del turno. Mientras este cerrada
         no se pueden cobrar cuentas.</p>
      ${can('cash.open')
      ? `<button class="btn btn-primary btn-xl" id="openCash">Abrir caja</button>`
      : `<p class="dim">No tienes permiso para abrir la caja.</p>`}
    </div>
  </div>`;
}

function openView(c) {
  return `
    <div class="card caja-portada mb">
      <div class="caja-estado abierta">
        <div class="caja-icono">🔓</div>
        <h2>Caja abierta</h2>
        <p>Desde las <strong>${esc(dateTime(c.opened_at))}</strong> ·
           la abrio ${esc(c.opened_by_name)}</p>
        ${can('cash.close')
      ? `<button class="btn btn-primary btn-xl" id="closeCash">Cerrar caja</button>`
      : `<p class="dim">No tienes permiso para cerrar la caja.</p>`}
      </div>
    </div>

    <div class="row wrap mb">
      ${can('cash.movement') ? `<button class="btn" id="income">Registrar ingreso</button>` : ''}
      ${can('cash.movement') ? `<button class="btn" id="withdraw">Registrar retiro</button>` : ''}
      <button class="btn btn-ghost" id="printCash">Imprimir arqueo</button>
    </div>

    <div class="grid grid-kpi mb">
      ${kpi('Base inicial', money(c.opening_amount))}
      ${kpi('Ventas cobradas', money(c.sales_total), `${c.orders_count} ordenes`)}
      ${kpi('Efectivo por ventas', money(c.cash_sales))}
      ${kpi('Ingresos extra', money(c.extra_income))}
      ${kpi('Retiros', money(c.withdrawals))}
      ${kpi('Gastos en efectivo', money(c.expenses))}
      ${kpi('Efectivo esperado', money(c.expected_amount), 'lo que deberia haber en caja')}
    </div>

    <div class="card mb">
      <div class="card-head">
        <h2>La cuenta, paso a paso</h2>
        <span class="small dim">Esto es lo que debe haber en el cajon ahora</span>
      </div>

      <div class="arqueo">
        <div class="aq-linea">
          <span class="aq-op"></span>
          <span class="aq-txt">Base con la que abriste</span>
          <span class="aq-val">${money(c.opening_amount)}</span>
        </div>

        <div class="aq-linea suma">
          <span class="aq-op">+</span>
          <span class="aq-txt">Lo que cobraste en efectivo
            <em>${c.orders_count} venta(s)</em></span>
          <span class="aq-val">${money(c.cash_sales)}</span>
        </div>

        ${c.extra_income > 0 ? `<div class="aq-linea suma">
          <span class="aq-op">+</span>
          <span class="aq-txt">Plata que metiste a la caja</span>
          <span class="aq-val">${money(c.extra_income)}</span>
        </div>` : ''}

        ${c.expenses > 0 ? `<div class="aq-linea resta">
          <span class="aq-op">&minus;</span>
          <span class="aq-txt">Gastos pagados en efectivo
            <em>${c.expense_list.length} gasto(s)</em></span>
          <span class="aq-val">${money(c.expenses)}</span>
        </div>` : ''}

        ${c.withdrawals > 0 ? `<div class="aq-linea resta">
          <span class="aq-op">&minus;</span>
          <span class="aq-txt">Retiros que hiciste</span>
          <span class="aq-val">${money(c.withdrawals)}</span>
        </div>` : ''}

        ${c.refunds > 0 ? `<div class="aq-linea resta">
          <span class="aq-op">&minus;</span>
          <span class="aq-txt">Devoluciones</span>
          <span class="aq-val">${money(c.refunds)}</span>
        </div>` : ''}

        <div class="aq-linea total">
          <span class="aq-op">=</span>
          <span class="aq-txt">Debe haber en el cajon</span>
          <span class="aq-val">${money(c.expected_amount)}</span>
        </div>
      </div>

      ${c.expense_list.length ? `
        <details class="detalle-gastos">
          <summary>Ver los ${c.expense_list.length} gasto(s) que se restaron</summary>
          <div class="dg-lista">
            ${c.expense_list.map(g => `<div class="dg-item">
              <span>${esc(g.description)}${g.category_name ? ` <em>${esc(g.category_name)}</em>` : ''}</span>
              <span class="pos-neg">&minus;${money(g.amount)}</span>
            </div>`).join('')}
          </div>
        </details>` : ''}

      ${c.other_expenses > 0 ? `
        <div class="banner warn mt">
          <strong>Ojo:</strong> hay ${money(c.other_expenses)} en gastos que
          <strong>no se restan del cajon</strong> porque no se pagaron en efectivo
          (transferencia, tarjeta). Esa plata nunca estuvo aqui, por eso no cuenta
          para el arqueo. Si aparecen en el Resumen y en Reportes.
          <details class="detalle-gastos" style="margin-top:8px">
            <summary>Ver cuales son</summary>
            <div class="dg-lista">
              ${c.other_expense_list.map(g => `<div class="dg-item">
                <span>${esc(g.description)} <em>${esc(g.method_name)}</em></span>
                <span>${money(g.amount)}</span>
              </div>`).join('')}
            </div>
          </details>
        </div>` : ''}
    </div>

    <div class="grid grid-3">
      <div class="card">
        <div class="card-head"><h2>Cobros por metodo de pago</h2></div>
        ${dataTable([
    { key: 'name', label: 'Metodo' },
    { key: 'count', label: 'Pagos', num: true },
    { label: 'Total', num: true, render: r => `<strong>${money(r.total)}</strong>` }
  ], c.by_method.filter(m => m.count > 0), { empty: 'Todavia no se ha cobrado nada.' })}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Gastos de este turno</h2>
          <a class="small" href="#/gastos">Anotar uno</a>
        </div>
        ${dataTable([
    { label: 'En que', render: e => `<strong>${esc(e.description)}</strong>` },
    { label: 'Tipo', render: e => esc(e.category_name || 'Sin clasificar') },
    { label: 'Quien', render: e => esc(e.user_name || '—') },
    { label: 'Valor', num: true, render: e => `<span class="pos-neg">-${money(e.amount)}</span>` }
  ], c.expense_list || [], { empty: 'No has anotado gastos en este turno.' })}
        ${(c.expense_list || []).length ? `<div class="row-between mt bold">
          <span>Total que sale del cajon</span>
          <span class="pos-neg">-${money(c.expenses)}</span></div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h2>Movimientos</h2></div>
        ${dataTable([
    { label: 'Hora', render: m => dateTime(m.created_at) },
    { label: 'Concepto', render: m => esc(m.concept || '—') },
    { label: 'Usuario', render: m => esc(m.user_name || '—') },
    {
      label: 'Valor', num: true,
      render: m => `<span class="${m.amount < 0 ? 'pos-neg' : ''}">${money(m.amount)}</span>`
    }
  ], c.movements, { empty: 'Sin movimientos.' })}
      </div>
    </div>`;
}

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(value)}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
}

function bind(host, current) {
  const on = (id, fn) => { const el = host.querySelector('#' + id); if (el) el.onclick = fn; };

  on('openCash', () => formModal({
    title: 'Abrir caja',
    fields: [
      { name: 'opening_amount', label: 'Base inicial en efectivo', type: 'number', value: 0, min: 0, required: true },
      { name: 'notes', label: 'Observaciones', full: true }
    ],
    submitLabel: 'Abrir caja',
    onSubmit: async (values, close) => { await api.post('/cash/open', values); close(); toast('Caja abierta.'); load(host); }
  }));

  on('income', () => movementModal('income', 'Registrar ingreso', host));
  on('withdraw', () => movementModal('withdrawal', 'Registrar retiro', host));

  on('printCash', () => printArqueo(current));

  on('closeCash', () => formModal({
    title: 'Cerrar caja',
    fields: [
      { name: 'counted_amount', label: 'Efectivo contado', type: 'number', required: true, min: 0 },
      { name: 'notes', label: 'Observaciones del cierre', type: 'textarea', full: true }
    ],
    extraHtml: `<div class="card" style="background:var(--carbon)">
      <div class="tiny dim mb">De donde sale el numero</div>
      <div class="row-between small"><span>Base con la que abriste</span><span>${money(current.opening_amount)}</span></div>
      <div class="row-between small"><span>Cobrado en efectivo</span><span>+${money(current.cash_sales)}</span></div>
      ${current.extra_income > 0 ? `<div class="row-between small"><span>Ingresos extra</span><span>+${money(current.extra_income)}</span></div>` : ''}
      ${current.withdrawals > 0 ? `<div class="row-between small"><span>Retiros</span><span class="pos-neg">-${money(current.withdrawals)}</span></div>` : ''}
      <div class="row-between small"><span>Gastos del turno</span><span class="pos-neg">-${money(current.expenses)}</span></div>
      <div class="row-between" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--borde)">
        <span class="muted">Deberia haber en el cajon</span>
        <strong style="font-size:20px;color:var(--oro)">${money(current.expected_amount)}</strong></div>
    </div>`,
    submitLabel: 'Cerrar caja',
    onSubmit: async (values, close) => {
      const summary = await api.post('/cash/close', values);
      close();
      const d = summary.difference;
      toast(d === 0 ? 'Caja cerrada sin diferencias.'
        : `Caja cerrada. Diferencia: ${money(d)}.`, d === 0 ? 'ok' : 'warn', 7000);
      printArqueo(summary);
      load(host);
    }
  }));

  host.querySelectorAll('[data-reg]').forEach(b => b.onclick = async () => {
    try {
      const summary = await api.get(`/cash/registers/${b.dataset.reg}`);
      modal({
        title: `Caja del ${dateTime(summary.opened_at)}`,
        size: 'wide',
        body: `<div class="grid grid-kpi mb">
            ${kpi('Base', money(summary.opening_amount))}
            ${kpi('Ventas', money(summary.sales_total))}
            ${kpi('Esperado', money(summary.expected_amount))}
            ${kpi('Contado', summary.counted_amount === null ? '—' : money(summary.counted_amount))}
            ${kpi('Diferencia', summary.difference === null ? '—' : money(summary.difference))}
          </div>
          ${dataTable([
          { key: 'name', label: 'Metodo' },
          { key: 'count', label: 'Pagos', num: true },
          { label: 'Total', num: true, render: r => money(r.total) }
        ], summary.by_method.filter(m => m.count > 0))}`,
        buttons: [{ label: 'Cerrar' }, { label: 'Imprimir', action: () => printArqueo(summary) }]
      });
    } catch (e) { notifyError(e); }
  });
}

function movementModal(type, title, host) {
  formModal({
    title,
    fields: [
      { name: 'amount', label: 'Valor', type: 'number', required: true, min: 0.01 },
      { name: 'concept', label: 'Concepto', required: true, full: true, placeholder: type === 'income' ? 'Prestamo del propietario' : 'Pago de domicilio' }
    ],
    submitLabel: 'Registrar',
    onSubmit: async (values, close) => {
      await api.post('/cash/movements', { ...values, type });
      close();
      toast('Movimiento registrado.');
      load(host);
    }
  });
}

function printArqueo(c) {
  printHtml(`
    <div class="p-center"><div class="p-big">${esc(state.settings.name)}</div>
      <div>ARQUEO DE CAJA</div></div>
    ${sep()}
    <div class="p-row"><span>Apertura</span><span>${esc(dateTime(c.opened_at))}</span></div>
    <div class="p-row"><span>Cierre</span><span>${esc(dateTime(c.closed_at))}</span></div>
    <div class="p-row"><span>Abrio</span><span>${esc(c.opened_by_name || '')}</span></div>
    <div class="p-row"><span>Cerro</span><span>${esc(c.closed_by_name || '—')}</span></div>
    ${sep()}
    <div class="p-row"><span>Base inicial</span><span>${money(c.opening_amount)}</span></div>
    <div class="p-row"><span>Ventas totales</span><span>${money(c.sales_total)}</span></div>
    <div class="p-row"><span>Ordenes</span><span>${esc(c.orders_count)}</span></div>
    ${sep()}
    ${c.by_method.filter(m => m.count > 0).map(m =>
    `<div class="p-row"><span>${esc(m.name)}</span><span>${money(m.total)}</span></div>`).join('')}
    ${sep()}
    <div class="p-row"><span>Efectivo por ventas</span><span>${money(c.cash_sales)}</span></div>
    <div class="p-row"><span>Ingresos extra</span><span>${money(c.extra_income)}</span></div>
    <div class="p-row"><span>Retiros</span><span>-${money(c.withdrawals)}</span></div>
    <div class="p-row"><span>Gastos del turno</span><span>-${money(c.expenses)}</span></div>
    ${(c.expense_list || []).map(e =>
      `<div class="p-row"><span>  ${esc(e.description)}</span><span>-${money(e.amount)}</span></div>`).join('')}
    ${sep()}
    <div class="p-row p-total"><span>ESPERADO</span><span>${money(c.expected_amount)}</span></div>
    ${c.counted_amount !== null ? `
      <div class="p-row p-total"><span>CONTADO</span><span>${money(c.counted_amount)}</span></div>
      <div class="p-row p-total"><span>DIFERENCIA</span><span>${money(c.difference)}</span></div>` : ''}
    ${sep()}
    <div class="p-center">Firma responsable</div>
    <div class="p-center">_______________________</div>
  `, state.settings.ticket_width);
}
