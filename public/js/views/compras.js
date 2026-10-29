import { api } from '../api.js';
import {
  esc, money, qty, can, toast, notifyError, modal, dataTable, tagFor,
  dateOnly, promptReason, today
} from '../ui.js';

export async function render(host) { await load(host); }

async function load(host) {
  let rows;
  try { rows = await api.get('/purchases'); }
  catch (e) { return notifyError(e); }

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Compras a proveedores</h2>
        ${can('purchases.manage') ? `<button class="btn btn-primary" id="new">Registrar compra</button>` : ''}
      </div>
      ${dataTable([
    { label: 'Fecha', render: p => dateOnly(p.purchase_date) },
    { label: 'Factura', render: p => esc(p.invoice_number || '—') },
    { label: 'Proveedor', render: p => esc(p.supplier_name || '—') },
    { key: 'items_count', label: 'Productos', num: true },
    { label: 'Pago', render: p => esc(p.method_name || '—') },
    { label: 'Estado', render: p => tagFor(p.status) },
    { label: 'Total', num: true, render: p => `<strong>${money(p.total)}</strong>` },
    { label: '', render: p => `<button class="btn btn-sm" data-open="${p.id}">Ver</button>` }
  ], rows, { empty: 'Todavia no hay compras registradas.' })}
    </div>`;

  const btn = host.querySelector('#new');
  if (btn) btn.onclick = () => newPurchase(host);
  host.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPurchase(Number(b.dataset.open), host));
}

async function newPurchase(host) {
  const [products, suppliers, methods] = await Promise.all([
    api.get('/products', { active: '1', limit: 1000 }),
    api.get('/suppliers'),
    api.get('/payment-methods')
  ]);

  let items = [];

  const m = modal({
    title: 'Registrar compra',
    size: 'wide',
    body: `
      <div class="form-grid">
        <div class="field">
          <label for="pSupplier">Proveedor</label>
          <select id="pSupplier"><option value="">Sin proveedor</option>
            ${suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="pInvoice">Numero de factura</label>
          <input type="text" id="pInvoice" placeholder="Opcional">
        </div>
        <div class="field">
          <label for="pMethod">Metodo de pago</label>
          <select id="pMethod"><option value="">Sin registrar</option>
            ${methods.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="pDate">Fecha</label>
          <input type="date" id="pDate" value="${today()}">
        </div>
      </div>

      <div class="card-head mt"><h2>Productos</h2></div>
      <div class="row wrap">
        <select id="pProduct" class="grow">
          ${products.map(p => `<option value="${p.id}" data-cost="${p.cost || 0}" data-unit="${esc(p.unit)}">${esc(p.name)}</option>`).join('')}
        </select>
        <input type="number" id="pQty" placeholder="Cantidad" min="0.01" step="0.01" style="width:120px">
        <input type="number" id="pCost" placeholder="Costo unit." min="0" step="0.01" style="width:130px">
        <button class="btn" id="pAdd">Agregar</button>
      </div>
      <div id="pItems" class="mt"></div>
      <div class="row-between mt" style="font-size:19px;font-weight:600">
        <span>Total de la compra</span><span id="pTotal" style="color:var(--oro)">${money(0)}</span>
      </div>
      <label class="check mt"><input type="checkbox" id="pUpdateCost" checked>
        <span>Actualizar el costo de los productos con estos precios</span></label>`,
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Guardar compra', kind: 'btn-primary',
        action: async (close, root) => {
          if (items.length === 0) return toast('Agrega al menos un producto.', 'warn');
          try {
            await api.post('/purchases', {
              supplier_id: root.querySelector('#pSupplier').value || null,
              invoice_number: root.querySelector('#pInvoice').value || null,
              payment_method_id: root.querySelector('#pMethod').value || null,
              purchase_date: root.querySelector('#pDate').value,
              update_cost: root.querySelector('#pUpdateCost').checked,
              items: items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost }))
            });
            close();
            toast('Compra registrada. El inventario ya subio.');
            load(host);
          } catch (e) { notifyError(e); }
        }
      }
    ]
  });

  const sel = m.root.querySelector('#pProduct');
  const costInput = m.root.querySelector('#pCost');
  sel.onchange = () => { costInput.value = sel.selectedOptions[0].dataset.cost; };
  sel.onchange();

  const paintItems = () => {
    const box = m.root.querySelector('#pItems');
    box.innerHTML = items.length === 0
      ? `<div class="empty">Sin productos en esta compra.</div>`
      : dataTable([
        { key: 'name', label: 'Producto' },
        { label: 'Cantidad', num: true, render: i => `${qty(i.quantity)} ${esc(i.unit)}` },
        { label: 'Costo unit.', num: true, render: i => money(i.unit_cost) },
        { label: 'Total', num: true, render: i => money(i.quantity * i.unit_cost) },
        { label: '', render: (i, idx) => `<button class="btn btn-sm btn-danger" data-rm="${i.product_id}">Quitar</button>` }
      ], items);
    m.root.querySelector('#pTotal').textContent = money(items.reduce((s, i) => s + i.quantity * i.unit_cost, 0));
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      items = items.filter(i => i.product_id !== Number(b.dataset.rm));
      paintItems();
    });
  };
  paintItems();

  m.root.querySelector('#pAdd').onclick = () => {
    const quantity = Number(m.root.querySelector('#pQty').value);
    const unit_cost = Number(costInput.value);
    if (!quantity || quantity <= 0) return toast('Escribe la cantidad.', 'warn');
    if (unit_cost < 0) return toast('El costo no puede ser negativo.', 'warn');
    const id = Number(sel.value);
    if (items.some(i => i.product_id === id)) return toast('Ese producto ya esta en la lista.', 'warn');
    items.push({
      product_id: id, quantity, unit_cost,
      name: sel.selectedOptions[0].textContent,
      unit: sel.selectedOptions[0].dataset.unit
    });
    m.root.querySelector('#pQty').value = '';
    paintItems();
  };
}

async function openPurchase(id, host) {
  let p;
  try { p = await api.get(`/purchases/${id}`); }
  catch (e) { return notifyError(e); }

  modal({
    title: `Compra ${p.invoice_number ? '· ' + p.invoice_number : '#' + p.id}`,
    size: 'wide',
    body: `
      <div class="grid grid-3 mb">
        <div><div class="tiny dim">Proveedor</div>${esc(p.supplier_name || '—')}</div>
        <div><div class="tiny dim">Fecha</div>${esc(dateOnly(p.purchase_date))}</div>
        <div><div class="tiny dim">Registro</div>${esc(p.user_name || '—')}</div>
      </div>
      ${p.status === 'void' ? `<div class="banner danger">Compra anulada.</div>` : ''}
      ${dataTable([
      { key: 'product_name', label: 'Producto' },
      { label: 'Cantidad', num: true, render: i => `${qty(i.quantity)} ${esc(i.unit)}` },
      { label: 'Costo unit.', num: true, render: i => money(i.unit_cost) },
      { label: 'Total', num: true, render: i => money(i.total) }
    ], p.items)}
      <div class="row-between mt" style="font-size:19px;font-weight:600">
        <span>Total</span><span style="color:var(--oro)">${money(p.total)}</span></div>`,
    buttons: [
      { label: 'Cerrar' },
      ...(p.status !== 'void' && can('purchases.manage') ? [{
        label: 'Anular compra', kind: 'btn-danger',
        action: close => {
          close();
          promptReason({
            title: 'Anular compra',
            label: 'Motivo',
            confirmLabel: 'Anular',
            onConfirm: async reason => {
              try {
                await api.post(`/purchases/${p.id}/void`, { reason });
                toast('Compra anulada. El inventario fue devuelto.');
                load(host);
              } catch (e) { notifyError(e); }
            }
          });
        }
      }] : [])
    ]
  });
}
