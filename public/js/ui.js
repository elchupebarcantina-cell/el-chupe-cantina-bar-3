// Herramientas de interfaz compartidas por todas las vistas.

export const state = {
  user: null,
  settings: { currency_symbol: '$', decimals: 0, name: 'EL CHUPE', ticket_width: '80mm', logo_path: '/assets/logo.svg' }
};

/** Escapa texto antes de insertarlo en HTML. Toda entrada del usuario pasa por aqui. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(value) {
  const n = Number(value || 0);
  const d = state.settings.decimals ?? 0;
  return (state.settings.currency_symbol || '$') +
    n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function qty(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function pct(value) {
  return (Number(value || 0)).toFixed(1) + '%';
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  if (isNaN(d)) return value;
  return d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function timeOnly(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  if (isNaN(d)) return value;
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(value) {
  if (!value) return '—';
  return String(value).slice(0, 10).split('-').reverse().join('/');
}

/** Minutos transcurridos desde una fecha, en texto corto. */
export function elapsed(value) {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60);
  return h + ' h ' + (mins % 60) + ' min';
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Permiso del usuario en sesion. */
export function can(code) {
  if (!state.user) return false;
  if (state.user.role_code === 'super_admin') return true;
  return state.user.permissions.includes(code);
}

// ---------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------
export function toast(message, kind = 'ok', ms = 3800) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const notifyError = e => toast(e?.message || 'Ocurrio un error inesperado.', 'error', 5200);

// ---------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------
let modalCount = 0;

/**
 * Abre un modal. buttons: [{ label, kind, action(close, root) }]
 * Devuelve { close, root }.
 */
export function modal({ title, body, buttons = [], size = '', onOpen }) {
  const host = document.getElementById('modals');
  const id = 'm' + (++modalCount);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.dataset.id = id;
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="close-x" data-close aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      ${buttons.length ? '<div class="modal-foot"></div>' : ''}
    </div>`;

  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };

  const foot = backdrop.querySelector('.modal-foot');
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.kind || 'btn-ghost');
    btn.textContent = b.label;
    btn.onclick = () => b.action ? b.action(close, backdrop) : close();
    foot.appendChild(btn);
  });

  backdrop.querySelector('[data-close]').onclick = close;
  backdrop.onclick = e => { if (e.target === backdrop) close(); };
  document.addEventListener('keydown', onKey);
  host.appendChild(backdrop);

  const firstInput = backdrop.querySelector('input, select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 40);
  if (onOpen) onOpen(backdrop, close);

  return { close, root: backdrop };
}

export function confirmAction({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false, onConfirm }) {
  modal({
    title,
    size: 'narrow',
    body: `<p>${esc(message)}</p>`,
    buttons: [
      { label: 'Cancelar' },
      {
        label: confirmLabel,
        kind: danger ? 'btn-danger' : 'btn-primary',
        action: async close => { close(); await onConfirm(); }
      }
    ]
  });
}

/** Pide un texto obligatorio (motivos de anulacion, ajustes, etc.). */
export function promptReason({ title, label = 'Motivo', placeholder = '', confirmLabel = 'Confirmar', danger = true, onConfirm }) {
  modal({
    title,
    size: 'narrow',
    body: `<div class="field"><label for="pr">${esc(label)}</label>
      <textarea id="pr" placeholder="${esc(placeholder)}"></textarea></div>`,
    buttons: [
      { label: 'Cancelar' },
      {
        label: confirmLabel,
        kind: danger ? 'btn-danger' : 'btn-primary',
        action: async (close, root) => {
          const value = root.querySelector('#pr').value.trim();
          if (value.length < 4) return toast('Escribe un motivo de al menos 4 caracteres.', 'warn');
          close();
          await onConfirm(value);
        }
      }
    ]
  });
}

// ---------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------
/**
 * Construye campos de formulario a partir de una definicion.
 * fields: [{ name, label, type, value, options, required, step, min, placeholder, help, hint, full }]
 */
export function formFields(fields) {
  return `<div class="form-grid">` + fields.map(f => {
    if (f.type === 'hidden') return '';
    const id = 'f_' + f.name;
    const req = f.required ? ' required' : '';
    const style = f.full ? ' style="grid-column: 1 / -1;"' : '';
    let control;

    if (f.type === 'select') {
      control = `<select id="${id}" name="${f.name}"${req}>` +
        (f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : '') +
        (f.options || []).map(o =>
          `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`
        ).join('') + `</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}"${req}>${esc(f.value ?? '')}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="field"${style}><label class="check">
        <input type="checkbox" id="${id}" name="${f.name}"${f.value ? ' checked' : ''}>
        <span>${esc(f.label)}</span></label>
        ${f.help ? `<span class="small dim">${esc(f.help)}</span>` : ''}</div>`;
    } else {
      const extra = [
        f.step ? `step="${f.step}"` : '',
        f.min !== undefined ? `min="${f.min}"` : '',
        f.max !== undefined ? `max="${f.max}"` : '',
        f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''
      ].filter(Boolean).join(' ');
      control = `<input type="${f.type || 'text'}" id="${id}" name="${f.name}"
        value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${extra}${req}>`;
    }

    return `<div class="field"${style}>
      <label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      ${control}
      ${f.help ? `<span class="small dim">${esc(f.help)}</span>` : ''}
    </div>`;
  }).join('') + `</div>`;
}

/** Lee un formulario dentro de un contenedor y devuelve un objeto plano. */
export function readForm(root, fields) {
  const out = {};
  fields.forEach(f => {
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) return;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value.trim();
  });
  return out;
}

/** Modal de formulario listo para usar. */
export function formModal({ title, fields, submitLabel = 'Guardar', size = '', onSubmit, extraHtml = '' }) {
  return modal({
    title,
    size,
    body: formFields(fields) + extraHtml,
    buttons: [
      { label: 'Cancelar' },
      {
        label: submitLabel,
        kind: 'btn-primary',
        action: async (close, root) => {
          const btn = root.querySelector('.modal-foot .btn-primary');
          btn.disabled = true;
          try {
            const values = readForm(root, fields);
            await onSubmit(values, close, root);
          } catch (e) {
            notifyError(e);
            btn.disabled = false;
          }
        }
      }
    ]
  });
}

// ---------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------
/**
 * columns: [{ key, label, num, render(row), width }]
 */
export function dataTable(columns, rows, { empty = 'Todavia no hay registros.', emptyHint = '' } = {}) {
  if (!rows || rows.length === 0) {
    return `<div class="empty"><strong>${esc(empty)}</strong>${emptyHint ? esc(emptyHint) : ''}</div>`;
  }
  return `<div class="table-wrap"><table class="data">
    <thead><tr>${columns.map(c =>
    `<th class="${c.num ? 'num' : ''}"${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row, i) => `<tr data-index="${i}">${columns.map(c =>
      `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(row) : esc(row[c.key])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------------
// Graficas (SVG propio, sin librerias externas)
// ---------------------------------------------------------------------
export function barChart(data, { labelKey = 'label', valueKey = 'value', height = 190, format = money } = {}) {
  if (!data || data.length === 0) return `<div class="empty">Sin datos en este periodo.</div>`;
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1);
  const w = Math.max(data.length * 46, 300);
  const padB = 34;
  const chartH = height - padB;
  const bw = Math.min(30, (w / data.length) * 0.6);

  const bars = data.map((d, i) => {
    const value = Number(d[valueKey]) || 0;
    const h = Math.max((value / max) * chartH, value > 0 ? 2 : 0);
    const x = (i + 0.5) * (w / data.length) - bw / 2;
    const y = chartH - h;
    const label = String(d[labelKey] ?? '');
    return `<g>
      <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3">
        <title>${esc(label)}: ${esc(format(value))}</title>
      </rect>
      <text x="${((i + 0.5) * (w / data.length)).toFixed(1)}" y="${height - 18}" text-anchor="middle">${esc(label.slice(-5))}</text>
    </g>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" style="height:${height}px">
    <defs><linearGradient id="gradGold" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#8E6B2F"/><stop offset="100%" stop-color="#E8C583"/>
    </linearGradient></defs>
    <line class="axis" x1="0" y1="${chartH}" x2="${w}" y2="${chartH}"/>
    ${bars}
  </svg>`;
}

/** Barras horizontales con etiqueta y valor: mejor para rankings. */
export function rankBars(rows, { labelKey = 'name', valueKey = 'total', format = money, limit = 10 } = {}) {
  const data = (rows || []).slice(0, limit);
  if (data.length === 0) return `<div class="empty">Sin datos en este periodo.</div>`;
  const max = Math.max(...data.map(r => Number(r[valueKey]) || 0), 1);
  return data.map(r => {
    const value = Number(r[valueKey]) || 0;
    return `<div class="bar-row">
      <span class="bl" title="${esc(r[labelKey])}">${esc(r[labelKey])}</span>
      <span class="bt"><span class="bf" style="width:${((value / max) * 100).toFixed(1)}%"></span></span>
      <span class="bv">${esc(format(value))}</span>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Impresion
// ---------------------------------------------------------------------
/**
 * Imprime un ticket con el tamano de hoja del rollo, no en tamano carta.
 *
 * La regla @page no se puede cambiar con una clase de CSS, asi que se inyecta
 * aqui con el ancho configurado. El alto va en "auto" para que la hoja mida
 * exactamente lo que mide el ticket y no salgan hojas en blanco.
 */
export function printHtml(html, width) {
  const ancho = String(width || state.settings.ticket_width || '80mm').replace('mm', '');

  const area = document.getElementById('print');
  area.innerHTML = html;

  document.body.classList.remove('ticket-58', 'ticket-80');
  document.body.classList.add('ticket-' + ancho);

  // Regla de pagina a la medida del rollo
  let hoja = document.getElementById('print-page-size');
  if (!hoja) {
    hoja = document.createElement('style');
    hoja.id = 'print-page-size';
    document.head.appendChild(hoja);
  }
  hoja.textContent = `@page { size: ${ancho}mm auto; margin: 0; }`;

  // Se deja pintar el contenido antes de abrir el dialogo de impresion
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

export function sep() { return '<div class="p-sep"></div>'; }

// ---------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------
export function debounce(fn, ms = 280) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function tagFor(status) {
  const map = {
    available: ['tag-ok', 'Disponible'],
    occupied: ['tag-danger', 'Ocupada'],
    bill_requested: ['tag-warn', 'Cuenta pedida'],
    reserved: ['tag-info', 'Reservada'],
    open: ['tag-info', 'Abierta'],
    paid: ['tag-ok', 'Pagada'],
    void: ['tag-mute', 'Anulada'],
    received: ['tag-ok', 'Recibida'],
    closed: ['tag-mute', 'Cerrada'],
    out: ['tag-danger', 'Agotado'],
    low: ['tag-warn', 'Bajo'],
    ok: ['tag-ok', 'Suficiente'],
    pending: ['tag-warn', 'Pendiente'],
    preparing: ['tag-info', 'En preparacion'],
    ready: ['tag-ok', 'Listo'],
    delivered: ['tag-mute', 'Entregado']
  };
  const [cls, label] = map[status] || ['tag-mute', status || '—'];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}

/** Selector de rango de fechas reutilizable. */
export function rangeSelector(current = 'today') {
  const options = [
    ['today', 'Hoy'], ['yesterday', 'Ayer'], ['week', 'Ultimos 7 dias'],
    ['month', 'Este mes'], ['last30', 'Ultimos 30 dias'], ['year', 'Este ano'], ['custom', 'Personalizado']
  ];
  return `<div class="row wrap">
    <select id="rangeSel" style="width:auto">
      ${options.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l}</option>`).join('')}
    </select>
    <span id="customRange" class="row hidden">
      <input type="date" id="rangeFrom" style="width:auto">
      <span class="dim">a</span>
      <input type="date" id="rangeTo" style="width:auto">
      <button class="btn btn-sm" id="rangeApply">Aplicar</button>
    </span>
  </div>`;
}

/** Conecta el selector de rango a un callback. */
export function bindRange(root, onChange) {
  const sel = root.querySelector('#rangeSel');
  const custom = root.querySelector('#customRange');
  if (!sel) return;
  sel.onchange = () => {
    if (sel.value === 'custom') {
      custom.classList.remove('hidden');
      const from = root.querySelector('#rangeFrom');
      const to = root.querySelector('#rangeTo');
      if (!from.value) from.value = today();
      if (!to.value) to.value = today();
    } else {
      custom.classList.add('hidden');
      onChange({ range: sel.value });
    }
  };
  const apply = root.querySelector('#rangeApply');
  if (apply) {
    apply.onclick = () => onChange({
      from: root.querySelector('#rangeFrom').value,
      to: root.querySelector('#rangeTo').value
    });
  }
}

/**
 * Panel de ayuda plegable. Explica en palabras sencillas para que sirve la
 * pantalla y como se usa. Pensado para que cualquiera lo entienda sin manual.
 */
export function ayuda(titulo, pasos, consejo = '') {
  const id = 'ayuda-' + Math.random().toString(36).slice(2, 8);
  return `
    <details class="ayuda" id="${id}">
      <summary>
        <span class="ayuda-icono">?</span>
        <span>${esc(titulo)}</span>
        <span class="ayuda-flecha">▾</span>
      </summary>
      <div class="ayuda-cuerpo">
        <ol>
          ${pasos.map(p => `<li>${p}</li>`).join('')}
        </ol>
        ${consejo ? `<p class="ayuda-consejo"><strong>Ojo:</strong> ${consejo}</p>` : ''}
      </div>
    </details>`;
}

/** Tarjeta grande de accion, facil de ver y de tocar. */
export function accionGrande({ icono, titulo, texto, id, tono = '' }) {
  return `<button class="accion-grande ${tono}" id="${id}">
    <span class="ag-icono">${icono}</span>
    <span class="ag-texto">
      <span class="ag-titulo">${esc(titulo)}</span>
      <span class="ag-sub">${esc(texto)}</span>
    </span>
  </button>`;
}
