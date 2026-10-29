import { api } from '../api.js';
import {
  state, esc, money, qty, can, toast, notifyError, modal, formModal, confirmAction,
  promptReason, printHtml, sep, dateTime, timeOnly, debounce
} from '../ui.js';

let ctx = { order: null, products: [], categories: [], category: null, search: '', methods: [] };

export async function render(host, params) {
  const [products, categories, methods] = await Promise.all([
    api.get('/products', { sellable: 1 }),
    api.get('/categories'),
    api.get('/payment-methods')
  ]);

  ctx = { order: null, products, categories, category: null, search: '', methods };

  if (params.order) {
    try { ctx.order = await api.get(`/orders/${params.order}`); }
    catch (e) { notifyError(e); }
  }

  paint(host);
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
function paint(host) {
  host.innerHTML = `
    <div class="pos-layout">
      <div class="pos-catalog">
        <input type="search" id="prodSearch" placeholder="Buscar producto o codigo…" value="${esc(ctx.search)}">
        <div class="cat-strip">
          <button class="cat-chip ${ctx.category === null ? 'active' : ''}" data-cat="">Favoritos</button>
          <button class="cat-chip ${ctx.category === 'all' ? 'active' : ''}" data-cat="all">Todos</button>
          ${ctx.categories.filter(c => c.station !== 'none').map(c =>
    `<button class="cat-chip ${ctx.category === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
        </div>
        <div class="product-grid" id="productGrid">${productTiles()}</div>
      </div>
      <aside class="cart" id="cart">${cartHtml()}</aside>
    </div>`;

  bind(host);
}

function visibleProducts() {
  let list = ctx.products;
  if (ctx.search) {
    const q = ctx.search.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q)
      || (p.barcode || '').toLowerCase().includes(q));
  } else if (ctx.category === null) {
    list = list.filter(p => p.is_favorite);
    if (list.length === 0) list = ctx.products.slice(0, 24);
  } else if (ctx.category !== 'all') {
    list = list.filter(p => p.category_id === ctx.category);
  }
  return list.slice(0, 200);
}

function productTiles() {
  const list = visibleProducts();
  if (list.length === 0) {
    return `<div class="empty" style="grid-column:1/-1">
      <strong>Nada por aqui</strong>Prueba con otra categoria o cambia la busqueda.</div>`;
  }
  return list.map(p => {
    const out = p.track_stock && p.stock <= 0;
    return `<button class="product-tile ${out ? 'out' : ''}" data-product="${p.id}">
      <span class="pt-name">${esc(p.name)}</span>
      <span>
        <span class="pt-price">${money(p.price)}</span>
        ${p.track_stock ? `<span class="pt-stock"> · ${qty(p.stock)} ${esc(p.unit)}</span>` : ''}
        ${p.type === 'recipe' ? `<span class="pt-stock"> · receta</span>` : ''}
      </span>
    </button>`;
  }).join('');
}

function cartHtml() {
  const o = ctx.order;

  if (!o) {
    return `<div class="cart-head"><strong>Sin cuenta abierta</strong></div>
      <div class="empty">
        <strong>Elige donde cobrar</strong>
        Abre una cuenta desde Mesas o crea una venta de mostrador.
      </div>
      <div class="cart-actions">
        <button class="btn btn-primary btn-block" id="newCounter">Venta de mostrador</button>
        <button class="btn btn-ghost btn-block" id="goTables">Ir a mesas</button>
      </div>`;
  }

  const paid = o.status === 'paid';
  const voided = o.status === 'void';

  return `
    <div class="cart-head">
      <div class="row-between">
        <div>
          <strong>${esc(o.table_name || 'Mostrador')}</strong>
          <div class="small dim">Cuenta #${esc(o.number)} · ${esc(o.waiter_name || 'sin mesero')}</div>
        </div>
        <div class="right small dim">
          ${esc(timeOnly(o.opened_at))}<br>${esc(o.guests)} pers.
        </div>
      </div>
      ${o.partner_id ? `<div class="banner socio-banner mt" style="margin-bottom:0">
        <span>★ Socio: <strong>${esc(o.partner_name)}</strong> · CC ${esc(o.partner_document)}</span>
        ${!paid && !voided ? `<button class="btn btn-sm btn-ghost" id="removePartner">Quitar</button>` : ''}
      </div>` : ''}
      ${paid ? `<div class="banner mt" style="margin-bottom:0">Cuenta pagada y cerrada.</div>` : ''}
      ${voided ? `<div class="banner danger mt" style="margin-bottom:0">Venta anulada: ${esc(o.void_reason || '')}</div>` : ''}
    </div>

    <div class="cart-items">
      ${o.items.length === 0
      ? `<div class="empty">Agrega productos tocando el catalogo.</div>`
      : o.items.map(i => cartItem(i, paid || voided)).join('')}
    </div>

    <div class="cart-totals">
      <div class="cart-line"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
      ${o.discount_amount > 0 ? `<div class="cart-line"><span>${o.partner_id ? 'Descuento socio' : 'Descuento'}${o.discount_type === 'percent' ? ` (${qty(o.discount_value)}%)` : ''}</span><span class="pos-neg">-${money(o.discount_amount)}</span></div>` : ''}
      ${o.tax_amount > 0 ? `<div class="cart-line"><span>Impuestos</span><span>${money(o.tax_amount)}</span></div>` : ''}
      ${o.service_amount > 0 ? `<div class="cart-line"><span>Servicio</span><span>${money(o.service_amount)}</span></div>` : ''}
      <div class="cart-line total"><span>Total</span><span>${money(o.total)}</span></div>
      ${o.paid_amount > 0 && !paid ? `
        <div class="cart-line"><span>Abonado</span><span>${money(o.paid_amount)}</span></div>
        <div class="cart-line bold"><span>Falta</span><span>${money(o.balance)}</span></div>` : ''}
    </div>

    <div class="cart-actions">
      ${paid || voided ? `
        <button class="btn btn-primary btn-block" id="printTicket">Imprimir factura</button>
        <button class="btn btn-ghost btn-block" id="closeOrder">Nueva cuenta</button>
      ` : `
        <div class="row">
          <button class="btn grow" id="sendKitchen">Enviar a cocina</button>
          <button class="btn grow" id="printTicket">Imprimir</button>
        </div>
        <div class="row">
          ${o.partner_id ? '' : `<button class="btn grow btn-socio" id="partner">★ Socio</button>`}
          ${can('orders.discount') ? `<button class="btn grow" id="discount">Descuento</button>` : ''}
          <button class="btn grow" id="requestBill">Pedir cuenta</button>
        </div>
        <button class="btn btn-primary btn-block btn-lg" id="pay"
          ${o.items.length === 0 ? 'disabled' : ''}>Cobrar ${money(o.balance)}</button>
        ${can('orders.void') ? `<button class="btn btn-danger btn-block btn-sm" id="voidOrder">Anular cuenta</button>` : ''}
      `}
    </div>`;
}

function cartItem(item, locked) {
  return `<div class="cart-item" data-item="${item.id}">
    <div class="cart-item-top">
      <div class="grow">
        <div class="cart-item-name">${esc(item.product_name)}</div>
        ${item.notes ? `<div class="cart-item-note">${esc(item.notes)}</div>` : ''}
        <div class="small dim">${money(item.unit_price)} c/u${item.sent_at ? ' · enviado' : ''}</div>
      </div>
      <div class="right bold">${money(item.total)}</div>
    </div>
    ${locked ? '' : `<div class="cart-item-controls">
      <button class="qty-btn" data-act="minus">−</button>
      <span class="qty-value">${qty(item.quantity)}</span>
      <button class="qty-btn" data-act="plus">+</button>
      <div class="grow"></div>
      <button class="btn btn-sm btn-ghost" data-act="note">Nota</button>
      <button class="btn btn-sm btn-danger" data-act="remove">Quitar</button>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
function bind(host) {
  const search = host.querySelector('#prodSearch');
  if (search) {
    search.oninput = debounce(() => {
      ctx.search = search.value.trim();
      host.querySelector('#productGrid').innerHTML = productTiles();
      bindProducts(host);
    }, 160);
    // Lector de codigo de barras: al pulsar Enter, agrega el unico resultado
    search.onkeydown = async e => {
      if (e.key !== 'Enter') return;
      const list = visibleProducts();
      if (list.length === 1 && ctx.order) {
        await addProduct(list[0].id, host);
        search.value = '';
        ctx.search = '';
        host.querySelector('#productGrid').innerHTML = productTiles();
        bindProducts(host);
      }
    };
  }

  host.querySelectorAll('.cat-chip').forEach(chip => chip.onclick = () => {
    ctx.category = chip.dataset.cat === '' ? null : (chip.dataset.cat === 'all' ? 'all' : Number(chip.dataset.cat));
    ctx.search = '';
    paint(host);
  });

  bindProducts(host);
  bindCart(host);
}

function bindProducts(host) {
  host.querySelectorAll('[data-product]').forEach(tile => {
    tile.onclick = () => addProduct(Number(tile.dataset.product), host);
  });
}

function bindCart(host) {
  const cart = host.querySelector('#cart');
  if (!cart) return;

  const on = (id, fn) => { const el = cart.querySelector('#' + id); if (el) el.onclick = fn; };

  on('newCounter', async () => {
    try {
      ctx.order = await api.post('/orders', { type: 'counter', guests: 1 });
      paint(host);
    } catch (e) { notifyError(e); }
  });
  on('goTables', () => location.hash = '#/mesas');
  on('closeOrder', () => { ctx.order = null; location.hash = '#/mesas'; });

  on('sendKitchen', async () => {
    try {
      const result = await api.post(`/orders/${ctx.order.id}/send`);
      toast(`${result.sent} producto(s) enviados a produccion.`);
      printCommands(result.items);
      await reload(host);
    } catch (e) { notifyError(e); }
  });

  on('printTicket', () => printTicket(ctx.order));
  on('requestBill', async () => {
    try { ctx.order = await api.post(`/orders/${ctx.order.id}/request-bill`); paint(host); toast('Cuenta solicitada.'); }
    catch (e) { notifyError(e); }
  });
  on('discount', () => discountModal(host));
  on('partner', () => partnerModal(host));
  on('removePartner', () => confirmAction({
    title: 'Quitar descuento de socio',
    message: `Se quita el descuento de ${ctx.order.partner_name}. Recupera ese uso del mes.`,
    confirmLabel: 'Quitar descuento',
    onConfirm: async () => {
      try {
        ctx.order = await api.del(`/orders/${ctx.order.id}/partner`);
        toast('Descuento de socio retirado.');
        paint(host);
      } catch (e) { notifyError(e); }
    }
  }));
  on('pay', () => payModal(host));
  on('voidOrder', () => promptReason({
    title: `Anular la cuenta #${ctx.order.number}`,
    label: 'Motivo de la anulacion',
    placeholder: 'Ejemplo: pedido equivocado',
    confirmLabel: 'Anular venta',
    onConfirm: async reason => {
      try {
        ctx.order = await api.post(`/orders/${ctx.order.id}/void`, { reason });
        toast('Venta anulada. El inventario fue devuelto.');
        paint(host);
      } catch (e) { notifyError(e); }
    }
  }));

  cart.querySelectorAll('.cart-item').forEach(row => {
    const itemId = Number(row.dataset.item);
    const item = ctx.order.items.find(i => i.id === itemId);
    row.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async e => {
      e.stopPropagation();
      const act = btn.dataset.act;
      try {
        if (act === 'plus') {
          ctx.order = await api.put(`/orders/${ctx.order.id}/items/${itemId}`, { quantity: item.quantity + 1 });
        } else if (act === 'minus') {
          if (item.quantity <= 1) return removeItem(itemId, host);
          ctx.order = await api.put(`/orders/${ctx.order.id}/items/${itemId}`, { quantity: item.quantity - 1 });
        } else if (act === 'remove') {
          return removeItem(itemId, host);
        } else if (act === 'note') {
          return noteModal(item, host);
        }
        paint(host);
      } catch (err) { notifyError(err); }
    });
  });
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------
async function addProduct(productId, host) {
  if (!ctx.order) {
    return toast('Abre una cuenta primero: elige una mesa o crea una venta de mostrador.', 'warn');
  }
  if (['paid', 'void'].includes(ctx.order.status)) {
    return toast('Esta cuenta ya esta cerrada.', 'warn');
  }
  try {
    ctx.order = await api.post(`/orders/${ctx.order.id}/items`, { product_id: productId, quantity: 1 });
    paint(host);
  } catch (e) { notifyError(e); }
}

function removeItem(itemId, host) {
  const item = ctx.order.items.find(i => i.id === itemId);
  confirmAction({
    title: 'Quitar producto',
    message: `Se retira "${item.product_name}" de la cuenta y el inventario vuelve a su lugar.`,
    confirmLabel: 'Quitar', danger: true,
    onConfirm: async () => {
      try {
        ctx.order = await api.del(`/orders/${ctx.order.id}/items/${itemId}`);
        paint(host);
      } catch (e) { notifyError(e); }
    }
  });
}

function noteModal(item, host) {
  formModal({
    title: 'Observacion para cocina o bar',
    fields: [{
      name: 'notes', label: item.product_name, type: 'textarea', full: true,
      value: item.notes || '', placeholder: 'Sin hielo, termino medio, sin cebolla…'
    }],
    submitLabel: 'Guardar nota',
    onSubmit: async (values, close) => {
      ctx.order = await api.put(`/orders/${ctx.order.id}/items/${item.id}`, { notes: values.notes || null });
      close();
      paint(host);
    }
  });
}

function discountModal(host) {
  const o = ctx.order;
  formModal({
    title: 'Aplicar descuento',
    fields: [
      {
        name: 'type', label: 'Tipo', type: 'select', value: o.discount_type || '',
        options: [
          { value: '', label: 'Sin descuento' },
          { value: 'percent', label: 'Porcentaje' },
          { value: 'amount', label: 'Valor fijo' },
          { value: 'courtesy', label: 'Cortesia (100%)' }
        ]
      },
      { name: 'value', label: 'Valor', type: 'number', value: o.discount_value || 0, min: 0, step: '0.01' },
      { name: 'reason', label: 'Motivo', full: true, value: o.discount_reason || '', placeholder: 'Cliente frecuente, ajuste, cortesia…' }
    ],
    extraHtml: o.partner_id
      ? `<div class="banner mt">Esta cuenta tiene el descuento de socio de ${esc(o.partner_name)}. Si cambias el descuento aquí, se le quita el de socio y recupera ese uso.</div>`
      : '',
    submitLabel: 'Aplicar',
    onSubmit: async (values, close) => {
      ctx.order = await api.post(`/orders/${o.id}/discount`, {
        type: values.type || null,
        value: Number(values.value) || 0,
        reason: values.reason || null
      });
      close();
      toast('Descuento actualizado.');
      paint(host);
    }
  });
}

// ---------------------------------------------------------------------
// Descuento de socio: la mesera digita la cedula y el sistema hace el resto
// ---------------------------------------------------------------------
function partnerModal(host) {
  const o = ctx.order;
  let found = null;

  modal({
    title: '★ Descuento de socio',
    size: 'narrow',
    body: `
      <div class="field">
        <label for="partnerDoc">Cédula del socio</label>
        <input type="text" id="partnerDoc" inputmode="numeric" autocomplete="off" placeholder="Solo números"
          style="font-size:22px;letter-spacing:1px">
      </div>
      <div id="partnerInfo" class="small dim">Escribe la cédula y toca Buscar.</div>`,
    buttons: [
      { label: 'Cancelar' },
      { label: 'Buscar', kind: 'btn', action: (close, root) => buscar(root) },
      {
        label: 'Aplicar descuento', kind: 'btn-primary',
        action: async (close, root) => {
          if (!found) return buscar(root);
          if (found.remaining <= 0) return toast('Este socio ya no tiene descuentos este mes.', 'warn');
          try {
            const r = await api.post(`/orders/${o.id}/partner`, { document: found.partner.document });
            ctx.order = r.order;
            close();
            toast(`Descuento de ${r.pct}% aplicado a ${r.partner.name}. Uso ${r.used} de ${r.limit} de ${r.month}.`, 'ok', 6000);
            paint(host);
          } catch (e) { notifyError(e); }
        }
      }
    ],
    onOpen: root => {
      const input = root.querySelector('#partnerDoc');
      input.onkeydown = e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (found && found.partner.document === input.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase() && found.remaining > 0) {
          root.querySelector('.modal-foot .btn-primary').click();
        } else buscar(root);
      };
      input.oninput = () => { found = null; root.querySelector('#partnerInfo').innerHTML = 'Escribe la cédula y toca Buscar.'; };
    }
  });

  async function buscar(root) {
    const doc = root.querySelector('#partnerDoc').value.trim();
    const info = root.querySelector('#partnerInfo');
    if (!doc) return toast('Escribe la cédula.', 'warn');
    found = null;
    info.innerHTML = 'Buscando…';
    try {
      const r = await api.get('/partners/lookup', { document: doc });
      found = r;
      const descuento = Math.round(o.subtotal * r.pct / 100);
      info.innerHTML = r.remaining > 0
        ? `<div class="banner socio-ok">
            <strong style="font-size:16px">${esc(r.partner.name)}</strong><br>
            Le quedan <strong>${r.remaining} de ${r.limit}</strong> descuentos en ${esc(r.month)}.<br>
            Descuento de ${esc(r.pct)}%${o.subtotal > 0 ? `: <strong>-${money(descuento)}</strong> sobre lo que lleva la cuenta` : ''}.
          </div>`
        : `<div class="banner danger">
            <strong>${esc(r.partner.name)}</strong> ya usó sus ${r.limit} descuentos de ${esc(r.month)}.<br>
            Se le renuevan el 1 de ${esc(r.renews)}.
          </div>`;
    } catch (e) {
      info.innerHTML = `<div class="banner danger">${esc(e.message)}</div>`;
    }
  }
}

// ---------------------------------------------------------------------
// Cobro con pagos mixtos
// ---------------------------------------------------------------------
function payModal(host) {
  const o = ctx.order;

  const m = modal({
    title: `Cobrar cuenta #${o.number}`,
    body: `
      <div class="card" style="background:var(--carbon)">
        <div class="row-between"><span class="muted">Total</span><strong style="font-size:20px">${money(o.total)}</strong></div>
        ${o.paid_amount > 0 ? `<div class="row-between small"><span class="muted">Ya abonado</span><span>${money(o.paid_amount)}</span></div>` : ''}
        <div class="row-between" style="margin-top:6px">
          <span class="muted">Pendiente</span>
          <strong style="font-size:22px;color:var(--oro)" id="pending">${money(o.balance)}</strong>
        </div>
      </div>

      <div class="field mt">
        <label for="payMethod">Metodo de pago</label>
        <select id="payMethod">
          ${ctx.methods.map(x => `<option value="${x.id}" data-cash="${x.affects_cash}">${esc(x.name)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label for="payAmount">Valor a pagar</label>
        <input type="number" id="payAmount" value="${o.balance}" min="0" step="1">
      </div>

      <div class="field" id="cashBox">
        <label for="payReceived">Efectivo recibido</label>
        <input type="number" id="payReceived" placeholder="Opcional" min="0" step="1">
        <span class="small dim" id="changeHint"></span>
      </div>

      <div class="field" id="refBox" style="display:none">
        <label for="payRef">Referencia o autorizacion</label>
        <input type="text" id="payRef" placeholder="Numero de aprobacion">
      </div>

      <div class="row wrap mt">
        ${[o.balance, 10000, 20000, 50000, 100000].filter((x, i, a) => x > 0 && a.indexOf(x) === i)
        .map(x => `<button class="btn btn-sm" data-quick="${x}">${money(x)}</button>`).join('')}
      </div>

      <div id="payList" class="mt"></div>`,
    buttons: [
      { label: 'Cerrar' },
      {
        label: 'Registrar pago', kind: 'btn-primary',
        action: async (close, root) => {
          const methodSel = root.querySelector('#payMethod');
          const amount = Number(root.querySelector('#payAmount').value);
          const received = root.querySelector('#payReceived').value;
          const reference = root.querySelector('#payRef').value;

          if (!amount || amount <= 0) return toast('Escribe el valor a pagar.', 'warn');

          try {
            const result = await api.post(`/orders/${o.id}/payments`, {
              payment_method_id: Number(methodSel.value),
              amount,
              received: received === '' ? null : Number(received),
              reference: reference || null
            });
            ctx.order = result.order;

            if (result.change > 0) toast(`Cambio a devolver: ${money(result.change)}`, 'warn', 8000);

            if (ctx.order.status === 'paid') {
              close();
              toast('Cuenta cerrada correctamente.');
              printTicket(ctx.order);
              paint(host);
            } else {
              toast(`Pago parcial registrado. Falta ${money(ctx.order.balance)}.`);
              root.querySelector('#pending').textContent = money(ctx.order.balance);
              root.querySelector('#payAmount').value = ctx.order.balance;
              root.querySelector('#payReceived').value = '';
              renderPayList(root);
              paint(host);
            }
          } catch (e) { notifyError(e); }
        }
      }
    ],
    onOpen: root => {
      const methodSel = root.querySelector('#payMethod');
      const amountInput = root.querySelector('#payAmount');
      const receivedInput = root.querySelector('#payReceived');
      const changeHint = root.querySelector('#changeHint');

      const sync = () => {
        const isCash = methodSel.selectedOptions[0].dataset.cash === '1';
        root.querySelector('#cashBox').style.display = isCash ? '' : 'none';
        root.querySelector('#refBox').style.display = isCash ? 'none' : '';
      };
      methodSel.onchange = sync;
      sync();

      const calc = () => {
        const received = Number(receivedInput.value) || 0;
        const amount = Number(amountInput.value) || 0;
        changeHint.textContent = received > amount ? `Cambio: ${money(received - amount)}` : '';
      };
      receivedInput.oninput = calc;
      amountInput.oninput = calc;

      root.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => {
        const value = Number(b.dataset.quick);
        if (value >= Number(amountInput.value)) receivedInput.value = value;
        else amountInput.value = value;
        calc();
      });

      renderPayList(root);
    }
  });

  function renderPayList(root) {
    const list = root.querySelector('#payList');
    if (!ctx.order.payments?.length) { list.innerHTML = ''; return; }
    list.innerHTML = `<div class="small dim tiny mb">Pagos registrados</div>` +
      ctx.order.payments.map(p =>
        `<div class="row-between small" style="padding:4px 0;border-bottom:1px solid var(--borde)">
          <span>${esc(p.method_name)}</span><span>${money(p.amount)}</span></div>`).join('');
  }
}

async function reload(host) {
  ctx.order = await api.get(`/orders/${ctx.order.id}`);
  paint(host);
}

// ---------------------------------------------------------------------
// Impresion
// ---------------------------------------------------------------------
export function printTicket(order) {
  const cfg = state.settings;
  const html = `
    <div class="p-center">
      <div class="p-big">${esc(cfg.name || 'EL CHUPE')}</div>
      ${cfg.legal_name ? `<div>${esc(cfg.legal_name)}</div>` : ''}
      ${cfg.nit ? `<div>NIT ${esc(cfg.nit)}</div>` : ''}
      ${cfg.address ? `<div>${esc(cfg.address)}</div>` : ''}
      ${cfg.phone ? `<div>Tel ${esc(cfg.phone)}</div>` : ''}
    </div>
    ${sep()}
    <div class="p-row"><span>Venta</span><span class="p-bold">#${esc(order.number)}</span></div>
    <div class="p-row"><span>Fecha</span><span>${esc(dateTime(order.closed_at || order.opened_at))}</span></div>
    <div class="p-row"><span>Mesa</span><span>${esc(order.table_name || 'Mostrador')}</span></div>
    <div class="p-row"><span>Atendio</span><span>${esc(order.waiter_name || '—')}</span></div>
    ${order.customer_name ? `<div class="p-row"><span>Cliente</span><span>${esc(order.customer_name)}</span></div>` : ''}
    ${order.partner_id ? `<div class="p-row"><span>Socio</span><span>${esc(order.partner_name)}</span></div>` : ''}
    ${sep()}
    <table>${order.items.map(i => `
      <tr><td colspan="2">${esc(i.product_name)}</td></tr>
      <tr>
        <td>${qty(i.quantity)} x ${money(i.unit_price)}</td>
        <td class="p-right">${money(i.total)}</td>
      </tr>
      ${i.notes ? `<tr><td colspan="2" class="p-note">${esc(i.notes)}</td></tr>` : ''}
    `).join('')}</table>
    ${sep()}
    <div class="p-row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
    ${order.discount_amount > 0 ? `<div class="p-row"><span>${order.partner_id ? `Descuento socio ${qty(order.discount_value)}%` : 'Descuento'}</span><span>-${money(order.discount_amount)}</span></div>` : ''}
    ${order.tax_amount > 0 ? `<div class="p-row"><span>Impuestos</span><span>${money(order.tax_amount)}</span></div>` : ''}
    ${order.service_amount > 0 ? `<div class="p-row"><span>Servicio</span><span>${money(order.service_amount)}</span></div>` : ''}
    <div class="p-row p-total"><span>TOTAL</span><span>${money(order.total)}</span></div>
    ${sep()}
    ${(order.payments || []).map(p =>
    `<div class="p-row"><span>${esc(p.method_name)}</span><span>${money(p.amount)}</span></div>` +
    (p.change_given > 0 ? `<div class="p-row"><span>Cambio</span><span>${money(p.change_given)}</span></div>` : '')
  ).join('')}
    ${order.status === 'void' ? `${sep()}<div class="p-center p-bold">*** VENTA ANULADA ***</div>` : ''}
    ${sep()}
    <div class="p-center">${esc(cfg.ticket_footer || 'Gracias por visitarnos')}</div>
  `;
  printHtml(html, cfg.ticket_width);
}

function printCommands(items) {
  const stations = [...new Set(items.map(i => i.station))].filter(s => s && s !== 'none');
  if (stations.length === 0) return;
  const order = ctx.order;

  const html = stations.map(station => `
    <div class="p-center p-big">${station === 'kitchen' ? 'COCINA' : 'BAR'}</div>
    ${sep()}
    <div class="p-row"><span>Mesa</span><span class="p-bold">${esc(order.table_name || 'Mostrador')}</span></div>
    <div class="p-row"><span>Cuenta</span><span>#${esc(order.number)}</span></div>
    <div class="p-row"><span>Mesero</span><span>${esc(order.waiter_name || '—')}</span></div>
    <div class="p-row"><span>Hora</span><span>${esc(timeOnly(new Date().toISOString()))}</span></div>
    ${sep()}
    ${items.filter(i => i.station === station).map(i => `
      <div class="p-item p-bold">${qty(i.quantity)} x ${esc(i.product_name)}</div>
      ${i.notes ? `<div class="p-note">→ ${esc(i.notes)}</div>` : ''}
    `).join('')}
    ${sep()}
  `).join('<div style="page-break-after:always"></div>');

  printHtml(html, state.settings.ticket_width);
}
