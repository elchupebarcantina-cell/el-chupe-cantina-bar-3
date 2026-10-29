import { api } from '../api.js';
import {
  esc, money, can, toast, notifyError, modal, confirmAction, dataTable,
  dateOnly, rangeSelector, bindRange, today, ayuda
} from '../ui.js';

let consulta = { range: 'month' };

export async function render(host) { await cargar(host); }

async function cargar(host) {
  let gastos, categorias, metodos;
  try {
    [gastos, categorias, metodos] = await Promise.all([
      api.get('/expenses', { from: consulta.from || inicioDelMes(), to: consulta.to || today() }),
      api.get('/expense-categories'),
      api.get('/payment-methods')
    ]);
  } catch (e) { return notifyError(e); }

  const total = gastos.reduce((s, g) => s + g.amount, 0);

  // Cuanto se gasto en cada categoria, para las tarjetas de resumen
  const porCategoria = {};
  gastos.forEach(g => {
    const k = g.category_name || 'Sin categoría';
    porCategoria[k] = (porCategoria[k] || 0) + g.amount;
  });
  const top = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 4);

  host.innerHTML = `
    ${ayuda('¿Qué es esta pantalla?', [
    'Aquí anotas <strong>toda la plata que sale</strong> del negocio.',
    'El domicilio del hielo, el sueldo de alguien, la reparación de la nevera, oficios varios… lo que sea.',
    'Toca el botón grande verde, escribe <strong>en qué gastaste</strong> y <strong>cuánto</strong>. Eso es todo.',
    'No necesitas crear proveedores ni nada raro. Un gasto suelto también sirve.'
  ], 'Lo que anotes aquí se resta de tu ganancia en el Resumen, así sabes de verdad cuánto te quedó.')}

    ${can('expenses.manage') ? `
      <button class="accion-grande destacada" id="nuevoGasto">
        <span class="ag-icono">💸</span>
        <span class="ag-texto">
          <span class="ag-titulo">Anotar un gasto</span>
          <span class="ag-sub">Escribe en qué gastaste y cuánto. Listo.</span>
        </span>
      </button>` : ''}

    <div class="card mt">
      <div class="card-head">
        <h2>Lo que ha salido</h2>
        ${rangeSelector(consulta.range || 'custom')}
      </div>

      <div class="gasto-total">
        <span class="gt-lbl">Total en este periodo</span>
        <span class="gt-num">${money(total)}</span>
        <span class="gt-sub">${gastos.length} gasto(s) anotado(s)</span>
      </div>

      ${top.length ? `<div class="gasto-cats">
        ${top.map(([nombre, valor]) => `<div class="gc-item">
          <span class="gc-nombre">${esc(nombre)}</span>
          <span class="gc-valor">${money(valor)}</span>
          <span class="gc-barra"><i style="width:${Math.round((valor / total) * 100)}%"></i></span>
        </div>`).join('')}
      </div>` : ''}

      ${gastos.length === 0 ? `
        <div class="empty grande">
          <div class="empty-icono">🧾</div>
          <strong>No has anotado gastos en este periodo</strong>
          Cada vez que salga plata del negocio, anótala aquí. Así el sistema
          te puede decir cuánto ganaste de verdad.
        </div>` : dataTable([
    { label: 'Cuándo', render: g => dateOnly(g.expense_date) },
    { label: 'En qué', render: g => `<strong>${esc(g.description)}</strong>` },
    { label: 'Tipo', render: g => esc(g.category_name || 'Sin categoría') },
    { label: 'Cómo se pagó', render: g => esc(g.method_name || 'No se anotó') },
    { label: 'Quién lo anotó', render: g => esc(g.user_name || '—') },
    { label: 'Cuánto', num: true, render: g => `<strong class="pos-neg">${money(g.amount)}</strong>` },
    ...(can('expenses.manage') ? [{
      label: '', render: g => `<button class="btn btn-sm btn-danger" data-borrar="${g.id}">Borrar</button>`
    }] : [])
  ], gastos)}
    </div>`;

  bindRange(host, q => { consulta = { ...q, range: q.range || null }; cargar(host); });

  const btn = host.querySelector('#nuevoGasto');
  if (btn) btn.onclick = () => formularioGasto(host, categorias, metodos);

  host.querySelectorAll('[data-borrar]').forEach(b => b.onclick = () => {
    const g = gastos.find(x => x.id === Number(b.dataset.borrar));
    confirmAction({
      title: '¿Borrar este gasto?',
      message: `Se quita "${g.description}" por ${money(g.amount)}.`,
      confirmLabel: 'Sí, borrar', danger: true,
      onConfirm: async () => {
        try { await api.del(`/expenses/${g.id}`); toast('Gasto borrado.'); cargar(host); }
        catch (e) { notifyError(e); }
      }
    });
  });
}

// ---------------------------------------------------------------------
//  Formulario en lenguaje sencillo
// ---------------------------------------------------------------------
function formularioGasto(host, categorias, metodos) {
  const sugerencias = ['Oficios varios', 'Domicilio', 'Aseo', 'Reparación', 'Transporte', 'Propinas'];

  const m = modal({
    title: 'Anotar un gasto',
    body: `
      <div class="field grande">
        <label for="gDesc">¿En qué gastaste?</label>
        <input type="text" id="gDesc" placeholder="Oficios varios, hielo, domicilio…" autocomplete="off">
        <div class="chips mt">
          ${sugerencias.map(s => `<button type="button" class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>

      <div class="field grande">
        <label for="gMonto">¿Cuánto fue?</label>
        <input type="number" id="gMonto" placeholder="0" min="0" step="1" inputmode="numeric" class="input-monto">
      </div>

      <details class="mas-opciones">
        <summary>Otros datos (puedes dejarlos en blanco)</summary>
        <div class="form-grid mt">
          <div class="field">
            <label for="gCat">¿Qué tipo de gasto es?</label>
            <select id="gCat">
              <option value="">Sin clasificar</option>
              ${categorias.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              <option value="__nueva__">➕ Crear un tipo nuevo…</option>
            </select>
          </div>
          <div class="field">
            <label for="gMetodo">¿Cómo lo pagaste?</label>
            <select id="gMetodo">
              <option value="">No anotarlo</option>
              ${metodos.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="gFecha">¿Qué día fue?</label>
            <input type="date" id="gFecha" value="${today()}">
          </div>
        </div>
      </details>`,
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Guardar gasto', kind: 'btn-primary',
        action: async (cerrar, raiz) => {
          const desc = raiz.querySelector('#gDesc').value.trim();
          const monto = Number(raiz.querySelector('#gMonto').value);

          if (!desc) return toast('Escribe en qué gastaste.', 'warn');
          if (!monto || monto <= 0) return toast('Escribe cuánto fue.', 'warn');

          const cat = raiz.querySelector('#gCat').value;
          try {
            await api.post('/expenses', {
              description: desc,
              amount: monto,
              expense_category_id: cat && cat !== '__nueva__' ? Number(cat) : null,
              payment_method_id: raiz.querySelector('#gMetodo').value || null,
              expense_date: raiz.querySelector('#gFecha').value || today()
            });
            cerrar();
            toast(`Gasto de ${money(monto)} anotado.`);
            cargar(host);
          } catch (e) { notifyError(e); }
        }
      }
    ],
    onOpen: raiz => {
      const desc = raiz.querySelector('#gDesc');
      desc.focus();

      raiz.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => {
        desc.value = b.dataset.sug;
        raiz.querySelector('#gMonto').focus();
      });

      // Crear un tipo de gasto sin salir de aquí
      const sel = raiz.querySelector('#gCat');
      sel.onchange = async () => {
        if (sel.value !== '__nueva__') return;
        sel.value = '';
        const nombre = prompt('¿Cómo se llama el tipo de gasto nuevo?');
        if (!nombre || !nombre.trim()) return;
        try {
          const nueva = await api.post('/expense-categories', { name: nombre.trim() });
          const opt = document.createElement('option');
          opt.value = nueva.id;
          opt.textContent = nueva.name;
          sel.insertBefore(opt, sel.lastElementChild);
          sel.value = nueva.id;
          toast(`Tipo "${nueva.name}" creado.`);
        } catch (e) { notifyError(e); }
      };
    }
  });
}

function inicioDelMes() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
