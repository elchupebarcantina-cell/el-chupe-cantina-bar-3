import { api } from '../api.js';
import {
  esc, money, qty, pct, can, notifyError, barChart, rankBars,
  rangeSelector, bindRange, dataTable, tagFor, dateTime, timeOnly, dateOnly, ayuda
} from '../ui.js';

let currentQuery = { range: 'today' };

export async function render(host) {
  await load(host);
  // La jornada se refresca sola para ver las ventas entrando en vivo.
  // El temporizador se guarda aqui adentro, no en una variable compartida:
  // si dos pantallas se montan seguidas, cada una apaga el suyo y no el ajeno.
  const reloj = setInterval(() => {
    // Si esta pantalla ya no esta visible, el temporizador se apaga solo.
    if (!host.isConnected) return clearInterval(reloj);
    load(host, true);
  }, 25000);
  return () => clearInterval(reloj);
}

// Valores neutros por si el servidor responde algo incompleto.
const KPI_VACIO = {
  sales: 0, orders: 0, average_ticket: 0, discounts: 0, taxes: 0, cost: 0,
  gross_profit: 0, margin_pct: 0, expenses: 0, net_profit: 0,
  voided_count: 0, voided_total: 0
};

async function load(host, silent = false) {
  let d;
  try { d = await api.get('/dashboard', currentQuery); }
  catch (e) { if (!silent) notifyError(e); return; }

  // Si la interfaz quedo desfasada del servidor, se avisa en lugar de reventar.
  if (!d || !d.shift) {
    host.innerHTML = `<div class="card"><div class="empty">
      <strong>Tu navegador tiene guardada una version anterior</strong>
      Recarga la pagina con Ctrl + Shift + R (en Mac: Cmd + Shift + R) para
      traer la version nueva del sistema.
    </div></div>`;
    return;
  }

  // Blindaje: si falta algun bloque, se muestra vacio en vez de romper la vista.
  d.shift = d.shift || KPI_VACIO;
  d.day = d.day || KPI_VACIO;
  d.yesterday = d.yesterday || KPI_VACIO;
  d.week = d.week || KPI_VACIO;
  d.month = d.month || KPI_VACIO;
  d.period = d.period || KPI_VACIO;
  d.shift_info = d.shift_info || { status: 'none' };
  d.shift_top_products = d.shift_top_products || [];
  d.shift_by_payment = d.shift_by_payment || [];
  d.shift_by_waiter = d.shift_by_waiter || [];
  d.expenses_recent = d.expenses_recent || [];
  d.setup = d.setup || {};
  d.alerts = d.alerts || [];
  d.top_products = d.top_products || [];
  d.slow_products = d.slow_products || [];
  d.by_category = d.by_category || [];
  d.by_waiter = d.by_waiter || [];
  d.by_payment = d.by_payment || [];
  d.sales_by_day = d.sales_by_day || [];
  d.sales_by_hour = d.sales_by_hour || [];
  d.tables = d.tables || { total: 0, available: 0, occupied: 0, bill_requested: 0 };
  d.open_orders = d.open_orders || { c: 0, t: 0 };

  // Al refrescar solo, no se pierde la posicion en la pagina.
  const scroll = silent ? window.scrollY : 0;

  const showProfit = can('reports.profit') || can('products.cost');

  // Negocio recien instalado: en vez de puros ceros, se muestra la guia.
  const s = d.setup;
  if ((s.products === 0 || s.tables === 0) && s.sales === 0) {
    host.innerHTML = primerosPasos(s);
    host.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => location.hash = b.dataset.ir);
    return;
  }

  host.innerHTML = `
    ${ayuda('¿Qué estoy viendo aquí?', [
      '<strong>La jornada</strong> es lo que va desde que abriste la caja hasta ahora. Se actualiza solo.',
      '<strong>El día de hoy</strong> son las cuentas de hoy en el calendario, con lo que vendiste y lo que gastaste.',
      '<strong>El mes</strong> es el acumulado desde el día 1.',
      'La <strong>utilidad neta</strong> es lo que de verdad te quedó: ventas menos lo que costó menos los gastos.'
    ], 'Si un número te parece raro, revisa que hayas anotado los gastos en la pantalla de Gastos.')}

    <div class="card-head">
      <h2>Resumen del negocio</h2>
      ${rangeSelector(currentQuery.range || 'custom')}
    </div>

    ${shiftBanner(d)}

    <h3 class="section-title">La jornada en vivo</h3>
    <div class="grid grid-kpi mb">
      ${kpi('Ventas de la jornada', money(d.shift.sales), `${d.shift.orders} ordenes cobradas`, true)}
      ${kpi('Ticket promedio', money(d.shift.average_ticket), 'de esta jornada')}
      ${kpi('Cuentas abiertas', String(d.open_orders.c), money(d.open_orders.t) + ' sin cobrar')}
      ${kpi('Mesas ocupadas', `${d.tables.occupied}/${d.tables.total}`,
    `${d.tables.available} libres · ${d.tables.bill_requested} pidiendo cuenta`)}
      ${d.cash ? kpi('Efectivo en caja', money(d.cash.expected_amount), 'esperado ahora mismo') : ''}
      ${showProfit ? kpi('Utilidad de la jornada', money(d.shift.gross_profit), `Margen ${pct(d.shift.margin_pct)}`) : ''}
    </div>

    <h3 class="section-title">El dia de hoy</h3>
    <div class="grid grid-kpi mb">
      ${kpi('Ventas del dia', money(d.day.sales), `${d.day.orders} ordenes · ${variacion(d.day.sales, d.yesterday.sales)}`)}
      ${kpi('Gastos del dia', money(d.day.expenses), 'salidas registradas hoy')}
      ${showProfit ? kpi('Utilidad neta del dia', money(d.day.net_profit), 'ventas menos costo y gastos') : ''}
      ${kpi('Ticket promedio del dia', money(d.day.average_ticket), 'por cuenta cobrada')}
      ${kpi('Descuentos del dia', money(d.day.discounts), 'rebajas aplicadas')}
      ${kpi('Anuladas hoy', String(d.day.voided_count), money(d.day.voided_total) + ' en ventas')}
    </div>

    <h3 class="section-title">El mes</h3>
    <div class="grid grid-kpi mb">
      ${kpi('Ventas del mes', money(d.month.sales), `${d.month.orders} ordenes`)}
      ${kpi('Gastos del mes', money(d.month.expenses), 'compras y gastos operativos')}
      ${showProfit ? kpi('Utilidad bruta del mes', money(d.month.gross_profit), `Margen ${pct(d.month.margin_pct)}`) : ''}
      ${showProfit ? kpi('Utilidad neta del mes', money(d.month.net_profit), 'despues de gastos') : ''}
      ${kpi('Ticket promedio del mes', money(d.month.average_ticket), 'por cuenta')}
      ${kpi('Esta semana', money(d.week.sales), `${d.week.orders} ordenes`)}
    </div>

    ${d.alerts.length ? `<div class="banner warn">
      <strong>${d.alerts.length} producto(s) necesitan reposicion.</strong>
      ${esc(d.alerts.slice(0, 4).map(a => a.name).join(', '))}${d.alerts.length > 4 ? '…' : ''}
      <a href="#/inventario"> Ver inventario</a>
    </div>` : ''}

    ${d.cash ? `<div class="banner">
      Caja abierta por ${esc(d.cash.opened_by_name)} · efectivo esperado
      <strong>${money(d.cash.expected_amount)}</strong> · ${d.cash.orders_count} ventas cobradas.
      <a href="#/caja"> Ver caja</a>
    </div>` : `<div class="banner warn">No hay caja abierta. <a href="#/caja">Abrir caja</a></div>`}

    <div class="grid grid-3 mb">
      <div class="card">
        <div class="card-head"><h2>Lo mas vendido en la jornada</h2><span class="tag tag-gold">en vivo</span></div>
        ${rankBars(d.shift_top_products, { labelKey: 'product_name', valueKey: 'quantity', format: v => qty(v) + ' und' })}
      </div>
      <div class="card">
        <div class="card-head"><h2>Cobros de la jornada</h2><span class="tag tag-gold">en vivo</span></div>
        ${rankBars(d.shift_by_payment, { labelKey: 'name', valueKey: 'total' })}
      </div>
      <div class="card">
        <div class="card-head"><h2>Meseros en la jornada</h2><span class="tag tag-gold">en vivo</span></div>
        ${rankBars(d.shift_by_waiter, { labelKey: 'name', valueKey: 'total' })}
      </div>
    </div>

    <div class="grid grid-2 mb">
      <div class="card">
        <div class="card-head"><h2>Ventas de los ultimos 30 dias</h2></div>
        ${barChart(d.sales_by_day.map(r => ({ label: r.day.slice(5), value: r.total })), { height: 200 })}
      </div>
      <div class="card">
        <div class="card-head"><h2>Ventas por hora</h2></div>
        ${barChart(d.sales_by_hour.map(r => ({ label: r.hour + 'h', value: r.total })), { height: 200 })}
      </div>
    </div>

    <div class="grid grid-3 mb">
      <div class="card">
        <div class="card-head"><h2>Productos mas vendidos</h2></div>
        ${rankBars(d.top_products, { labelKey: 'product_name', valueKey: 'quantity', format: v => qty(v) + ' und' })}
      </div>
      <div class="card">
        <div class="card-head"><h2>Ventas por categoria</h2></div>
        ${rankBars(d.by_category, { labelKey: 'name', valueKey: 'total' })}
      </div>
      <div class="card">
        <div class="card-head"><h2>Metodos de pago</h2></div>
        ${rankBars(d.by_payment, { labelKey: 'name', valueKey: 'total' })}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Ventas por mesero</h2></div>
        ${dataTable([
      { key: 'name', label: 'Mesero' },
      { key: 'orders', label: 'Ordenes', num: true },
      { label: 'Promedio', num: true, render: r => money(r.average_ticket) },
      { label: 'Total', num: true, render: r => `<strong>${money(r.total)}</strong>` }
    ], d.by_waiter, { empty: 'Sin ventas en este periodo.' })}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Alertas de inventario</h2>
          <a class="small" href="#/inventario">Ver todo</a>
        </div>
        ${dataTable([
      { key: 'name', label: 'Producto' },
      { label: 'Stock', num: true, render: r => `${qty(r.stock)} ${esc(r.unit)}` },
      { label: 'Minimo', num: true, render: r => qty(r.min_stock) },
      { label: 'Estado', render: r => tagFor(r.level) }
    ], d.alerts.slice(0, 10), { empty: 'Todo el inventario esta en niveles adecuados.' })}
      </div>
    </div>

    <div class="grid grid-2 mt">
      <div class="card">
        <div class="card-head">
          <h2>Ultimos gastos del mes</h2>
          <a class="small" href="#/gastos">Ver todos</a>
        </div>
        ${dataTable([
      { label: 'Fecha', render: r => dateOnly(r.expense_date) },
      { key: 'category_name', label: 'Categoria' },
      { key: 'description', label: 'Descripcion' },
      { label: 'Valor', num: true, render: r => `<strong>${money(r.amount)}</strong>` }
    ], d.expenses_recent, { empty: 'No hay gastos registrados este mes.' })}
      </div>

      <div class="card">
        <div class="card-head"><h2>Productos con menor rotacion</h2></div>
      ${dataTable([
      { key: 'product_name', label: 'Producto' },
      { key: 'category', label: 'Categoria' },
      { label: 'Vendidos', num: true, render: r => qty(r.quantity) },
      { label: 'Total', num: true, render: r => money(r.total) }
    ], d.slow_products, { empty: 'Sin datos suficientes en este periodo.' })}
      </div>
    </div>
  `;

  bindRange(host, q => { currentQuery = q; load(host); });
  if (silent && scroll) window.scrollTo(0, scroll);
}

/** Compara con ayer en palabras claras. */
function variacion(hoy, ayer) {
  if (!ayer) return 'sin dato de ayer';
  const dif = ((hoy - ayer) / ayer) * 100;
  if (Math.abs(dif) < 0.5) return 'igual que ayer';
  return `${dif > 0 ? '+' : ''}${dif.toFixed(0)}% vs ayer`;
}

/**
 * Guia de arranque. Aparece mientras el negocio esta vacio, para que la
 * primera pantalla diga que hacer en vez de mostrar ceros.
 */
function primerosPasos(s) {
  const paso = (hecho, num, icono, titulo, texto, boton, ir) => `
    <div class="paso ${hecho ? 'listo' : ''}">
      <div class="paso-num">${hecho ? '✓' : num}</div>
      <div class="paso-cuerpo">
        <div class="paso-titulo">${icono} ${esc(titulo)}</div>
        <div class="paso-texto">${esc(texto)}</div>
      </div>
      ${hecho
      ? `<span class="paso-listo">Listo</span>`
      : `<button class="btn btn-primary" data-ir="${ir}">${esc(boton)}</button>`}
    </div>`;

  return `
    <div class="bienvenida">
      <div class="bv-icono">🍹</div>
      <h2>¡Bienvenido a tu sistema!</h2>
      <p>Está limpio y listo para tu negocio. Vamos paso a paso: son cuatro
         cosas y quedas funcionando.</p>
    </div>

    <div class="pasos">
      ${paso(s.named, 1, '🏪', 'Ponle los datos de tu negocio',
    'El nombre, el NIT, la dirección y el teléfono. Eso sale en las facturas.',
    'Ir a Ajustes', '#/configuracion')}

      ${paso(s.tables > 0, 2, '🪑', 'Arma tus mesas',
    'Crea las zonas de tu local y las mesas de cada una.',
    'Crear mesas', '#/mesas')}

      ${paso(s.products > 0, 3, '🍹', 'Carga tu carta',
    'Los tragos, la comida y las cervezas con sus precios. Después le armas las recetas a los cócteles.',
    'Cargar productos', '#/productos')}

      ${paso(s.users > 1, 4, '👥', 'Crea tus meseros y cajeros',
    'Cada uno con su PIN para entrar rápido desde una tablet.',
    'Crear usuarios', '#/usuarios')}
    </div>

    <div class="bv-nota">
      Cuando termines, abre la caja y empieza a vender. Este resumen se va a
      llenar solo con tus números reales.
      ${can('backup.manage') ? '<br>Si quieres practicar antes con datos de prueba, pídele a quien te instaló el sistema que ejecute <code>npm run demo</code>.' : ''}
    </div>`;
}

function kpi(label, value, sub, destacado = false) {
  return `<div class="kpi${destacado ? ' kpi-live' : ''}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(value)}</div>
    <div class="kpi-sub">${esc(sub)}</div>
  </div>`;
}

/** Explica de que periodo son los numeros de la jornada. */
function shiftBanner(d) {
  const info = d.shift_info;

  if (info.status === 'open') {
    return `<div class="banner live">
      <span class="live-dot"></span>
      Jornada abierta desde las <strong>${esc(timeOnly(info.opened_at))}</strong>
      del ${esc(fechaCorta(info.opened_at))}. Los numeros de abajo se actualizan solos
      mientras la caja este abierta.
    </div>`;
  }

  if (info.status === 'closed') {
    return `<div class="banner warn">
      No hay caja abierta. Estas viendo la ultima jornada:
      del <strong>${esc(dateTime(info.opened_at))}</strong> al
      <strong>${esc(dateTime(info.closed_at))}</strong>.
      <a href="#/caja"> Abrir caja</a>
    </div>`;
  }

  return `<div class="banner warn">
    Todavia no se ha abierto ninguna caja. Mientras tanto se muestra el dia calendario.
    <a href="#/caja"> Abrir caja</a>
  </div>`;
}

function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
}
