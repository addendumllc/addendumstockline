/* ---------- Manual mode: record sales per store, count stock, add products ---------- */
function allStores() { return (Store.status && Store.status.stores) || []; }
function apiStores() { return allStores().filter(function (s) { return s.auth !== 'manual' && s.auth !== 'app' && s.enabled; }); }
function storeLabel(s) { return s.name || (s.domain || '').replace(/^manual:/, ''); }
function saleForm() {
  if (!UI.sale) UI.sale = { storeId: (allStores()[0] || {}).id || '', date: todayISO(), ref: '', note: '', deduct: true, lines: [{ sku: '', qty: 1, price: '' }], range: '30', store: '' };
  if (UI.sale.storeId && !allStores().some(function (s) { return s.id === UI.sale.storeId; })) UI.sale.storeId = (allStores()[0] || {}).id || '';
  return UI.sale;
}
function loadSales() { if (UI.salesLoading) return; UI.salesLoading = true; API.req('GET', '/api/sales').then(function (r) { UI.sales = r; UI.salesLoading = false; render(); }).catch(function (e) { UI.salesLoading = false; UI.sales = []; toast(e.message); render(); }); }

function pageSales() {
  var stores = allStores(), f = saleForm(), can = Store.canWrite, dis = can ? '' : ' disabled';
  if (!UI.sales && Store.mode === 'db') loadSales();
  var products = WS.products.slice().filter(function (p) { return p.status !== 'discontinued'; }).sort(function (a, b) { return (a.collection + a.name).localeCompare(b.collection + b.name); });
  var head = '<div class="ph"><div><h1>Record sales</h1><div class="sub">Enter what each store sold. Sales drive the forecasts and reorder quantities, and can take units off your shared stock.</div></div></div>';
  if (!stores.length) {
    return head + '<section class="card"><div class="hd"><div><h2>First, add your stores</h2><div class="small muted">One for each place you sell from: for example the online store, the pro store and the salon.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:12px">' +
      (isAdmin() ? '<div class="row"><input type="text" id="qs-name" placeholder="Store name, e.g. Addendum Hair" style="flex:1;min-width:200px;max-width:360px"><button class="btn primary" data-act="qs-add">Add store</button></div><p class="small muted" style="margin:0">The first store you add is the stock source. You can change that and add Shopify connections later under Settings → Stores & sync.</p>'
        : '<p class="muted" style="margin:0">Ask an admin to add your stores under Settings → Stores & sync.</p>') + '</div></section>';
  }
  var sales = (UI.sales || []).filter(function (s) { return (f.range === 'all' || s.date >= E.addDays(todayISO(), -(+f.range))) && (!f.store || s.storeId === f.store); });
  // 30-day units per store
  var d30 = E.addDays(todayISO(), -30), per = {};
  (UI.sales || []).forEach(function (s) { if (s.date >= d30) s.lines.forEach(function (l) { per[s.storeId] = (per[s.storeId] || 0) + l.qty; }); });
  var total = 0; f.lines.forEach(function (l) { var p = prod(l.sku); total += (+l.qty || 0) * (l.price !== '' && l.price != null ? +l.price : p ? +p.price || 0 : 0); });

  return head +
    '<div class="grid2"><section class="card"><div class="hd"><h2>New sale</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:14px">' +
    '<div><div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Store</div><div class="seg" role="group" aria-label="Store">' + stores.map(function (s) { return '<button aria-pressed="' + (f.storeId === s.id) + '" data-act="sale-store|' + s.id + '"' + dis + '>' + esc(storeLabel(s)) + '</button>'; }).join('') + '</div></div>' +
    '<div class="fields"><label class="field"><span>Date</span><input type="date" id="sale-date" data-f="sale||date" value="' + esc(f.date) + '" max="' + E.addDays(todayISO(), 1) + '"' + dis + '></label>' +
    '<label class="field"><span>Order or receipt # <span class="faint">(optional)</span></span><input type="text" id="sale-ref" data-f="sale||ref" value="' + esc(f.ref) + '" placeholder="e.g. #1043 or Daily total"' + dis + '></label></div>' +
    '<div><div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Items sold</div><div style="display:flex;flex-direction:column;gap:8px">' +
    f.lines.map(function (l, i) {
      var p = prod(l.sku), a = A[l.sku];
      return '<div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:8px">' + skuPicker({ id: 'sale-sku-' + i, f: 'salel|' + i + '|sku', value: l.sku, dis: dis, style: 'flex:1;min-width:0' }) +
        '<input type="number" class="qty" min="1" step="1" id="sale-qty-' + i + '" data-f="salel|' + i + '|qty" value="' + esc(l.qty) + '" aria-label="Quantity"' + dis + '>' +
        '<input type="number" min="0" step="0.01" id="sale-price-' + i + '" data-f="salel|' + i + '|price" value="' + esc(l.price) + '" placeholder="' + (p ? esc(p.price) : 'Price') + '" style="width:92px" aria-label="Unit price"' + dis + '>' +
        (f.lines.length > 1 ? '<button class="btn ghost sm" data-act="sale-line-del|' + i + '" aria-label="Remove item">✕</button>' : '') + '</div>' +
        (f.deduct && a && +l.qty > a.onHand ? '<div class="small" style="color:var(--now)">Only ' + num(a.onHand) + ' in stock</div>' : '');
    }).join('') + '</div><div class="row" style="margin-top:6px;justify-content:space-between"><button class="btn ghost sm" data-act="sale-line-add"' + dis + '>+ Add another item</button><span class="small muted">Total ' + money(total, 2) + ' · price defaults to the product\'s retail price</span></div></div>' +
    '<label class="check"><input type="checkbox" data-f="sale||deduct"' + (f.deduct ? ' checked' : '') + dis + '> Take these units off stock <span class="small faint">(untick if your stock count already reflects this sale)</span></label>' +
    '<p class="small faint" style="margin:0">Stock changes right away. Forecasts use complete days, so today\'s sales count from tomorrow.</p>' +
    '<div class="row"><button class="btn primary" data-act="sale-record"' + (can && !UI.saleBusy ? '' : ' disabled') + '>' + (UI.saleBusy ? 'Saving…' : 'Record sale') + '</button>' + (can ? '' : '<span class="small muted">Viewers can\'t record sales.</span>') + '</div></div></section>' +

    '<div class="stack"><section class="card"><div class="hd"><h2>Last 30 days</h2><span class="small muted">units recorded</span></div><div class="bd flush"><table class="t"><tbody>' +
    stores.map(function (s) { return '<tr><td><b>' + esc(storeLabel(s)) + '</b> <span class="small faint">' + (s.role === 'primary' ? 'stock source' : s.auth === 'manual' ? 'manual' : 'Shopify') + '</span></td><td class="r"><b>' + num(per[s.id] || 0) + '</b></td></tr>'; }).join('') + '</tbody></table></div></section>' +
    '<section class="card"><div class="hd"><div><h2>Import a store\'s orders</h2><div class="small muted">Faster than typing: export orders from that store\'s Shopify admin (Orders → Export) and import them here.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">' +
    '<label class="field"><span>Store</span><select data-f="ordimp||store"' + dis + '>' + stores.map(function (s) { return '<option value="' + s.id + '"' + ((UI.ordImp && UI.ordImp.store || stores[0].id) === s.id ? ' selected' : '') + '>' + esc(storeLabel(s)) + '</option>'; }).join('') + '</select></label>' +
    '<input type="file" accept=".csv,text/csv" data-ordfile="1" aria-label="Orders export"' + dis + '>' + (UI.ordImp && UI.ordImp.file ? '<span class="small" style="color:var(--ok)">✓ ' + esc(UI.ordImp.file.name) + ' · ' + num(UI.ordImp.file.rows.length) + ' rows</span>' : '') +
    '<label class="check small"><input type="checkbox" data-f="ordimp||deduct"' + (UI.ordImp && UI.ordImp.deduct ? ' checked' : '') + dis + '> Take new orders off stock</label>' +
    '<p class="small faint" style="margin:0">Importing the same file again replaces those orders instead of adding them twice. Cancelled and refunded orders are left out. Leave "take off stock" unticked if you count stock separately.</p>' +
    '<button class="btn" style="align-self:flex-start" data-act="ord-import"' + (UI.ordImp && UI.ordImp.file && can ? '' : ' disabled') + '>Import orders</button></div></section></div></div>' +

    '<section class="card"><div class="hd"><div><h2>Recorded sales</h2><div class="small muted">' + sales.length + ' entr' + (sales.length === 1 ? 'y' : 'ies') + '</div></div><div class="row"><select data-f="sale||store" aria-label="Filter by store"><option value="">All stores</option>' + stores.map(function (s) { return '<option value="' + s.id + '"' + (f.store === s.id ? ' selected' : '') + '>' + esc(storeLabel(s)) + '</option>'; }).join('') + '</select>' +
    '<div class="seg" role="group" aria-label="Period">' + [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']].map(function (o) { return '<button aria-pressed="' + (f.range === o[0]) + '" data-act="sale-range|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>' +
    '<div class="bd flush tw"><table class="t"><thead><tr><th>Date</th><th>Store</th><th>Order</th><th>Items</th><th class="r">Units</th><th class="r">Value</th><th></th></tr></thead><tbody>' +
    (!UI.sales ? '<tr><td colspan="7"><div class="empty">Loading…</div></td></tr>' : sales.length ? sales.slice(0, 300).map(function (s) {
      var u = 0, v = 0; s.lines.forEach(function (l) { u += l.qty; v += l.qty * l.price; });
      return '<tr><td>' + dNice(s.date, true) + '</td><td>' + esc(s.store || '—') + '</td><td>' + esc(s.ref || '—') + (s.kind === 'imported' ? ' <span class="tag">Imported</span>' : '') + (s.deducted ? '' : s.kind === 'manual' ? ' <span class="tag" title="Stock wasn\'t changed">Not off stock</span>' : '') + '</td>' +
        '<td class="wrap">' + s.lines.map(function (l) { var p = prod(l.sku); return '<div>' + esc(p ? p.name : l.sku) + ' × ' + num(l.qty) + '</div>'; }).join('') + '</td><td class="r"><b>' + num(u) + '</b></td><td class="r">' + money(v, 2) + '</td>' +
        '<td>' + (s.kind === 'manual' && can ? (UI.saleUndo === s.id ? '<span class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="sale-undo-no">Keep</button><button class="btn sm primary" data-act="sale-undo-yes|' + esc(s.id) + '">Undo</button></span>' : '<button class="btn ghost sm" data-act="sale-undo|' + esc(s.id) + '">Undo</button>') : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>No sales in this period</b>Record one above, or import a store\'s orders.</div></td></tr>') +
    '</tbody></table></div></section>';
}

/* ---------- Count stock (Inventory page) ---------- */
function countBar() {
  if (!UI.counting) return '';
  var changed = Object.keys(UI.counts || {}).filter(function (k) { var p = prod(k); return p && UI.counts[k] !== '' && +UI.counts[k] !== +p.onHand; }).length;
  return '<div class="note row" style="justify-content:space-between"><span><b>Counting stock.</b> Type what\'s on the shelf for each product you counted; leave the rest blank. ' + changed + ' change' + (changed === 1 ? '' : 's') + ' so far.</span><span class="row"><button class="btn sm" data-act="count-cancel">Cancel</button><button class="btn sm primary" data-act="count-save"' + (changed ? '' : ' disabled') + '>Save ' + changed + ' count' + (changed === 1 ? '' : 's') + '</button></span></div>';
}
function countCell(a) {
  var v = UI.counts && UI.counts[a.sku] != null ? UI.counts[a.sku] : '';
  return '<input type="number" min="0" class="qty" id="cnt-' + esc(a.sku) + '" data-f="count|' + esc(a.sku) + '|" value="' + esc(v) + '" placeholder="' + num(a.onHand) + '" aria-label="Counted on hand for ' + esc(a.p.name) + '">';
}

/* ---------- Add / delete product ---------- */
function newProductModal(m) {
  var d = m.draft || {};
  function f(id, label, type, help, val) { return '<label class="field"><span>' + label + '</span><input type="' + (type || 'text') + '" id="np-' + id + '" value="' + esc(val != null ? val : d[id] || '') + '"' + (type === 'number' ? ' min="0" step="any"' : '') + '>' + (help ? '<small>' + help + '</small>' : '') + '</label>'; }
  var cols = collections();
  return '<div class="mh"><div><div class="eyebrow">Products</div><h2>Add a product</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') +
    '<section class="card"><div class="hd"><h2>Product</h2></div><div class="bd"><div class="fields">' + f('sku', 'SKU', 'text', 'Use the same SKU as in Shopify so imports match') + f('name', 'Name', 'text', 'e.g. Redefined Weft 1B 22"') +
    '<label class="field"><span>Collection</span><input type="text" id="np-collection" list="np-cols" value="' + esc(d.collection || '') + '"><datalist id="np-cols">' + cols.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></label>' +
    f('variant', 'Shade / length', 'text', 'Optional') + f('price', 'Retail price', 'number') + f('cost', 'Unit cost', 'number') + f('onHand', 'In stock now', 'number', 'Logged as the starting count') + '</div></div></section>' +
    '<section class="card"><div class="hd"><h2>Ordering</h2><span class="small muted">optional; can be set later</span></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Supplier</span><select id="np-supplierId"><option value="">—</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (d.supplierId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
    f('moq', 'MOQ', 'number') + f('casePack', 'Case size', 'number', '', d.casePack || 1) + f('prodLead', 'Production lead (days)', 'number', 'Blank uses the supplier\'s') + f('transit', 'Transit (days)', 'number') + '</div></div></section>' +
    '<div class="row"><button class="btn primary" data-act="np-save">Add product</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}

Object.assign(ACTIONS, {
  'qs-add': async function () { var n = (document.getElementById('qs-name') || {}).value || ''; try { await API.req('POST', '/api/stores', { auth: 'manual', name: n }); await loadStatus(); await loadWorkspace(); toast('Store added'); } catch (e) { toast(e.message); } },
  'sale-store': function (id) { saleForm().storeId = id; render(); },
  'sale-range': function (r) { saleForm().range = r; render(); },
  'sale-line-add': function () { saleForm().lines.push({ sku: '', qty: 1, price: '' }); render(); var i = document.getElementById('sale-sku-' + (saleForm().lines.length - 1)); if (i) i.focus(); },
  'sale-line-del': function (i) { saleForm().lines.splice(+i, 1); render(); },
  'sale-record': async function () {
    var f = saleForm();
    ['date', 'ref'].forEach(function (k) { var el = document.getElementById('sale-' + k); if (el) f[k] = el.value; });
    f.lines.forEach(function (l, i) { var q = document.getElementById('sale-qty-' + i), p = document.getElementById('sale-price-' + i); if (q) l.qty = +q.value; if (p) l.price = p.value; });
    var lines = f.lines.filter(function (l) { return l.sku; });
    if (!f.storeId) { toast('Choose a store.'); return; }
    if (!lines.length) { toast('Choose at least one product.'); return; }
    if (lines.some(function (l) { return !(l.qty > 0); })) { toast('Enter a quantity for each item.'); return; }
    UI.saleBusy = true; render();
    try {
      await API.req('POST', '/api/sales', { storeId: f.storeId, date: f.date, ref: f.ref, deduct: f.deduct, lines: lines });
      var units = lines.reduce(function (s, l) { return s + l.qty; }, 0), st = allStores().filter(function (s) { return s.id === f.storeId; })[0];
      UI.sale = Object.assign({}, f, { ref: '', lines: [{ sku: '', qty: 1, price: '' }] }); UI.saleBusy = false; UI.sales = null;
      await loadWorkspace(); toast('Recorded ' + units + ' unit' + (units === 1 ? '' : 's') + ' for ' + (st ? storeLabel(st) : 'the store'));
    } catch (e) { UI.saleBusy = false; render(); toast(e.message); }
  },
  'sale-undo': function (id) { UI.saleUndo = id; render(); },
  'sale-undo-no': function () { UI.saleUndo = null; render(); },
  'sale-undo-yes': async function (id) { UI.saleUndo = null; try { await API.req('DELETE', '/api/sales/' + encodeURIComponent(id)); UI.sales = null; await loadWorkspace(); toast('Sale removed'); } catch (e) { toast(e.message); render(); } },
  'ord-import': async function () {
    var o = UI.ordImp || {}; if (!o.file) return;
    var storeId = o.store || (allStores()[0] || {}).id;
    try {
      var r = await API.req('POST', '/api/import/orders', { storeId: storeId, rows: parseOrdersExport(o.file.rows), deduct: !!o.deduct });
      UI.ordImp = { store: storeId }; UI.sales = null; await loadWorkspace();
      toast(num(r.orders) + ' orders imported' + (r.excluded ? ', ' + r.excluded + ' cancelled/refunded left out' : '') + (r.unknown.length ? '. ' + r.unknown.length + ' SKU(s) aren\'t in your products; see Settings → Sync log' : ''));
    } catch (e) { toast('Import failed: ' + e.message); }
  },
  'count-start': function () { UI.counting = true; UI.counts = {}; render(); },
  'count-cancel': function () { UI.counting = false; UI.counts = {}; render(); },
  'count-save': async function () {
    var counts = Object.keys(UI.counts || {}).filter(function (k) { return UI.counts[k] !== '' && prod(k) && +UI.counts[k] !== +prod(k).onHand; }).map(function (k) { return { sku: k, onHand: +UI.counts[k] }; });
    try { var r = await API.req('POST', '/api/stock-count', { counts: counts }); UI.counting = false; UI.counts = {}; await loadWorkspace(); toast(r.changed + ' stock count' + (r.changed === 1 ? '' : 's') + ' saved'); } catch (e) { toast(e.message); }
  },
  'np-open': function () { UI.modal = { type: 'newprod' }; render(); setTimeout(function () { var i = document.getElementById('np-sku'); if (i) i.focus(); }, 0); },
  'np-save': async function () {
    var d = {}; ['sku', 'name', 'collection', 'variant', 'price', 'cost', 'onHand', 'supplierId', 'moq', 'casePack', 'prodLead', 'transit'].forEach(function (k) { var el = document.getElementById('np-' + k); d[k] = el ? el.value.trim() : ''; });
    UI.modal.draft = d;
    try { var r = await API.req('POST', '/api/products', d); UI.modal = null; await loadWorkspace(); toast('Product added'); go('product', r.sku); }
    catch (e) { UI.modal.error = e.message; render(); }
  },
  'prod-del': function () { UI.prodDel = true; render(); },
  'prod-del-no': function () { UI.prodDel = false; render(); },
  'prod-del-yes': async function (sku) { UI.prodDel = false; try { await API.req('DELETE', '/api/products/' + encodeURIComponent(sku)); await loadWorkspace(); toast('Product deleted'); go('products'); } catch (e) { toast(e.message); render(); } },
  'fresh-ask': function () { UI.freshAsk = true; render(); },
  'fresh-no': function () { UI.freshAsk = false; render(); },
  'fresh-yes': async function () {
    var keep = !!(document.getElementById('fresh-keep') || {}).checked; UI.freshAsk = false;
    try { await API.req('POST', '/api/start-fresh', { keepSuppliers: keep }); UI.sales = null; UI.sale = null; await loadStatus(); await loadWorkspace(); toast('Ready for your own data'); go('dashboard'); } catch (e) { toast(e.message); render(); }
  }
});
// Orders export file for the import card
document.addEventListener('change', function (e) {
  var el = e.target; if (!el.dataset || !el.dataset.ordfile) return;
  e.stopImmediatePropagation();
  var file = el.files[0]; if (!file) return;
  var r = new FileReader();
  r.onload = function () { try { var rows = parseCSV(String(r.result)); UI.ordImp = Object.assign({}, UI.ordImp || {}, { file: { name: file.name, rows: rows } }); if (!rows.length) toast(file.name + ' has no rows.'); } catch (err) { toast('Could not read ' + file.name); } render(); };
  r.readAsText(file);
}, true);

/* ---------- First-run guide when the catalog is empty ---------- */
function setupGuide() {
  var stores = allStores(), admin = isAdmin();
  function step(n, done, title, body, btn) { return '<div class="rec" style="grid-template-columns:32px minmax(0,1fr) auto"><span class="stepnum' + (done ? ' done' : '') + '">' + (done ? '✓' : n) + '</span><div><b>' + title + '</b><div class="small muted">' + body + '</div></div><div>' + (btn || '') + '</div></div>'; }
  return '<div class="ph"><div><h1>Set up your inventory</h1><div class="sub">Four steps and the dashboard starts answering what to order, how much and when.</div></div></div>' +
    '<section class="card"><div class="bd flush">' +
    step(1, stores.length > 0, 'Add your stores', stores.length ? stores.map(storeLabel).join(', ') : 'One for each place you sell from, for example online, pro and salon.', admin ? '<button class="btn sm" data-act="nav|sales">Add stores</button>' : '') +
    step(2, WS.products.length > 0, 'Add your products', 'Import a Shopify Products export (Settings → Stores & sync), or add them one at a time.', '<div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="np-open">Add product</button>' + (admin ? '<button class="btn sm ghost" data-act="set-tab|stores">Import</button>' : '') + '</div>') +
    step(3, WS.products.some(function (p) { return +p.onHand > 0; }), 'Count your stock', 'Inventory → Count stock. One shared count for all stores.', '<button class="btn sm" data-act="nav|inventory">Count stock</button>') +
    step(4, (WS.storeSales || []).some(function (s) { return s.units && s.units.some(function (v) { return v; }); }), 'Log purchases', 'Each store has its own page in the menu. Log purchases there, or import a store\'s Shopify orders export to bring in past months at once.', '<button class="btn sm" data-act="nav|' + (stores[0] ? 'store/' + esc(stores[0].id) : 'sales') + '">Log purchases</button>') +
    '</div></section><p class="small muted">Then set each product\'s supplier, lead time and MOQ on the Products page so order dates and quantities are right.</p>';
}
