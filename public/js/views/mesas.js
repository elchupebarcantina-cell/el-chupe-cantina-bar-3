import { api } from '../api.js';
import {
  esc, money, can, toast, notifyError, modal, formModal, confirmAction,
  dataTable, elapsed, ayuda
} from '../ui.js';


export async function render(host) {
  await pintar(host);
  // El temporizador se guarda aqui adentro, no en una variable compartida:
  // si dos pantallas se montan seguidas, cada una apaga el suyo y no el ajeno.
  const reloj = setInterval(() => {
    // Si esta pantalla ya no esta visible, el temporizador se apaga solo.
    if (!host.isConnected) return clearInterval(reloj);
    pintar(host, true);
  }, 20000);
  return () => clearInterval(reloj);
}

async function pintar(host, silencioso = false) {
  let mesas, zonas;
  try {
    [mesas, zonas] = await Promise.all([api.get('/tables'), api.get('/zones')]);
  } catch (e) { if (!silencioso) notifyError(e); return; }

  const ocupadas = mesas.filter(m => m.status === 'occupied' || m.status === 'bill_requested');
  const libres = mesas.filter(m => m.status === 'available');

  host.innerHTML = `
    ${ayuda('¿Cómo funciona esta pantalla?', [
    '<strong>Toca una mesa verde</strong> para atender a alguien que acaba de llegar.',
    '<strong>Toca una mesa dorada</strong> para agregarle más cosas o para cobrarle.',
    'Si la mesa está <strong>parpadeando</strong>, es que pidieron la cuenta.',
    'Para armar tu local a la medida, usa el botón <strong>Mis mesas</strong> de abajo.'
  ], 'Esta pantalla se actualiza sola. No hace falta que recargues nada.')}

    <div class="resumen-mesas">
      <div class="rm-dato"><span class="rm-num">${libres.length}</span><span class="rm-lbl">libres</span></div>
      <div class="rm-dato ocupado"><span class="rm-num">${ocupadas.length}</span><span class="rm-lbl">atendiendo</span></div>
      <div class="rm-dato"><span class="rm-num">${money(ocupadas.reduce((s, m) => s + (m.order_total || 0), 0))}</span><span class="rm-lbl">sin cobrar</span></div>
    </div>

    <div class="row wrap mb">
      ${can('orders.create') ? `<button class="btn btn-primary btn-lg" id="mostrador">
        🥤 Venta rápida (sin mesa)</button>` : ''}
      ${can('tables.manage') ? `<button class="btn btn-lg" id="misMesas">
        🪑 Mis mesas · agregar o quitar</button>` : ''}
    </div>

    ${mesas.length === 0 ? `
      <div class="card">
        <div class="empty grande">
          <div class="empty-icono">🪑</div>
          <strong>Todavía no tienes mesas</strong>
          Vamos a crear las mesas de tu local. Es rápido: le pones un nombre
          a cada una y listo.
          ${can('tables.manage') ? `<button class="btn btn-primary btn-xl mt" id="primeraMesa">
            Crear mi primera mesa</button>` : ''}
        </div>
      </div>` : ''}

    ${zonas.map(z => {
    const suyas = mesas.filter(m => m.zone_id === z.id);
    if (suyas.length === 0) return '';
    return `<section class="zone-block">
        <div class="zone-title">${esc(z.name)} · ${suyas.length} mesa(s)</div>
        <div class="table-grid">${suyas.map(baldosa).join('')}</div>
      </section>`;
  }).join('')}
  `;

  conectar(host, mesas, zonas);
}

function baldosa(m) {
  const textos = {
    available: { icono: '✅', estado: 'Libre', detalle: `${m.seats} puestos` },
    occupied: { icono: '🍽️', estado: 'Atendiendo', detalle: money(m.order_total || 0) },
    bill_requested: { icono: '🔔', estado: '¡Pidió la cuenta!', detalle: money(m.order_total || 0) },
    reserved: { icono: '📅', estado: 'Reservada', detalle: `${m.seats} puestos` }
  }[m.status] || { icono: '❔', estado: m.status, detalle: '' };

  return `<button class="table-tile ${m.status}" data-id="${m.id}">
    <span class="tt-icono">${textos.icono}</span>
    <span class="tt-nombre">${esc(m.name)}</span>
    <span class="tt-estado">${esc(textos.estado)}</span>
    <span class="tt-detalle">${esc(textos.detalle)}</span>
    ${m.opened_at ? `<span class="tt-tiempo">${esc(elapsed(m.opened_at))}</span>` : ''}
  </button>`;
}

// ---------------------------------------------------------------------
function conectar(host, mesas, zonas) {
  const b = id => host.querySelector('#' + id);

  if (b('mostrador')) b('mostrador').onclick = async () => {
    try {
      const orden = await api.post('/orders', { type: 'counter', guests: 1 });
      location.hash = `#/pos?order=${orden.id}`;
    } catch (e) { notifyError(e); }
  };

  if (b('misMesas')) b('misMesas').onclick = () => misMesas(host, zonas, mesas);
  if (b('primeraMesa')) b('primeraMesa').onclick = () => nuevaMesa(host, zonas);

  host.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = () => {
      const mesa = mesas.find(m => m.id === Number(el.dataset.id));
      if (mesa.status === 'available') abrirCuenta(mesa, host);
      else menuMesa(mesa, host);
    };
  });
}

// ---------------------------------------------------------------------
//  Abrir cuenta
// ---------------------------------------------------------------------
async function abrirCuenta(mesa, host) {
  let meseros = [];
  try { meseros = await api.get('/users/waiters'); } catch (e) { /* opcional */ }

  formModal({
    title: `Llegó gente a ${mesa.name}`,
    fields: [
      {
        name: 'guests', label: '¿Cuántas personas son?', type: 'number',
        value: 2, min: 1, required: true, full: true
      },
      ...(meseros.length ? [{
        name: 'waiter_id', label: '¿Quién los va a atender?', type: 'select',
        options: meseros.map(w => ({ value: w.id, label: w.name })),
        placeholder: 'Escoge un mesero'
      }] : []),
      {
        name: 'notes', label: 'Alguna nota (opcional)', full: true,
        placeholder: 'Cumpleaños, cliente frecuente, alergias…'
      }
    ],
    submitLabel: 'Abrir la mesa y empezar a vender',
    onSubmit: async (valores, cerrar) => {
      const orden = await api.post('/orders', { table_id: mesa.id, ...valores });
      cerrar();
      location.hash = `#/pos?order=${orden.id}`;
    }
  });
}

// ---------------------------------------------------------------------
//  Menú de una mesa ocupada
// ---------------------------------------------------------------------
function menuMesa(mesa, host) {
  const acciones = [
    { icono: '🧾', titulo: 'Seguir atendiendo', texto: 'Agregar cosas o cobrar', ir: () => location.hash = `#/pos?order=${mesa.order_id}` },
    { icono: '🔄', titulo: 'Cambiar de mesa', texto: 'Se pasaron a otro lugar', ir: () => cambiarMesa(mesa, host) },
    { icono: '🤝', titulo: 'Juntar con otra mesa', texto: 'Van a pagar todo junto', ir: () => juntarMesas(mesa, host) },
    { icono: '✂️', titulo: 'Separar la cuenta', texto: 'Cada uno paga lo suyo', ir: () => separarCuenta(mesa, host) }
  ];

  const m = modal({
    title: `${mesa.name} · ${money(mesa.order_total || 0)}`,
    body: `<div class="lista-acciones">
      ${acciones.map((a, i) => `<button class="accion-grande" data-i="${i}">
        <span class="ag-icono">${a.icono}</span>
        <span class="ag-texto">
          <span class="ag-titulo">${esc(a.titulo)}</span>
          <span class="ag-sub">${esc(a.texto)}</span>
        </span>
      </button>`).join('')}
    </div>`
  });

  m.root.querySelectorAll('[data-i]').forEach(btn => btn.onclick = () => {
    m.close();
    acciones[Number(btn.dataset.i)].ir();
  });
}

async function cambiarMesa(mesa, host) {
  const libres = (await api.get('/tables')).filter(t => t.status === 'available');
  if (!libres.length) return toast('No hay mesas libres en este momento.', 'warn');

  formModal({
    title: `¿A qué mesa se pasaron?`,
    fields: [{
      name: 'table_id', label: 'Nueva mesa', type: 'select', required: true, full: true,
      options: libres.map(t => ({ value: t.id, label: `${t.zone_name} · ${t.name}` }))
    }],
    submitLabel: 'Pasar la cuenta',
    onSubmit: async (v, cerrar) => {
      await api.post(`/orders/${mesa.order_id}/transfer-table`, v);
      cerrar();
      toast('Listo, la cuenta se pasó de mesa.');
      pintar(host);
    }
  });
}

async function juntarMesas(mesa, host) {
  const otras = (await api.get('/orders', { status: 'open' })).filter(o => o.id !== mesa.order_id);
  if (!otras.length) return toast('No hay otra cuenta abierta para juntar.', 'warn');

  formModal({
    title: `Juntar otra cuenta con ${mesa.name}`,
    fields: [{
      name: 'source_order_id', label: '¿Cuál cuenta se le suma?', type: 'select',
      required: true, full: true,
      options: otras.map(o => ({ value: o.id, label: `${o.table_name || 'Mostrador'} · ${money(o.total)}` }))
    }],
    submitLabel: 'Juntar las dos',
    onSubmit: async (v, cerrar) => {
      await api.post(`/orders/${mesa.order_id}/merge`, v);
      cerrar();
      toast('Las dos cuentas quedaron en una sola.');
      pintar(host);
    }
  });
}

async function separarCuenta(mesa, host) {
  const orden = await api.get(`/orders/${mesa.order_id}`);
  const libres = (await api.get('/tables')).filter(t => t.status === 'available');

  const m = modal({
    title: 'Separar la cuenta',
    size: 'wide',
    body: `
      <p class="ayuda-texto">Marca lo que se va a pagar aparte. Eso se pasa a una
      cuenta nueva y lo demás se queda aquí.</p>
      <div class="lista-separar">
        ${orden.items.map(i => `<label class="check grande">
          <input type="checkbox" value="${i.id}">
          <span>${esc(i.product_name)} · ${money(i.total)}</span>
        </label>`).join('')}
      </div>
      <div class="field mt">
        <label for="splitTable">¿A qué mesa se va lo marcado?</label>
        <select id="splitTable">
          <option value="">Dejarlo sin mesa (mostrador)</option>
          ${libres.map(t => `<option value="${t.id}">${esc(t.zone_name)} · ${esc(t.name)}</option>`).join('')}
        </select>
      </div>`,
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Separar', kind: 'btn-primary',
        action: async (cerrar, raiz) => {
          const ids = [...raiz.querySelectorAll('input:checked')].map(c => Number(c.value));
          if (!ids.length) return toast('Marca al menos una cosa.', 'warn');
          try {
            await api.post(`/orders/${orden.id}/split`, {
              item_ids: ids,
              table_id: raiz.querySelector('#splitTable').value || null
            });
            cerrar();
            toast('Listo, quedaron dos cuentas.');
            pintar(host);
          } catch (e) { notifyError(e); }
        }
      }
    ]
  });
}

// ---------------------------------------------------------------------
//  Mis mesas: crear, editar, eliminar
// ---------------------------------------------------------------------
function misMesas(host, zonas, mesas) {
  const m = modal({
    title: 'Mis mesas',
    size: 'wide',
    body: `
      ${ayuda('¿Qué puedo hacer aquí?', [
      'Las <strong>zonas</strong> son las partes de tu local: el salón, la terraza, la barra.',
      'Dentro de cada zona van tus <strong>mesas</strong>.',
      'Puedes agregar, cambiarle el nombre o eliminar lo que quieras.'
    ], 'Si una mesa tiene una cuenta abierta, el sistema no te deja eliminarla hasta que la cobres.')}

      <div class="row wrap mb">
        <button class="btn btn-primary" id="nuevaMesa">➕ Agregar una mesa</button>
        <button class="btn" id="nuevaZona">🏠 Agregar una zona</button>
      </div>

      <div id="listaMesas"></div>`
  });

  const pintarLista = async () => {
    const [zs, ms] = await Promise.all([api.get('/zones'), api.get('/tables')]);
    m.root.querySelector('#listaMesas').innerHTML = zs.map(z => {
      const suyas = ms.filter(t => t.zone_id === z.id);
      return `<div class="zona-admin">
        <div class="za-cabeza">
          <strong>🏠 ${esc(z.name)}</strong>
          <div class="row">
            <button class="btn btn-sm" data-editzona="${z.id}">Cambiar nombre</button>
            <button class="btn btn-sm btn-danger" data-borrazona="${z.id}">Eliminar zona</button>
          </div>
        </div>
        ${suyas.length === 0
          ? `<p class="dim small" style="padding:8px 0">Esta zona no tiene mesas todavía.</p>`
          : `<div class="za-mesas">${suyas.map(t => `
            <div class="za-mesa">
              <span class="zam-nombre">🪑 ${esc(t.name)}</span>
              <span class="zam-puestos">${t.seats} puestos</span>
              <span class="zam-estado">${t.status === 'available' ? 'Libre' : 'Ocupada'}</span>
              <button class="btn btn-sm" data-editmesa="${t.id}">Editar</button>
              <button class="btn btn-sm btn-danger" data-borramesa="${t.id}">Eliminar</button>
            </div>`).join('')}</div>`}
      </div>`;
    }).join('') || `<div class="empty">Aún no has creado ninguna zona.</div>`;

    conectarLista(zs, ms);
  };

  const conectarLista = (zs, ms) => {
    const r = m.root;

    r.querySelectorAll('[data-editzona]').forEach(b => b.onclick = () => {
      const z = zs.find(x => x.id === Number(b.dataset.editzona));
      formModal({
        title: 'Cambiar el nombre de la zona',
        fields: [{ name: 'name', label: 'Nombre', value: z.name, required: true, full: true }],
        submitLabel: 'Guardar',
        onSubmit: async (v, c) => { await api.put(`/zones/${z.id}`, v); c(); toast('Nombre cambiado.'); pintarLista(); pintar(host); }
      });
    });

    r.querySelectorAll('[data-borrazona]').forEach(b => b.onclick = () => {
      const z = zs.find(x => x.id === Number(b.dataset.borrazona));
      confirmAction({
        title: `¿Eliminar la zona ${z.name}?`,
        message: 'Solo se puede si la zona no tiene mesas adentro.',
        confirmLabel: 'Sí, eliminar', danger: true,
        onConfirm: async () => {
          try { await api.del(`/zones/${z.id}`); toast('Zona eliminada.'); pintarLista(); pintar(host); }
          catch (e) { notifyError(e); }
        }
      });
    });

    r.querySelectorAll('[data-editmesa]').forEach(b => b.onclick = () => {
      const t = ms.find(x => x.id === Number(b.dataset.editmesa));
      formModal({
        title: `Editar ${t.name}`,
        fields: [
          { name: 'name', label: '¿Cómo se llama?', value: t.name, required: true },
          { name: 'seats', label: '¿Cuántas personas caben?', type: 'number', value: t.seats, min: 1 },
          {
            name: 'zone_id', label: '¿En qué zona está?', type: 'select', value: t.zone_id,
            options: zs.map(z => ({ value: z.id, label: z.name }))
          }
        ],
        submitLabel: 'Guardar cambios',
        onSubmit: async (v, c) => { await api.put(`/tables/${t.id}`, v); c(); toast('Mesa actualizada.'); pintarLista(); pintar(host); }
      });
    });

    r.querySelectorAll('[data-borramesa]').forEach(b => b.onclick = () => {
      const t = ms.find(x => x.id === Number(b.dataset.borramesa));
      confirmAction({
        title: `¿Eliminar ${t.name}?`,
        message: 'La mesa desaparece de la pantalla. Las ventas viejas no se borran.',
        confirmLabel: 'Sí, eliminar', danger: true,
        onConfirm: async () => {
          try { await api.del(`/tables/${t.id}`); toast('Mesa eliminada.'); pintarLista(); pintar(host); }
          catch (e) { notifyError(e); }
        }
      });
    });

    const bn = r.querySelector('#nuevaMesa');
    if (bn) bn.onclick = () => nuevaMesa(host, zs, () => { pintarLista(); });
    const bz = r.querySelector('#nuevaZona');
    if (bz) bz.onclick = () => formModal({
      title: 'Agregar una zona',
      fields: [{
        name: 'name', label: '¿Cómo se llama?', required: true, full: true,
        placeholder: 'Salón principal, Terraza, Barra…'
      }],
      submitLabel: 'Crear zona',
      onSubmit: async (v, c) => { await api.post('/zones', v); c(); toast('Zona creada.'); pintarLista(); pintar(host); }
    });
  };

  pintarLista();
}

async function nuevaMesa(host, zonas, despues) {
  let zs = zonas;
  if (!zs || !zs.length) zs = await api.get('/zones');

  if (!zs.length) {
    return formModal({
      title: 'Primero creemos una zona',
      fields: [{
        name: 'name', label: '¿Cómo se llama esa parte del local?', required: true, full: true,
        placeholder: 'Salón principal'
      }],
      submitLabel: 'Crear zona y seguir',
      onSubmit: async (v, c) => {
        await api.post('/zones', v);
        c();
        nuevaMesa(host, null, despues);
      }
    });
  }

  formModal({
    title: 'Agregar una mesa',
    fields: [
      { name: 'name', label: '¿Cómo se llama?', required: true, placeholder: 'Mesa 5, Barra 2, Terraza 1…' },
      { name: 'seats', label: '¿Cuántas personas caben?', type: 'number', value: 4, min: 1 },
      {
        name: 'zone_id', label: '¿En qué zona está?', type: 'select', required: true,
        value: zs[0].id, options: zs.map(z => ({ value: z.id, label: z.name }))
      }
    ],
    submitLabel: 'Crear la mesa',
    onSubmit: async (v, c) => {
      await api.post('/tables', v);
      c();
      toast('¡Mesa creada!');
      pintar(host);
      if (despues) despues();
    }
  });
}
