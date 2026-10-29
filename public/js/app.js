// Punto de entrada: sesion, navegacion y montaje de vistas.
import { api } from './api.js';
import { state, esc, can, toast, notifyError, debounce, money } from './ui.js';

// Sello de esta version de la interfaz. Debe coincidir con el del servidor.
// La version se lee de la propia direccion desde la que se cargo este archivo
// (/v/<version>/js/app.js). No hace falta un script suelto en la pagina.
const BUILD = (import.meta.url.match(/\/v\/([^/]+)\//) || [])[1] || 'desconocida';

const root = document.getElementById('root');

// ---------------------------------------------------------------------
// Mapa de vistas
// ---------------------------------------------------------------------
const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  mesas: () => import('./views/mesas.js'),
  pos: () => import('./views/pos.js'),
  ordenes: () => import('./views/ordenes.js'),
  cocina: () => import('./views/kds.js'),
  productos: () => import('./views/productos.js'),
  inventario: () => import('./views/inventario.js'),
  compras: () => import('./views/compras.js'),
  proveedores: () => import('./views/proveedores.js'),
  caja: () => import('./views/caja.js'),
  gastos: () => import('./views/gastos.js'),
  clientes: () => import('./views/clientes.js'),
  socios: () => import('./views/socios.js'),
  reportes: () => import('./views/reportes.js'),
  usuarios: () => import('./views/usuarios.js'),
  auditoria: () => import('./views/auditoria.js'),
  configuracion: () => import('./views/configuracion.js')
};

const NAV = [
  {
    group: 'Operacion', items: [
      { id: 'dashboard', label: 'Resumen', icon: '◧', perm: 'dashboard.view' },
      { id: 'mesas', label: 'Mesas', icon: '▦', perm: 'tables.view' },
      { id: 'pos', label: 'Vender', icon: '◈', perm: 'pos.use' },
      { id: 'ordenes', label: 'Ventas hechas', icon: '≡', perm: 'orders.view' },
      { id: 'cocina', label: 'Cocina y bar', icon: '◔', perm: 'kds.view' }
    ]
  },
  {
    group: 'Inventario', items: [
      { id: 'productos', label: 'Productos', icon: '◇', perm: 'products.view' },
      { id: 'inventario', label: 'Inventario', icon: '▤', perm: 'inventory.view' },
      { id: 'compras', label: 'Compras', icon: '↓', perm: 'purchases.view' },
      { id: 'proveedores', label: 'Proveedores', icon: '⌂', perm: 'suppliers.view' }
    ]
  },
  {
    group: 'Dinero', items: [
      { id: 'caja', label: 'Caja', icon: '▣', perm: 'cash.view' },
      { id: 'gastos', label: 'Gastos', icon: '↗', perm: 'expenses.view' },
      { id: 'reportes', label: 'Reportes', icon: '◑', perm: 'reports.view' }
    ]
  },
  {
    group: 'Administracion', items: [
      { id: 'clientes', label: 'Clientes', icon: '☺', perm: 'customers.view' },
      { id: 'socios', label: 'Socios', icon: '★', perm: 'partners.view' },
      { id: 'usuarios', label: 'Usuarios', icon: '◉', perm: 'users.view' },
      { id: 'auditoria', label: 'Quien hizo que', icon: '⌛', perm: 'audit.view' },
      { id: 'configuracion', label: 'Ajustes', icon: '⚙', perm: 'settings.view' }
    ]
  }
];

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
function renderLogin() {
  root.innerHTML = `
  <div class="login-screen">
    <div class="login-card">
      <img src="${esc(state.settings.logo_path || '/assets/logo.svg')}" alt="EL CHUPE Cantina"
           class="login-logo" data-fallback-logo>
      <div class="login-tabs">
        <button class="active" data-tab="pass">Correo y contrasena</button>
        <button data-tab="pin">PIN rapido</button>
      </div>

      <form id="passForm">
        <div class="field">
          <label for="email">Correo</label>
          <input type="email" id="email" autocomplete="username" required placeholder="admin@elchupe.local">
        </div>
        <div class="field">
          <label for="password">Contrasena</label>
          <input type="password" id="password" autocomplete="current-password" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">Entrar</button>
      </form>

      <div id="pinForm" class="hidden">
        <div class="pin-display" id="pinDisplay">····</div>
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-key="${n}">${n}</button>`).join('')}
          <button data-key="clear">C</button>
          <button data-key="0">0</button>
          <button data-key="enter" style="color:var(--oro)">→</button>
        </div>
      </div>

      <p class="small dim center mt">Sistema POS · Cafe bar</p>
    </div>
  </div>`;

  conectarLogos(root);

  const tabs = root.querySelectorAll('.login-tabs button');
  tabs.forEach(t => t.onclick = () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    root.querySelector('#passForm').classList.toggle('hidden', t.dataset.tab !== 'pass');
    root.querySelector('#pinForm').classList.toggle('hidden', t.dataset.tab !== 'pin');
  });

  root.querySelector('#passForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const data = await api.post('/auth/login', {
        email: root.querySelector('#email').value,
        password: root.querySelector('#password').value
      });
      state.user = data.user;
      await boot();
    } catch (err) {
      notifyError(err);
      btn.disabled = false;
    }
  };

  let pin = '';
  const display = root.querySelector('#pinDisplay');
  const paint = () => { display.textContent = pin.padEnd(4, '·'); };
  const submitPin = async () => {
    if (pin.length < 4) return toast('El PIN debe tener al menos 4 digitos.', 'warn');
    try {
      const data = await api.post('/auth/pin', { pin });
      state.user = data.user;
      await boot();
    } catch (err) { notifyError(err); pin = ''; paint(); }
  };

  root.querySelectorAll('.pin-pad button').forEach(b => b.onclick = () => {
    const key = b.dataset.key;
    if (key === 'clear') pin = '';
    else if (key === 'enter') return submitPin();
    else if (pin.length < 8) pin += key;
    paint();
    if (pin.length === 4) submitPin();
  });
}

// ---------------------------------------------------------------------
// Estructura de la aplicacion
// ---------------------------------------------------------------------
function renderShell() {
  const nav = NAV.map(group => {
    const items = group.items.filter(i => can(i.perm));
    if (items.length === 0) return '';
    return `<div class="nav-group">
      <div class="nav-group-title">${esc(group.group)}</div>
      ${items.map(i => `<div class="nav-item" data-view="${i.id}">
        <span class="nav-icon">${i.icon}</span><span>${esc(i.label)}</span></div>`).join('')}
    </div>`;
  }).join('');

  root.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <img src="${esc(state.settings.logo_path || '/assets/logo.svg')}" alt="${esc(state.settings.name)}"
             data-fallback-logo>
      </div>
      <nav class="sidebar-nav">${nav}</nav>
      <div class="sidebar-foot">
        <div class="row-between">
          <div style="min-width:0">
            <div class="bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(state.user.name)}</div>
            <div class="small dim">${esc(state.user.role_name)}</div>
          </div>
          <button class="btn btn-sm btn-ghost" id="logout" title="Cerrar sesion">Salir</button>
        </div>
        <div class="build-tag" title="Version del sistema">v${esc(BUILD)}</div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="menu-toggle" id="menuToggle" aria-label="Abrir menu">☰</button>
        <h1 id="viewTitle">Dashboard</h1>
        <div class="grow"></div>
        <div class="search-global">
          <input type="search" id="globalSearch" placeholder="Buscar producto, venta, mesa, cliente…" autocomplete="off">
          <div class="search-results hidden" id="searchResults"></div>
        </div>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>`;

  conectarLogos(root);

  root.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => { location.hash = '#/' + el.dataset.view; closeSidebar(); };
  });

  root.querySelector('#logout').onclick = async () => {
    await api.post('/auth/logout').catch(() => {});
    state.user = null;
    location.hash = '';
    renderLogin();
  };

  const sidebar = root.querySelector('#sidebar');
  root.querySelector('#menuToggle').onclick = () => {
    sidebar.classList.add('open');
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.onclick = closeSidebar;
    root.querySelector('.app').appendChild(scrim);
  };

  bindGlobalSearch();
}

function closeSidebar() {
  root.querySelector('#sidebar')?.classList.remove('open');
  root.querySelector('.scrim')?.remove();
}

// ---------------------------------------------------------------------
// Busqueda global
// ---------------------------------------------------------------------
function bindGlobalSearch() {
  const input = root.querySelector('#globalSearch');
  const box = root.querySelector('#searchResults');
  if (!input) return;

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.classList.add('hidden'); return; }
    try {
      const r = await api.get('/search', { q });
      const groups = [
        ['Productos', r.products, p => `${esc(p.name)} <span class="dim small">· ${esc(p.code)} · ${money(p.price)}</span>`, p => `#/productos?id=${p.id}`],
        ['Ventas', r.orders, o => `Venta #${esc(o.number)} <span class="dim small">· ${money(o.total)}</span>`, o => `#/ordenes?id=${o.id}`],
        ['Mesas', r.tables, t => `${esc(t.name)} <span class="dim small">· ${esc(t.zone_name)}</span>`, () => `#/mesas`],
        ['Clientes', r.customers, c => `${esc(c.name)} <span class="dim small">· ${esc(c.phone || '')}</span>`, () => `#/clientes`],
        ['Proveedores', r.suppliers, s => `${esc(s.name)} <span class="dim small">· ${esc(s.company || '')}</span>`, () => `#/proveedores`]
      ].filter(([, list]) => list && list.length);

      if (groups.length === 0) {
        box.innerHTML = `<div class="sr-item dim">Sin resultados para "${esc(q)}".</div>`;
      } else {
        box.innerHTML = groups.map(([title, list, render, href]) =>
          `<div class="sr-group">${title}</div>` +
          list.map(item => `<div class="sr-item" data-href="${href(item)}">${render(item)}</div>`).join('')
        ).join('');
        box.querySelectorAll('[data-href]').forEach(el => el.onclick = () => {
          location.hash = el.dataset.href;
          box.classList.add('hidden');
          input.value = '';
        });
      }
      box.classList.remove('hidden');
    } catch (e) { box.classList.add('hidden'); }
  });

  input.oninput = run;
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-global')) box.classList.add('hidden');
  });
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
let currentCleanup = null;
let turnoActual = 0;

async function route() {
  if (!state.user) return;
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [name, queryString] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryString || ''));

  const navItem = NAV.flatMap(g => g.items).find(i => i.id === name);
  const allowed = navItem && can(navItem.perm) && VIEWS[name];
  const target = allowed ? name : firstAllowedView();

  if (target !== name) { location.hash = '#/' + target; return; }

  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === target));
  document.getElementById('viewTitle').textContent = navItem?.label || 'EL CHUPE';

  if (currentCleanup) { try { currentCleanup(); } catch (e) { /* vista sin limpieza */ } currentCleanup = null; }

  /**
   * Cada pantalla estrena su propio contenedor.
   *
   * Si una pantalla anterior dejo una consulta a medio camino, al terminar va a
   * escribir en SU contenedor, que para entonces ya esta fuera de la pagina.
   * Asi no puede pintar encima de lo que el usuario este haciendo ahora.
   */
  const anterior = document.getElementById('view');
  const host = document.createElement('main');
  host.id = 'view';
  host.className = anterior.className;
  anterior.replaceWith(host);

  host.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando…</div>`;

  // Marca de esta navegacion. Si el usuario cambia de pantalla mientras esta
  // se esta cargando, la que llegue tarde no monta nada.
  const miTurno = ++turnoActual;

  try {
    const module = await VIEWS[target]();
    if (miTurno !== turnoActual) return;

    const limpieza = await module.render(host, params) || null;

    if (miTurno !== turnoActual) {
      // El usuario ya se fue a otra parte: se apaga lo que esta alcanzo a dejar.
      if (limpieza) { try { limpieza(); } catch (e) { /* nada */ } }
      return;
    }
    currentCleanup = limpieza;
  } catch (e) {
    if (miTurno !== turnoActual) return;
    console.error(e);
    host.innerHTML = `<div class="card"><div class="empty">
      <strong>No se pudo abrir esta seccion</strong>${esc(e.message || '')}</div></div>`;
  }
}

function firstAllowedView() {
  for (const group of NAV) {
    for (const item of group.items) if (can(item.perm) && VIEWS[item.id]) return item.id;
  }
  return 'dashboard';
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
/**
 * Confirma que la interfaz que cargo el navegador y el servidor que responde
 * sean de la misma version. Si no, se explica que hacer en lugar de dejar que
 * salgan errores raros mas adelante.
 */
async function checkVersion() {
  let info = null;
  try { info = await api.get('/version'); }
  catch (e) { info = null; }

  if (info && info.build === BUILD) return true;

  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="version-warn">
      <div class="version-card">
        <img src="/assets/logo.svg" alt="EL CHUPE" class="version-logo">
        <h2>El sistema quedo a medio actualizar</h2>
        <p>
          La pantalla que estas viendo es de la version <strong>${esc(BUILD)}</strong>,
          pero el programa que esta corriendo ${info
      ? `es de la version <strong>${esc(info.build || 'anterior')}</strong>`
      : `es de una version anterior`}.
        </p>
        <ol>
          <li><strong>Cierra la ventana negra</strong> donde corre el sistema.
              No basta con cerrar el navegador: el programa sigue en memoria con
              los archivos viejos.</li>
          <li>Vuelve a abrirla con <strong>iniciar.bat</strong>.</li>
          <li>Aqui en el navegador presiona <strong>Ctrl + Shift + R</strong>.</li>
        </ol>
        <button class="btn btn-primary btn-lg" id="reintentar">Ya lo hice, reintentar</button>
      </div>
    </div>`;
  document.getElementById('reintentar').onclick = () => location.reload(true);
  return false;
}

/**
 * El CSP no permite manejadores onerror escritos dentro del HTML, asi que el
 * respaldo del logo se conecta aqui. Si la imagen configurada no carga (por
 * ejemplo si se perdio la carpeta uploads al actualizar), se muestra el logo
 * de respaldo que viene con el sistema.
 */
function conectarLogos(scope = document) {
  scope.querySelectorAll('img[data-fallback-logo]').forEach(img => {
    img.addEventListener('error', () => {
      if (img.dataset.yaFallo) return;
      img.dataset.yaFallo = '1';
      img.src = '/assets/logo.svg';
    });
    // Si la ruta guardada devuelve HTML en vez de imagen, tambien se detecta.
    if (img.complete && img.naturalWidth === 0) img.dispatchEvent(new Event('error'));
  });
}

async function boot() {
  if (!(await checkVersion())) return;
  try {
    const me = await api.get('/auth/me');
    state.user = me.user;
    state.settings = { ...state.settings, ...me.settings };
    renderShell();
    if (!location.hash) location.hash = '#/' + firstAllowedView();
    await route();
  } catch (e) {
    state.user = null;
    renderLogin();
  }
}

window.addEventListener('hashchange', route);
boot();
