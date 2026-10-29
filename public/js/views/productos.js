import { api } from '../api.js';
import {
  esc, money, qty, pct, can, toast, notifyError, modal, formModal, confirmAction,
  dataTable, tagFor, debounce, ayuda
} from '../ui.js';

let cache = { products: [], categories: [], taxes: [], suppliers: [] };
let filters = { search: '', category_id: '', type: '' };

export async function render(host, params) {
  await reload(host);
  if (params.id) openProduct(Number(params.id), host);
}

async function reload(host) {
  try {
    const [products, categories, taxes, suppliers] = await Promise.all([
      api.get('/products', { active: '1', ...filters }),
      api.get('/categories'),
      api.get('/taxes'),
      api.get('/suppliers').catch(() => [])
    ]);
    cache = { products, categories, taxes, suppliers };
  } catch (e) { return notifyError(e); }

  paint(host);
}

function paint(host) {
  const showCost = can('products.cost');

  host.innerHTML = `
    ${ayuda('¿Qué van aquí?', [
      'Todo lo que vendes y todo lo que usas para prepararlo.',
      '<strong>Producto simple</strong>: una cerveza, un paquete de papas. Se vende tal cual.',
      '<strong>Con receta</strong>: un cóctel. Le dices qué lleva y cuánto, y al venderlo se descuenta solo.',
      '<strong>Insumo</strong>: el ron, el hielo, los limones. No se venden sueltos, alimentan las recetas.'
    ], 'Para armar la receta de un cóctel: abre el producto y toca "Editar receta".')}

    <div class="card">
      <div class="card-head">
        <h2>Productos</h2>
        <div class="row wrap">
          ${can('products.manage') ? `<button class="btn btn-primary" id="new">Nuevo producto</button>` : ''}
          ${can('recipes.manage') ? `<button class="btn btn-ghost" id="refreshCosts">Recalcular costos</button>` : ''}
          ${can('products.manage') ? `<button class="btn btn-ghost" id="cats">Categorias</button>` : ''}
        </div>
      </div>

      <div class="row wrap mb">
        <input type="search" id="search" placeholder="Buscar por nombre o codigo…" value="${esc(filters.search)}" style="max-width:280px">
        <select id="catFilter" style="width:auto">
          <option value="">Todas las categorias</option>
          ${cache.categories.map(c => `<option value="${c.id}"${String(filters.category_id) === String(c.id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <select id="typeFilter" style="width:auto">
          <option value="">Todos los tipos</option>
          <option value="simple"${filters.type === 'simple' ? ' selected' : ''}>Producto simple</option>
          <option value="recipe"${filters.type === 'recipe' ? ' selected' : ''}>Con receta</option>
          <option value="supply"${filters.type === 'supply' ? ' selected' : ''}>Insumo</option>
        </select>
      </div>

      ${dataTable([
    { key: 'code', label: 'Codigo' },
    { label: 'Producto', render: p => `<strong>${esc(p.name)}</strong>${p.type === 'recipe' ? ` <span class="tag tag-gold">receta</span>` : ''}${p.type === 'supply' ? ` <span class="tag tag-mute">insumo</span>` : ''}` },
    { label: 'Categoria', render: p => esc(p.category_name || '—') },
    { label: 'Stock', num: true, render: p => p.track_stock ? `${qty(p.stock)} ${esc(p.unit)}` : '<span class="dim">no controla</span>' },
    ...(showCost ? [{ label: 'Costo', num: true, render: p => money(p.cost) }] : []),
    { label: 'Precio', num: true, render: p => p.type === 'supply' ? '—' : `<strong>${money(p.price)}</strong>` },
    ...(showCost ? [{
      label: 'Margen', num: true,
      render: p => p.price > 0 ? pct(((p.price - p.cost) / p.price) * 100) : '—'
    }] : []),
    { label: '', render: p => `<button class="btn btn-sm" data-open="${p.id}">Abrir</button>` }
  ], cache.products, { empty: 'No hay productos con estos filtros.' })}
    </div>`;

  const search = host.querySelector('#search');
  search.oninput = debounce(() => { filters.search = search.value.trim(); reload(host); }, 300);
  host.querySelector('#catFilter').onchange = e => { filters.category_id = e.target.value; reload(host); };
  host.querySelector('#typeFilter').onchange = e => { filters.type = e.target.value; reload(host); };

  const newBtn = host.querySelector('#new');
  if (newBtn) newBtn.onclick = () => editProduct(null, host);

  const refresh = host.querySelector('#refreshCosts');
  if (refresh) refresh.onclick = async () => {
    try {
      const r = await api.post('/recipes/refresh-costs');
      toast(`Costos recalculados en ${r.updated} recetas.`);
      reload(host);
    } catch (e) { notifyError(e); }
  };

  const catsBtn = host.querySelector('#cats');
  if (catsBtn) catsBtn.onclick = () => categoriesModal(host);

  host.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openProduct(Number(b.dataset.open), host));
}

// ---------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------
async function openProduct(id, host) {
  let p;
  try { p = await api.get(`/products/${id}`); }
  catch (e) { return notifyError(e); }

  const showCost = can('products.cost');
  const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;

  modal({
    title: p.name,
    size: 'wide',
    body: `
      <div class="grid grid-3 mb">
        <div><div class="tiny dim">Codigo</div>${esc(p.code)}</div>
        <div><div class="tiny dim">Categoria</div>${esc(p.category_name || '—')}</div>
        <div><div class="tiny dim">Unidad</div>${esc(p.unit)}</div>
        <div><div class="tiny dim">Stock</div>${p.track_stock ? qty(p.stock) + ' ' + esc(p.unit) : 'no controla'}</div>
        <div><div class="tiny dim">Stock minimo</div>${qty(p.min_stock)}</div>
        <div><div class="tiny dim">Precio</div><strong>${money(p.price)}</strong></div>
        ${showCost ? `<div><div class="tiny dim">Costo</div>${money(p.cost)}</div>
        <div><div class="tiny dim">Utilidad por unidad</div>${money(p.price - p.cost)}</div>
        <div><div class="tiny dim">Margen</div>${pct(margin)}</div>` : ''}
      </div>

      ${p.description ? `<p class="small muted mb">${esc(p.description)}</p>` : ''}

      ${p.recipe.length ? `
        <div class="card-head"><h2>Receta</h2><span class="small dim">Se descuenta al vender</span></div>
        ${dataTable([
      { key: 'name', label: 'Ingrediente' },
      { label: 'Cantidad', num: true, render: r => `${qty(r.quantity)} ${esc(r.unit)}` },
      { label: 'Disponible', num: true, render: r => `${qty(r.stock)} ${esc(r.unit)}` },
      ...(showCost ? [{ label: 'Costo', num: true, render: r => money(r.quantity * r.cost) }] : [])
    ], p.recipe)}` : ''}
    `,
    buttons: [
      { label: 'Cerrar' },
      ...(can('inventory.view') ? [{
        label: 'Ver kardex',
        action: close => { close(); location.hash = `#/inventario?product=${p.id}`; }
      }] : []),
      ...(can('recipes.manage') ? [{
        label: 'Editar receta',
        action: close => { close(); recipeModal(p, host); }
      }] : []),
      ...(can('products.manage') ? [{
        label: 'Editar', kind: 'btn-primary',
        action: close => { close(); editProduct(p, host); }
      }] : [])
    ]
  });
}

// ---------------------------------------------------------------------
// Crear / editar
// ---------------------------------------------------------------------
function editProduct(p, host) {
  const isNew = !p;
  const fields = [
    { name: 'code', label: 'Codigo', required: true, value: p?.code || suggestCode() },
    { name: 'name', label: 'Nombre', required: true, value: p?.name || '' },
    { name: 'barcode', label: 'Codigo de barras', value: p?.barcode || '' },
    {
      name: 'category_id', label: 'Categoria', type: 'select', value: p?.category_id || '',
      placeholder: 'Sin categoria', options: cache.categories.map(c => ({ value: c.id, label: c.name }))
    },
    {
      name: 'type', label: 'Tipo', type: 'select', value: p?.type || 'simple',
      options: [
        { value: 'simple', label: 'Producto simple (descuenta su propio stock)' },
        { value: 'recipe', label: 'Con receta (descuenta ingredientes)' },
        { value: 'supply', label: 'Insumo (no se vende suelto)' }
      ]
    },
    { name: 'unit', label: 'Unidad', value: p?.unit || 'und', help: 'und, ml, gr, lt…' },
    { name: 'price', label: 'Precio de venta', type: 'number', value: p?.price ?? 0, min: 0, step: '0.01' },
    { name: 'cost', label: 'Costo', type: 'number', value: p?.cost ?? 0, min: 0, step: '0.01' },
    ...(isNew ? [{ name: 'stock', label: 'Stock inicial', type: 'number', value: 0, min: 0, step: '0.01' }] : []),
    { name: 'min_stock', label: 'Stock minimo', type: 'number', value: p?.min_stock ?? 0, min: 0, step: '0.01' },
    {
      name: 'tax_id', label: 'Impuesto', type: 'select', value: p?.tax_id || 1,
      options: cache.taxes.map(t => ({ value: t.id, label: `${t.name} (${t.rate}%)` }))
    },
    {
      name: 'station', label: 'Estacion', type: 'select', value: p?.station || '',
      placeholder: 'Usar la de la categoria',
      options: [{ value: 'bar', label: 'Bar' }, { value: 'kitchen', label: 'Cocina' }, { value: 'none', label: 'Ninguna' }]
    },
    {
      name: 'supplier_id', label: 'Proveedor', type: 'select', value: p?.supplier_id || '',
      placeholder: 'Sin proveedor', options: cache.suppliers.map(s => ({ value: s.id, label: s.name }))
    },
    { name: 'description', label: 'Descripcion', type: 'textarea', value: p?.description || '', full: true },
    { name: 'track_stock', label: 'Controlar inventario', type: 'checkbox', value: p ? !!p.track_stock : true },
    { name: 'is_favorite', label: 'Mostrar en favoritos del POS', type: 'checkbox', value: !!p?.is_favorite },
    { name: 'is_active', label: 'Producto activo', type: 'checkbox', value: p ? !!p.is_active : true }
  ];

  formModal({
    title: isNew ? 'Nuevo producto' : `Editar ${p.name}`,
    size: 'wide',
    fields,
    submitLabel: isNew ? 'Crear producto' : 'Guardar cambios',
    onSubmit: async (values, close) => {
      if (isNew) await api.post('/products', values);
      else await api.put(`/products/${p.id}`, values);
      close();
      toast(isNew ? 'Producto creado.' : 'Producto actualizado.');
      reload(host);
    },
    extraHtml: !isNew && can('products.delete')
      ? `<button class="btn btn-danger btn-sm" id="delProd">Eliminar producto</button>` : ''
  }).root.querySelector('#delProd')?.addEventListener('click', () => {
    confirmAction({
      title: 'Eliminar producto', danger: true, confirmLabel: 'Eliminar',
      message: `Se eliminara "${p.name}". Si tiene ventas registradas el sistema lo impedira.`,
      onConfirm: async () => {
        try {
          await api.del(`/products/${p.id}`);
          document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
          toast('Producto eliminado.');
          reload(host);
        } catch (e) { notifyError(e); }
      }
    });
  });
}

function suggestCode() {
  return 'P-' + String(Date.now()).slice(-6);
}

// ---------------------------------------------------------------------
// Receta
// ---------------------------------------------------------------------
async function recipeModal(product, host) {
  const supplies = await api.get('/products', { active: '1', limit: 1000 });
  const options = supplies.filter(s => s.id !== product.id);
  let items = product.recipe.map(r => ({ ingredient_id: r.ingredient_id, quantity: r.quantity, name: r.name, unit: r.unit }));

  const m = modal({
    title: `Receta de ${product.name}`,
    size: 'wide',
    body: `
      <p class="small muted mb">Cada vez que se venda este producto, el sistema descuenta estas cantidades del inventario.</p>
      <div id="recipeList"></div>
      <div class="row wrap mt">
        <select id="ingSel" class="grow">
          ${options.map(o => `<option value="${o.id}" data-unit="${esc(o.unit)}">${esc(o.name)} (${esc(o.unit)})</option>`).join('')}
        </select>
        <input type="number" id="ingQty" placeholder="Cantidad" step="0.01" min="0.01" style="width:130px">
        <button class="btn" id="addIng">Agregar</button>
      </div>`,
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Guardar receta', kind: 'btn-primary',
        action: async close => {
          try {
            await api.put(`/products/${product.id}/recipe`, {
              items: items.map(i => ({ ingredient_id: i.ingredient_id, quantity: i.quantity }))
            });
            close();
            toast('Receta guardada. El costo se recalculo solo.');
            reload(host);
          } catch (e) { notifyError(e); }
        }
      }
    ]
  });

  const list = m.root.querySelector('#recipeList');
  const paintList = () => {
    list.innerHTML = items.length === 0
      ? `<div class="empty">Sin ingredientes todavia.</div>`
      : dataTable([
        { key: 'name', label: 'Ingrediente' },
        { label: 'Cantidad', num: true, render: i => `${qty(i.quantity)} ${esc(i.unit)}` },
        { label: '', render: (i) => `<button class="btn btn-sm btn-danger" data-rm="${i.ingredient_id}">Quitar</button>` }
      ], items);
    list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      items = items.filter(i => i.ingredient_id !== Number(b.dataset.rm));
      paintList();
    });
  };
  paintList();

  m.root.querySelector('#addIng').onclick = () => {
    const sel = m.root.querySelector('#ingSel');
    const qtyInput = m.root.querySelector('#ingQty');
    const value = Number(qtyInput.value);
    if (!value || value <= 0) return toast('Escribe la cantidad del ingrediente.', 'warn');
    const id = Number(sel.value);
    if (items.some(i => i.ingredient_id === id)) return toast('Ese ingrediente ya esta en la receta.', 'warn');
    items.push({
      ingredient_id: id,
      quantity: value,
      name: sel.selectedOptions[0].textContent.replace(/\s*\([^)]*\)$/, ''),
      unit: sel.selectedOptions[0].dataset.unit
    });
    qtyInput.value = '';
    paintList();
  };
}

// ---------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------
function categoriesModal(host) {
  const m = modal({
    title: 'Categorias',
    body: `
      <div class="card-head"><h2>Listado</h2>
        <button class="btn btn-sm btn-primary" id="addCat">Nueva categoria</button></div>
      ${dataTable([
      { key: 'name', label: 'Nombre' },
      { label: 'Estacion', render: c => esc({ bar: 'Bar', kitchen: 'Cocina', none: 'Ninguna' }[c.station]) },
      { key: 'products', label: 'Productos', num: true },
      { label: '', render: c => `<button class="btn btn-sm" data-edit="${c.id}">Editar</button>` }
    ], cache.categories)}`
  });

  const refresh = () => { m.close(); reload(host).then(() => host.querySelector('#cats')?.click()); };

  m.root.querySelector('#addCat').onclick = () => formModal({
    title: 'Nueva categoria',
    fields: [
      { name: 'name', label: 'Nombre', required: true },
      {
        name: 'station', label: 'Estacion', type: 'select', value: 'bar',
        options: [{ value: 'bar', label: 'Bar' }, { value: 'kitchen', label: 'Cocina' }, { value: 'none', label: 'Ninguna' }]
      },
      { name: 'sort_order', label: 'Orden', type: 'number', value: cache.categories.length }
    ],
    onSubmit: async (values, close) => { await api.post('/categories', values); close(); toast('Categoria creada.'); refresh(); }
  });

  m.root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const c = cache.categories.find(x => x.id === Number(b.dataset.edit));
    formModal({
      title: 'Editar categoria',
      fields: [
        { name: 'name', label: 'Nombre', value: c.name, required: true },
        {
          name: 'station', label: 'Estacion', type: 'select', value: c.station,
          options: [{ value: 'bar', label: 'Bar' }, { value: 'kitchen', label: 'Cocina' }, { value: 'none', label: 'Ninguna' }]
        },
        { name: 'sort_order', label: 'Orden', type: 'number', value: c.sort_order },
        { name: 'is_active', label: 'Activa', type: 'checkbox', value: !!c.is_active }
      ],
      onSubmit: async (values, close) => { await api.put(`/categories/${c.id}`, values); close(); toast('Categoria actualizada.'); refresh(); }
    });
  });
}
