import { api } from '../api.js';
import {
  state, esc, money, can, toast, notifyError, modal, formModal, confirmAction,
  formFields, readForm, dataTable, dateTime
} from '../ui.js';

export async function render(host) { await load(host); }

async function load(host) {
  let settings, methods, backups;
  try {
    [settings, methods, backups] = await Promise.all([
      api.get('/settings'),
      api.get('/payment-methods'),
      can('backup.manage') ? api.get('/backups').catch(() => []) : Promise.resolve([])
    ]);
  } catch (e) { return notifyError(e); }

  const fields = businessFields(settings);
  const editable = can('settings.manage');

  host.innerHTML = `
    <div class="grid grid-2 mb">
      <div class="card">
        <div class="card-head"><h2>Datos del negocio</h2></div>
        <form id="bizForm">${formFields(fields)}</form>
        ${editable ? `<button class="btn btn-primary" id="saveBiz">Guardar cambios</button>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h2>Logo</h2></div>
        <div class="center mb" style="background:var(--noche);border:1px solid var(--borde);border-radius:10px;padding:20px">
          <img src="${esc(settings.logo_path || '/assets/logo.svg')}" alt="Logo actual"
               style="max-width:100%;max-height:150px" onerror="this.src='/assets/logo.svg'">
        </div>
        ${editable ? `
          <p class="small muted mb">Sube el logo oficial en PNG con fondo transparente o negro.
          Aparecera en el sistema y en las facturas impresas.</p>
          <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml">
          <button class="btn mt" id="uploadLogo">Subir logo</button>` : ''}
      </div>
    </div>

    <div class="grid grid-2 mb">
      <div class="card">
        <div class="card-head">
          <h2>Metodos de pago</h2>
          ${editable ? `<button class="btn btn-sm btn-primary" id="newMethod">Nuevo metodo</button>` : ''}
        </div>
        ${dataTable([
    { key: 'name', label: 'Nombre' },
    {
      label: 'Tipo',
      render: m => esc({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' }[m.type])
    },
    { label: 'Afecta caja', render: m => m.affects_cash ? 'Si' : 'No' },
    ...(editable ? [{ label: '', render: m => `<button class="btn btn-sm" data-method="${m.id}">Editar</button>` }] : [])
  ], methods)}
      </div>

      <div class="card">
        <div class="card-head"><h2>Mi cuenta</h2></div>
        <div class="mb">
          <div class="tiny dim">Usuario</div>${esc(state.user.name)}
          <div class="tiny dim mt">Rol</div>${esc(state.user.role_name)}
        </div>
        <button class="btn" id="changePass">Cambiar mi contrasena</button>
      </div>
    </div>

    ${can('backup.manage') ? `
    <div class="card">
      <div class="card-head">
        <h2>Copias de seguridad</h2>
        <button class="btn btn-primary" id="newBackup">Crear copia ahora</button>
      </div>
      <p class="small muted mb">Cada copia es una foto completa de la base de datos.
      Descarga y guarda las copias fuera del equipo del local.</p>
      ${dataTable([
    { label: 'Archivo', render: b => `<span class="small">${esc(b.filename)}</span>` },
    { label: 'Creada', render: b => dateTime(b.created_at) },
    { label: 'Tamano', num: true, render: b => (b.size / 1048576).toFixed(2) + ' MB' },
    {
      label: '', render: b => `<div class="row" style="justify-content:flex-end">
        <button class="btn btn-sm" data-dl="${esc(b.filename)}">Descargar</button>
        <button class="btn btn-sm btn-danger" data-rm="${esc(b.filename)}">Eliminar</button></div>`
    }
  ], backups, { empty: 'Aun no has creado copias de seguridad.' })}
      <p class="small dim mt">Para restaurar: detén el sistema, reemplaza el archivo
      <code>data/elchupe.db</code> por la copia descargada y vuelve a iniciarlo.</p>
    </div>` : ''}
  `;

  // ----- guardar datos del negocio -----
  const saveBtn = host.querySelector('#saveBiz');
  if (saveBtn) saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const values = readForm(host.querySelector('#bizForm'), fields);
      const updated = await api.put('/settings', values);
      state.settings = { ...state.settings, ...updated };
      toast('Configuracion guardada.');
    } catch (e) { notifyError(e); }
    saveBtn.disabled = false;
  };

  // ----- logo -----
  const uploadBtn = host.querySelector('#uploadLogo');
  if (uploadBtn) uploadBtn.onclick = async () => {
    const input = host.querySelector('#logoFile');
    if (!input.files.length) return toast('Elige primero un archivo de imagen.', 'warn');
    const fd = new FormData();
    fd.append('file', input.files[0]);
    fd.append('slot', 'logo');
    try {
      const r = await api.upload('/upload', fd);
      state.settings.logo_path = r.path;
      toast('Logo actualizado. Recarga la pagina para verlo en todas partes.');
      load(host);
    } catch (e) { notifyError(e); }
  };

  // ----- metodos de pago -----
  const newMethod = host.querySelector('#newMethod');
  if (newMethod) newMethod.onclick = () => methodModal(null, host);
  host.querySelectorAll('[data-method]').forEach(b => b.onclick = () =>
    methodModal(methods.find(m => m.id === Number(b.dataset.method)), host));

  // ----- contrasena -----
  host.querySelector('#changePass').onclick = () => formModal({
    title: 'Cambiar mi contrasena',
    fields: [
      { name: 'current_password', label: 'Contrasena actual', type: 'password', required: true, full: true },
      { name: 'new_password', label: 'Contrasena nueva', type: 'password', required: true, full: true, help: 'Minimo 8 caracteres' }
    ],
    submitLabel: 'Cambiar',
    onSubmit: async (values, close) => {
      await api.post('/auth/change-password', values);
      close();
      toast('Contrasena actualizada.');
    }
  });

  // ----- copias -----
  const backupBtn = host.querySelector('#newBackup');
  if (backupBtn) backupBtn.onclick = async () => {
    backupBtn.disabled = true;
    try {
      const r = await api.post('/backups');
      toast('Copia creada: ' + r.filename);
      load(host);
    } catch (e) { notifyError(e); backupBtn.disabled = false; }
  };

  host.querySelectorAll('[data-dl]').forEach(b => b.onclick = () =>
    api.download('/backups/' + encodeURIComponent(b.dataset.dl), null, b.dataset.dl));

  host.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => confirmAction({
    title: 'Eliminar copia', danger: true, confirmLabel: 'Eliminar',
    message: `Se eliminara la copia ${b.dataset.rm}.`,
    onConfirm: async () => {
      try { await api.del('/backups/' + encodeURIComponent(b.dataset.rm)); toast('Copia eliminada.'); load(host); }
      catch (e) { notifyError(e); }
    }
  }));
}

function businessFields(s) {
  return [
    { name: 'name', label: 'Nombre comercial', value: s.name, required: true },
    { name: 'legal_name', label: 'Razon social', value: s.legal_name || '' },
    { name: 'nit', label: 'NIT', value: s.nit || '' },
    { name: 'phone', label: 'Telefono', value: s.phone || '' },
    { name: 'address', label: 'Direccion', value: s.address || '', full: true },
    { name: 'city', label: 'Ciudad', value: s.city || '' },
    { name: 'email', label: 'Correo', type: 'email', value: s.email || '' },
    { name: 'currency', label: 'Moneda', value: s.currency },
    { name: 'currency_symbol', label: 'Simbolo', value: s.currency_symbol },
    { name: 'decimals', label: 'Decimales', type: 'number', value: s.decimals, min: 0, max: 4 },
    { name: 'timezone', label: 'Zona horaria', value: s.timezone },
    {
      name: 'ticket_width', label: 'Ancho del ticket', type: 'select', value: s.ticket_width,
      options: [{ value: '58mm', label: '58 mm' }, { value: '80mm', label: '80 mm' }]
    },
    {
      name: 'service_charge_pct', label: 'Servicio voluntario (%)', type: 'number',
      value: s.service_charge_pct, min: 0, max: 100, step: '0.1'
    },
    {
      name: 'waiter_discount_limit', label: 'Tope de descuento para meseros', type: 'number',
      value: s.waiter_discount_limit, min: 0,
      help: 'En dinero. Por encima de este valor se necesita otro rol.'
    },
    { name: 'ticket_footer', label: 'Mensaje al pie del ticket', value: s.ticket_footer || '', full: true },
    { name: 'prices_include_tax', label: 'Los precios ya incluyen impuestos', type: 'checkbox', value: !!s.prices_include_tax },
    {
      name: 'allow_negative_stock', label: 'Permitir vender sin inventario', type: 'checkbox',
      value: !!s.allow_negative_stock, help: 'Actívalo solo si aún no tienes el inventario al día.'
    }
  ];
}

function methodModal(m, host) {
  formModal({
    title: m ? `Editar ${m.name}` : 'Nuevo metodo de pago',
    fields: [
      { name: 'name', label: 'Nombre', required: true, value: m?.name || '' },
      ...(m ? [] : [{ name: 'code', label: 'Codigo', help: 'Se genera solo si lo dejas vacio' }]),
      {
        name: 'type', label: 'Tipo', type: 'select', value: m?.type || 'other',
        options: [
          { value: 'cash', label: 'Efectivo' }, { value: 'card', label: 'Tarjeta' },
          { value: 'transfer', label: 'Transferencia' }, { value: 'other', label: 'Otro' }
        ]
      },
      { name: 'sort_order', label: 'Orden', type: 'number', value: m?.sort_order ?? 50 },
      {
        name: 'affects_cash', label: 'Entra a la caja fisica', type: 'checkbox',
        value: m ? !!m.affects_cash : false, full: true,
        help: 'Marca solo el efectivo. Define que se cuenta al cerrar caja.'
      },
      ...(m ? [{ name: 'is_active', label: 'Metodo activo', type: 'checkbox', value: !!m.is_active }] : [])
    ],
    onSubmit: async (values, close) => {
      if (m) await api.put(`/payment-methods/${m.id}`, values);
      else await api.post('/payment-methods', values);
      close();
      toast('Metodo de pago guardado.');
      load(host);
    }
  });
}
