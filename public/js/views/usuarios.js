import { api } from '../api.js';
import {
  esc, can, toast, notifyError, modal, formModal, confirmAction, dataTable, dateTime
} from '../ui.js';

export async function render(host) { await load(host); }

async function load(host) {
  let users, roles, permissions;
  try {
    [users, roles, permissions] = await Promise.all([
      api.get('/users'), api.get('/roles'), api.get('/permissions')
    ]);
  } catch (e) { return notifyError(e); }

  host.innerHTML = `
    <div class="card mb">
      <div class="card-head">
        <h2>Usuarios</h2>
        ${can('users.manage') ? `<button class="btn btn-primary" id="new">Nuevo usuario</button>` : ''}
      </div>
      ${dataTable([
    { label: 'Nombre', render: u => `<strong>${esc(u.name)}</strong>` },
    { key: 'email', label: 'Correo' },
    { key: 'role_name', label: 'Rol' },
    { key: 'phone', label: 'Telefono' },
    { label: 'Ultimo acceso', render: u => u.last_login_at ? dateTime(u.last_login_at) : 'nunca' },
    { label: 'Estado', render: u => u.is_active ? '<span class="tag tag-ok">Activo</span>' : '<span class="tag tag-mute">Inactivo</span>' },
    ...(can('users.manage') ? [{
      label: '', render: u => `<div class="row" style="justify-content:flex-end">
        <button class="btn btn-sm" data-edit="${u.id}">Editar</button>
        <button class="btn btn-sm btn-danger" data-del="${u.id}">Eliminar</button></div>`
    }] : [])
  ], users)}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Roles y permisos</h2>
        ${can('users.manage') ? `<button class="btn btn-ghost" id="newRole">Nuevo rol</button>` : ''}
      </div>
      ${dataTable([
    { label: 'Rol', render: r => `<strong>${esc(r.name)}</strong>` },
    { key: 'description', label: 'Descripcion' },
    { key: 'users', label: 'Usuarios', num: true },
    { label: 'Permisos', num: true, render: r => r.code === 'super_admin' ? 'todos' : r.permissions.length },
    ...(can('users.manage') ? [{
      label: '', render: r => r.code === 'super_admin' ? ''
        : `<button class="btn btn-sm" data-perms="${r.id}">Permisos</button>`
    }] : [])
  ], roles)}
    </div>`;

  const userFields = u => [
    { name: 'name', label: 'Nombre completo', required: true, value: u?.name || '' },
    { name: 'email', label: 'Correo', type: 'email', required: true, value: u?.email || '' },
    {
      name: 'role_id', label: 'Rol', type: 'select', required: true, value: u?.role_id || '',
      options: roles.map(r => ({ value: r.id, label: r.name }))
    },
    { name: 'document', label: 'Documento', value: u?.document || '' },
    { name: 'phone', label: 'Telefono', value: u?.phone || '' },
    { name: 'pin', label: 'PIN de acceso rapido', value: u?.pin || '', help: '4 a 8 digitos, unico por usuario' },
    {
      name: 'password', label: u ? 'Contrasena nueva' : 'Contrasena', type: 'password',
      required: !u, help: u ? 'Dejala vacia para no cambiarla' : 'Minimo 8 caracteres'
    }
  ];

  const newBtn = host.querySelector('#new');
  if (newBtn) newBtn.onclick = () => formModal({
    title: 'Nuevo usuario', fields: userFields(null), size: 'wide',
    onSubmit: async (values, close) => { await api.post('/users', values); close(); toast('Usuario creado.'); load(host); }
  });

  host.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id === Number(b.dataset.edit));
    formModal({
      title: `Editar ${u.name}`, size: 'wide',
      fields: [...userFields(u), { name: 'is_active', label: 'Usuario activo', type: 'checkbox', value: !!u.is_active }],
      onSubmit: async (values, close) => {
        if (!values.password) delete values.password;
        await api.put(`/users/${u.id}`, values);
        close(); toast('Usuario actualizado.'); load(host);
      }
    });
  });

  host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id === Number(b.dataset.del));
    confirmAction({
      title: 'Eliminar usuario', danger: true, confirmLabel: 'Eliminar',
      message: `Se eliminara "${u.name}". Si tiene ventas registradas el sistema lo impedira.`,
      onConfirm: async () => {
        try { await api.del(`/users/${u.id}`); toast('Usuario eliminado.'); load(host); }
        catch (e) { notifyError(e); }
      }
    });
  });

  const roleBtn = host.querySelector('#newRole');
  if (roleBtn) roleBtn.onclick = () => formModal({
    title: 'Nuevo rol',
    fields: [
      { name: 'name', label: 'Nombre del rol', required: true },
      { name: 'description', label: 'Descripcion', full: true }
    ],
    onSubmit: async (values, close) => { await api.post('/roles', values); close(); toast('Rol creado.'); load(host); }
  });

  host.querySelectorAll('[data-perms]').forEach(b => b.onclick = () => {
    const role = roles.find(r => r.id === Number(b.dataset.perms));
    const modules = [...new Set(permissions.map(p => p.module))];

    const m = modal({
      title: `Permisos de ${role.name}`,
      size: 'wide',
      body: modules.map(mod => `
        <div class="card-head" style="margin-bottom:6px"><h2>${esc(mod)}</h2>
          <button class="btn btn-sm btn-ghost" data-all="${esc(mod)}">Marcar todo</button></div>
        <div class="form-grid" style="margin-bottom:12px">
          ${permissions.filter(p => p.module === mod).map(p => `
            <label class="check">
              <input type="checkbox" value="${esc(p.code)}" data-mod="${esc(mod)}"
                ${role.permissions.includes(p.code) ? 'checked' : ''}>
              <span>${esc(p.name)}</span>
            </label>`).join('')}
        </div>`).join(''),
      buttons: [
        { label: 'Cancelar' },
        {
          label: 'Guardar permisos', kind: 'btn-primary',
          action: async (close, root) => {
            const codes = [...root.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
            try {
              await api.put(`/roles/${role.id}/permissions`, { permissions: codes });
              close(); toast('Permisos actualizados.'); load(host);
            } catch (e) { notifyError(e); }
          }
        }
      ]
    });

    m.root.querySelectorAll('[data-all]').forEach(btn => btn.onclick = () => {
      const boxes = m.root.querySelectorAll(`input[data-mod="${btn.dataset.all}"]`);
      const allChecked = [...boxes].every(x => x.checked);
      boxes.forEach(x => { x.checked = !allChecked; });
    });
  });
}
