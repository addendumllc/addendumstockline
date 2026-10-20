/* ---------- Shopify CSV import ---------- */
function dropZone(kind, title, help) {
  var f = UI.imp && UI.imp[kind];
  return '<div class="drop ' + (f ? 'done' : '') + '"><b>' + title + '</b><span class="small muted">' + help + '</span>' + (f ? '<span class="small" style="color:var(--ok)">✓ ' + esc(f.name) + ' · ' + num(f.rows.length) + ' rows</span>' : '') + '<input type="file" accept=".csv,text/csv" data-file="' + kind + '" aria-label="' + title + '"' + (Store.canWrite ? '' : ' disabled') + '></div>';
}
function parseCSV(text) {
  var rows = [], row = [], cur = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && cur === '') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  var head = (rows.shift() || []).map(function (h) { return h.replace(/^﻿/, '').trim(); });
  return rows.filter(function (r) { return r.some(function (x) { return x !== ''; }); }).map(function (r) { var o = {}; head.forEach(function (h, i2) { o[h] = (r[i2] || '').trim(); }); return o; });
}
function col(o, names) { for (var i = 0; i < names.length; i++) if (o[names[i]] != null && o[names[i]] !== '') return o[names[i]]; return ''; }
// Shopify CSV exports are parsed here and sent to the server. Nothing already saved is removed.
function parseProductsExport(rows) {
  var lastTitle = {}, typeOf = {}, out = [];
  rows.forEach(function (r) {
    var h = col(r, ['Handle']), title = col(r, ['Title']); if (title) lastTitle[h] = title;
    var tp = col(r, ['Type', 'Product Type', 'Product Category']); if (tp) typeOf[h] = tp;
    var sku = col(r, ['Variant SKU', 'SKU']); if (!sku) return;
    var opts = [col(r, ['Option1 Value']), col(r, ['Option2 Value']), col(r, ['Option3 Value'])].filter(function (x) { return x && x !== 'Default Title'; });
    var base = title || lastTitle[h] || sku;
    out.push({ sku: sku, name: base + (opts.length ? ' ' + opts.join(' / ') : ''), variant: opts.join(' / '), groupName: base, shade: opts[0] || '', collection: typeOf[h] || base,
      price: col(r, ['Variant Price', 'Price']), stylistPrice: col(r, ['Stylist Price', 'Stylist price', 'Variant Stylist Price', 'Wholesale Price', 'Pro Price']), cost: col(r, ['Cost per item', 'Variant Cost', 'Cost']), onHand: col(r, ['Variant Inventory Qty', 'Inventory Qty', 'On hand']),
      archived: col(r, ['Status']).toLowerCase() === 'archived' });
  });
  return out;
}
function parseInventoryExport(rows) {
  var inv = {};
  rows.forEach(function (r) {
    var sku = col(r, ['SKU', 'Variant SKU']); if (!sku) return;
    var on = parseFloat(col(r, ['On hand (current)', 'On hand', 'On Hand'])), cm = parseFloat(col(r, ['Committed', 'Committed (current)'])), av = parseFloat(col(r, ['Available', 'Available (current)']));
    if (isNaN(on) && !isNaN(av)) on = av + (isNaN(cm) ? 0 : cm);
    if (!isNaN(on)) inv[sku] = (inv[sku] || 0) + on;
  });
  return Object.keys(inv).map(function (k) { return { sku: k, onHand: Math.max(0, inv[k]) }; });
}
function parseOrdersExport(rows) {
  var seen = {}, out = [];
  rows.forEach(function (r) {
    var name = col(r, ['Name', 'Order', 'Order Name']), date = col(r, ['Created at', 'Created At', 'Processed at']).slice(0, 10), sku = col(r, ['Lineitem sku', 'Lineitem SKU', 'SKU']);
    var key = name + '|' + sku + '|' + col(r, ['Lineitem price']) + '|' + col(r, ['Lineitem name']) + '|' + col(r, ['Lineitem quantity']);
    if (seen[key]) return; seen[key] = 1;
    out.push({ name: name, date: date, sku: sku, qty: parseFloat(col(r, ['Lineitem quantity', 'Lineitem Quantity', 'Quantity'])) || 0, price: parseFloat(col(r, ['Lineitem price', 'Price'])) || 0,
      cancelled: !!col(r, ['Cancelled at']), financial: col(r, ['Financial Status']), customer: col(r, ['Billing Name', 'Shipping Name', 'Customer', 'Email']) });
  });
  return out;
}
async function runImport() {
  var imp = UI.imp || {}, msgs = [];
  try {
    if (imp.products) { var p = await API.req('POST', '/api/import/products', { rows: parseProductsExport(imp.products.rows), stock: !imp.inventory && !!UI.impStock }); msgs.push(p.added + ' products added, ' + p.updated + ' updated'); }
    if (imp.inventory) { var c = await API.req('POST', '/api/stock-count', { counts: parseInventoryExport(imp.inventory.rows), note: 'Inventory export ' + imp.inventory.name, sync: true }); msgs.push(c.changed + ' stock counts changed' + (c.excluded ? ', ' + c.excluded + ' excluded from sync left alone' : '')); }
    UI.imp = null; await loadWorkspace(); toast(msgs.join(' · ') || 'Nothing to import');
  } catch (e) { toast('Import failed: ' + e.message); }
}

/* ---------- Small modals ---------- */
function adjustModal(p) {
  return '<div class="mh"><div><div class="eyebrow">Adjust stock</div><h2>' + esc(p.name) + '</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    '<p class="muted" style="margin:0">Currently ' + num(p.onHand) + ' on hand. Enter a counted quantity or a change. The adjustment is logged.</p><div class="fields">' +
    '<label class="field"><span>New on-hand count</span><input type="number" id="adj-count" min="0" value="' + num(p.onHand).replace(/,/g, '') + '"></label>' +
    '<label class="field"><span>Reason</span><select id="adj-reason"><option>Cycle count</option><option>Damaged</option><option>Returned to stock</option><option>Sample / marketing</option><option>Other</option></select></label></div>' +
    '<label class="field"><span>Note</span><input type="text" id="adj-note" placeholder="Optional"></label><div class="row"><button class="btn primary" data-act="adjust-confirm">Save adjustment</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}

/* ---------- Render ---------- */
// Store pages are added per store (Addendum Hair, Addendum Hair Pro, …); "Record Sales" only shows until the first store exists.
var PAGES = ['dashboard', 'usage', 'inventory', 'ledger', 'recs', 'sales', 'pos', 'salon', 'products', 'edit', 'suppliers', 'analytics', 'forecast', 'settings'];
function navList() {
  var st = (Store.status && Store.status.stores) || [];
  return [['dashboard', 'Dashboard', 'dashboard'], ['usage', 'Monthly Usage', 'usage'], ['inventory', 'Inventory', 'inventory'], ['ledger', 'Stock History', 'ledger'], ['recs', 'Order Recommendations', 'recs']]
    .concat(st.length ? st.map(function (s) { return ['store/' + s.id, s.name || s.domain, 'store', s.logo]; }) : [['sales', 'Record Sales', 'sales']])
    .concat([['salon', 'Salon Usage', 'salon'], ['pos', 'Purchase Orders', 'pos'], ['products', 'Products', 'products'], ['suppliers', 'Suppliers', 'suppliers'], ['analytics', 'Sales Analytics', 'analytics'], ['forecast', 'Forecast', 'forecast'], ['settings', 'Settings', 'settings']]);
}
function render() {
  var app = document.getElementById('app');
  var ae = document.activeElement, focusId = ae && ae.id, sel = null;
  try { if (focusId && ae.selectionStart != null) sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) {}
  var scrollY = window.scrollY, modalScroll = (document.querySelector('.modal') || {}).scrollTop;
  CHARTS = {}; _cid = 0;
  if (Store.mode === 'loading') { app.innerHTML = shell('<div class="loading">Loading your inventory…</div>'); return; }
  if (Store.mode === 'empty') { app.innerHTML = shell(emptyState()); return; }
  if (Store.mode === 'blocked') { app.innerHTML = shell('<div class="ph"><div><h1>Can\'t open Addendum-Stockline</h1></div></div><div class="note bad">' + esc(Store.blocked || 'Shopify sign-in failed.') + '</div><p class="muted">Reload the page to try again. If it keeps happening, ask an admin to check the app\'s settings.</p>'); return; }
  var body;
  try {
    body = ({ dashboard: pageDashboard, inventory: pageInventory, recs: pageRecs, pos: pagePOs, products: pageProducts, product: pageProduct, suppliers: pageSuppliers, salon: pageSalon, sales: pageSales, analytics: pageAnalytics, forecast: pageForecast, settings: pageSettings, store: pageStore, usage: pageUsage, ledger: pageLedger, edit: pageEditAll }[UI.page] || pageDashboard)();
  } catch (e) { console.error(e); body = '<div class="note bad">This page hit an error: ' + esc(e.message) + '</div>'; }
  var sy = Store.status && Store.status.sync;
  var banner = Store.mode === 'preview' ? '<div class="note warn">Can\'t reach the Addendum-Stockline server. Showing demo data; changes are not saved.</div>' : (sy && sy.running ? '<div class="note">Syncing Shopify: ' + esc(sy.step) + (sy.progress ? ' · ' + esc(sy.progress) : '') + '…</div>' : '');
  app.innerHTML = shell(banner + body) + cartBar() + modalHtml();
  drawCharts();
  if (focusId) { var el = document.getElementById(focusId); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  window.scrollTo(0, scrollY);
  var m = document.querySelector('.modal'); if (m && modalScroll) m.scrollTop = modalScroll;
}
function shell(content) {
  var due = AL.filter(function (a) { return a.needsOrder && (a.orderT <= 0 || a.status === 'oos'); }).length;
  var last = (WS.sync.log || [])[0];
  var cur = UI.page === 'product' ? 'inventory' : UI.page === 'edit' ? 'products' : UI.page === 'store' ? 'store/' + UI.storeId : UI.page;
  return '<div class="shell ' + (Store.canWrite ? '' : 'ro') + (EMBED ? ' embedded' : '') + '"><aside class="side ' + (UI.navOpen ? 'open' : '') + '"><div class="brand">' + (brandInfo().logo ? '<img class="brandlogo" src="' + esc(brandInfo().logo) + '" alt="">' : '') + '<b>' + esc(brandInfo().appName) + '</b><span>' + esc(WS.meta.storeName || 'Addendum Hair') + '</span></div><nav class="nav" aria-label="Main">' +
    navList().map(function (n) { return '<button data-act="nav|' + esc(n[0]) + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '>' + icon(n[2]) + '<span class="nl">' + esc(n[1]) + '</span>' + (n[0] === 'recs' && due ? '<span class="count">' + due + '</span>' : '') + '</button>'; }).join('') +
    '</nav><div class="side-foot"><span><span class="sync-dot ' + (last && last.status === 'error' ? 'err' : '') + '"></span>' + (last ? 'Synced ' + esc(new Date(last.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : WS.meta.source === 'manual' ? 'Manual mode' : 'Not synced') + '</span><span>' + (WS.meta.source === 'demo' ? 'Demo data' : num(WS.products.length) + ' SKUs' + ((Store.status && Store.status.stores || []).length > 1 ? ' · ' + Store.status.stores.length + ' stores' : '')) + '</span>' +
    (Store.status && Store.status.user && !EMBED ? '<div class="who"><span><b>' + esc(Store.status.user.name) + '</b>' + esc(Store.status.user.roleLabel) + '</span><button data-act="logout">Sign out</button></div>' : '') + '</div></aside>' +
    '<div style="min-width:0"><div class="topbar"><button data-act="nav-toggle" aria-label="Menu">' + icon('menu') + '</button><b>' + esc(brandInfo().appName) + '</b></div><main class="main">' + content + '</main></div></div><div id="toast" class="toast" role="status" ' + (UI.toast ? '' : 'hidden') + '>' + esc(UI.toast || '') + '</div>';
}
function emptyState() {
  return '<div class="ph"><div><h1>Set up Addendum-Stockline</h1><div class="sub">Nothing is saved in this workspace yet.</div></div></div><div class="grid2e"><section class="card"><div class="hd"><h2>Explore with demo data</h2></div><div class="bd"><p class="muted">19 hair extension SKUs across Redefined Weft, Redefined Tape, K-Tips and Clip-Ins, with 15 months of sales, four suppliers and open purchase orders.</p><button class="btn primary" data-act="load-demo"' + (Store.canWrite ? '' : ' disabled') + '>Load demo store</button></div></section>' +
    '<section class="card"><div class="hd"><h2>Use your Shopify data</h2></div><div class="bd"><p class="muted">Import your Products and Orders exports from Shopify admin. You can add suppliers and lead times afterwards.</p><button class="btn" data-act="start-import"' + (Store.canWrite ? '' : ' disabled') + '>Go to import</button></div></section></div>';
}
function cartBar() {
  var k = Object.keys(UI.cart); if (!k.length || UI.page === 'recs') return '';
  var u = 0, c = 0; k.forEach(function (s) { var a = A[s]; if (a) { u += +UI.cart[s]; c += UI.cart[s] * a.cost; } });
  return '<div class="cartbar" role="region" aria-label="Purchase order builder"><span><b>' + k.length + '</b> product' + (k.length > 1 ? 's' : '') + ' · ' + num(u) + ' units · ' + money(c) + '</span><button class="btn ghost sm" data-act="cart-clear">Clear</button><button class="btn primary sm" data-act="cart-create">Create purchase order' + (new Set(k.map(function (s) { return (prod(s) || {}).supplierId; })).size > 1 ? 's' : '') + '</button></div>';
}
function modalHtml() {
  var m = UI.modal; if (!m) return '';
  var inner = '';
  if (m.type === 'po') { var x = po(m.id); if (!x) { UI.modal = null; return ''; } inner = poModal(x); }
  else if (m.type === 'sup') { inner = supModal(m.isNew ? m.draft : sup(m.id) || m.draft, m.isNew); }
  else if (m.type === 'adjust') { var p = prod(m.sku); if (p) inner = adjustModal(p); }
  else if (m.type === 'store') inner = storeModal(m);
  else if (m.type === 'user') inner = userModal(m);
  else if (m.type === 'newprod') inner = newProductModal(m);
  else if (m.type === 'editprod') { var ep = prod(m.sku); if (!ep) { UI.modal = null; return ''; } inner = editProductModal(ep, m); }
  var c = m.type === 'adjust' || m.type === 'user';
  return '<div class="modal-bg ' + (c ? 'c' : '') + '" data-act="modal-bg"><div class="modal ' + (c ? 'center' : '') + '" role="dialog" aria-modal="true">' + inner + '</div></div>';
}

/* ---------- Events ---------- */
function setPage(key) {
  if (/^store\//.test(key)) { UI.storeId = key.slice(6); UI.page = 'store'; return 'store/' + encodeURIComponent(UI.storeId); }
  UI.page = key; return key === 'product' ? 'inventory' : key === 'store' ? 'store/' + encodeURIComponent(UI.storeId || '') : key;
}
function go(page, sku) { var seg = setPage(page); if (sku) UI.sku = sku; UI.navOpen = false; UI.modal = null; render(); window.scrollTo(0, 0); try { var path = '/app/' + seg; if (location.pathname !== path) history.pushState({ page: UI.page === 'store' ? 'store/' + UI.storeId : UI.page, sku: sku || null }, '', path + location.search); } catch (e) {} }
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]'); if (!el) return;
  var parts = el.dataset.act.split('|'), act = parts[0], arg = parts.slice(1).join('|');
  if (act === 'modal-bg') { if (e.target === el) { UI.modal = null; render(); } return; }
  if (el.tagName === 'TR' && e.target.closest('button,input,select,a,label')) return;
  if (el.classList.contains('rw') && e.target.closest('button')) return;
  e.stopPropagation();
  var H = ACTIONS[act]; if (H) H(arg, el, e);
});
var ACTIONS = {
  nav: function (p) { go(p); },
  'nav-toggle': function () { UI.navOpen = !UI.navOpen; render(); },
  'open-product': function (s) { UI.modal = null; go('product', s); },
  'open-forecast': function (s) { UI.fc.sku = s; UI.fc.tab = 'timeline'; go('forecast'); },
  dismiss: function (id) { UI.dismissed[id] = 1; saveUI(); render(); },
  undismiss: function () { UI.dismissed = {}; saveUI(); render(); },
  'cart-toggle': function (s) { if (UI.cart[s] != null) delete UI.cart[s]; else UI.cart[s] = A[s].qty || A[s].moq || 1; render(); },
  'cart-add-all': function () { AL.forEach(function (a) { if (a.needsOrder) UI.cart[a.sku] = a.qty; }); render(); },
  'cart-clear': function () { UI.cart = {}; render(); },
  'cart-create': function () { var made = createPOs(Object.keys(UI.cart).map(function (s) { return { sku: s, qty: UI.cart[s] }; })); UI.cart = {}; finishPOs(made); },
  'rec-create': function () { var items = AL.filter(function (a) { return UI.recSel[a.sku] && (a.orderNow || ((a.status === 'now' || a.status === 'soon') && a.qty > 0)); }).map(function (a) { return { sku: a.sku, qty: recQty(a) }; }); var made = createPOs(items); items.forEach(function (it) { delete UI.recSel[it.sku]; delete UI.recQty[it.sku]; }); saveUI(); finishPOs(made); },
  'rec-reset': function (s) { if (s) delete UI.recQty[s]; else UI.recQty = {}; saveUI(); render(); },
  'po-from': function (s) { finishPOs(createPOs([{ sku: s, qty: A[s].qty }])); },
  sort: function (k) { if (UI.sort.k === k) UI.sort.d *= -1; else { UI.sort.k = k; UI.sort.d = 1; } render(); },
  'inv-status': function (s) { UI.inv.status = s; render(); },
  'dash-range': function (r) { dashState().range = r; render(); },
  'inv-adjust': function (s) { UI.modal = { type: 'adjust', sku: s }; render(); setTimeout(function () { var i = document.getElementById('adj-count'); if (i) i.focus(); }, 0); },
  'adjust-confirm': function () {
    var p = prod(UI.modal.sku), c = parseFloat(document.getElementById('adj-count').value);
    if (isNaN(c) || c < 0) { toast('Enter a count of 0 or more.'); return; }
    var d = c - p.onHand; if (!d) { UI.modal = null; render(); return; }
    p.onHand = c; saveProduct(p);
    var t = { id: 'TX-' + Date.now().toString(36), date: todayISO(), sku: p.sku, type: 'adjust', qty: d, ref: document.getElementById('adj-reason').value, note: document.getElementById('adj-note').value };
    WS.txns.unshift(t); saveTxn(t); UI.modal = null; toast('Stock adjusted by ' + (d > 0 ? '+' : '') + d); changed();
  },
  'modal-close': function () { UI.modal = null; render(); },
  'po-filter': function (f) { UI.poFilter = f; render(); },
  'po-open': function (id) { UI.modal = { type: 'po', id: id }; render(); },
  'po-new': function () { var x = { id: nextPoId(), supplierId: settings().defaultSupplier || (WS.suppliers[0] || {}).id || '', created: todayISO(), submitted: null, status: 'draft', statedLead: null, expectedShip: null, expectedDelivery: null, receivedDate: null, notes: '', lines: [] }; WS.pos.unshift(x); savePO(x); UI.page = 'pos'; UI.modal = { type: 'po', id: x.id }; changed(); },
  'po-status': function (s) {
    var x = po(UI.modal.id); var t = todayISO();
    if (s === 'submitted') { if (!x.lines.length) { toast('Add at least one line first.'); return; } x.submitted = t; planDates(x, t); }
    if (s === 'shipped') { x.shippedDate = t; var tr = 0; x.lines.forEach(function (l) { var a = A[l.sku]; if (a) tr = Math.max(tr, a.transit); }); if (!x.expectedDelivery || x.expectedDelivery < E.addDays(t, tr)) x.expectedDelivery = E.addDays(t, tr); x.expectedShip = t; }
    x.status = s; savePO(x); toast(x.id + ': ' + PO_STATUS[s]); changed();
  },
  'po-cancel': function () { UI.modal.confirm = { text: 'Cancel ' + UI.modal.id + '? Its units stop counting as incoming.', yes: 'Cancel PO', fn: function (x) { x.status = 'cancelled'; savePO(x); } }; render(); },
  'po-delete': function () { UI.modal.confirm = { text: 'Delete ' + UI.modal.id + ' permanently?', yes: 'Delete', fn: function (x) { WS.pos = WS.pos.filter(function (y) { return y !== x; }); unpersist('pos', x.id); UI.modal = null; } }; render(); },
  'confirm-no': function () { UI.modal.confirm = null; render(); },
  'confirm-yes': function () { var x = po(UI.modal.id), c = UI.modal.confirm; UI.modal.confirm = null; c.fn(x); changed(); },
  'po-receive': function () { UI.modal.receive = true; render(); },
  'po-receive-cancel': function () { UI.modal.receive = false; render(); },
  'po-receive-confirm': function () {
    var x = po(UI.modal.id), date = document.getElementById('rc-date').value || todayISO(), any = false, bad = false;
    var rows = x.lines.map(function (l, i) { var q = parseFloat(document.getElementById('rc-q-' + i).value) || 0, d = parseFloat(document.getElementById('rc-d-' + i).value) || 0; if (q < 0 || d < 0) bad = true; if (q || d) any = true; return [l, q, d]; });
    if (bad) { toast('Quantities cannot be negative.'); return; } if (!any) { toast('Enter at least one received quantity.'); return; }
    rows.forEach(function (r) {
      var l = r[0], q = r[1], d = r[2]; if (!q && !d) return;
      l.received = (+l.received || 0) + q; l.damaged = (+l.damaged || 0) + d;
      var p = prod(l.sku); if (p && q) { p.onHand = (+p.onHand || 0) + q; saveProduct(p); }
      var t = { id: 'TX-' + x.id + '-' + docId(l.sku) + '-' + Date.now().toString(36), date: date, sku: l.sku, type: 'receive', qty: q, ref: x.id, note: d ? d + ' damaged/missing' : '' };
      WS.txns.unshift(t); saveTxn(t);
    });
    var done = x.lines.every(function (l) { return (+l.received || 0) + (+l.damaged || 0) >= +l.qty; });
    x.status = done ? 'received' : 'partially_received'; x.receivedDate = date; savePO(x);
    UI.modal.receive = false; toast(done ? x.id + ' fully received' : x.id + ' partially received'); changed();
  },
  'pol-del': function (i) { var x = po(UI.modal.id); x.lines.splice(+i, 1); savePO(x); changed(); },
  'pol-add': function () { var s = document.getElementById('po-add-sku').value; if (!s) return; var x = po(UI.modal.id), p = prod(s), a = A[s]; x.lines.push({ sku: s, name: p.name, qty: a && a.qty ? a.qty : (a && a.moq) || 1, cost: +p.cost || 0, received: 0, damaged: 0 }); if (!x.supplierId) x.supplierId = p.supplierId; planDates(x, x.submitted || todayISO()); savePO(x); changed(); },
  'sup-open': function (id) { UI.modal = { type: 'sup', id: id }; render(); },
  'sup-new': function () { UI.modal = { type: 'sup', isNew: true, draft: { id: '', name: '', prodLead: settings().defaultProdLead, shipLead: settings().defaultTransit, moq: '' } }; render(); },
  'sup-save': function (id) {
    function v(k) { var el = document.getElementById('sf-' + k); return el ? el.value.trim() : ''; }
    if (!v('name')) { toast('Give the supplier a name.'); return; }
    var s = id ? sup(id) : { id: 'SUP-' + Date.now().toString(36).toUpperCase() };
    ['name', 'contact', 'email', 'phone', 'country', 'terms', 'notes'].forEach(function (k) { s[k] = v(k); });
    ['prodLead', 'shipLead', 'moq'].forEach(function (k) { var n2 = parseFloat(v(k)); s[k] = isNaN(n2) ? null : n2; });
    if (!id) WS.suppliers.push(s); saveSupplier(s); UI.modal = { type: 'sup', id: s.id }; toast('Supplier saved'); changed();
  },
  'sup-del': function (id) { WS.suppliers = WS.suppliers.filter(function (s) { return s.id !== id; }); unpersist('suppliers', id); UI.modal = null; changed(); },
  'sup-apply': function (id) {
    var s = sup(id), pf = E.supplierPerf(s, WS.pos); var newProd = Math.max(1, Math.round(pf.avgActual - (+s.shipLead || 0)));
    var delta = newProd - s.prodLead; s.prodLead = newProd; saveSupplier(s);
    WS.products.forEach(function (p) { if (p.supplierId === id && p.prodLead != null && p.prodLead !== '') { p.prodLead = Math.max(1, +p.prodLead + delta); saveProduct(p); } });
    toast(s.name + ' lead time set to ' + (newProd + (+s.shipLead || 0)) + ' days'); changed();
  },
  'ov-reset': function (k) { var p = prod(UI.sku); if (p.overrides) { delete p.overrides[k]; saveProduct(p); changed(); } },
  'promo-add': function () {
    var p = prod(UI.sku), st = document.getElementById('pr-start').value, en = document.getElementById('pr-end').value, lift = parseFloat(document.getElementById('pr-lift').value);
    if (!st || !en || isNaN(lift)) { toast('Enter start, end and lift %.'); return; } if (en < st) { toast('End date must be after start.'); return; }
    (p.promos = p.promos || []).push({ start: st, end: en, lift: lift, label: document.getElementById('pr-label').value || 'Promotion' }); saveProduct(p); changed();
  },
  'promo-del': function (i) { var p = prod(UI.sku); p.promos.splice(+i, 1); saveProduct(p); changed(); },
  'an-range': function (r) { UI.an.range = r; if (r === 'custom' && !UI.an.from) { UI.an.from = E.addDays(WS.meta.asOf, -60); UI.an.to = E.addDays(WS.meta.asOf, -1); } render(); },
  'an-rank': function (r) { UI.an.rank = r; render(); },
  'fc-tab': function (t) { UI.fc.tab = t; render(); },
  'wi-reset': function () { UI.wi = { sku: UI.wi.sku, salesPct: 0, leadDays: 0, seasonPct: 0, promoLift: 0, promoStart: '', promoDays: 7 }; render(); },
  sync: function () { if (Store.status && (Store.status.stores || []).length) startSync(false); else { UI.setTab = 'stores'; go('settings'); toast(isAdmin() ? 'Add a Shopify store first, or import CSV exports.' : 'An admin needs to connect a Shopify store first.'); } },
  'sync-full': function () { startSync(true); },
  'import-run': function () { runImport(); },
  'import-clear': function () { UI.imp = null; render(); },
  'start-import': function () { go('settings'); },
  'load-demo': function () { writeWorkspace(clone(DEMO), 'Loading demo store…'); },
  'reset-ask': function () { UI.confirmReset = true; render(); },
  'reset-no': function () { UI.confirmReset = false; render(); },
  'reset-yes': async function () {
    UI.confirmReset = false; UI.cart = {};
    if (Store.mode !== 'db') { WS = clone(DEMO); changed(); return; }
    toast('Resetting…');
    try { await API.req('POST', '/api/reset-demo'); await loadWorkspace(); toast('Demo data loaded'); } catch (e) { toast('Reset failed: ' + e.message); }
  }
};
function finishPOs(made) {
  if (!made.length) { toast('Nothing to order. Set quantities above zero.'); return; }
  toast(made.length > 1 ? made.length + ' draft purchase orders created' : made[0].id + ' created as a draft');
  UI.page = 'pos'; UI.poFilter = 'open'; UI.modal = { type: 'po', id: made[0].id }; changed();
}

function onField(e) {
  var el = e.target, f = el.dataset && el.dataset.f; if (!f) return;
  if (e.type === 'input' && !el.dataset.live && el.type !== 'range') return;
  var parts = f.split('|'), kind = parts[0], id = parts[1], key = parts[2];
  var raw = el.type === 'checkbox' ? el.checked : el.value;
  var numv = raw === '' ? null : parseFloat(raw);
  if (kind === 'urole') { API.req('PUT', '/api/users/' + id, { role: raw }).then(function () { UI.users = null; toast('Role updated'); render(); }).catch(function (x) { toast(x.message); UI.users = null; render(); }); return; }
  if (kind === 'sal') { salForm()[key] = el.type === 'checkbox' ? el.checked : raw; if (key === 'who') render(); return; }
  if (kind === 'sall') { var ln = salForm().lines[+id]; if (ln) { ln[key] = key === 'qty' ? (+raw || 0) : raw; if (key === 'sku') render(); } return; }
  if (kind === 'brand') { var bd = brandDraft(); var v = String(raw).trim(); if (key !== 'appName' && v && v[0] !== '#') v = '#' + v; bd[key] = v; if (key === 'appName' || BRAND.ok(v) || !v) { previewBrand(); render(); } return; }
  if (kind === 'sale') { saleForm()[key] = el.type === 'checkbox' ? el.checked : raw; if (key === 'store' || key === 'deduct') render(); return; }
  if (kind === 'salel') { var sl = saleForm().lines[+id]; if (sl) { sl[key] = raw; if (key === 'sku') render(); } return; }
  if (kind === 'ordimp') { UI.ordImp = UI.ordImp || {}; UI.ordImp[key] = el.type === 'checkbox' ? el.checked : raw; return; }
  if (kind === 'count') { UI.counts = UI.counts || {}; UI.counts[id] = raw; render(); return; }
  if (kind === 'impstock') { UI.impStock = el.checked; return; }
  if (kind === 'moqtoggle') { WS.settings.showMoqTiming = el.checked; if (isAdmin()) saveConfig('settings'); render(); return; }
  if (kind === 'ui') { UI[id][key] = raw; if (id === 'fc') UI.fc.tab = 'timeline'; render(); return; }
  if (kind === 'wi') { UI.wi[key] = key === 'sku' || key === 'promoStart' ? raw : (+raw || 0); render(); return; }
  if (kind === 'showinactive') { UI.showInactive = el.checked; render(); return; }
  if (kind === 'rsel') { UI.recSel[id] = el.checked; render(); return; }
  if (kind === 'rqty') { UI.recQty[id] = Math.max(0, Math.round(+raw || 0)); saveUI(); render(); return; }
  if (!Store.canWrite) return;
  if (kind === 'p') {
    var p = prod(id); if (!p) return;
    var numeric = ['prodLead', 'transit', 'moq', 'casePack', 'cost', 'price', 'stylistPrice', 'ssDays', 'ssUnits', 'ssPct', 'coverDays', 'targetLevel'];
    p[key] = numeric.indexOf(key) >= 0 ? (isNaN(numv) ? null : numv) : (raw || null);
    if (key === 'supplierId' || key === 'prodLead' || key === 'transit') p.needsSetup = false;
    if (key === 'status' && raw === 'launch' && !p.launch) p.launch = WS.meta.asOf;
    saveProduct(p); changed(); return;
  }
  if (kind === 'ov') {
    var p2 = prod(id); p2.overrides = p2.overrides || {};
    if (raw === '' || raw == null) delete p2.overrides[key]; else p2.overrides[key] = key === 'orderDate' || key === 'period' ? raw : numv;
    saveProduct(p2); changed(); return;
  }
  if ((kind === 's' || kind === 'sb' || kind === 'sn' || kind === 'm') && !isAdmin()) return;
  if (kind === 's') { WS.settings[key] = ['period', 'ssMethod', 'currency', 'defaultSupplier', 'autoSync', 'salonLocation', 'shopifyStaffRole'].indexOf(key) >= 0 ? raw : (isNaN(numv) ? null : numv); saveConfig('settings'); changed(); return; }
  if (kind === 'sb') { WS.settings[key] = !!raw; saveConfig('settings'); changed(); return; }
  if (kind === 'sn') { WS.settings.notify = Object.assign({}, settings().notify, WS.settings.notify || {}); WS.settings.notify[key] = !!raw; saveConfig('settings'); changed(); return; }
  if (kind === 'm') { WS.meta[key] = raw; saveConfig('meta'); render(); return; }
  if (kind === 'po') { var x = po(id); x[key] = raw || null; savePO(x); changed(); return; }
  if (kind === 'pol') { var x2 = po(id), ik = key.split(':'); x2.lines[+ik[0]][ik[1]] = Math.max(0, numv || 0); savePO(x2); changed(); return; }
}
var _live;
document.addEventListener('change', function (e) {
  if (e.target.dataset && e.target.dataset.file) {
    var kind = e.target.dataset.file, file = e.target.files[0]; if (!file) return;
    var r = new FileReader();
    r.onload = function () { try { var rows = parseCSV(String(r.result)); UI.imp = UI.imp || {}; UI.imp[kind] = { name: file.name, rows: rows }; if (!rows.length) toast(file.name + ' has no data rows.'); } catch (err) { toast('Could not read ' + file.name + ': ' + err.message); } render(); };
    r.onerror = function () { toast('Could not read ' + file.name + '.'); };
    r.readAsText(file); return;
  }
  onField(e);
});
document.addEventListener('input', function (e) { var el = e.target; if (!el.dataset || !el.dataset.f) return; if (el.type === 'range') { clearTimeout(_live); _live = setTimeout(function () { onField(e); }, 60); return; } if (el.dataset.live) { clearTimeout(_live); _live = setTimeout(function () { onField({ target: el, type: 'change' }); }, 180); } });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (UI.modal || UI.navOpen)) { UI.modal = null; UI.navOpen = false; render(); } });

/* ---------- Boot ---------- */
function pageFromUrl() {
  var s = /^\/app\/store\/([^/?#]+)/.exec(location.pathname);
  if (s) { try { return 'store/' + decodeURIComponent(s[1]); } catch (e) { return null; } }
  var m = /^\/app\/([a-z]+)/.exec(location.pathname), h = (location.hash || '').replace('#', '');
  var p = m ? m[1] : h;
  return PAGES.indexOf(p) >= 0 ? p : null;
}
window.addEventListener('popstate', function (e) {
  var st = e.state || {}, p = st.page || pageFromUrl() || 'dashboard';
  setPage(p); if (st.sku) UI.sku = st.sku; UI.modal = null; render();
});
(function boot() {
  var p = pageFromUrl(); if (p) setPage(p);
  render();
  initStore();
})();

function brandInfo() { return (UI.brandPreview) || (Store.status && Store.status.branding) || { appName: 'Addendum-Stockline' }; }
// Image uploads from any <input type=file data-img="kind|id">
document.addEventListener('change', async function (e) {
  var el = e.target; if (!el.dataset || !el.dataset.img) return;
  e.stopImmediatePropagation();
  var parts = el.dataset.img.split('|'), kind = parts[0], id = parts.slice(1).join('|'), file = el.files[0];
  if (!file) return;
  try {
    var data = await BRAND.read(file, kind === 'product' ? 1000 : 600);
    if (kind === 'product') { var r = await API.req('PUT', '/api/products/' + encodeURIComponent(id) + '/image', { image: data }); var p = prod(id); if (p) p.image = r.image; toast('Photo saved'); changed(); }
    else if (kind === 'store') { await API.req('PUT', '/api/stores/' + encodeURIComponent(id) + '/logo', { logo: data }); await loadStatus(); toast('Logo saved'); render(); }
    else if (kind === 'app') { UI.brandDraft = Object.assign({}, UI.brandDraft || {}, { logo: data, logoPreview: data }); render(); }
  } catch (err) { toast(err.message); el.value = ''; }
}, true);
Object.assign(ACTIONS, {
  'img-remove': async function (sku) { try { await API.req('PUT', '/api/products/' + encodeURIComponent(sku) + '/image', { image: null }); var p = prod(sku); if (p) p.image = null; toast('Photo removed'); changed(); } catch (e) { toast(e.message); } },
  'logo-remove': async function (id) { try { await API.req('PUT', '/api/stores/' + encodeURIComponent(id) + '/logo', { logo: null }); await loadStatus(); toast('Logo removed'); render(); } catch (e) { toast(e.message); } }
});
