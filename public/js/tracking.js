/* ---------- Store purchase pages, monthly usage, stock history and product editing ---------- */

// Reloading the workspace also drops cached usage and history so they refetch.
(function () {
  var lw = loadWorkspace;
  loadWorkspace = function () { UI.usage = null; UI.ledger = null; UI.pledger = {}; UI.ss = null; return lw.apply(this, arguments); };
  // Receipts and other changes saved from the browser: refresh history once the save lands.
  saveTxn = function (t) {
    return persist('txns', t.id, t).then(function () { UI.ledger = null; UI.pledger = {}; UI.usage = null; if (UI.page === 'ledger' || UI.page === 'product' || UI.page === 'usage') render(); });
  };
})();

function storeById(id) { return allStores().filter(function (s) { return s.id === id; })[0]; }
function isStylistStore(s) { return !!s && s.priceList === 'stylist'; }
function priceFor(s, p) {
  if (!p) return 0;
  if (isStylistStore(s) && p.stylistPrice != null && p.stylistPrice !== '') return +p.stylistPrice;
  return +p.price || 0;
}
function monthLabel(m, short) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return E.MON[mo - 1] + (short ? ' ’' + String(y).slice(2) : ' ' + y); }
function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n)); }

/* ===== Store purchases (one page per store) ===== */
function spForm(id) {
  UI.sf = UI.sf || {};
  if (!UI.sf[id]) UI.sf[id] = { date: todayISO(), customer: '', ref: '', note: '', deduct: true, lines: [{ sku: '', qty: 1, price: '' }], range: '30', who: '', q: '' };
  return UI.sf[id];
}
// Update the running total without re-rendering, so a click on the next button isn't lost mid-typing.
function spTotals(id) {
  var f = spForm(id), s = storeById(id), t = 0, el = document.getElementById('sp-total');
  f.lines.forEach(function (l) { var p = prod(l.sku); t += (+l.qty || 0) * (l.price !== '' && l.price != null ? +l.price : priceFor(s, p)); });
  if (el) el.textContent = 'Total ' + money(t, 2);
}
// A store's orders: logged here, imported, and synced from Shopify. Fetched per store and period.
var STORE_ORDER_LIMIT = 2000;
function storeSalesSince(f) { return f.range === 'all' ? '' : E.addDays(todayISO(), -Math.max(30, +f.range)); }
function storeSales(id) {
  var since = storeSalesSince(spForm(id)), key = id + '|' + since;
  if (UI.ss && UI.ss.key === key) return UI.ss.rows;
  if (Store.mode !== 'db' || (UI.ss && UI.ss.loading === key)) return null;
  UI.ss = { key: UI.ss && UI.ss.key, rows: UI.ss && UI.ss.rows, loading: key };
  API.req('GET', '/api/sales?store=' + encodeURIComponent(id) + '&limit=' + STORE_ORDER_LIMIT + (since ? '&since=' + since : ''))
    .then(function (r) { UI.ss = { key: key, rows: r }; render(); })
    .catch(function (e) { UI.ss = { key: key, rows: [] }; toast(e.message); render(); });
  return null;
}
function orderTotals(x) { var u = 0, v = 0; if (!x.cancelled) x.lines.forEach(function (l) { u += l.qty; v += l.qty * l.price; }); return { u: u, v: v }; }
var PAYMENT = { PAID: 'Paid', PENDING: 'Payment pending', AUTHORIZED: 'Authorized', PARTIALLY_PAID: 'Partially paid', PARTIALLY_REFUNDED: 'Partially refunded', REFUNDED: 'Refunded', VOIDED: 'Voided', EXPIRED: 'Expired' };
function orderSource(x) { return x.kind === 'shopify' ? 'Shopify' : x.kind === 'imported' ? 'Imported from Shopify export' : 'Logged here'; }
function orderTags(x) {
  return (x.kind === 'shopify' ? ' <span class="tag">Shopify</span>' : x.kind === 'imported' ? ' <span class="tag">Imported</span>' : '') +
    (x.cancelled ? ' <span class="tag risk">Cancelled</span>' : x.payment && /REFUND/.test(x.payment) ? ' <span class="tag down">' + esc(PAYMENT[x.payment]) + '</span>' : '');
}
function pageStore() {
  var s = storeById(UI.storeId);
  if (!s) {
    if (!Store.status) return '<div class="loading">Loading…</div>';
    return '<div class="ph"><div><h1>Store not found</h1><div class="sub">It may have been removed in Settings → Stores & sync.</div></div></div><button class="btn" data-act="nav|dashboard">Back to dashboard</button>';
  }
  var f = spForm(s.id), can = Store.canWrite, dis = can ? '' : ' disabled', pro = isStylistStore(s);
  var who = pro ? 'Stylist or salon' : 'Customer';
  var loaded = storeSales(s.id), all = loaded || [];
  var since = f.range === 'all' ? '0000' : E.addDays(todayISO(), -(+f.range)), q = (f.q || '').toLowerCase();
  var shown = all.filter(function (x) {
    if (x.date < since || (f.who && x.customer !== f.who)) return false;
    if (!q) return true;
    return [x.ref, x.customer, x.note].concat(x.lines.map(function (l) { var p = prod(l.sku); return l.sku + ' ' + (p ? p.name : ''); })).join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var d30 = E.addDays(todayISO(), -30), u30 = 0, v30 = 0, o30 = 0, bySku = {}, custs = {}, c30 = {};
  all.forEach(function (x) {
    if (x.customer) custs[x.customer] = 1;
    if (x.date >= d30 && !x.cancelled) { o30++; if (x.customer) c30[x.customer] = 1; x.lines.forEach(function (l) { u30 += l.qty; v30 += l.qty * l.price; bySku[l.sku] = (bySku[l.sku] || 0) + l.qty; }); }
  });
  var top = Object.keys(bySku).sort(function (a, b) { return bySku[b] - bySku[a]; })[0];
  var products = WS.products.filter(function (p) { return p.status !== 'discontinued'; }).sort(function (a, b) { return (a.collection + a.name).localeCompare(b.collection + b.name); });
  var total = 0; f.lines.forEach(function (l) { var p = prod(l.sku); total += (+l.qty || 0) * (l.price !== '' && l.price != null ? +l.price : priceFor(s, p)); });
  var sv = 0, su = 0; shown.forEach(function (x) { var t = orderTotals(x); su += t.u; sv += t.v; });

  return '<div class="ph"><div><div class="row" style="gap:10px">' + (s.logo ? '<img class="storelogo" src="' + esc(mediaUrl(s.logo)) + '" alt="">' : '') + '<h1>' + esc(storeLabel(s)) + '</h1><span class="tag">' + (pro ? 'Stylist pricing' : 'Retail (DTC) pricing') + '</span></div>' +
    '<div class="sub">Log what ' + (pro ? 'stylists and salons' : 'customers') + ' buy from ' + esc(storeLabel(s)) + '. Purchases count toward demand and can take units off your shared stock.</div></div></div>' +
    '<div class="grid2"><section class="card"><div class="hd"><div><h2>Log a purchase</h2><div class="small muted">Prices default to each product\'s ' + (pro ? 'stylist' : 'retail (DTC)') + ' price. Type over one to change it.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:14px">' +
    '<div class="fields"><label class="field"><span>Date</span><input type="date" id="sp-date" data-f="sp|' + esc(s.id) + '|date" value="' + esc(f.date) + '" max="' + E.addDays(todayISO(), 1) + '"' + dis + '></label>' +
    '<label class="field"><span>' + who + ' <span class="faint">(optional)</span></span><input type="text" id="sp-customer" list="sp-custs" data-f="sp|' + esc(s.id) + '|customer" value="' + esc(f.customer) + '" placeholder="' + (pro ? 'e.g. Studio Belle' : 'Name or email') + '"' + dis + '><datalist id="sp-custs">' + Object.keys(custs).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></label>' +
    '<label class="field"><span>Order # <span class="faint">(optional)</span></span><input type="text" id="sp-ref" data-f="sp|' + esc(s.id) + '|ref" value="' + esc(f.ref) + '" placeholder="e.g. #1043"' + dis + '></label></div>' +
    '<div><div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Items purchased</div><div style="display:flex;flex-direction:column;gap:8px">' +
    f.lines.map(function (l, i) {
      var p = prod(l.sku), a = A[l.sku];
      return '<div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:8px">' + skuPicker({ id: 'sp-sku-' + i, f: 'spl|' + esc(s.id) + '|' + i + ':sku', value: l.sku, dis: dis, style: 'flex:1;min-width:0' }) +
        '<input type="number" class="qty" min="1" step="1" id="sp-qty-' + i + '" data-f="spl|' + esc(s.id) + '|' + i + ':qty" value="' + esc(l.qty) + '" aria-label="Quantity"' + dis + '>' +
        '<input type="number" min="0" step="0.01" id="sp-price-' + i + '" data-f="spl|' + esc(s.id) + '|' + i + ':price" value="' + esc(l.price) + '" placeholder="' + (p ? esc(priceFor(s, p).toFixed(2)) : 'Price') + '" style="width:92px" aria-label="Unit price"' + dis + '>' +
        (f.lines.length > 1 ? '<button class="btn ghost sm" data-act="sp-line-del|' + esc(s.id) + '|' + i + '" aria-label="Remove item">✕</button>' : '') + '</div>' +
        (pro && p && (p.stylistPrice == null || p.stylistPrice === '') ? '<div class="small faint">No stylist price set for this product, so retail is used.</div>' : '') +
        (f.deduct && a && +l.qty > a.onHand ? '<div class="small" style="color:var(--now)">Only ' + num(a.onHand) + ' in stock</div>' : '');
    }).join('') + '</div><div class="row" style="margin-top:6px;justify-content:space-between"><button class="btn ghost sm" data-act="sp-line-add|' + esc(s.id) + '"' + dis + '>+ Add another item</button><span class="small"><b id="sp-total">Total ' + money(total, 2) + '</b></span></div></div>' +
    '<label class="field"><span>Note <span class="faint">(optional)</span></span><input type="text" id="sp-note" data-f="sp|' + esc(s.id) + '|note" value="' + esc(f.note) + '"' + dis + '></label>' +
    '<label class="check"><input type="checkbox" data-f="sp|' + esc(s.id) + '|deduct"' + (f.deduct ? ' checked' : '') + dis + '> Take these units off stock <span class="small faint">(untick if your stock count already reflects it)</span></label>' +
    '<div class="row"><button class="btn primary" data-act="sp-record|' + esc(s.id) + '"' + (can && !UI.spBusy ? '' : ' disabled') + '>' + (UI.spBusy ? 'Saving…' : 'Log purchase') + '</button>' + (can ? '' : '<span class="small muted">Viewers can\'t log purchases.</span>') + '</div></div></section>' +

    '<div class="stack"><section class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
    kpi('Units, 30 days', num(u30), Object.keys(bySku).length + ' products') + kpi('Sales value, 30 days', money(v30), o30 + ' purchase' + (o30 === 1 ? '' : 's')) +
    kpi(pro ? 'Stylists buying' : 'Customers', num(Object.keys(c30).length), 'last 30 days') + kpi('Most purchased', top ? esc((prod(top) || {}).name || top) : '—', top ? num(bySku[top]) + ' units' : '') + '</section>' +
    '<section class="card"><div class="hd"><div><h2>Import orders</h2><div class="small muted">Export orders from this store\'s Shopify admin (Orders → Export) and bring them in at once.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">' +
    '<input type="file" accept=".csv,text/csv" data-ordfile="1" aria-label="Orders export"' + dis + '>' + (UI.ordImp && UI.ordImp.file ? '<span class="small" style="color:var(--ok)">✓ ' + esc(UI.ordImp.file.name) + ' · ' + num(UI.ordImp.file.rows.length) + ' rows</span>' : '') +
    '<label class="check small"><input type="checkbox" data-f="ordimp||deduct"' + (UI.ordImp && UI.ordImp.deduct ? ' checked' : '') + dis + '> Take new orders off stock</label>' +
    '<p class="small faint" style="margin:0">Importing the same file again replaces those orders instead of adding them twice. Cancelled and refunded orders are left out.</p>' +
    '<button class="btn" style="align-self:flex-start" data-act="sp-import|' + esc(s.id) + '"' + (UI.ordImp && UI.ordImp.file && can ? '' : ' disabled') + '>Import orders</button></div></section>' +
    (isAdmin() ? '<section class="card"><div class="hd"><div><h2>Pricing</h2><div class="small muted">Which price this store charges by default.</div></div></div><div class="bd"><div class="seg" role="group" aria-label="Price list">' +
      [['retail', 'Retail (DTC)'], ['stylist', 'Stylist']].map(function (o) { return '<button aria-pressed="' + ((s.priceList || 'retail') === o[0]) + '" data-act="sp-pricelist|' + esc(s.id) + '|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></section>' : '') +
    '</div></div>' +

    '<section class="card"><div class="hd"><div><h2>Purchases</h2><div class="small muted">' + shown.length + ' purchase' + (shown.length === 1 ? '' : 's') + ' · ' + num(su) + ' units · ' + money(sv, 2) + '</div></div>' +
    '<div class="row"><input type="search" data-live="1" id="sp-q" data-f="sp|' + esc(s.id) + '|q" value="' + esc(f.q) + '" placeholder="Search" style="width:150px" aria-label="Search purchases">' +
    '<select data-f="sp|' + esc(s.id) + '|who" aria-label="' + who + '"><option value="">All ' + (pro ? 'stylists' : 'customers') + '</option>' + Object.keys(custs).sort().map(function (n) { return '<option' + (f.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
    '<div class="seg" role="group" aria-label="Period">' + [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']].map(function (o) { return '<button aria-pressed="' + (f.range === o[0]) + '" data-act="sp-range|' + esc(s.id) + '|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>' +
    '<div class="bd flush tw"><table class="t"><thead><tr><th>Date</th><th>' + who + '</th><th>Order</th><th>Items</th><th class="r">Units</th><th class="r">Value</th><th>Stock</th><th></th></tr></thead><tbody>' +
    (!loaded ? '<tr><td colspan="8"><div class="empty">Loading…</div></td></tr>' : shown.length ? shown.slice(0, 400).map(function (x) {
      var t = orderTotals(x), u = t.u, v = t.v;
      return '<tr class="click" data-act="order-open|' + esc(x.id) + '" title="View order"><td>' + dNice(x.date, true) + '</td><td>' + esc(x.customer || '—') + (x.note ? '<div class="small faint">' + esc(x.note) + '</div>' : '') + '</td><td>' + esc(x.ref && x.ref !== 'Manual sale' ? x.ref : '—') + orderTags(x) + '</td>' +
        '<td class="wrap">' + x.lines.map(function (l) { var p = prod(l.sku); return '<div><button class="btn ghost sm" style="padding:0" data-act="open-product|' + esc(l.sku) + '">' + esc(p ? p.name : l.sku) + '</button> × ' + num(l.qty) + ' <span class="small faint">@ ' + money(l.price, 2) + '</span></div>'; }).join('') + '</td>' +
        '<td class="r"><b>' + num(u) + '</b></td><td class="r">' + money(v, 2) + '</td><td>' + (x.deducted ? '<span class="small">Taken off</span>' : x.kind === 'shopify' ? '<span class="small faint">From Shopify</span>' : '<span class="small faint">Not changed</span>') + '</td>' +
        '<td>' + (x.kind === 'manual' && can ? (UI.saleUndo === x.id ? '<span class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="sale-undo-no">Keep</button><button class="btn sm primary" data-act="sale-undo-yes|' + esc(x.id) + '">Undo</button></span>' : '<button class="btn ghost sm" data-act="sale-undo|' + esc(x.id) + '">Undo</button>') : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8"><div class="empty"><b>No purchases ' + (f.range === 'all' && !q && !f.who ? 'yet' : 'match') + '</b>Log one above, or import this store\'s orders.</div></td></tr>') +
    '</tbody></table></div>' + (loaded && all.length >= STORE_ORDER_LIMIT ? '<div class="bd small muted">Showing the latest ' + num(STORE_ORDER_LIMIT) + ' orders. Choose a shorter period to see everything in it.</div>' : shown.length > 400 ? '<div class="bd small muted">Showing the latest 400 of ' + num(shown.length) + '. Search or choose a shorter period to narrow it down.</div>' : '') + '</section>';
}

/* ===== Order detail ===== */
function orderModal(m) {
  var x = (UI.ss && UI.ss.rows || []).filter(function (o) { return o.id === m.id; })[0];
  if (!x) return '<div class="mh"><h2>Order not found</h2><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb"><p class="muted">It may have been removed. Close this window and reload the page.</p></div>';
  var s = storeById(x.storeId), pro = isStylistStore(s), t = { u: 0, v: 0, refunded: 0 };
  var rows = x.lines.map(function (l) {
    var p = prod(l.sku), line = l.qty * l.price, back = (l.ordered || l.qty) - l.qty;
    t.u += l.qty; t.v += line; t.refunded += back;
    return '<tr' + (p ? ' class="click" data-act="order-product|' + esc(l.sku) + '"' : '') + '><td><div class="pwrap">' + thumb(p) + '<div class="pname"><b>' + esc(p ? p.name : l.sku) + '</b><span>' + esc(l.sku) + (p && p.variant ? ' · ' + esc(p.variant) : '') + (p ? '' : ' · not in your products') + '</span></div></div></td>' +
      '<td class="r">' + num(l.qty) + (back > 0 ? '<div class="small" style="color:var(--soon)">' + num(back) + ' refunded of ' + num(l.ordered) + '</div>' : '') + '</td><td class="r">' + money(l.price, 2) + '</td><td class="r"><b>' + money(line, 2) + '</b></td></tr>';
  }).join('');
  var undo = x.kind === 'manual' && Store.canWrite;
  return '<div class="mh"><div><div class="eyebrow">' + esc(s ? storeLabel(s) : x.store || 'Order') + '</div><h2>' + esc(x.ref && x.ref !== 'Manual sale' ? 'Order ' + x.ref : 'Purchase') + orderTags(x) + '</h2><div class="small faint">' + esc(dLong(x.date)) + '</div></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (x.cancelled ? '<div class="note bad">This order was cancelled in Shopify, so it doesn\'t count toward sales.</div>' : '') +
    '<section class="card"><div class="bd"><dl class="dl">' +
    '<dt>' + (pro ? 'Stylist or salon' : 'Customer') + '</dt><dd>' + esc(x.customer || '—') + '</dd>' +
    '<dt>Source</dt><dd>' + esc(orderSource(x)) + '</dd>' +
    (x.payment ? '<dt>Payment</dt><dd>' + esc(PAYMENT[x.payment] || x.payment) + '</dd>' : '') +
    '<dt>Stock</dt><dd>' + (x.deducted ? 'Taken off stock when logged' : x.kind === 'shopify' ? 'Counted in Shopify\'s inventory' : 'Not changed') + '</dd>' +
    (x.note ? '<dt>Note</dt><dd>' + esc(x.note) + '</dd>' : '') + '</dl></div></section>' +
    '<section class="card"><div class="hd"><h2>Items</h2><span class="small muted">' + x.lines.length + ' line' + (x.lines.length === 1 ? '' : 's') + '</span></div><div class="bd flush tw"><table class="t"><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Total</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="4"><div class="empty">No items with a SKU on this order.</div></td></tr>') +
    '</tbody><tfoot><tr><td><b>Total</b></td><td class="r"><b>' + num(t.u) + '</b></td><td></td><td class="r"><b>' + money(t.v, 2) + '</b></td></tr></tfoot></table></div></section>' +
    (x.kind === 'shopify' ? '<p class="small faint" style="margin:0">Prices are before discounts, tax and shipping. Items without a SKU aren\'t imported from Shopify.</p>' : '') +
    (undo ? '<div class="row" style="justify-content:flex-end">' + (m.undo ? '<span class="small" style="color:var(--now)">Remove this purchase' + (x.deducted ? ' and put its units back in stock' : '') + '?</span><button class="btn sm" data-act="order-undo-no">Keep</button><button class="btn sm primary" data-act="order-undo-yes|' + esc(x.id) + '">Undo purchase</button>' : '<button class="btn ghost danger" data-act="order-undo">Undo purchase</button>') + '</div>' : '') +
    '</div>';
}
(function () {
  var base = modalHtml;
  modalHtml = function () {
    var m = UI.modal;
    if (m && m.type === 'order') return '<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">' + orderModal(m) + '</div></div>';
    return base();
  };
})();

/* ===== Monthly usage dashboard ===== */
function loadUsage() {
  var n = +usageState().months || 12;
  if (UI.usageLoading === n) return; UI.usageLoading = n;
  API.req('GET', '/api/usage-monthly?months=' + n).then(function (r) { if (UI.usageLoading !== n) return; r.req = n; UI.usage = r; UI.usageLoading = null; render(); })
    .catch(function (e) { UI.usageLoading = null; UI.usage = { req: n, error: e.message }; render(); });
}
// Filters only change what is shown; the loaded history stays in UI.usage, keyed by SKU.
function usageState() { if (!UI.uf) UI.uf = { ch: '', col: '', q: '', sort: 'name', months: 12, used: false }; return UI.uf; }
function usageName(o) { return o.p ? o.p.name : o.sku; }
function pageUsage() {
  var head = '<div class="ph"><div><h1>Monthly usage</h1><div class="sub">Units used per product each month, from order history in every store plus salon use, with the monthly average. Usage follows the SKU, so renaming a product or moving it to another collection keeps its history.</div></div><div class="actions"><button class="btn" data-act="usage-csv"' + (UI.usage && UI.usage.rows ? '' : ' disabled') + '>Download CSV</button></div></div>';
  if (Store.mode !== 'db') return head + '<div class="note">Monthly usage needs the Addendum-Stockline server.</div>';
  var f = usageState();
  if (!UI.usage || UI.usage.req !== (+f.months || 12)) loadUsage(); // keeps showing the previous range until the new one arrives
  if (!UI.usage) return head + '<div class="loading">Loading usage…</div>';
  if (UI.usage.error) return head + '<div class="note bad">' + esc(UI.usage.error) + '</div>';
  var U = UI.usage, months = U.months, cur = U.currentMonth, nM = months.length;
  var curIdx = months.indexOf(cur);
  // Months that count toward the average: complete months from the first month with any usage.
  var firstIdx = nM; U.rows.forEach(function (r) { var i = months.indexOf(r.m); if (i >= 0 && i < firstIdx) firstIdx = i; });
  var fullIdx = []; for (var i = firstIdx; i < nM; i++) if (i !== curIdx) fullIdx.push(i);
  var chName = {}; U.channels.forEach(function (c) { chName[c.id] = c.name; });
  var rows = U.rows.filter(function (r) { return !f.ch || r.ch === f.ch; });
  var per = {}, chTot = {}, monthTot = new Array(nM).fill(0);
  function shown(sku, p) {
    if (f.col && (!p || (p.collection || 'Uncategorized') !== f.col)) return false;
    return !f.q || (sku + ' ' + (p ? p.name : '')).toLowerCase().indexOf(f.q.toLowerCase()) >= 0;
  }
  rows.forEach(function (r) {
    var i = months.indexOf(r.m); if (i < 0) return;
    var p = prod(r.sku);
    if (!shown(r.sku, p)) return;
    var o = per[r.sku] = per[r.sku] || { sku: r.sku, p: p, m: new Array(nM).fill(0) };
    o.m[i] += r.u; monthTot[i] += r.u;
    var c = chTot[r.ch] = chTot[r.ch] || new Array(nM).fill(0); c[i] += r.u;
  });
  // Every tracked product is listed, with zeros for months it wasn't used.
  if (!f.used) WS.products.forEach(function (p) { if (p.status !== 'untracked' && !per[p.sku] && shown(p.sku, p)) per[p.sku] = { sku: p.sku, p: p, m: new Array(nM).fill(0) }; });
  // A product's own average starts at its first month with usage, so a new launch isn't averaged over months it didn't exist.
  function firstOf(arr) { for (var i = 0; i < arr.length; i++) if (arr[i]) return i; return arr.length; }
  function avgFrom(arr) { var f0 = firstOf(arr), idx = fullIdx.filter(function (i) { return i >= f0; }); if (!idx.length) return 0; var s = 0; idx.forEach(function (i) { s += arr[i]; }); return s / idx.length; }
  function avgOf(arr) { if (!fullIdx.length) return 0; var s = 0; fullIdx.forEach(function (i) { s += arr[i]; }); return s / fullIdx.length; }
  var list = Object.keys(per).map(function (k) { var o = per[k]; o.total = o.m.reduce(function (a, b) { return a + b; }, 0); o.avg = avgFrom(o.m); o.months = fullIdx.filter(function (i) { return i >= firstOf(o.m); }).length; o.last = curIdx > 0 ? o.m[curIdx - 1] : o.m[nM - 1]; return o; });
  list.sort(function (a, b) { return f.sort === 'name' ? usageName(a).localeCompare(usageName(b), undefined, { numeric: true, sensitivity: 'base' }) : f.sort === 'total' ? b.total - a.total : f.sort === 'last' ? b.last - a.last : b.avg - a.avg; });
  var avgAll = avgOf(monthTot), lastIdx = curIdx > 0 ? curIdx - 1 : nM - 1, lastM = monthTot[lastIdx];
  var soFar = curIdx >= 0 ? monthTot[curIdx] : 0;
  var td = new Date(), dim = new Date(td.getFullYear(), td.getMonth() + 1, 0).getDate(), dom = td.getDate();
  var pace = cur === todayISO().slice(0, 7) && dom > 2 ? soFar / dom * dim : null;
  var topP = list.filter(function (o) { return o.avg > 0; }).sort(function (a, b) { return b.avg - a.avg; })[0];
  var cols = collections();

  var kpis = '<section class="kpis">' +
    kpi('Average per month', num(avgAll), fullIdx.length ? 'over ' + fullIdx.length + ' full month' + (fullIdx.length === 1 ? '' : 's') : 'no full months yet') +
    kpi(monthLabel(months[lastIdx]), num(lastM), avgAll ? pct(lastM / avgAll - 1, true) + ' vs average' : '') +
    kpi(monthLabel(cur) + ' so far', num(soFar), pace != null ? 'on pace for ~' + num(pace) : 'month in progress') +
    kpi('Most used', topP ? esc(topP.p ? topP.p.name : topP.sku) : '—', topP ? num(topP.avg) + ' a month on average' : '') + '</section>';

  var labels = months.map(function (m) { return monthLabel(m, true); });
  var chartCard = '<section class="card"><div class="hd"><div><h2>Units used per month</h2><div class="small muted">' + (f.ch ? esc(chName[f.ch] || f.ch) : 'All channels') + (f.col ? ' · ' + esc(f.col) : '') + '</div></div><div class="legend"><span><i style="background:var(--chart-1)"></i>Units</span><span><i style="background:var(--ink-3)"></i>Average</span></div></div><div class="bd">' +
    chart({ type: 'bar', labels: labels, series: [{ values: monthTot, color: '--chart-1' }], hlines: avgAll ? [{ v: avgAll, color: '--ink-3' }] : [], h: 220, label: 'Units used per month',
      tip: function (i) { return monthLabel(months[i]) + ': <b>' + num(monthTot[i]) + '</b> units' + (i === curIdx ? ' (so far)' : '') + (U.channels.length > 1 && !f.ch ? '<br>' + U.channels.map(function (c) { return esc(c.name) + ' ' + num((chTot[c.id] || [])[i] || 0); }).join(' · ') : ''); } }) + '</div></section>';

  var chCard = '<section class="card"><div class="hd"><h2>By channel</h2><span class="small muted">units</span></div><div class="bd flush tw"><table class="t"><thead><tr><th>Channel</th><th class="r">' + esc(monthLabel(months[lastIdx], true)) + '</th><th class="r">Avg / month</th><th class="r">' + nM + ' months</th><th class="r">Share</th></tr></thead><tbody>' +
    (function () {
      var grand = 0; U.channels.forEach(function (c) { (chTot[c.id] || []).forEach(function (v) { grand += v; }); });
      var ids = f.ch ? [f.ch] : U.channels.map(function (c) { return c.id; });
      return ids.map(function (id) { var arr = chTot[id] || new Array(nM).fill(0), t = arr.reduce(function (a, b) { return a + b; }, 0); return '<tr><td><b>' + esc(chName[id] || id) + '</b></td><td class="r">' + num(arr[lastIdx]) + '</td><td class="r">' + num(avgOf(arr)) + '</td><td class="r">' + num(t) + '</td><td class="r">' + (grand ? pct(t / grand) : '—') + '</td></tr>'; }).join('') || '<tr><td colspan="5"><div class="empty">No usage yet.</div></td></tr>';
    })() + '</tbody></table></div></section>';

  var filters = '<div class="filters"><input type="search" data-live="1" id="uf-q" data-f="uf||q" value="' + esc(f.q) + '" placeholder="Search products" aria-label="Search products">' +
    '<select data-f="uf||ch" aria-label="Channel"><option value="">All channels</option>' + U.channels.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.ch === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
    '<select data-f="uf||col" aria-label="Collection"><option value="">All collections</option>' + cols.map(function (c) { return '<option' + (f.col === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
    '<select data-f="uf||sort" aria-label="Sort">' + [['name', 'All products (A–Z)'], ['avg', 'Most used per month'], ['total', 'Most used in total'], ['last', 'Most used last month']].map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    '<select data-f="uf||months" aria-label="Months of history">' + [[12, 'Last 12 months'], [24, 'Last 24 months']].map(function (o) { return '<option value="' + o[0] + '"' + (+f.months === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    '<label class="check small"><input type="checkbox" data-f="uf||used"' + (f.used ? ' checked' : '') + '> Only products with usage</label>' +
    (UI.usageLoading ? '<span class="small muted">Loading ' + UI.usageLoading + ' months…</span>' : '') + '</div>';

  function sh(label, key, cls) { return '<th class="' + (cls || '') + ' sortable"><button data-act="usage-sort|' + key + '" aria-pressed="' + (f.sort === key) + '">' + label + (f.sort === key ? ' ↓' : '') + '</button></th>'; }
  var table = '<section class="card"><div class="hd"><div><h2>Products</h2><div class="small muted">' + list.length + ' product' + (list.length === 1 ? '' : 's') + ' · average uses complete months' + (fullIdx.length ? ' (' + monthLabel(months[fullIdx[0]]) + ' – ' + monthLabel(months[fullIdx[fullIdx.length - 1]]) + '), from each product\'s first month' : '') + '; ' + esc(monthLabel(cur)) + ' is in progress</div></div></div>' +
    '<div class="bd flush tw"><table class="t usage"><thead><tr>' + sh('Product', 'name', 'stick') + months.map(function (m, i) { return '<th class="r' + (i === curIdx ? ' curm' : '') + '">' + esc(monthLabel(m, true)) + '</th>'; }).join('') + sh('Avg / mo', 'avg', 'r hi') + sh('Total', 'total', 'r') + '</tr></thead><tbody>' +
    (list.length ? list.map(function (o) {
      return '<tr class="click" data-act="open-product|' + esc(o.sku) + '"><td class="stick"><b>' + esc(usageName(o)) + '</b><div class="small faint">' + esc(o.sku) + '</div></td>' +
        o.m.map(function (v, i) { return '<td class="r' + (i === curIdx ? ' curm' : '') + (v ? '' : ' faint') + '">' + (v ? num(v) : '–') + '</td>'; }).join('') +
        '<td class="r hi" title="Average of ' + o.months + ' full month' + (o.months === 1 ? '' : 's') + '"><b>' + (o.avg >= 10 || !o.avg ? num(o.avg) : (Math.round(o.avg * 10) / 10)) + '</b>' + (o.months && o.months < fullIdx.length ? '<div class="small faint">' + o.months + ' mo</div>' : '') + '</td><td class="r">' + num(o.total) + '</td></tr>';
    }).join('') + '<tr class="tot"><td class="stick"><b>Total</b></td>' + monthTot.map(function (v, i) { return '<td class="r' + (i === curIdx ? ' curm' : '') + '"><b>' + num(v) + '</b></td>'; }).join('') + '<td class="r hi"><b>' + num(avgAll) + '</b></td><td class="r"><b>' + num(monthTot.reduce(function (a, b) { return a + b; }, 0)) + '</b></td></tr>'
      : '<tr><td colspan="' + (nM + 3) + '"><div class="empty"><b>No usage recorded' + (f.ch || f.col || f.q ? ' for this filter' : ' yet') + '</b>Purchases logged on the store pages and salon usage show up here.</div></td></tr>') +
    '</tbody></table></div></section>';

  return head + kpis + filters + '<div class="grid2e">' + chartCard + chCard + '</div>' + table;
}

/* ===== Stock history (ledger) ===== */
var LEDGER_TYPES = [['', 'All changes'], ['receive', 'PO received'], ['sale', 'Store purchase'], ['salon', 'Salon use'], ['count', 'Stock count'], ['adjust', 'Adjustment'], ['sync', 'Shopify sync']];
function ledgerState() { if (!UI.lf) UI.lf = { sku: '', type: '', store: '', from: E.addDays(todayISO(), -90), to: '', q: '' }; return UI.lf; }
function ledgerQuery(o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
function loadLedger() {
  var f = ledgerState(), key = ledgerQuery({ sku: f.sku, type: f.type, store: f.store, from: f.from, to: f.to, q: f.q, limit: 2000 });
  if (UI.ledger && UI.ledger.key === key) return; if (UI.ledgerLoading === key) return;
  UI.ledgerLoading = key;
  API.req('GET', '/api/ledger?' + key).then(function (r) { if (UI.ledgerLoading !== key) return; r.key = key; UI.ledger = r; UI.ledgerLoading = null; render(); })
    .catch(function (e) { UI.ledgerLoading = null; UI.ledger = { key: key, error: e.message, rows: [], totals: {} }; render(); });
}
function typeTag(t) { var cls = { receive: 'in', sale: 'out', salon: 'out', count: 'cnt', adjust: 'adj', sync: 'cnt' }[t.type] || ''; return '<span class="tag lt ' + cls + '">' + esc(t.label || t.type) + '</span>'; }
function pageLedger() {
  var f = ledgerState(), dis = Store.canWrite ? '' : ' disabled';
  var head = '<div class="ph"><div><h1>Stock history</h1><div class="sub">Every change to on-hand stock: receipts, store purchases, counts, adjustments and salon use, with the running balance after each one.</div></div>' +
    '<div class="actions"><button class="btn" data-act="ledger-csv"' + (UI.ledger && UI.ledger.rows && UI.ledger.rows.length ? '' : ' disabled') + '>Download CSV</button><button class="btn" data-act="nav|inventory">Count stock</button><button class="btn primary" data-act="ledger-adjust"' + dis + '>Adjust stock</button></div></div>';
  if (Store.mode !== 'db') return head + '<div class="note">Stock history needs the Addendum-Stockline server.</div>';
  loadLedger();
  var L = UI.ledger && UI.ledger.key === ledgerQuery({ sku: f.sku, type: f.type, store: f.store, from: f.from, to: f.to, q: f.q, limit: 2000 }) ? UI.ledger : null;
  var products = WS.products.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var filters = '<div class="filters"><input type="search" data-live="1" id="lf-q" data-f="lf||q" value="' + esc(f.q) + '" placeholder="Search notes, orders, people" aria-label="Search">' +
    skuPicker({ id: 'lf-sku', f: 'lf||sku', value: f.sku, empty: 'All products', placeholder: 'All products (search SKU, color…)', all: true, style: 'width:260px' }) +
    '<select data-f="lf||type" aria-label="Type of change">' + LEDGER_TYPES.map(function (o) { return '<option value="' + o[0] + '"' + (f.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    (allStores().length ? '<select data-f="lf||store" aria-label="Store"><option value="">All stores</option>' + allStores().map(function (s) { return '<option value="' + esc(s.id) + '"' + (f.store === s.id ? ' selected' : '') + '>' + esc(storeLabel(s)) + '</option>'; }).join('') + '</select>' : '') +
    '<label class="row small" style="gap:6px">From <input type="date" data-f="lf||from" value="' + esc(f.from) + '" aria-label="From date"></label><label class="row small" style="gap:6px">To <input type="date" data-f="lf||to" value="' + esc(f.to) + '" aria-label="To date"></label>' +
    (f.sku || f.type || f.store || f.q || f.to || f.from !== E.addDays(todayISO(), -90) ? '<button class="btn ghost sm" data-act="ledger-clear">Clear filters</button>' : '') + '</div>';
  if (!L) return head + filters + '<div class="loading">Loading stock history…</div>';
  if (L.error) return head + filters + '<div class="note bad">' + esc(L.error) + '</div>';
  var t = L.totals || {}, one = f.sku ? prod(f.sku) : null;
  var kpis = '<section class="kpis">' + kpi('Changes', num(t.count || 0), L.shown < (t.count || 0) ? 'showing latest ' + num(L.shown) : 'in this view') + kpi('Units in', '+' + num(t.in || 0), 'received, counted up, returned') +
    kpi('Units out', '−' + num(t.out || 0), 'purchases, salon, write-offs') + kpi(one ? 'On hand now' : 'Net change', one ? num(one.onHand) : signed((t.in || 0) - (t.out || 0)), one ? one.name : 'units') + '</section>';
  var table = '<section class="card"><div class="bd flush tw"><table class="t"><thead><tr><th>Date</th><th>Product</th><th>Change</th><th class="r">Qty</th><th class="r">Balance</th><th>Store</th><th>Details</th><th>By</th></tr></thead><tbody>' +
    (L.rows.length ? L.rows.map(function (r) {
      return '<tr><td>' + dNice(r.date, true) + '</td><td><button class="btn ghost sm" style="padding:0;text-align:left" data-act="open-product|' + esc(r.sku) + '">' + esc(r.name) + '</button><div class="small faint">' + esc(r.sku) + '</div></td><td>' + typeTag(r) + '</td>' +
        '<td class="r"><b class="' + (r.qty > 0 ? 'qin' : r.qty < 0 ? 'qout' : '') + '">' + signed(r.qty) + '</b></td><td class="r" style="white-space:nowrap">' + (r.after == null ? '—' : (r.before >= 0 ? '<span class="faint">' + num(r.before) + ' → </span>' : '') + '<b>' + num(r.after) + '</b>') + '</td>' +
        '<td>' + esc(r.store || '—') + '</td><td class="wrap">' + esc(r.ref || '') + (r.note ? '<div class="small faint">' + esc(r.note) + '</div>' : '') + '</td><td class="small">' + esc(r.user || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="8"><div class="empty"><b>No stock changes in this view</b>Try a wider date range or clear the filters.</div></td></tr>') +
    '</tbody></table></div></section>';
  return head + filters + kpis + table;
}
function productLedgerCard(p) {
  UI.pledger = UI.pledger || {};
  var L = UI.pledger[p.sku];
  if (!L && Store.mode === 'db' && !UI.pledgerLoading) {
    UI.pledgerLoading = p.sku;
    API.req('GET', '/api/ledger?sku=' + encodeURIComponent(p.sku) + '&limit=15').then(function (r) { UI.pledger[p.sku] = r; UI.pledgerLoading = null; render(); }).catch(function () { UI.pledger[p.sku] = { rows: [] }; UI.pledgerLoading = null; render(); });
  }
  var rows = L ? L.rows : WS.txns.filter(function (t) { return t.sku === p.sku; }).slice(0, 15).map(function (t) { return { date: t.date, type: t.type, label: t.type, qty: t.qty, ref: t.ref, note: t.note }; });
  return '<section class="card"><div class="hd"><h2>Stock history</h2><button class="btn ghost sm" data-act="ledger-for|' + esc(p.sku) + '">See all</button></div><div class="bd flush">' +
    (rows.length ? '<table class="t"><tbody>' + rows.map(function (t) {
      return '<tr><td style="white-space:nowrap">' + dNice(t.date, true) + '</td><td class="wrap">' + typeTag(t) + '<div class="small faint">' + esc(t.ref || '') + (t.store ? ' · ' + esc(t.store) : '') + (t.note ? ' · ' + esc(t.note) : '') + '</div></td><td class="r"><b class="' + (t.qty > 0 ? 'qin' : 'qout') + '">' + signed(t.qty) + '</b>' + (t.after != null ? '<div class="small faint">→ ' + num(t.after) + '</div>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">' + (L || Store.mode !== 'db' ? 'No stock changes recorded yet.' : 'Loading…') + '</div>') + '</div></section>';
}

/* ===== Edit product ===== */
var ADJ_REASONS = [['count', 'Stock count'], ['damaged', 'Damaged'], ['lost', 'Lost / missing'], ['returned', 'Customer return'], ['found', 'Found stock'], ['sample', 'Sample / gift'], ['correction', 'Correction'], ['other', 'Other']];
function reasonSelect(id, sel) { return '<select id="' + id + '">' + ADJ_REASONS.map(function (o) { return '<option value="' + o[0] + '"' + (sel === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
function editProductModal(p, m) {
  var d = m.draft || {};
  function v(k) { return d[k] != null ? d[k] : p[k] == null ? '' : p[k]; }
  function f(k, label, type, help, ph) { return '<label class="field"><span>' + label + '</span><input type="' + (type || 'text') + '" id="ep-' + k + '" value="' + esc(v(k)) + '"' + (type === 'number' ? ' min="0" step="any"' : '') + (ph != null ? ' placeholder="' + esc(ph) + '"' : '') + '>' + (help ? '<small>' + help + '</small>' : '') + '</label>'; }
  var sp = sup(v('supplierId')), cols = collections();
  var stock = d.onHand != null ? d.onHand : p.onHand;
  return '<div class="mh"><div><div class="eyebrow">Edit product</div><h2>' + esc(p.name) + '</h2><div class="small faint">' + esc(p.sku) + '</div></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') +
    '<section class="card"><div class="hd"><h2>Details</h2></div><div class="bd"><div class="fields">' + f('name', 'Name') +
    '<label class="field"><span>Collection</span><input type="text" id="ep-collection" list="ep-cols" value="' + esc(v('collection')) + '"><datalist id="ep-cols">' + cols.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></label>' +
    f('variant', 'Shade / length') +
    '<label class="field"><span>Status</span><select id="ep-status">' + statusOptions(v('status')) + '</select><small>Not tracked: left out of inventory, forecasts and reorders</small></label></div></div></section>' +
    '<section class="card"><div class="hd"><h2>Prices</h2></div><div class="bd"><div class="fields">' + f('price', 'Retail (DTC) price', 'number', 'Charged by retail stores, e.g. Addendum Hair') + f('stylistPrice', 'Stylist price', 'number', 'Charged by stylist stores, e.g. Addendum Hair Pro') + f('cost', 'Unit cost', 'number', 'What you pay the supplier') + '</div></div></section>' +
    '<section class="card"><div class="hd"><div><h2>Stock</h2><div class="small muted">Changing on hand is logged in Stock history with the reason.</div></div></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>On hand</span><input type="number" id="ep-onHand" min="0" step="1" value="' + esc(stock) + '"><small>Currently ' + num(p.onHand) + '</small></label>' +
    '<label class="field"><span>Reason for change</span>' + reasonSelect('ep-reason', d.reason || 'count') + '</label>' +
    '<label class="field"><span>Note <span class="faint">(optional)</span></span><input type="text" id="ep-note" value="' + esc(d.note || '') + '"></label></div></div></section>' +
    '<section class="card"><div class="hd"><h2>Ordering</h2></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Supplier</span><select id="ep-supplierId"><option value="">—</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (v('supplierId') === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
    f('supplierSku', 'Supplier SKU') + f('moq', 'MOQ', 'number', '', sp && sp.moq != null ? sp.moq : '') + f('casePack', 'Case size', 'number') +
    f('prodLead', 'Production lead (days)', 'number', 'Blank uses the supplier\'s', sp ? sp.prodLead : '') + f('transit', 'Transit (days)', 'number', '', sp ? sp.shipLead : '') + '</div></div></section>' +
    '<div class="row"><button class="btn primary" data-act="ep-save|' + esc(p.sku) + '"' + (UI.epBusy ? ' disabled' : '') + '>' + (UI.epBusy ? 'Saving…' : 'Save changes') + '</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}
// Quick stock adjustment (Adjust stock button): now saved on the server and logged with a reason.
function adjustModal(p) {
  var many = UI.modal && UI.modal.pick;
  var products = WS.products.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  return '<div class="mh"><div><div class="eyebrow">Adjust stock</div><h2>' + (many ? 'Change on-hand stock' : esc(p.name)) + '</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (many ? '<label class="field"><span>Product</span>' + skuPicker({ id: 'adj-sku', f: 'adjsku||', value: p.sku, all: true }) + '</label>' : '') +
    '<p class="muted" style="margin:0">Currently ' + num(p.onHand) + ' on hand. Enter the new count, or a change like -2 or +5. It\'s logged in Stock history.</p><div class="fields">' +
    '<label class="field"><span>New on hand, or change</span><input type="text" inputmode="numeric" id="adj-count" value="' + String(Math.round(p.onHand)) + '"></label>' +
    '<label class="field"><span>Reason</span>' + reasonSelect('adj-reason', 'count') + '</label></div>' +
    '<label class="field"><span>Note</span><input type="text" id="adj-note" placeholder="Optional"></label><div class="row"><button class="btn primary" data-act="adjust-confirm">Save adjustment</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}

function downloadCSV(name, rows) {
  var csv = rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ===== Fields and actions ===== */
(function () {
  var base = onField;
  onField = function (e) {
    var el = e.target, f = el.dataset && el.dataset.f; if (!f) return base(e);
    if (e.type === 'input' && !el.dataset.live) return;
    var parts = f.split('|'), kind = parts[0], id = parts[1], key = parts[2], raw = el.type === 'checkbox' ? el.checked : el.value;
    if (kind === 'sp') { var sf = spForm(id); sf[key] = raw; if (key === 'deduct' || key === 'who' || key === 'q') render(); return; }
    if (kind === 'spl') { var k = key.split(':'), ln = spForm(id).lines[+k[0]]; if (ln) { ln[k[1]] = k[1] === 'qty' ? (+raw || 0) : raw; if (k[1] === 'sku') render(); else spTotals(id); } return; }
    if (kind === 'uf') { usageState()[key] = el.type === 'checkbox' ? el.checked : raw; render(); return; }
    if (kind === 'lf') { ledgerState()[key] = raw; render(); return; }
    if (kind === 'adjsku') { UI.modal.sku = raw; render(); return; }
    return base(e);
  };
})();

Object.assign(ACTIONS, {
  'order-open': function (id) { UI.modal = { type: 'order', id: id }; render(); },
  'order-product': function (sku) { UI.modal = null; go('product', sku); },
  'order-undo': function () { UI.modal.undo = true; render(); },
  'order-undo-no': function () { UI.modal.undo = false; render(); },
  'order-undo-yes': function (id) { UI.modal = null; ACTIONS['sale-undo-yes'](id); },
  'sp-line-add': function (id) { spForm(id).lines.push({ sku: '', qty: 1, price: '' }); render(); var i = document.getElementById('sp-sku-' + (spForm(id).lines.length - 1)); if (i) i.focus(); },
  'sp-line-del': function (arg) { var p = arg.split('|'); spForm(p[0]).lines.splice(+p[1], 1); render(); },
  'sp-range': function (arg) { var p = arg.split('|'); spForm(p[0]).range = p[1]; render(); },
  'sp-pricelist': async function (arg) {
    var p = arg.split('|');
    try { await API.req('PUT', '/api/stores/' + encodeURIComponent(p[0]) + '/price-list', { priceList: p[1] }); await loadStatus(); toast(p[1] === 'stylist' ? 'This store now uses stylist prices' : 'This store now uses retail prices'); render(); } catch (e) { toast(e.message); }
  },
  'sp-record': async function (id) {
    var f = spForm(id), s = storeById(id);
    ['date', 'customer', 'ref', 'note'].forEach(function (k) { var el = document.getElementById('sp-' + k); if (el) f[k] = el.value; });
    f.lines.forEach(function (l, i) { var q = document.getElementById('sp-qty-' + i), pr = document.getElementById('sp-price-' + i); if (q) l.qty = +q.value; if (pr) l.price = pr.value; });
    var lines = f.lines.filter(function (l) { return l.sku; });
    if (!lines.length) { toast('Choose at least one product.'); return; }
    if (lines.some(function (l) { return !(l.qty > 0); })) { toast('Enter a quantity for each item.'); return; }
    if (Store.mode !== 'db') { toast('The server isn\'t reachable, so purchases can\'t be saved.'); return; }
    UI.spBusy = true; render();
    try {
      await API.req('POST', '/api/sales', { storeId: id, date: f.date, ref: f.ref, customer: f.customer, note: f.note, deduct: f.deduct, lines: lines.map(function (l) { return { sku: l.sku, qty: l.qty, price: l.price === '' ? priceFor(s, prod(l.sku)) : +l.price }; }) });
      var units = lines.reduce(function (t, l) { return t + l.qty; }, 0);
      UI.sf[id] = Object.assign({}, f, { customer: '', ref: '', note: '', lines: [{ sku: '', qty: 1, price: '' }] });
      UI.spBusy = false; UI.sales = null; await loadWorkspace();
      toast('Logged ' + units + ' unit' + (units === 1 ? '' : 's') + (f.deduct ? ' and took them off stock' : ''));
    } catch (e) { UI.spBusy = false; render(); toast(e.message); }
  },
  'sp-import': async function (id) {
    var o = UI.ordImp || {}; if (!o.file) return;
    try {
      var r = await API.req('POST', '/api/import/orders', { storeId: id, rows: parseOrdersExport(o.file.rows), deduct: !!o.deduct });
      UI.ordImp = {}; UI.sales = null; await loadWorkspace();
      toast(num(r.orders) + ' orders imported' + (r.excluded ? ', ' + r.excluded + ' cancelled/refunded left out' : '') + (r.unknown.length ? '. ' + r.unknown.length + ' SKU(s) aren\'t in your products; see Settings → Sync log' : ''));
    } catch (e) { toast('Import failed: ' + e.message); }
  },
  'usage-sort': function (k) { usageState().sort = k; render(); },
  'usage-csv': function () {
    var U = UI.usage; if (!U || !U.rows) return;
    var per = {}; U.rows.forEach(function (r) { var o = per[r.sku] = per[r.sku] || {}; var k = r.ch + '|' + r.m; o[k] = (o[k] || 0) + r.u; });
    var chName = {}; U.channels.forEach(function (c) { chName[c.id] = c.name; });
    var out = [['SKU', 'Product', 'Channel'].concat(U.months)];
    Object.keys(per).sort().forEach(function (sku) { var p = prod(sku); U.channels.forEach(function (c) { var vals = U.months.map(function (m) { return per[sku][c.id + '|' + m] || 0; }); if (vals.some(function (x) { return x; })) out.push([sku, p ? p.name : sku, c.name].concat(vals)); }); });
    downloadCSV('monthly-usage-' + todayISO() + '.csv', out);
  },
  'ledger-clear': function () { UI.lf = null; render(); },
  'ledger-for': function (sku) { UI.lf = null; ledgerState().sku = sku; ledgerState().from = ''; go('ledger'); },
  'ledger-adjust': function () { var p = prod(ledgerState().sku) || WS.products[0]; if (!p) { toast('Add a product first.'); return; } UI.modal = { type: 'adjust', sku: p.sku, pick: true }; render(); },
  'ledger-csv': function () {
    var L = UI.ledger; if (!L || !L.rows) return;
    downloadCSV('stock-history-' + todayISO() + '.csv', [['Date', 'SKU', 'Product', 'Change', 'Qty', 'Before', 'After', 'Store', 'Reference', 'Note', 'By']].concat(L.rows.map(function (r) { return [r.date, r.sku, r.name, r.label, r.qty, r.before, r.after, r.store, r.ref, r.note, r.user]; })));
  },
  'prod-edit': function (sku) { UI.modal = { type: 'editprod', sku: sku }; render(); setTimeout(function () { var i = document.getElementById('ep-name'); if (i) i.focus(); }, 0); },
  'ep-save': async function (sku) {
    var d = {}; ['name', 'collection', 'variant', 'status', 'price', 'stylistPrice', 'cost', 'onHand', 'reason', 'note', 'supplierId', 'supplierSku', 'moq', 'casePack', 'prodLead', 'transit'].forEach(function (k) { var el = document.getElementById('ep-' + k); if (el) d[k] = el.value.trim(); });
    UI.modal.draft = d;
    if (Store.mode !== 'db') { UI.modal.error = 'The server isn\'t reachable, so changes can\'t be saved.'; render(); return; }
    UI.epBusy = true; render();
    try {
      var r = await API.req('POST', '/api/products/' + encodeURIComponent(sku) + '/edit', d);
      UI.epBusy = false; UI.modal = null; await loadWorkspace();
      toast('Saved' + (r.delta ? ' · stock ' + signed(r.delta) : ''));
    } catch (e) { UI.epBusy = false; UI.modal.error = e.message; render(); }
  },
  'adjust-confirm': async function () {
    var m = UI.modal, p = prod(m.sku), raw = String((document.getElementById('adj-count') || {}).value || '').trim();
    if (!p) return;
    var rel = /^[+-]/.test(raw), v = parseFloat(raw.replace(/[−–]/, '-'));
    if (raw === '' || isNaN(v)) { toast('Enter a number.'); return; }
    if (!rel && v < 0) { toast('Enter a count of 0 or more.'); return; }
    var item = { sku: p.sku, mode: rel ? 'delta' : 'set', qty: v, reason: document.getElementById('adj-reason').value, note: document.getElementById('adj-note').value };
    if (Store.mode !== 'db') { var d = rel ? v : v - p.onHand; p.onHand = Math.max(0, p.onHand + d); UI.modal = null; changed(); return; }
    try { var r = await API.req('POST', '/api/stock-adjust', { items: [item] }); UI.modal = null; await loadWorkspace(); toast(r.changed ? 'Stock updated' : 'No change'); }
    catch (e) { toast(e.message); }
  }
});
