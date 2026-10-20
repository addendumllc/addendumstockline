/* ---------- Purchase orders ---------- */
function poTotals(x) { var u = 0, c = 0; x.lines.forEach(function (l) { u += +l.qty || 0; c += (+l.qty || 0) * (+l.cost || 0); }); return { units: u, cost: c }; }
function pagePOs() {
  var f = UI.poFilter;
  var list = WS.pos.filter(function (x) { return f === 'all' ? true : f === 'open' ? (E.OPEN[x.status] || x.status === 'draft') : f === 'closed' ? (x.status === 'received' || x.status === 'cancelled') : x.status === f; });
  var openVal = 0; WS.pos.forEach(function (x) { if (E.OPEN[x.status]) openVal += poTotals(x).cost; });
  return '<div class="ph"><div><h1>Purchase orders</h1><div class="sub">' + WS.pos.filter(function (x) { return E.OPEN[x.status]; }).length + ' open · ' + money(openVal) + ' on order</div></div><div class="actions"><button class="btn primary" data-act="po-new"' + (Store.canWrite ? '' : ' disabled') + '>New purchase order</button></div></div>' +
    '<div class="seg" role="group" aria-label="Filter purchase orders">' + [['open', 'Open & drafts'], ['draft', 'Drafts'], ['shipped', 'Shipped'], ['closed', 'Closed'], ['all', 'All']].map(function (o) { return '<button aria-pressed="' + (f === o[0]) + '" data-act="po-filter|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' +
    '<section class="card"><div class="bd flush tw"><table class="t"><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Created</th><th class="r">Lines</th><th class="r">Units</th><th class="r">Total</th><th>Expected ship</th><th>Expected delivery</th></tr></thead><tbody>' +
    (list.length ? list.map(function (x) {
      var t = poTotals(x), late = E.OPEN[x.status] && x.expectedDelivery && x.expectedDelivery < WS.meta.asOf;
      return '<tr class="click" data-act="po-open|' + x.id + '"><td><b>' + x.id + '</b></td><td>' + esc(supName(x.supplierId)) + '</td><td>' + poPill(x.status) + '</td><td>' + dNice(x.created, true) + '</td><td class="r">' + x.lines.length + '</td><td class="r">' + num(t.units) + '</td><td class="r">' + money(t.cost) + '</td><td>' + dNice(x.expectedShip) + '</td><td>' + (late ? '<b style="color:var(--now)">' + dNice(x.expectedDelivery) + ' · overdue</b>' : x.status === 'received' ? 'Received ' + dNice(x.receivedDate) : dNice(x.expectedDelivery)) + '</td></tr>';
    }).join('') : '<tr><td colspan="9"><div class="empty"><b>No purchase orders here</b>Create one from Order Recommendations.</div></td></tr>') + '</tbody></table></div></section>';
}
function nextPoId() { var m = 1000; WS.pos.forEach(function (x) { var n = parseInt(String(x.id).replace(/\D/g, ''), 10); if (n > m) m = n; }); return 'PO-' + (m + 1); }
function createPOs(items) {
  var by = {}, made = [];
  items.forEach(function (it) { var p = prod(it.sku); if (!p || !(+it.qty > 0)) return; (by[p.supplierId || ''] = by[p.supplierId || ''] || []).push({ p: p, qty: +it.qty }); });
  Object.keys(by).forEach(function (sid) {
    var id = nextPoId();
    var x = { id: id, supplierId: sid, created: todayISO(), submitted: null, status: 'draft', statedLead: null, expectedShip: null, expectedDelivery: null, receivedDate: null, notes: '',
      lines: by[sid].map(function (r) { return { sku: r.p.sku, name: r.p.name, qty: r.qty, cost: +r.p.cost || 0, received: 0, damaged: 0 }; }) };
    planDates(x, todayISO());
    WS.pos.unshift(x); savePO(x); made.push(x);
  });
  return made;
}
function planDates(x, from) {
  var prodL = 0, trans = 0, c = ctx();
  x.lines.forEach(function (l) { var a = A[l.sku]; if (a) { prodL = Math.max(prodL, a.prodLead); trans = Math.max(trans, a.transit); } });
  if (!prodL) { var sp = sup(x.supplierId); prodL = sp ? +sp.prodLead : c.settings.defaultProdLead; trans = sp ? +sp.shipLead : c.settings.defaultTransit; }
  x.statedLead = prodL + trans; x.expectedShip = E.addDays(from, prodL); x.expectedDelivery = E.addDays(from, prodL + trans);
}
function poModal(x) {
  var t = poTotals(x), editable = Store.canWrite && (x.status === 'draft' || x.status === 'submitted' || x.status === 'in_production'), dis = Store.canWrite ? '' : ' disabled';
  var rec = UI.modal.receive;
  var next = { draft: ['submitted', 'Submit to supplier'], submitted: ['in_production', 'Mark in production'], in_production: ['shipped', 'Mark shipped'] }[x.status];
  var canReceive = x.status === 'shipped' || x.status === 'partially_received' || x.status === 'in_production' || x.status === 'submitted';
  var others = WS.products.filter(function (p) { return !x.lines.some(function (l) { return l.sku === p.sku; }) && (!x.supplierId || p.supplierId === x.supplierId); });
  return '<div class="mh"><div><div class="eyebrow">Purchase order</div><h2>' + x.id + ' · ' + esc(supName(x.supplierId)) + '</h2><div class="row" style="margin-top:6px">' + poPill(x.status) + '<span class="small muted">Created ' + dNice(x.created, true) + (x.submitted ? ' · submitted ' + dNice(x.submitted, true) : '') + '</span></div></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div>' +
    '<div class="mb">' +
    (rec ? '' : '<div class="row">' + (next ? '<button class="btn primary" data-act="po-status|' + next[0] + '"' + dis + '>' + next[1] + '</button>' : '') + (canReceive ? '<button class="btn ' + (next ? '' : 'primary') + '" data-act="po-receive"' + dis + '>Receive inventory</button>' : '') + (x.status !== 'received' && x.status !== 'cancelled' ? '<button class="btn ghost danger" data-act="po-cancel"' + dis + '>Cancel PO</button>' : '') + (x.status === 'draft' || x.status === 'cancelled' ? '<button class="btn ghost danger" data-act="po-delete"' + dis + '>Delete</button>' : '') + '</div>') +
    (UI.modal.confirm ? '<div class="note bad row" style="justify-content:space-between"><span>' + esc(UI.modal.confirm.text) + '</span><span class="row"><button class="btn sm" data-act="confirm-no">Keep</button><button class="btn sm primary" data-act="confirm-yes">' + esc(UI.modal.confirm.yes) + '</button></span></div>' : '') +
    (rec ? '<section class="card"><div class="hd"><h2>Receive inventory</h2></div><div class="bd"><label class="field" style="max-width:200px"><span>Date received</span><input type="date" id="rc-date" value="' + todayISO() + '"></label><div class="tw" style="margin-top:12px"><table class="t"><thead><tr><th>Product</th><th class="r">Ordered</th><th class="r">Already in</th><th class="r">Received now</th><th class="r">Damaged / missing</th></tr></thead><tbody>' +
      x.lines.map(function (l, i) { var rem = Math.max(0, l.qty - (l.received || 0) - (l.damaged || 0)); return '<tr><td><div class="pname"><b>' + esc(l.name) + '</b><span>' + esc(l.sku) + '</span></div></td><td class="r">' + num(l.qty) + '</td><td class="r">' + num(l.received || 0) + '</td><td class="r"><input type="number" min="0" class="qty" id="rc-q-' + i + '" value="' + rem + '"></td><td class="r"><input type="number" min="0" class="qty" id="rc-d-' + i + '" value="0"></td></tr>'; }).join('') +
      '</tbody></table></div><p class="small muted">Good units are added to on-hand inventory and logged. Damaged or missing units close out that part of the line.</p><div class="row"><button class="btn primary" data-act="po-receive-confirm">Confirm receipt</button><button class="btn ghost" data-act="po-receive-cancel">Back</button></div></div></section>' : '') +
    '<section class="card"><div class="hd"><h2>Lines</h2><span class="small muted">' + num(t.units) + ' units · ' + money(t.cost, 2) + '</span></div><div class="bd flush tw"><table class="t"><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Total</th><th class="r">Received</th><th class="r">Lead</th><th></th></tr></thead><tbody>' +
    x.lines.map(function (l, i) {
      var a = A[l.sku];
      return '<tr><td><div class="pname"><b>' + esc(l.name) + '</b><span>' + esc(l.sku) + (a && a.moq && l.qty < a.moq ? ' · <span style="color:var(--soon)">below MOQ ' + a.moq + '</span>' : '') + (a && a.pack > 1 && l.qty % a.pack ? ' · <span style="color:var(--soon)">not a full case of ' + a.pack + '</span>' : '') + '</span></div></td>' +
        '<td class="r">' + (editable ? '<input type="number" min="0" class="qty" data-f="pol|' + x.id + '|' + i + ':qty" value="' + l.qty + '" aria-label="Quantity">' : num(l.qty)) + '</td>' +
        '<td class="r">' + (editable ? '<input type="number" min="0" step="0.01" style="width:90px" data-f="pol|' + x.id + '|' + i + ':cost" value="' + l.cost + '" aria-label="Unit cost">' : money(l.cost, 2)) + '</td>' +
        '<td class="r">' + money(l.qty * l.cost, 2) + '</td><td class="r">' + num(l.received || 0) + (l.damaged ? '<div class="small" style="color:var(--now)">' + l.damaged + ' damaged</div>' : '') + '</td><td class="r">' + (a ? a.prodLead + '+' + a.transit + 'd' : '—') + '</td><td>' + (x.status === 'draft' && Store.canWrite ? '<button class="btn ghost sm" data-act="pol-del|' + i + '" aria-label="Remove line">✕</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    (x.status === 'draft' && Store.canWrite && others.length ? '<div class="bd row">' + skuPicker({ id: 'po-add-sku', value: '', only: others.map(function (p) { return p.sku; }), placeholder: 'Add a product: search SKU, color or collection', style: 'flex:1;min-width:220px' }) + '<button class="btn sm" data-act="pol-add">Add line</button></div>' : '') + '</section>' +
    '<section class="card"><div class="hd"><h2>Details</h2></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Supplier</span><select data-f="po|' + x.id + '|supplierId"' + (x.status === 'draft' && Store.canWrite ? '' : ' disabled') + '><option value="">—</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (x.supplierId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
    '<label class="field"><span>Production lead</span><input type="text" disabled value="' + (x.statedLead ? x.statedLead + ' days total' : '—') + '"></label>' +
    '<label class="field"><span>Expected ship date</span><input type="date" data-f="po|' + x.id + '|expectedShip" value="' + esc(x.expectedShip || '') + '"' + dis + '></label>' +
    '<label class="field"><span>Expected delivery</span><input type="date" data-f="po|' + x.id + '|expectedDelivery" value="' + esc(x.expectedDelivery || '') + '"' + dis + '><small>Drives incoming stock in every forecast</small></label>' +
    '</div><label class="field" style="margin-top:12px"><span>Notes</span><textarea rows="2" data-f="po|' + x.id + '|notes"' + dis + '>' + esc(x.notes || '') + '</textarea></label></div></section>' +
    (x.status === 'draft' ? '<p class="note">Drafts are not counted as incoming stock until submitted' + (settings().countDrafts ? ' (your settings count drafts too)' : '') + '.</p>' : '') +
    '</div>';
}

/* ---------- Suppliers ---------- */
function pageSuppliers() {
  return '<div class="ph"><div><h1>Suppliers</h1><div class="sub">Lead-time accuracy is measured from submitted to received on every completed PO.</div></div><div class="actions"><button class="btn primary" data-act="sup-new"' + (Store.canWrite ? '' : ' disabled') + '>Add supplier</button></div></div>' +
    '<div class="sup-grid">' + WS.suppliers.map(function (s) {
      var pf = E.supplierPerf(s, WS.pos), items = WS.products.filter(function (p) { return p.supplierId === s.id; });
      var open = WS.pos.filter(function (x) { return x.supplierId === s.id && E.OPEN[x.status]; }).length;
      var sc = pf.score, scCol = sc == null ? '--ink-3' : sc >= 85 ? '--ok' : sc >= 65 ? '--watch' : '--now';
      return '<section class="card" style="display:flex;flex-direction:column"><div class="hd"><div><h2>' + esc(s.name) + '</h2><div class="small muted">' + esc(s.country || '') + (s.contact ? ' · ' + esc(s.contact) : '') + '</div></div><div style="text-align:right"><div class="score" style="color:var(' + scCol + ')">' + (sc == null ? '—' : sc) + '</div><div class="small faint">reliability</div></div></div>' +
        '<div class="bd" style="display:flex;flex-direction:column;gap:12px;flex:1">' +
        (pf.flag ? '<div class="note warn">⚠ Typically takes ' + Math.round(pf.avgActual) + ' days, but lead time is set to ' + pf.stated + ' days.</div>' : '') +
        '<div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="stat"><span>Set lead</span><b>' + pf.stated + 'd</b><em>' + s.prodLead + ' + ' + s.shipLead + ' ship</em></div><div class="stat"><span>Actual avg</span><b>' + (pf.avgActual == null ? '—' : Math.round(pf.avgActual) + 'd') + '</b><em>' + pf.n + ' PO' + (pf.n === 1 ? '' : 's') + '</em></div><div class="stat"><span>On time · fill</span><b>' + (pf.onTime == null ? '—' : pct(pf.onTime)) + '</b><em>' + (pf.fill == null ? '' : pct(pf.fill) + ' filled') + '</em></div></div>' +
        '<div class="small muted">' + items.length + ' products · MOQ ' + (s.moq || '—') + ' · ' + open + ' open PO' + (open === 1 ? '' : 's') + '</div>' +
        '<div class="row" style="margin-top:auto"><button class="btn sm" data-act="sup-open|' + s.id + '">Open</button>' + (pf.flag && Store.canWrite ? '<button class="btn sm primary" data-act="sup-apply|' + s.id + '">Use actual ' + Math.round(pf.avgActual) + '-day lead</button>' : '') + '</div></div></section>';
    }).join('') + '</div>';
}
function supModal(s, isNew) {
  var pf = E.supplierPerf(s, WS.pos), dis = Store.canWrite ? '' : ' disabled';
  var hist = WS.pos.filter(function (x) { return x.supplierId === s.id; });
  var items = WS.products.filter(function (p) { return p.supplierId === s.id; });
  function f(k, label, type) { return '<label class="field"><span>' + label + '</span><input type="' + (type || 'text') + '" id="sf-' + k + '" value="' + esc(s[k] == null ? '' : s[k]) + '"' + dis + '></label>'; }
  return '<div class="mh"><div><div class="eyebrow">Supplier</div><h2>' + (isNew ? 'New supplier' : esc(s.name)) + '</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (pf.flag ? '<div class="note warn row" style="justify-content:space-between"><span>⚠ Supplier typically takes ' + Math.round(pf.avgActual) + ' days, but your lead time is set to ' + pf.stated + ' days.</span>' + (Store.canWrite ? '<button class="btn sm primary" data-act="sup-apply|' + s.id + '">Use ' + Math.round(pf.avgActual) + ' days</button>' : '') + '</div>' : '') +
    '<section class="card"><div class="hd"><h2>Details</h2></div><div class="bd"><div class="fields">' + f('name', 'Supplier name') + f('contact', 'Contact') + f('email', 'Email', 'email') + f('phone', 'Phone') + f('country', 'Country') + f('terms', 'Payment terms') + f('prodLead', 'Production lead (days)', 'number') + f('shipLead', 'Shipping lead (days)', 'number') + f('moq', 'Default MOQ', 'number') + '</div>' +
    '<label class="field" style="margin-top:12px"><span>Notes</span><textarea rows="2" id="sf-notes"' + dis + '>' + esc(s.notes || '') + '</textarea></label><div class="row" style="margin-top:12px"><button class="btn primary" data-act="sup-save|' + (isNew ? '' : s.id) + '"' + dis + '>Save supplier</button>' + (!isNew && !items.length ? '<button class="btn ghost danger" data-act="sup-del|' + s.id + '"' + dis + '>Delete</button>' : '') + '</div></div></section>' +
    (isNew ? '' : '<section class="card"><div class="hd"><h2>Performance</h2></div><div class="bd"><div class="stats"><div class="stat"><span>Average fulfillment</span><b>' + (pf.avgActual == null ? '—' : Math.round(pf.avgActual) + ' days') + '</b><em>submitted → received</em></div><div class="stat"><span>Stated lead</span><b>' + pf.stated + ' days</b></div><div class="stat"><span>Average delay</span><b>' + (pf.n ? (pf.delay > 0 ? '+' : '') + Math.round(pf.delay) + ' days' : '—') + '</b></div><div class="stat"><span>On-time rate</span><b>' + (pf.onTime == null ? '—' : pct(pf.onTime)) + '</b><em>within 2 days</em></div><div class="stat"><span>Fill rate</span><b>' + (pf.fill == null ? '—' : pct(pf.fill)) + '</b></div><div class="stat"><span>Reliability score</span><b>' + (pf.score == null ? '—' : pf.score + '/100') + '</b></div></div></div></section>' +
      '<section class="card"><div class="hd"><h2>Products supplied</h2><span class="small muted">' + items.length + '</span></div><div class="bd flush tw"><table class="t"><tbody>' + items.map(function (p) { var a = A[p.sku]; return '<tr class="click" data-act="open-product|' + esc(p.sku) + '"><td><b>' + esc(p.name) + '</b><div class="small faint">' + esc(p.supplierSku || p.sku) + '</div></td><td>' + (a ? pill(a.status) : '') + '</td><td class="r">' + (a ? a.L + 'd lead' : '') + '</td><td class="r">MOQ ' + (p.moq || s.moq || '—') + '</td></tr>'; }).join('') + '</tbody></table></div></section>' +
      '<section class="card"><div class="hd"><h2>Order history</h2></div><div class="bd flush tw"><table class="t"><thead><tr><th>PO</th><th>Status</th><th>Submitted</th><th>Received</th><th class="r">Took</th><th class="r">Set</th></tr></thead><tbody>' + (hist.length ? hist.map(function (x) { var took = x.submitted && x.receivedDate ? E.diff(x.submitted, x.receivedDate) : null; return '<tr class="click" data-act="po-open|' + x.id + '"><td><b>' + x.id + '</b></td><td>' + poPill(x.status) + '</td><td>' + dNice(x.submitted, true) + '</td><td>' + dNice(x.receivedDate, true) + '</td><td class="r">' + (took == null ? '—' : '<b style="color:var(' + (took > (x.statedLead || 0) + 2 ? '--now' : '--ok') + ')">' + took + 'd</b>') + '</td><td class="r">' + (x.statedLead ? x.statedLead + 'd' : '—') + '</td></tr>'; }).join('') : '<tr><td colspan="6"><div class="empty">No orders yet.</div></td></tr>') + '</tbody></table></div></section>') +
    '</div>';
}

/* ---------- Sales analytics ---------- */
function pageAnalytics() {
  var f = UI.an, asOf = WS.meta.asOf, q = (f.q || '').toLowerCase();
  var prods = WS.products.filter(function (p) { return (!f.col || p.collection === f.col) && (!q || (p.name + ' ' + p.sku + ' ' + (p.variant || '')).toLowerCase().indexOf(q) >= 0); });
  var N = 456, rng;
  if (f.range === 'custom' && f.from && f.to) rng = [Math.max(1, E.diff(f.to, asOf)), Math.min(N, E.diff(f.from, asOf))]; // k from..to (days ago)
  else rng = [1, +f.range || 90];
  var days = rng[1] - rng[0] + 1;
  var agg = [], rev = [];
  for (var k = 0; k < N; k++) { agg.push(0); rev.push(0); }
  var rows = prods.map(function (p) {
    var h = E.history(p, asOf, N), u = 0, r = 0, pu = 0, inst = 0;
    var sd = p.salonDays || {}, su = 0;
    h.forEach(function (x) { var sq = sd[x.date] || 0; agg[N - x.k] += x.u; rev[N - x.k] += (x.u - sq) * (+p.price || 0); if (x.k >= rng[0] && x.k <= rng[1]) { u += x.u; su += sq; if (!x.oos && !x.missing) inst++; } if (x.k > rng[1] && x.k <= rng[1] + days) pu += x.u; });
    r = (u - su) * (+p.price || 0);
    return { p: p, a: A[p.sku], u: u, r: r, prev: pu, vel: inst ? u / inst : 0, g: pu ? u / pu - 1 : null };
  });
  var U = 0, R = 0, PU = 0; rows.forEach(function (x) { U += x.u; R += x.r; PU += x.prev; });
  // weekly series in range
  var wl = [], wu = [], wr = [], start = N - rng[1], end = N - rng[0];
  var bucket = days > 120 ? 7 : days > 45 ? 7 : 1;
  for (var i = start; i <= end; i += bucket) { var su = 0, sr = 0; for (var j = i; j < Math.min(end + 1, i + bucket); j++) { su += agg[j]; sr += rev[j]; } wl.push(dNice(E.addDays(asOf, -(N - i)))); wu.push(su); wr.push(sr); }
  // monthly (calendar) for last 15 months
  var months = {}; for (var m = 0; m < N; m++) { var d = E.addDays(asOf, -(N - m)); var key = d.slice(0, 7); months[key] = months[key] || { u: 0, r: 0, n: 0 }; months[key].u += agg[m]; months[key].r += rev[m]; months[key].n++; }
  var mk = Object.keys(months).sort().filter(function (k2) { return months[k2].n >= 28 || k2 === asOf.slice(0, 7); });
  var cur = asOf.slice(0, 7), full = mk.filter(function (k2) { return k2 !== cur && months[k2].n >= 28; });
  var last = full[full.length - 1], prev = full[full.length - 2];
  var ly = last ? (+last.slice(0, 4) - 1) + last.slice(4) : null;
  var mom = last && prev && months[prev].u ? months[last].u / months[prev].u - 1 : null;
  var yoy = last && ly && months[ly] && months[ly].n >= 28 && months[ly].u ? months[last].u / months[ly].u - 1 : null;
  var last12 = full.slice(-12);
  var mlabels = last12.map(function (k2) { return E.MON[+k2.slice(5) - 1] + ' ' + k2.slice(2, 4); });
  var mvals = last12.map(function (k2) { return months[k2].u; });
  var mprev = last12.map(function (k2) { var p2 = (+k2.slice(0, 4) - 1) + k2.slice(4); return months[p2] && months[p2].n >= 28 ? months[p2].u : null; });
  var avgM = mvals.reduce(function (s2, v) { return s2 + v; }, 0) / Math.max(1, mvals.length);
  var cols = {}; rows.forEach(function (x) { var c = x.p.collection || 'Other'; cols[c] = cols[c] || { u: 0, r: 0 }; cols[c].u += x.u; cols[c].r += x.r; });
  var ck = Object.keys(cols).sort(function (a, b) { return cols[b].r - cols[a].r; });
  var sorted = rows.slice().sort(function (a, b) { return (f.rank === 'revenue' ? b.r - a.r : f.rank === 'growth' ? (b.g == null ? -9 : b.g) - (a.g == null ? -9 : a.g) : b.u - a.u); });
  var slow = rows.filter(function (x) { return !(x.a && x.a.isLaunch && x.a.ageDays < days); }).sort(function (a, b) { return a.vel - b.vel; }).slice(0, 5);
  var rlabel = f.range === 'custom' ? dNice(E.addDays(asOf, -rng[1])) + ' – ' + dNice(E.addDays(asOf, -rng[0])) : 'Last ' + (f.range === '365' ? '12 months' : f.range + ' days');
  return '<div class="ph"><div><h1>Sales analytics</h1><div class="sub">' + esc(rlabel) + ' · ' + prods.length + ' products · net of refunds and cancellations' + ((WS.salon || []).length ? '; units include salon use, revenue does not' : '') + '</div></div></div>' +
    '<div class="filters"><div class="seg" role="group" aria-label="Date range">' + [['30', '30d'], ['90', '90d'], ['180', '6m'], ['365', '12m'], ['custom', 'Custom']].map(function (o) { return '<button aria-pressed="' + (f.range === o[0]) + '" data-act="an-range|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' +
    (f.range === 'custom' ? '<input type="date" data-f="ui|an|from" value="' + esc(f.from) + '" aria-label="From"><input type="date" data-f="ui|an|to" value="' + esc(f.to) + '" aria-label="To">' : '') +
    '<select data-f="ui|an|col" aria-label="Collection"><option value="">All collections</option>' + collections().map(function (c) { return '<option' + (f.col === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
    '<input type="search" id="an-q" placeholder="Product, SKU or variant" data-f="ui|an|q" data-live="1" value="' + esc(f.q) + '" aria-label="Filter by product, SKU or variant"></div>' +
    '<section class="kpis">' + kpi('Units sold', num(U), PU ? pct(U / PU - 1, true) + ' vs previous ' + days + ' days' : '') + kpi('Revenue', money(R), 'at current retail price') + kpi('Units per day', rate(U / days), 'calendar average') + kpi('Avg. price per unit', money(U ? R / U : 0), 'revenue ÷ units') +
    kpi('Month over month', pct(mom, true), last && prev ? E.MON[+last.slice(5) - 1] + ' vs ' + E.MON[+prev.slice(5) - 1] : 'needs 2 full months', mom != null && mom < 0 ? 'warn' : '') +
    kpi('Year over year', pct(yoy, true), yoy != null ? E.MON[+last.slice(5) - 1] + ' ' + last.slice(0, 4) + ' vs ' + ly.slice(0, 4) : 'needs 13 months of history', yoy != null && yoy < 0 ? 'warn' : '') +
    kpi('Best seller', sorted[0] ? esc(sorted[0].p.name) : '—', sorted[0] ? num(sorted[0].u) + ' units' : '') + kpi('Top collection', ck[0] ? esc(ck[0]) : '—', ck[0] ? money(cols[ck[0]].r) : '') + '</section>' +
    '<section class="card"><div class="hd"><h2>Sales trend</h2><div class="legend"><span><i style="background:var(--chart-1)"></i>Units ' + (bucket === 7 ? 'per week' : 'per day') + '</span></div></div><div class="bd">' + chart({ labels: wl, series: [{ values: wu, color: '--chart-1', area: true }], h: 230, label: 'Units sold over time', tip: function (i) { return (bucket === 7 ? 'Week of ' : '') + wl[i] + ': <b>' + num(wu[i]) + '</b> units · ' + money(wr[i]); } }) + '</div></section>' +
    '<div class="grid2e"><section class="card"><div class="hd"><h2>Monthly units</h2><div class="legend"><span><i style="background:var(--chart-1)"></i>This year</span><span><i style="background:var(--chart-3)"></i>Same month last year</span></div></div><div class="bd">' + chart({ type: 'bar', labels: mlabels, series: [{ values: mprev, color: '--chart-3', op: .8 }, { values: mvals, color: '--chart-1' }], h: 220, label: 'Monthly units', tip: function (i) { return mlabels[i] + ': <b>' + num(mvals[i]) + '</b>' + (mprev[i] != null ? ' · last year ' + num(mprev[i]) : ''); } }) + '</div></section>' +
    '<section class="card"><div class="hd"><h2>Seasonal pattern</h2><span class="small muted">month vs 12-month average</span></div><div class="bd">' + chart({ type: 'bar', labels: mlabels, series: [{ values: mvals.map(function (v) { return avgM ? v / avgM * 100 : 0; }), color: '--chart-2' }], hlines: [{ v: 100, color: '--ink-3' }], yfmt: function (v) { return Math.round(v) + '%'; }, h: 220, label: 'Seasonality index', tip: function (i) { return mlabels[i] + ': <b>' + Math.round(avgM ? mvals[i] / avgM * 100 : 0) + '%</b> of average month'; } }) + '</div></section></div>' +
    '<div class="grid2"><section class="card"><div class="hd"><h2>Products ranked</h2><div class="seg" role="group" aria-label="Rank by">' + [['units', 'Units'], ['revenue', 'Revenue'], ['growth', 'Growth']].map(function (o) { return '<button aria-pressed="' + (f.rank === o[0]) + '" data-act="an-rank|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div><div class="bd flush tw"><table class="t"><thead><tr><th>#</th><th>Product</th><th class="r">Units</th><th class="r">Revenue</th><th class="r">Share</th><th class="r">Units/day</th><th class="r">vs prior</th><th>Trend</th></tr></thead><tbody>' +
    sorted.map(function (x, i) { return '<tr class="click" data-act="open-product|' + esc(x.p.sku) + '"><td class="faint">' + (i + 1) + '</td><td><div class="pname"><b>' + esc(x.p.name) + '</b><span>' + esc(x.p.variant || x.p.sku) + '</span></div></td><td class="r"><b>' + num(x.u) + '</b></td><td class="r">' + money(x.r) + '</td><td class="r">' + (R ? Math.round(x.r / R * 100) : 0) + '%</td><td class="r">' + rate(x.vel) + '</td><td class="r" style="color:var(' + (x.g == null ? '--ink-3' : x.g >= 0 ? '--ok' : '--soon') + ')">' + (x.g == null ? '—' : pct(x.g, true)) + '</td><td>' + (x.a ? trendTag(x.a) : '') + '</td></tr>'; }).join('') + '</tbody></table></div></section>' +
    '<div class="stack">' + storeSalesCard(rng) + '<section class="card"><div class="hd"><h2>Revenue by collection</h2></div><div class="bd">' + ck.map(function (c) { var w = R ? cols[c].r / R * 100 : 0; return '<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><b>' + esc(c) + '</b><span class="small">' + money(cols[c].r) + ' · ' + num(cols[c].u) + ' units</span></div><div class="meter" style="margin-top:6px"><span style="width:' + w + '%;background:var(--chart-1)"></span></div></div>'; }).join('') + '</div></section>' +
    '<section class="card"><div class="hd"><h2>Slowest sellers</h2><span class="small muted">units/day in stock</span></div><div class="bd flush"><table class="t"><tbody>' + slow.map(function (x) { return '<tr class="click" data-act="open-product|' + esc(x.p.sku) + '"><td><b>' + esc(x.p.name) + '</b></td><td class="r">' + rate(x.vel) + '/day</td><td class="r faint">' + (x.a && x.a.daysCover !== Infinity ? num(x.a.daysCover) + 'd cover' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></section></div></div>';
}

/* ---------- Forecast & what-if ---------- */
function pageForecast() {
  var tab = UI.fc.tab;
  return '<div class="ph"><div><h1>Forecast</h1><div class="sub">Projected stock, day by day, from today\'s inventory, forecast sales and every open purchase order.</div></div></div>' +
    '<div class="tabs" role="tablist"><button role="tab" aria-selected="' + (tab === 'timeline') + '" data-act="fc-tab|timeline">Timeline</button><button role="tab" aria-selected="' + (tab === 'runway') + '" data-act="fc-tab|runway">All products</button><button role="tab" aria-selected="' + (tab === 'whatif') + '" data-act="fc-tab|whatif">What-if planning</button></div>' +
    (tab === 'runway' ? fcRunway() : tab === 'whatif' ? fcWhatIf() : fcTimeline());
}
function productSelect(id, val, f) {
  return '<select id="' + id + '" data-f="' + f + '" aria-label="Product">' + AL.filter(function (a) { return a.status !== 'disc' || a.sku === val; }).map(function (a) { return '<option value="' + esc(a.sku) + '"' + (a.sku === val ? ' selected' : '') + '>' + esc(a.p.name) + ' · ' + STATUS[a.status].label + '</option>'; }).join('') + '</select>';
}
function fcTimeline() {
  var first = AL.filter(function (x) { return x.status !== 'disc'; })[0] || AL[0]; var sku = UI.fc.sku || (first && first.sku); var a = A[sku]; if (!a) return '<div class="empty">No products.</div>';
  var asOf = WS.meta.asOf, H = Math.min(a.proj.length - 1, Math.max(120, a.arriveT + 30));
  var labels = [], base = [], withOrder = [];
  var nextArr = a.incomingLines.length ? a.incomingLines.slice().sort(function (x, y) { return x.due < y.due ? -1 : 1; })[0] : null;
  for (var t = 0; t <= H; t++) { labels.push(dNice(E.addDays(asOf, t))); base.push(Math.round(a.proj[t] * 10) / 10); }
  var showOrder = a.qty > 0 && a.status !== 'disc' && a.status !== 'untracked';
  if (showOrder) { var inv2 = a.available; for (t = 0; t <= H; t++) { if (t > 0) inv2 = Math.max(0, inv2 - a.rate(t)) + (a.arrivals[t] || 0) + (t === a.arriveT ? a.qty : 0); withOrder.push(t >= a.arriveT ? Math.round(inv2 * 10) / 10 : null); } }
  var ropT = null; for (t = 0; t <= H; t++) if (a.proj[t] <= a.ROP) { ropT = t; break; }
  var vlines = [{ i: 0, label: 'Today', color: '--ink-3' }];
  if (a.orderT != null && a.orderT >= 0 && a.orderT <= H) vlines.push({ i: a.orderT, label: 'Order by', color: '--accent', row: 1 });
  if (a.stockT != null && a.stockT <= H) vlines.push({ i: a.stockT, label: 'Stockout', color: '--now', row: 2 });
  if (showOrder && a.arriveT <= H) vlines.push({ i: a.arriveT, label: 'New order lands', color: '--ok', dash: 1, row: 3 });
  a.incomingLines.forEach(function (l) { var d = E.diff(asOf, l.due); if (d >= 0 && d <= H) vlines.push({ i: d, label: l.po, color: '--chart-2', dash: 1, row: 4 }); });
  var verdict, vc;
  if (a.status === 'untracked') { verdict = 'Not tracked in inventory, so there is no stock forecast. Change its status on the Products page to track it.'; vc = 'warn'; }
  else if (a.status === 'disc') { verdict = 'Discontinued. No more orders planned.'; vc = 'warn'; }
  else if (a.orderT == null) { verdict = 'You are ordering early enough. Stock and open orders cover demand for the whole forecast window.'; vc = 'good'; }
  else if (a.atRisk) { verdict = 'Too late to avoid a gap. Stock runs out ' + dNice(a.stockDate) + '; the earliest a new order could land is ' + dNice(E.addDays(asOf, a.L)) + ' (' + a.lateGap + ' days out of stock).'; vc = 'bad'; }
  else if (a.orderT <= 0) { verdict = 'Order today. Placed now, stock lands ' + dNice(a.arriveDate) + (a.stockT != null ? ', ' + (a.stockT - a.arriveT) + ' days before the projected stockout.' : '.'); vc = 'bad'; }
  else { verdict = 'On track if you order by ' + dNice(a.orderDate) + '. Stock would land ' + dNice(a.arriveDate) + (a.stockT != null ? ', ' + (a.stockT - a.arriveT) + ' days before the projected stockout.' : '.'); vc = a.orderT <= settings().soonDays ? 'warn' : 'good'; }
  return '<div class="row" style="justify-content:space-between"><div class="row">' + productSelect('fc-sku', sku, 'ui|fc|sku') + pill(a.status) + trendTag(a) + '</div><button class="btn sm" data-act="open-product|' + esc(sku) + '">Product details</button></div>' +
    '<section class="card"><div class="bd" style="display:flex;flex-direction:column;gap:18px">' +
    '<div class="tl">' +
    '<div class="acc"><div class="tk">' + dNice(asOf) + ' · now</div><div class="tv">' + num(a.available) + ' available</div><div class="td">' + num(a.onHand) + ' on hand' + (a.incoming ? ', ' + num(a.incoming) + ' incoming' : '') + '</div></div>' +
    '<div><div class="tk">Expected sales</div><div class="tv">' + rate(a.base) + ' / day</div><div class="td">' + num(a.DL) + ' units over the ' + a.L + '-day lead time</div></div>' +
    '<div class="' + (a.orderT != null && a.orderT <= 0 ? 'hot' : '') + '"><div class="tk">Reorder point · ' + num(a.ROP) + '</div><div class="tv">' + (a.orderT == null ? 'Not reached' : a.orderT <= 0 ? 'Order today' : 'Order by ' + dNice(a.orderDate)) + '</div><div class="td">' + (ropT != null ? 'Stock reaches reorder point ' + (ropT === 0 ? 'now' : dNice(E.addDays(asOf, ropT))) : 'Safety stock ' + num(a.SS)) + '</div></div>' +
    '<div class="' + (a.stockT != null ? 'hot' : 'good') + '"><div class="tk">Projected stockout</div><div class="tv">' + (a.stockT == null ? 'None in ' + (a.proj.length - 1) + ' days' : dNice(a.stockDate, true)) + '</div><div class="td">' + (a.stockT == null ? '' : a.stockT === 0 ? 'Out of stock now' : rel(a.stockT) + ' with no new order') + '</div></div>' +
    '<div class="good"><div class="tk">Next delivery</div><div class="tv">' + (nextArr ? dNice(nextArr.due, true) : showOrder ? dNice(a.arriveDate, true) : '—') + '</div><div class="td">' + (nextArr ? num(nextArr.qty) + ' units · ' + nextArr.po : showOrder ? num(a.qty) + ' units if ordered ' + (a.orderT <= 0 ? 'today' : dNice(a.orderDate)) : 'No order needed') + '</div></div></div>' +
    '<div class="verdict ' + vc + '">' + esc(verdict) + '</div>' +
    '<div><div class="legend" style="margin-bottom:8px"><span><i style="background:var(--chart-1)"></i>Projected stock, no new order</span>' + (showOrder ? '<span><i style="background:var(--ok)"></i>With recommended order of ' + num(a.qty) + '</span>' : '') + '<span><i style="background:var(--now);height:2px"></i>Safety stock</span><span><i style="background:var(--watch);height:2px"></i>Reorder point</span></div>' +
    chart({ labels: labels, series: [{ values: base, color: '--chart-1', area: true }].concat(showOrder ? [{ values: withOrder, color: '--ok', dash: '6 4', noEnd: true }] : []), hlines: [{ v: a.SS, color: '--now', label: 'Safety ' + num(a.SS) }, { v: a.ROP, color: '--watch', label: 'Reorder ' + num(a.ROP) }], vlines: vlines, h: 300, label: 'Projected inventory', tip: function (i) { return labels[i] + ': <b>' + num(base[i]) + '</b> projected' + (withOrder[i] != null && showOrder ? ' · ' + num(withOrder[i]) + ' with order' : ''); } }) + '</div>' +
    '<details class="why"><summary>How this was calculated</summary>' + reasonsDl(a) + '</details>' +
    '</div></section>';
}
function fcRunway() {
  var list = AL.filter(function (a) { return a.status !== 'disc'; });
  var late = list.filter(function (a) { return a.orderT != null && a.orderT <= 0; }).length;
  return '<p class="muted" style="margin:0">Bar length is how long current and incoming stock lasts. The dashed box is the lead time: if the bar ends inside it, a new order can\'t arrive in time. The black tick is the order-by date. ' + late + ' product' + (late === 1 ? '' : 's') + ' are due or past due.</p>' +
    '<section class="card"><div class="hd"><div class="legend"><span><i style="background:var(--now)"></i>Order now / out</span><span><i style="background:var(--soon)"></i>Reorder soon</span><span><i style="background:var(--watch)"></i>Watch</span><span><i style="background:var(--ok)"></i>Healthy</span></div></div>' + runway(list, 150) + '</section>';
}
var PRESETS = [
  ['Normal forecast', {}], ['Sales +10%', { salesPct: 10 }], ['Sales +25%', { salesPct: 25 }], ['Sales −10%', { salesPct: -10 }],
  ['Lead time +7 days', { leadDays: 7 }], ['Supplier delay +14 days', { leadDays: 14 }], ['Promotion: +50% for 2 weeks', { promoRel: [14, 14, 50] }], ['Seasonal peak +30%', { seasonPct: 30 }]
];
function wiObj(o) {
  var w = { salesPct: o.salesPct || 0, leadDays: o.leadDays || 0, seasonPct: o.seasonPct || 0 };
  if (o.promoRel) w.promo = { start: E.addDays(WS.meta.asOf, o.promoRel[0]), end: E.addDays(WS.meta.asOf, o.promoRel[0] + o.promoRel[1] - 1), lift: o.promoRel[2] };
  if (o.promoLift && o.promoStart) w.promo = { start: o.promoStart, end: E.addDays(o.promoStart, (+o.promoDays || 7) - 1), lift: +o.promoLift };
  return w;
}
function fcWhatIf() {
  var w = UI.wi, sku = w.sku || (AL[0] && AL[0].sku), p = prod(sku); if (!p) return '';
  var custom = wiObj(w), base = A[sku];
  var scen = PRESETS.map(function (x) { return { label: x[0], a: E.analyze(p, ctx(wiObj(x[1]))) }; });
  var cust = E.analyze(p, ctx(custom));
  function card(label, a, cls) {
    var d = a.qty - base.qty;
    return '<div class="' + (cls || '') + '"><div class="small muted">' + esc(label) + '</div><div class="sv">' + (a.qty > 0 ? num(a.qty) + ' units' : 'No order') + '</div><div class="delta ' + (d > 0 ? 'up' : d < 0 ? 'dn' : '') + '">' + (cls === 'base' ? 'Baseline' : d === 0 ? 'No change' : (d > 0 ? '+' : '') + num(d) + ' vs normal') + '</div><div class="small">' + (a.orderT == null ? 'No order date in window' : 'Order ' + (a.orderT <= 0 ? 'today' : 'by ' + dNice(a.orderDate))) + '</div><div class="small faint">Stockout ' + (a.stockT == null ? 'not projected' : dNice(a.stockDate)) + ' · ' + money(a.qty * a.cost) + '</div></div>';
  }
  // portfolio impact of the custom scenario
  var c = ctx(custom), bu = 0, bc = 0, su = 0, sc = 0, flips = [];
  WS.products.forEach(function (pp) { var a0 = A[pp.sku], a1 = E.analyze(pp, c); if (a0.needsOrder) { bu += a0.qty; bc += a0.qty * a0.cost; } if (a1.needsOrder) { su += a1.qty; sc += a1.qty * a1.cost; } if (a0.status !== a1.status) flips.push([pp, a0, a1]); });
  var any = custom.salesPct || custom.leadDays || custom.seasonPct || custom.promo;
  function sl(k, label, min, max, step, unit) { return '<label class="field"><span>' + label + ': <b>' + (w[k] > 0 ? '+' : '') + w[k] + unit + '</b></span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + w[k] + '" data-f="wi||' + k + '" aria-label="' + label + '"></label>'; }
  return '<div class="row">' + productSelect('wi-sku', sku, 'wi||sku') + '<span class="small muted">Scenarios never change your saved data.</span></div>' +
    '<section class="card"><div class="hd"><h2>Preset scenarios for ' + esc(p.name) + '</h2></div><div class="bd"><div class="scen">' + scen.map(function (s2, i) { return card(s2.label, s2.a, i === 0 ? 'base' : ''); }).join('') + '</div></div></section>' +
    '<section class="card"><div class="hd"><h2>Build your own scenario</h2><button class="btn ghost sm" data-act="wi-reset">Reset</button></div><div class="bd"><div class="grid2e"><div class="fields" style="grid-template-columns:1fr">' +
    sl('salesPct', 'Sales change', -50, 100, 5, '%') + sl('leadDays', 'Extra lead time / supplier delay', 0, 45, 1, ' days') + sl('seasonPct', 'Seasonal increase', 0, 100, 5, '%') +
    '<div class="row"><label class="field"><span>Promotion lift %</span><input type="number" min="0" data-f="wi||promoLift" value="' + esc(w.promoLift) + '"></label><label class="field"><span>Starts</span><input type="date" data-f="wi||promoStart" value="' + esc(w.promoStart) + '"></label><label class="field"><span>Days</span><input type="number" min="1" data-f="wi||promoDays" value="' + esc(w.promoDays) + '"></label></div></div>' +
    '<div class="scen" style="grid-template-columns:1fr 1fr;align-content:start">' + card('Normal', base, 'base') + card('Your scenario', cust, 'custom') + '</div></div></div></section>' +
    (any ? '<section class="card"><div class="hd"><div><h2>Across all products</h2><div class="small muted">Your scenario applied to every SKU</div></div></div><div class="bd"><div class="stats"><div class="stat"><span>Units to order now</span><b>' + num(su) + '</b><em>normal ' + num(bu) + ' (' + (su - bu >= 0 ? '+' : '') + num(su - bu) + ')</em></div><div class="stat"><span>Cash needed</span><b>' + money(sc) + '</b><em>normal ' + money(bc) + '</em></div><div class="stat"><span>Status changes</span><b>' + flips.length + '</b><em>products</em></div></div>' +
      (flips.length ? '<div class="tw" style="margin-top:14px"><table class="t"><thead><tr><th>Product</th><th>Normal</th><th>Scenario</th><th>Order by</th><th class="r">Qty</th></tr></thead><tbody>' + flips.map(function (f2) { return '<tr><td><b>' + esc(f2[0].name) + '</b></td><td>' + pill(f2[1].status) + '</td><td>' + pill(f2[2].status) + '</td><td>' + (f2[2].orderT == null ? '—' : f2[2].orderT <= 0 ? 'Today' : dNice(f2[2].orderDate)) + '</td><td class="r">' + num(f2[2].qty) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div></section>' : '');
}

function storeSalesCard(rng) {
  var ss = (WS.storeSales || []).filter(function (x) { return x.units && x.units.length; });
  if (ss.length < 2) return '';
  var rows = ss.map(function (x) { var n = x.units.length, u = 0, r = 0, c = 0; for (var k = rng[0]; k <= rng[1] && k <= n; k++) { u += x.units[n - k] || 0; r += x.revenue[n - k] || 0; c += (x.cost ? x.cost[n - k] : 0) || 0; } return { name: x.name, role: x.role, u: u, r: r, c: c }; });
  var U = rows.reduce(function (s, x) { return s + x.u; }, 0);
  var R = rows.reduce(function (s, x) { return s + x.r; }, 0), cols = ['--chart-1', '--chart-2', '--chart-3', '--chart-4'];
  return '<section class="card"><div class="hd"><h2>Sales by channel</h2><span class="small muted">units, all products, same dates</span></div><div class="bd">' +
    '<div class="mixbar" style="height:10px;margin-bottom:14px">' + rows.map(function (x, i) { return '<span style="width:' + (U ? x.u / U * 100 : 0) + '%;background:var(' + cols[i % 4] + ')"></span>'; }).join('') + '</div>' +
    rows.map(function (x, i) { return '<div class="row" style="justify-content:space-between;margin-bottom:8px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(' + cols[i % 4] + ');margin-right:8px"></i><b>' + esc(x.name) + '</b> <span class="small faint">' + (x.role === 'primary' ? 'stock source' : x.role === 'salon' ? 'in-house' : 'sales') + '</span></span><span class="small">' + num(x.u) + ' units · ' + (U ? Math.round(x.u / U * 100) : 0) + '% · ' + (x.role === 'salon' ? money(x.c) + ' at cost' : money(x.r)) + '</span></div>'; }).join('') + '</div></section>';
}
