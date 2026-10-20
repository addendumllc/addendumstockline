/* ---------- Alerts ---------- */
function buildAlerts() {
  var s = settings(), n = s.notify || {}, out = [];
  AL.forEach(function (a) {
    var nm = a.p.name;
    if (a.status === 'disc') return;
    if (a.status === 'oos' && n.stockout) out.push({ id: 'oos-' + a.sku, sev: 'now', type: 'Out of stock', sku: a.sku, text: nm + ' is out of stock.' + (a.incoming ? ' ' + a.incoming + ' units arrive ' + dNice(a.incomingLines[0].due) + '.' : a.onOrder.length ? ' Already on ' + a.onOrder.join(', ') + '.' : ' Order ' + num(a.qty) + ' units today.') });
    else if (a.stockT != null && a.stockT <= 30 && n.stockout) out.push({ id: 'so-' + a.sku, sev: a.atRisk ? 'now' : 'soon', type: 'Stockout risk', sku: a.sku, text: nm + ' is projected to run out in ' + a.stockT + ' days (' + dNice(a.stockDate) + ')' + (a.atRisk ? ', ' + a.lateGap + ' days before a new order could arrive.' + (a.incoming ? ' Ask the supplier to expedite ' + a.incomingLines[0].po + '.' : '') : '.') });
    if (a.needsOrder && n.order) out.push({ id: 'or-' + a.sku, sev: a.status === 'soon' ? 'soon' : 'now', type: 'Order recommendation', sku: a.sku, text: 'Order ' + num(a.qty) + ' ' + nm + (a.orderT <= 0 ? ' today.' : ' by ' + dNice(a.orderDate) + '.') });
    else if (a.status === 'watch' && a.available < a.ROP && n.low) out.push({ id: 'lo-' + a.sku, sev: 'watch', type: 'Low inventory', sku: a.sku, text: nm + ' is below its reorder point (' + num(a.available) + ' available vs ' + num(a.ROP) + ').' });
    if (a.g30 != null && a.g30 > 1.25 && a.w.d30.sold >= 10 && !a.isLaunch && n.spike) out.push({ id: 'sp-' + a.sku, sev: 'info', type: 'Sales increase', sku: a.sku, text: 'Sales of ' + nm + ' are ' + pct(a.g30 - 1) + ' higher than the previous 30 days.' });
  });
  if (n.supplier) WS.suppliers.forEach(function (sp) { var pf = E.supplierPerf(sp, WS.pos); if (pf.flag) out.push({ id: 'sd-' + sp.id, sev: 'soon', type: 'Supplier delay', sup: sp.id, text: sp.name + ' is averaging ' + Math.round(pf.delay) + ' days longer than expected (' + Math.round(pf.avgActual) + ' days vs ' + pf.stated + ' set).' }); });
  if (n.overdue) WS.pos.forEach(function (x) { if (E.OPEN[x.status] && x.expectedDelivery && x.expectedDelivery < WS.meta.asOf) out.push({ id: 'od-' + x.id, sev: 'soon', type: 'Delivery overdue', po: x.id, text: x.id + ' from ' + supName(x.supplierId) + ' was due ' + dNice(x.expectedDelivery) + ' and has not been received.' }); });
  var rank = { now: 0, soon: 1, watch: 2, info: 3 };
  return out.filter(function (x) { return !UI.dismissed[x.id]; }).sort(function (a, b) { return rank[a.sev] - rank[b.sev]; });
}
function alertList(list, max) {
  if (!list.length) return '<div class="empty"><b>No alerts</b>Nothing needs attention right now.</div>';
  return '<div class="alerts">' + list.slice(0, max || 99).map(function (x) {
    var link = x.sku ? 'open-product|' + x.sku : x.sup ? 'sup-open|' + x.sup : x.po ? 'po-open|' + x.po : '';
    return '<div class="alert ' + x.sev + '"><i></i><div><div class="t1">' + esc(x.type) + '</div><div class="t2">' + esc(x.text) + '</div></div><div class="row" style="gap:2px">' +
      (link ? '<button class="btn ghost sm" data-act="' + link + '">View</button>' : '') + '<button class="btn ghost sm" data-act="dismiss|' + x.id + '" aria-label="Dismiss">✕</button></div></div>';
  }).join('') + '</div>';
}

/* ---------- Shared bits ---------- */
function cartBtn(a) {
  if (a.status === 'disc' || a.status === 'untracked') return '';
  var inCart = UI.cart[a.sku] != null;
  return '<button class="btn sm ' + (inCart ? 'added' : '') + '" data-act="cart-toggle|' + a.sku + '"' + (Store.canWrite ? '' : ' disabled') + '>' + (inCart ? '✓ On PO' : '+ Add to PO') + '</button>';
}
function thumb(p, cls) { return p && p.image ? '<img class="' + (cls || 'thumb') + '" src="' + esc(mediaUrl('/uploads/' + p.image)) + '" alt="" loading="lazy">' : '<span class="' + (cls || 'thumb') + ' ph" aria-hidden="true">' + esc(String((p && p.collection) || (p && p.name) || '?').trim().charAt(0).toUpperCase()) + '</span>'; }
function pname(a) { return '<div class="pwrap">' + thumb(a.p) + pnameText(a) + '</div>'; }
function pnameText(a) { return '<div class="pname"><b>' + esc(a.p.name) + (a.p.needsSetup ? ' <span class="tag" title="Set supplier and lead time on the Products page">Needs setup</span>' : '') + '</b><span>' + esc(a.p.sku) + ' · ' + esc(supName(a.p.supplierId)) + '</span></div>'; }
function orderByCell(a) {
  if (a.status === 'disc') return '<span class="faint">—</span>';
  if (a.orderT == null) return '<span class="faint">Not within ' + (a.proj.length - 1) + 'd</span>';
  if (a.orderT <= 0) return '<b style="color:var(--now)">Today</b>' + (a.atRisk ? ' <span class="tag risk">Late</span>' : '');
  return dNice(a.orderDate) + ' <span class="faint small">' + rel(a.orderT) + '</span>';
}
function stockCell(a) {
  if (a.stockT == null) return '<span class="faint">Not projected</span>';
  if (a.stockT === 0) return '<b style="color:var(--now)">Now</b>';
  return dNice(a.stockDate) + ' <span class="faint small">' + a.stockT + 'd</span>';
}
function dataAsOf() {
  var stale = E.diff(WS.meta.asOf, todayISO());
  return 'Data as of ' + dLong(WS.meta.asOf) + (WS.meta.source === 'demo' ? ' · demo store' : '') + (stale > 1 ? ' · ' + stale + ' days old' : '');
}

/* ---------- Dashboard ---------- */
/* ---------- Dashboard sales (date range) ---------- */
var DASH_RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['year', 'This year']];
function dashState() { if (!UI.dash) UI.dash = { range: '30' }; return UI.dash; }
// Demo data stops at its own as-of date; real data runs to today in the browser's local time.
function dashToday() { return WS.meta.source === 'demo' && WS.meta.asOf ? WS.meta.asOf : todayISO(); }
function dashRange() {
  var r = dashState().range, to = dashToday();
  var from = r === 'month' ? to.slice(0, 8) + '01' : r === 'year' ? to.slice(0, 5) + '01-01' : E.addDays(to, -((+r || 30) - 1));
  return { key: r, from: from, to: to, label: (DASH_RANGES.filter(function (x) { return x[0] === r; })[0] || DASH_RANGES[1])[1] };
}
// Without the server, estimate from each product's daily history (salon use left out, priced at retail).
function localSales(from, to) {
  var span = E.diff(from, to) + 1, pFrom = E.addDays(from, -span), pTo = E.addDays(from, -1);
  var per = {}, daily = {}, tot = { units: 0, revenue: 0, orders: 0 }, prev = { from: pFrom, to: pTo, units: 0, revenue: 0, orders: 0 };
  WS.products.forEach(function (p) {
    var sd = p.salonDays || {};
    E.history(p, E.addDays(to, 1), span * 2).forEach(function (h) {
      var u = h.u - (sd[h.date] || 0); if (!u) return;
      var r = u * (+p.price || 0);
      if (h.date >= from) { var o = per[p.sku] = per[p.sku] || { sku: p.sku, units: 0, revenue: 0, orders: 0 }; o.units += u; o.revenue += r; var d = daily[h.date] = daily[h.date] || { date: h.date, units: 0, revenue: 0 }; d.units += u; d.revenue += r; tot.units += u; tot.revenue += r; }
      else { prev.units += u; prev.revenue += r; }
    });
  });
  return { from: from, to: to, days: span, estimated: true, local: true, totals: tot, prev: prev,
    products: Object.keys(per).map(function (k) { return per[k]; }).filter(function (o) { return o.units > 0; }).sort(function (a, b) { return b.units - a.units || b.revenue - a.revenue; }),
    daily: Object.keys(daily).sort().map(function (k) { return daily[k]; }) };
}
function dashSales() {
  var rg = dashRange(), key = rg.from + '|' + rg.to;
  if (Store.mode !== 'db') return localSales(rg.from, rg.to);
  UI.dashSales = UI.dashSales || {};
  if (UI.dashSales[key]) return UI.dashSales[key];
  if (UI.dashLoading !== key) {
    UI.dashLoading = key;
    API.req('GET', '/api/sales-summary?from=' + rg.from + '&to=' + rg.to)
      .then(function (r) { UI.dashSales[key] = r; })
      .catch(function (e) { UI.dashSales[key] = { error: e.message }; })
      .then(function () { if (UI.dashLoading === key) UI.dashLoading = null; if (UI.page === 'dashboard') render(); });
  }
  return null;
}
function dashSalesSection() {
  var rg = dashRange(), S = dashSales();
  var bar = '<div class="filters dash-range"><div class="seg" role="group" aria-label="Date range">' + DASH_RANGES.map(function (o) { return '<button aria-pressed="' + (rg.key === o[0]) + '" data-act="dash-range|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' +
    '<span class="small"><b>' + esc(rg.label) + ':</b> ' + esc(dNice(rg.from, rg.from.slice(0, 4) !== rg.to.slice(0, 4)) + ' – ' + dNice(rg.to, true)) + '</span>' + (S && UI.dashLoading ? '' : !S ? '<span class="small muted">Loading sales…</span>' : '') + '</div>';
  if (!S) return bar + '<section class="card"><div class="loading">Loading sales…</div></section>';
  if (S.error) return bar + '<div class="note bad">Couldn\'t load sales: ' + esc(S.error) + '</div>';
  var T = S.totals, P = S.prev, days = S.days || 1;
  function vs(cur, old) { return old ? pct(cur / old - 1, true) + ' vs previous ' + days + ' days' : 'no sales in previous ' + days + ' days'; }
  var kpis = '<section class="kpis" aria-label="Sales for ' + esc(rg.label) + '">' +
    kpi('Units sold', num(T.units), vs(T.units, P.units)) +
    kpi('Sales', money(T.revenue), S.estimated ? 'some at current retail price' : vs(T.revenue, P.revenue)) +
    kpi('Orders', S.local ? '—' : num(T.orders), S.local ? 'needs the server' : vs(T.orders, P.orders)) +
    kpi('Units per day', rate(T.units / days), days + '-day average') + '</section>';
  // Daily bars for short ranges, weekly for a whole year.
  var byDay = {}; S.daily.forEach(function (d) { byDay[d.date] = d; });
  var step = days > 62 ? 7 : 1, labels = [], vals = [], revs = [], starts = [];
  for (var t = 0; t < days; t += step) {
    var u = 0, r = 0; for (var j = t; j < Math.min(days, t + step); j++) { var d = byDay[E.addDays(rg.from, j)]; if (d) { u += d.units; r += d.revenue; } }
    starts.push(E.addDays(rg.from, t)); labels.push(dNice(E.addDays(rg.from, t))); vals.push(u); revs.push(r);
  }
  var trend = '<section class="card"><div class="hd"><h2>Sales trend</h2><span class="small muted">units ' + (step === 7 ? 'per week' : 'per day') + '</span></div><div class="bd">' +
    chart({ type: 'bar', labels: labels, series: [{ values: vals, color: '--chart-1' }], h: 240, label: 'Units sold, ' + rg.label, tip: function (i) { return (step === 7 ? 'Week of ' : '') + dNice(starts[i], true) + ': <b>' + num(vals[i]) + '</b> units · ' + money(revs[i]); } }) + '</div></section>';
  var top = S.products.slice(0, 10), maxU = top.length ? top[0].units : 0;
  var topCard = '<section class="card"><div class="hd"><div><h2>Top-selling products</h2><div class="small muted">' + esc(rg.label) + ' · ranked by units sold</div></div><button class="btn ghost sm" data-act="nav|analytics">Sales analytics</button></div><div class="bd flush tw">' +
    (top.length ? '<table class="t compact"><thead><tr><th class="r">#</th><th>Product</th><th class="r">Units</th><th class="r">Sales</th></tr></thead><tbody>' + top.map(function (o, i) {
      var p = prod(o.sku), a = p ? A[o.sku] : null;
      var nameCell = a ? pname(a) : '<div class="pwrap">' + thumb(p) + '<div class="pname"><b>' + esc(p ? p.name : o.sku) + '</b><span>' + esc(o.sku) + '</span></div></div>';
      return '<tr' + (p ? ' class="click" data-act="open-product|' + esc(o.sku) + '"' : '') + '><td class="r faint">' + (i + 1) + '</td><td>' + nameCell + '<div class="topbar"><span style="width:' + (maxU ? o.units / maxU * 100 : 0) + '%"></span></div></td><td class="r"><b>' + num(o.units) + '</b></td><td class="r">' + money(o.revenue) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty"><b>No sales in this period</b>Orders from your stores show up here.</div>') + '</div></section>';
  return bar + kpis + '<div class="grid2e">' + topCard + trend + '</div>' +
    '<p class="small muted" style="margin:0">Sales count store orders net of refunds and removed items; cancelled, refunded and voided orders are left out, and salon use is not a sale.' + (S.estimated ? ' Sales before your order history are valued at current retail price.' : '') + ' The sections below show stock and orders as of today and don\'t change with the date range.</p>';
}

function pageDashboard() {
  if (!WS.products.length) return setupGuide();
  var s = settings();
  var need = AL.filter(function (a) { return a.needsOrder; });
  var units = 0, cost = 0; need.forEach(function (a) { units += a.qty; cost += a.qty * a.cost; });
  var soonest = need.filter(function (a) { return a.orderT != null; }).sort(function (a, b) { return a.orderT - b.orderT; });
  var dueToday = need.filter(function (a) { return a.orderT <= 0 || a.status === 'oos'; }).length;
  var next = AL.filter(function (a) { return a.orderT != null && a.orderT > 0 && a.status !== 'disc'; }).sort(function (a, b) { return a.orderT - b.orderT; })[0];
  var totUnits = 0, value = 0, risk = 0, oos = 0, incoming = 0;
  AL.forEach(function (a) { totUnits += a.onHand; value += a.onHand * a.cost; if (a.stockT != null && a.stockT <= 30 && a.status !== 'disc') risk++; if (a.status === 'oos') oos++; incoming += a.incoming; });
  var openPOs = WS.pos.filter(function (x) { return E.OPEN[x.status]; });
  var drafts = WS.pos.filter(function (x) { return x.status === 'draft'; }).length;
  var action = AL.filter(function (a) { return a.status === 'now' || a.status === 'oos' || a.status === 'soon' || a.atRisk; });
  var al = buildAlerts();
  var mix = {}; AL.forEach(function (a) { mix[a.status] = (mix[a.status] || 0) + 1; });
  var colors = { oos: '--oos', now: '--now', soon: '--soon', watch: '--watch', healthy: '--ok', disc: '--disc' };
  var lastSync = (WS.sync.log || [])[0];

  return '<div class="ph"><div><div class="eyebrow">' + esc(dLong(todayISO())) + '</div><h1>Purchasing desk</h1><div class="sub">' + esc(dataAsOf()) + '</div></div>' +
    '<div class="actions">' + (apiStores().length ? '<button class="btn" data-act="sync">Sync Shopify data</button>' : '<button class="btn" data-act="nav|sales">Record sales</button>') + '<button class="btn primary" data-act="nav|recs">Review order recommendations</button></div></div>' +
    dashSalesSection() +

    '<section class="answers" aria-label="Today\'s answers">' +
    '<div class="first"><div class="q">What do I need to order?</div><div class="a">' + need.length + '<small>product' + (need.length === 1 ? '' : 's') + '</small></div><div class="d">' + (need.length ? esc(need.slice(0, 3).map(function (a) { return a.p.name; }).join(', ')) + (need.length > 3 ? ' +' + (need.length - 3) + ' more' : '') : 'Everything is covered by stock and open orders.') + '</div></div>' +
    '<div><div class="q">How much?</div><div class="a">' + num(units) + '<small>units</small></div><div class="d">' + money(cost) + ' at cost across ' + Object.keys(need.reduce(function (o, a) { o[a.p.supplierId] = 1; return o; }, {})).length + ' supplier(s)</div></div>' +
    '<div><div class="q">When?</div><div class="a">' + (dueToday ? 'Today' : soonest.length ? dNice(soonest[0].orderDate) : next ? dNice(next.orderDate) : '—') + '</div><div class="d">' + (dueToday ? dueToday + ' order' + (dueToday > 1 ? 's are' : ' is') + ' due now' + (soonest.length > dueToday ? ', the rest within ' + s.soonDays + ' days' : '') : next ? 'Next order due ' + rel(next.orderT) + ' (' + esc(next.p.name) + ')' : 'No orders due in the forecast window') + '</div></div>' +
    '</section>' +

    '<h2 class="dash-sec">Stock right now</h2>' +
    '<section class="kpis" aria-label="Inventory overview">' +
    kpi('Total SKUs', num(AL.length), collections().length + ' collections') +
    kpi('Units in stock', num(totUnits), 'on hand across locations') +
    kpi('Inventory value', money(value), 'at unit cost') +
    kpi('Need ordering', num(need.length), dueToday + ' due today', need.length ? 'bad' : '') +
    kpi('Stockout risk ≤ 30 days', num(risk), 'projected to hit zero', risk ? 'warn' : '') +
    kpi('Out of stock', num(oos), 'available = 0', oos ? 'bad' : '') +
    kpi('Open purchase orders', num(openPOs.length), drafts ? drafts + ' draft' + (drafts > 1 ? 's' : '') + ' not counted' : 'submitted to shipped') +
    kpi('Incoming units', num(incoming), openPOs.length ? 'next ' + dNice(openPOs.map(function (x) { return x.expectedDelivery; }).filter(Boolean).sort()[0]) : 'none on order') +
    '</section>' +

    '<section class="card"><div class="hd"><div><h2>Action required</h2><div class="small muted">Ordered by urgency. Add items to build purchase orders.</div></div><button class="btn sm" data-act="cart-add-all"' + (Store.canWrite ? '' : ' disabled') + '>Add all to PO</button></div>' +
    '<div class="bd flush tw">' + (action.length ? '<table class="t"><thead><tr><th>Product</th><th>Status</th><th class="r">Available</th><th class="r">Sales/day</th><th class="r">Lead</th><th>Stockout</th><th>Order by</th><th class="r">Rec. order</th><th></th></tr></thead><tbody>' +
      action.map(function (a) {
        return '<tr class="click sev ' + a.status + '" data-act="open-product|' + a.sku + '"><td>' + pname(a) + '</td><td>' + pill(a.status) + '</td><td class="r">' + num(a.available) + (a.incoming ? '<div class="small faint">+' + num(a.incoming) + ' incoming</div>' : '') + '</td><td class="r">' + rate(a.base) + '</td><td class="r">' + a.L + 'd</td><td>' + stockCell(a) + '</td><td>' + orderByCell(a) + '</td><td class="r"><b>' + (a.qty > 0 ? num(a.qty) : '—') + '</b>' + (a.overrides.qty != null && a.overrides.qty !== '' ? ' <span class="tag manual">Manual</span>' : '') + '</td><td>' + (a.qty > 0 ? cartBtn(a) : '<span class="small faint">Expedite</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty"><b>Nothing urgent</b>No products need ordering in the next ' + s.soonDays + ' days.</div>') + '</div></section>' +
    '<div class="grid2"><div class="stack">' +

    '<section class="card"><div class="hd"><h2>Stock runway</h2><div class="legend"><span><i style="background:var(--ok)"></i>Days of stock</span><span><i style="border:1.5px dashed var(--ink-2)"></i>Lead time</span><span><i style="background:var(--ink);width:3px"></i>Order by</span></div></div>' + runway(AL.filter(function (a) { return a.status !== 'disc'; }).slice(0, 10)) +
    '<div class="bd"><button class="btn sm" data-act="nav|forecast">See all ' + AL.length + ' products in Forecast</button></div></section>' +
    '</div><div class="stack">' +
    '<section class="card"><div class="hd"><h2>Alerts</h2><span class="small muted">' + al.length + ' open</span></div><div class="bd flush">' + alertList(al, 7) + '</div></section>' +
    '<section class="card"><div class="hd"><h2>Status mix</h2></div><div class="bd"><div class="mixbar">' + ['oos', 'now', 'soon', 'watch', 'healthy', 'disc'].map(function (k) { return mix[k] ? '<span style="width:' + (mix[k] / AL.length * 100) + '%;background:var(' + colors[k] + ')" title="' + STATUS[k].label + ': ' + mix[k] + '"></span>' : ''; }).join('') + '</div><div class="legend" style="margin-top:10px">' + ['oos', 'now', 'soon', 'watch', 'healthy', 'disc'].filter(function (k) { return mix[k]; }).map(function (k) { return '<span><i style="background:var(' + colors[k] + ')"></i>' + STATUS[k].label + ' ' + mix[k] + '</span>'; }).join('') + '</div></div></section>' +
    '<section class="card"><div class="hd"><h2>Incoming deliveries</h2><button class="btn ghost sm" data-act="nav|pos">All POs</button></div><div class="bd flush tw">' + (openPOs.length ? '<table class="t compact"><tbody>' + openPOs.sort(function (a, b) { return (a.expectedDelivery || '9') < (b.expectedDelivery || '9') ? -1 : 1; }).map(function (x) {
      var u = x.lines.reduce(function (s2, l) { return s2 + Math.max(0, l.qty - (l.received || 0) - (l.damaged || 0)); }, 0);
      var late = x.expectedDelivery && x.expectedDelivery < WS.meta.asOf;
      return '<tr class="click" data-act="po-open|' + x.id + '"><td><div class="pname"><b>' + x.id + '</b><span>' + esc(supName(x.supplierId)) + '</span></div></td><td>' + poPill(x.status) + '</td><td class="r">' + num(u) + ' units<div class="small ' + (late ? '' : 'faint') + '" style="' + (late ? 'color:var(--now)' : '') + '">' + (late ? 'Overdue · ' : '') + 'due ' + dNice(x.expectedDelivery) + '</div></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">No open purchase orders.</div>') + '</div></section>' +
    '<section class="card"><div class="hd"><h2>Shopify sync</h2><button class="btn ghost sm" data-act="nav|settings">Details</button></div><div class="bd"><dl class="dl">' +
    '<dt>Last sync</dt><dd>' + (lastSync ? esc(new Date(lastSync.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' · ' + esc(lastSync.kind) : 'Never') + '</dd>' +
    '<dt>Status</dt><dd>' + (lastSync ? (lastSync.status === 'success' ? '<span style="color:var(--ok);font-weight:600">Succeeded</span>' : '<span style="color:var(--now);font-weight:600">Failed</span>') : '—') + '</dd>' +
    '<dt>Products</dt><dd>' + num(WS.products.length) + '</dd><dt>Orders</dt><dd>' + (lastSync ? num(lastSync.orders) : '—') + '</dd>' +
    (function () { var ss = (Store.status && Store.status.stores) || []; return ss.length ? '<dt>Stores</dt><dd>' + ss.map(function (x) { return '<div>' + esc(x.name) + ' <span class="small faint">' + (x.role === 'primary' ? 'stock source' : 'sales') + (x.lastStatus === 'error' ? '</span> <b style="color:var(--now)">failed</b>' : '</span>') + '</div>'; }).join('') + '</dd>' : ''; })() +
    '<dt>Errors</dt><dd>' + (lastSync && lastSync.status === 'error' ? esc(lastSync.message) : 'None in last sync') + '</dd>' + (function () { var le = (WS.sync.log || []).filter(function (l) { return l.status === 'error'; })[0]; return le && le !== lastSync ? '<dt>Last error</dt><dd class="small">' + esc(new Date(le.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + ': ' + esc(le.message) + '</dd>' : ''; })() + '</dl></div></section>' +
    '</div></div>';
}
function kpi(l, v, f, cls) { return '<div class="kpi"><span class="l">' + l + '</span><span class="v ' + (cls || '') + (String(v).length > 14 ? ' txt' : '') + '">' + v + '</span><span class="f">' + esc(f) + '</span></div>'; }

function runway(list, maxD) {
  maxD = maxD || 120;
  var col = { oos: '--now', now: '--now', soon: '--soon', watch: '--watch', healthy: '--ok', disc: '--disc' };
  var ticks = [0, 30, 60, 90, 120].filter(function (t) { return t <= maxD; });
  return '<div class="runway"><div class="rw-axis"><div>Product</div><div class="ax">' + ticks.map(function (t) { return '<span style="left:' + (t / maxD * 100) + '%">' + (t === 0 ? 'Today' : t + 'd') + '</span>'; }).join('') + '</div><div style="text-align:right">Order by</div></div>' +
    list.map(function (a) {
      var d = a.stockT == null ? maxD : Math.min(maxD, a.stockT), L = Math.min(maxD, a.L);
      return '<div class="rw" data-act="open-forecast|' + a.sku + '" title="' + esc(a.p.name) + '"><div class="nm">' + esc(a.p.name) + '<span>' + num(a.available) + ' avail · ' + rate(a.base) + '/day</span></div>' +
        '<div class="track"><div class="fill" style="width:' + (d / maxD * 100) + '%;background:var(' + col[a.status] + ')"></div><div class="lead" style="width:' + (L / maxD * 100) + '%"></div>' +
        (a.orderT != null && a.orderT >= 0 && a.orderT <= maxD ? '<div class="mk" style="left:' + (a.orderT / maxD * 100) + '%"></div>' : '') + '</div>' +
        '<div class="when">' + (a.orderT == null ? '<span class="faint">—</span>' : a.orderT <= 0 ? '<b style="color:var(--now)">Today</b>' : dNice(a.orderDate)) + '</div></div>';
    }).join('') + '</div>';
}

/* ---------- Order recommendations ---------- */
function pageRecs() {
  // AL already leaves out untracked products; discontinued ones never get orderNow or a quantity.
  var out = AL.filter(function (a) { return a.orderNow; });
  var now = AL.filter(function (a) { return a.status === 'now' && a.qty > 0; });
  var soon = AL.filter(function (a) { return a.status === 'soon' && a.qty > 0; });
  var watch = AL.filter(function (a) { return a.status === 'watch'; });
  var onOrd = AL.filter(function (a) { return a.status === 'oos' && !a.orderNow; });
  var risk = AL.filter(function (a) { return a.atRisk && a.status !== 'now' && a.status !== 'oos' && a.status !== 'soon'; });
  var all = [].concat(out, now, soon);
  all.forEach(function (a) { if (UI.recSel[a.sku] == null) UI.recSel[a.sku] = a.status !== 'soon'; });
  var edited = all.filter(function (a) { return UI.recQty[a.sku] != null; }).length;
  var sel = all.filter(function (a) { return UI.recSel[a.sku]; });
  var due = out.length + now.length;
  var tu = 0, tc = 0; sel.forEach(function (a) { var q = +recQty(a) || 0; tu += q; tc += q * a.cost; });
  var bySup = {};
  sel.forEach(function (a) { (bySup[a.p.supplierId] = bySup[a.p.supplierId] || []).push(a); });

  function group(title, list, sub) {
    if (!list.length) return '';
    var sups = {}; list.forEach(function (a) { (sups[a.p.supplierId] = sups[a.p.supplierId] || []).push(a); });
    return '<section class="card"><div class="hd"><div><h2>' + title + '</h2><div class="small muted">' + sub + '</div></div></div><div class="bd flush">' +
      Object.keys(sups).map(function (sid) {
        var items = sups[sid], sp = sup(sid);
        var su = 0, sc = 0; items.forEach(function (a) { if (UI.recSel[a.sku]) { var q = +recQty(a) || 0; su += q; sc += q * a.cost; } });
        return '<div class="rec-group"><div class="gh"><div><b>' + esc(sp ? sp.name : 'No supplier set') + '</b> <span class="small muted">' + (sp ? (sp.prodLead + sp.shipLead) + '-day lead · MOQ ' + sp.moq : 'Set a supplier on these products') + '</span></div><span class="small">' + (su ? num(su) + ' units · ' + money(sc) + ' selected' : 'None selected') + '</span></div>' +
          items.map(recCard).join('') + '</div>';
      }).join('') + '</div></section>';
  }
  return '<div class="ph"><div><div class="eyebrow">Order recommendations · ' + esc(dLong(WS.meta.asOf)) + '</div><h1>' + (due ? 'Order today: ' + due + ' product' + (due > 1 ? 's' : '') : soon.length ? 'Nothing due today' : 'You are covered') + '</h1><div class="sub">' +
    (out.length ? out.length + ' out of stock with nothing on order' + (now.length ? '; ' + now.length + ' more will fall below safety stock before a new order could arrive.' : '.') : now.length ? 'These will fall below safety stock before a new order could arrive if you wait.' : soon.length ? soon.length + ' product' + (soon.length > 1 ? 's' : '') + ' come due within ' + settings().soonDays + ' days.' : 'No product needs ordering within ' + settings().soonDays + ' days.') + '</div></div>' +
    '<div class="actions">' + (edited ? '<button class="btn" data-act="rec-reset" title="Replace your typed quantities with the recommended ones">Recalculate ' + edited + ' edited quantit' + (edited > 1 ? 'ies' : 'y') + '</button>' : '') + '<button class="btn primary" data-act="rec-create"' + (sel.length && Store.canWrite ? '' : ' disabled') + '>Create ' + (Object.keys(bySup).length > 1 ? Object.keys(bySup).length + ' purchase orders' : 'purchase order') + (sel.length ? ' · ' + num(tu) + ' units · ' + money(tc) : '') + '</button></div></div>' +
    group('Order Now: out of stock', out, 'Out of stock and not on any active or draft purchase order. Quantities are rounded to practical amounts and never below MOQ; type any quantity to change it.') +
    group(out.length ? 'Due today' : 'Order now', now, 'Will fall below safety stock before a new order could arrive. Quantities are rounded to practical amounts and never below MOQ.') +
    group('Reorder soon', soon, 'Due within ' + settings().soonDays + ' days. Not selected by default.') +
    (onOrd.length ? '<section class="card"><div class="hd"><div><h2>Out of stock · already on order</h2><div class="small muted">Left out of Order Now to avoid a duplicate order. If a purchase order is cancelled, the product comes back to Order Now.</div></div></div><div class="bd flush tw"><table class="t"><thead><tr><th>Product</th><th class="r">Available</th><th>Purchase order</th><th>Expected</th><th class="r">On order</th></tr></thead><tbody>' +
      onOrd.map(function (a) { var nx = a.incomingLines[0]; return '<tr><td>' + pname(a) + '</td><td class="r">' + num(a.available) + '</td><td>' + a.onOrder.map(function (id) { return '<button class="btn ghost sm" data-act="po-open|' + esc(id) + '">' + esc(id) + '</button>'; }).join(' ') + '</td><td>' + (nx ? dNice(nx.due) : '<span class="faint">Draft, not submitted</span>') + '</td><td class="r">' + (a.incoming ? num(a.incoming) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
    (risk.length ? '<section class="card"><div class="hd"><div><h2>Stockout gap even with open orders</h2><div class="small muted">Incoming stock arrives after these run out. A new order cannot land sooner; expedite instead.</div></div></div><div class="bd flush tw"><table class="t"><thead><tr><th>Product</th><th class="r">Available</th><th>Runs out</th><th>Next delivery</th><th class="r">Short by</th><th></th></tr></thead><tbody>' +
      risk.map(function (a) { var nx = a.incomingLines[0]; return '<tr><td>' + pname(a) + '</td><td class="r">' + num(a.available) + '</td><td>' + stockCell(a) + '</td><td>' + (nx ? dNice(nx.due) + ' · ' + nx.po : '—') + '</td><td class="r">~' + num(a.lateUnits) + ' units</td><td>' + (nx ? '<button class="btn sm" data-act="po-open|' + nx.po + '">Open ' + nx.po + '</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
    (watch.length ? '<section class="card"><div class="hd"><div><h2>Watch</h2><div class="small muted">Order date falls within ' + settings().watchDays + ' days. No action yet.</div></div></div><div class="bd flush tw"><table class="t"><thead><tr><th>Product</th><th class="r">Available</th><th class="r">Sales/day</th><th class="r">Lead</th><th>Order by</th><th class="r">Expected qty</th></tr></thead><tbody>' +
      watch.map(function (a) { return '<tr class="click" data-act="open-product|' + a.sku + '"><td>' + pname(a) + '</td><td class="r">' + num(a.available) + '</td><td class="r">' + rate(a.base) + '</td><td class="r">' + a.L + 'd</td><td>' + orderByCell(a) + '</td><td class="r">' + num(a.qty) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') +
    (!all.length && !watch.length && !onOrd.length ? '<section class="card"><div class="empty"><b>All products are covered</b>Stock on hand and open purchase orders cover forecast demand plus safety stock.</div></section>' : '');
}
function recCard(a) {
  var on = !!UI.recSel[a.sku], q = recQty(a), edited = UI.recQty[a.sku] != null;
  return '<div class="rec"><input type="checkbox" aria-label="Include ' + esc(a.p.name) + '" data-f="rsel|' + a.sku + '|" ' + (on ? 'checked' : '') + '><div style="min-width:0"><div class="row"><button class="btn ghost sm" style="padding:0;font-size:15px;font-weight:650;color:var(--ink)" data-act="open-product|' + a.sku + '">' + esc(a.p.name) + '</button>' + pill(a.status) + trendTag(a) + (a.atRisk ? '<span class="tag risk">Stockout gap ' + a.lateGap + 'd</span>' : '') + '</div>' +
    '<div class="small faint">' + esc(a.p.sku) + ' · ' + esc(a.p.variant || '') + '</div>' +
    '<div class="facts"><div><span>Available</span><b>' + num(a.available) + '</b></div><div><span>Avg sales</span><b>' + rate(a.base) + '/day</b></div><div><span>Lead time</span><b>' + a.L + ' days</b></div><div><span>Stockout</span><b>' + (a.stockT == null ? '—' : a.stockT === 0 ? 'Now' : dNice(a.stockDate)) + '</b></div><div><span>Order by</span><b>' + (a.orderT <= 0 ? 'Today' : dNice(a.orderDate)) + '</b></div></div>' +
    '<details class="why"><summary>Why this order</summary><p class="small" style="margin:8px 0 0">' + esc(a.summary) + '</p><p class="small" style="margin:6px 0 0"><b>Quantity:</b> ' + esc(a.qtyWhy) + '</p>' + reasonsDl(a) + '</details></div>' +
    '<div class="order"><span class="small faint">Recommended ' + num(a.qty) + (a.moq ? ' · MOQ ' + num(a.moq) : '') + (edited ? ' · <button class="btn ghost sm" style="padding:0;font-size:inherit" data-act="rec-reset|' + a.sku + '">Reset</button>' : '') + '</span><label class="row" style="gap:6px"><span class="small muted">Order</span><input class="qty" type="number" min="0" step="1" data-f="rqty|' + a.sku + '|" value="' + esc(q) + '" aria-label="Order quantity"></label><span class="small muted">' + money((+q || 0) * a.cost) + ' at ' + money(a.cost) + '</span>' + (a.atRisk ? '<span class="small" style="color:var(--now);max-width:220px">Lands ' + a.lateGap + ' days after stockout. Consider air freight.</span>' : '') + '</div></div>';
}
function reasonsDl(a) {
  return '<dl class="reasons">' + a.reasons.map(function (r) { return '<dt>' + esc(r.k) + '</dt><dd>' + esc(r.v) + '</dd>'; }).join('') + '</dl><ul class="method">' + a.method.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
}

/* ---------- Inventory ---------- */
function filtered(everything) {
  var f = UI.inv, q = f.q.toLowerCase();
  return (everything ? ALL : AL).filter(function (a) {
    if (f.col && a.p.collection !== f.col) return false;
    if (f.sup && a.p.supplierId !== f.sup) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.sync && !a.p.noSync !== (f.sync === 'on')) return false;
    if (q && !productMatches(a.p, q)) return false;
    return true;
  });
}
function filterBar(withStatus) {
  var f = UI.inv;
  return '<div class="filters"><input type="search" id="inv-q" placeholder="Search name, SKU, shade" data-f="ui|inv|q" data-live="1" value="' + esc(f.q) + '" aria-label="Search products">' +
    '<select data-f="ui|inv|col" aria-label="Collection"><option value="">All collections</option>' + collections().map(function (c) { return '<option ' + (f.col === c ? 'selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
    '<select data-f="ui|inv|sup" aria-label="Supplier"><option value="">All suppliers</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '" ' + (f.sup === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
    '<select data-f="ui|inv|sync" aria-label="Inventory sync">' + [['', 'Synced and not synced'], ['on', 'Inventory synced'], ['off', 'Excluded from sync']].map(function (o) { return '<option value="' + o[0] + '"' + ((f.sync || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    (withStatus ? '<div class="seg" role="group" aria-label="Status">' + [['', 'All']].concat(['oos', 'now', 'soon', 'watch', 'healthy'].map(function (k) { return [k, STATUS[k].label]; })).map(function (x) { var c = x[0] ? AL.filter(function (a) { return a.status === x[0]; }).length : AL.length; return '<button aria-pressed="' + (f.status === x[0]) + '" data-act="inv-status|' + x[0] + '">' + x[1] + ' ' + c + '</button>'; }).join('') + '</div>' : '') + '</div>';
}
function sortRows(list) {
  var k = UI.sort.k, d = UI.sort.d;
  var key = {
    status: function (a) { return STATUS[a.status].order * 1000 + (a.orderT == null ? 999 : a.orderT); }, name: function (a) { return a.p.name.toLowerCase(); },
    onHand: function (a) { return a.onHand; }, available: function (a) { return a.available; }, incoming: function (a) { return a.incoming; }, base: function (a) { return a.base; },
    cover: function (a) { return a.daysCover === Infinity ? 1e9 : a.daysCover; }, rop: function (a) { return a.ROP; }, stock: function (a) { return a.stockT == null ? 1e9 : a.stockT; },
    order: function (a) { return a.orderT == null ? 1e9 : a.orderT; }, moq: function (a) { return +a.moq || 0; }, lead: function (a) { return a.L; },
    moqlasts: function (a) { var m = moqInfo(a); return m.lasts == null ? 1e9 : m.lasts; }, value: function (a) { return a.onHand * a.cost; }, qty: function (a) { return a.qty; }
  }[k] || function () { return 0; };
  return list.slice().sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
}
function th(label, k, r) { var on = UI.sort.k === k; return '<th class="sortable ' + (r ? 'r' : '') + '" data-act="sort|' + k + '" aria-sort="' + (on ? (UI.sort.d > 0 ? 'ascending' : 'descending') : 'none') + '">' + label + (on ? (UI.sort.d > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }
/* MOQ timing: for an order of exactly the minimum quantity, how long until it arrives and how long it lasts. */
function moqInfo(a) {
  var moq = +a.moq || 0, cost = moq * a.cost;
  var lasts = moq && a.base > 0 ? moq / a.base : null;
  var slow = +(settings().moqSlowDays || 120);
  return { moq: moq, cost: cost, arrive: a.L, arriveDate: E.addDays(WS.meta.asOf, a.L), lasts: lasts, cycle: lasts == null ? null : a.L + lasts, slow: lasts != null && lasts > slow, slowDays: slow };
}
function moqCells(a) {
  var m = moqInfo(a);
  if (!m.moq) return '<td class="moqcell"><span class="faint">MOQ not set</span></td>';
  return '<td class="moqcell"><div><b>' + num(m.moq) + ' units</b> <span class="faint">' + money(m.cost) + '</span></div>' +
    '<div class="small">Arrives in <b>' + m.arrive + 'd</b> <span class="faint">(' + dNice(m.arriveDate) + ')</span></div>' +
    '<div class="small">Lasts ' + (m.lasts == null ? '<span class="faint">— no sales</span>' : '<b' + (m.slow ? ' style="color:var(--soon)"' : '') + '>' + num(m.lasts) + 'd</b>' + (m.slow ? ' <span class="tag down">Slow to use</span>' : '')) + '</div></td>';
}
/* Inventory sync selection: products can be left out of Shopify syncs and inventory imports. */
function syncCell(p) { return '<td><label class="check" title="' + (p.noSync ? 'Excluded: on hand changes only here' : 'Synced: on hand comes from Shopify and inventory imports') + '"><input type="checkbox" data-f="psync|' + esc(p.sku) + '|"' + (p.noSync ? '' : ' checked') + (Store.canWrite ? '' : ' disabled') + ' aria-label="Sync inventory for ' + esc(p.name) + '"></label></td>'; }
function syncBar(list) {
  var off = list.filter(function (a) { return a.p.noSync; }).length, on = list.length - off, can = Store.canWrite && list.length && !UI.syncBusy;
  return '<div class="bulkbar" role="region" aria-label="Inventory sync"><b>Inventory sync</b><span class="small">' + num(on) + ' of ' + num(list.length) + ' shown ' + (on === 1 ? 'is' : 'are') + ' synced' + (off ? ', ' + num(off) + ' excluded' : '') + '</span>' +
    (Store.canWrite ? '<span class="row" style="gap:6px;margin-left:auto"><button class="btn sm" data-act="sync-shown|1"' + (can && off ? '' : ' disabled') + '>Include all shown</button><button class="btn sm" data-act="sync-shown|0"' + (can && on ? '' : ' disabled') + '>Exclude all shown</button></span>' : '') +
    '<span class="small faint" style="flex-basis:100%">Search or pick a collection to choose products by name, SKU or collection, then include or exclude them. Excluded products keep their own on-hand count: Shopify syncs and inventory imports skip them, while counts, receipts and sales still update them.</span></div>';
}
async function setSync(skus, on) {
  if (!skus.length) return;
  if (Store.mode !== 'db') { toast('The server isn\'t reachable, so changes can\'t be saved.'); return; }
  UI.syncBusy = true; render();
  try {
    var r = await API.req('POST', '/api/products-sync', { skus: skus, sync: on });
    UI.syncBusy = false; await loadWorkspace();
    toast(r.changed ? r.changed + ' product' + (r.changed === 1 ? '' : 's') + (on ? ' included in' : ' excluded from') + ' inventory sync' : 'Nothing to change');
  } catch (e) { UI.syncBusy = false; render(); toast(e.message); }
}
function pageInventory() {
  var list = sortRows(filtered()), showMoq = !!settings().showMoqTiming;
  var tot = { on: 0, com: 0, av: 0, inc: 0, val: 0 }; list.forEach(function (a) { tot.on += a.onHand; tot.com += a.committed; tot.av += a.available; tot.inc += a.incoming; tot.val += a.onHand * a.cost; });
  return '<div class="ph"><div><h1>Inventory</h1><div class="sub">' + list.length + ' of ' + AL.length + ' SKUs · ' + (ALL.length > AL.length ? num(ALL.length - AL.length) + ' not tracked · ' : '') + num(tot.on) + ' units on hand · ' + money(tot.val) + ' at cost</div></div>' +
    '<div class="actions"><label class="check small"><input type="checkbox" data-f="moqtoggle||"' + (showMoq ? ' checked' : '') + '> Show MOQ timing</label>' + (Store.canWrite && !UI.counting ? '<button class="btn" data-act="count-start">Update stock</button>' : '') + stockSendButton() + '</div></div>' + countBar() +
    (showMoq ? '<p class="small muted" style="margin:0">MOQ timing: for an order of exactly the minimum quantity, <b>arrives in</b> is the product\'s lead time and <b>lasts</b> is how long those units cover at the current sales rate. Products that take more than ' + num(+(settings().moqSlowDays || 120)) + ' days to use their MOQ are marked slow to use.</p>' : '') +
    filterBar(true) + syncBar(list) +
    '<section class="card"><div class="bd flush tw"><table class="t"><thead><tr>' + th('Product', 'name') + th('Status', 'status') + '<th title="Shopify syncs and inventory imports update on hand only for synced products">Sync</th>' + th('On hand', 'onHand', 1) + '<th class="r">Committed</th>' + th('Available', 'available', 1) + (showMoq ? th('MOQ timing', 'moqlasts') : '') + th('Incoming', 'incoming', 1) + th('Sales/day', 'base', 1) + th('Days of cover', 'cover', 1) + th('Reorder pt.', 'rop', 1) + th('Stockout', 'stock') + th('Order by', 'order') + th('Value', 'value', 1) + '<th></th></tr></thead><tbody>' +
    (list.length ? list.map(function (a) {
      return '<tr class="click sev ' + a.status + '" data-act="open-product|' + a.sku + '"><td>' + pname(a) + '</td><td>' + pill(a.status) + '</td>' + syncCell(a.p) + '<td class="r">' + (UI.counting ? countCell(a) : num(a.onHand)) + '</td><td class="r">' + num(a.committed) + '</td><td class="r"><b>' + num(a.available) + '</b></td>' + (showMoq ? moqCells(a) : '') + '<td class="r">' + (a.incoming ? num(a.incoming) : '<span class="faint">—</span>') + '</td><td class="r">' + rate(a.base) + '</td><td class="r">' + (a.daysCover === Infinity ? '∞' : num(a.daysCover)) + '</td><td class="r">' + num(a.ROP) + '</td><td>' + stockCell(a) + '</td><td>' + orderByCell(a) + '</td><td class="r">' + money(a.onHand * a.cost) + '</td><td><button class="btn ghost sm" data-act="prod-edit|' + esc(a.sku) + '"' + (Store.canWrite ? '' : ' disabled') + '>Edit</button></td></tr>';
    }).join('') : '<tr><td colspan="' + (showMoq ? 15 : 14) + '"><div class="empty"><b>No matching products</b>Clear a filter to see more.</div></td></tr>') +
    '</tbody><tfoot><tr><td colspan="3"><b>Total</b></td><td class="r"><b>' + num(tot.on) + '</b></td><td class="r">' + num(tot.com) + '</td><td class="r"><b>' + num(tot.av) + '</b></td>' + (showMoq ? '<td></td>' : '') + '<td class="r">' + num(tot.inc) + '</td><td colspan="5"></td><td class="r"><b>' + money(tot.val) + '</b></td><td></td></tr></tfoot></table></div></section>';
}

/* ---------- Products (catalog editor) ---------- */
// Products and Edit all products share one main tab; these sub-tabs switch between them.
function productTabs(cur) {
  return '<div class="tabs" role="tablist" aria-label="Products">' + [['products', 'Ordering settings'], ['edit', 'Edit all products']].map(function (t) { return '<button role="tab" aria-selected="' + (cur === t[0]) + '" data-act="nav|' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
}
function pageProducts() {
  var every = sortRows(filtered(true));
  var hidden = every.filter(function (a) { return a.p.status === 'discontinued' || a.p.status === 'untracked'; }).length;
  var list = UI.showInactive ? every : every.filter(function (a) { return a.p.status !== 'discontinued' && a.p.status !== 'untracked'; });
  var dis = Store.canWrite ? '' : ' disabled';
  return '<div class="ph"><div><h1>Products</h1><div class="sub">Supplier, lead time and ordering rules per SKU. Edits apply immediately to every forecast. Blank lead times use the supplier\'s default.</div></div><div class="actions">' + sheetButtons() + '<button class="btn primary" data-act="np-open"' + dis + '>Add product</button></div></div>' +
    productTabs('products') + filterBar(false) + (hidden || UI.showInactive ? '<label class="check small"><input type="checkbox" data-f="showinactive||"' + (UI.showInactive ? ' checked' : '') + '> Show discontinued and not tracked products (' + hidden + ')</label>' : '') + bulkBar(list) +
    '<section class="card"><div class="bd flush tw"><table class="t"><thead><tr>' + selAllCell(list) + th('Product', 'name') + '<th>Supplier</th><th>Supplier SKU</th><th class="r">Prod. lead</th><th class="r">Transit</th><th class="r">Total</th><th class="r">MOQ</th><th class="r">Case</th><th class="r">Unit cost</th><th class="r">Retail (DTC)</th><th class="r">Stylist</th><th>Status</th><th></th></tr></thead><tbody>' +
    list.map(function (a) {
      var p = a.p, sp = sup(p.supplierId);
      function n(k, ph) { return '<input type="number" min="0" style="width:68px" data-f="p|' + esc(p.sku) + '|' + k + '" value="' + (p[k] == null ? '' : esc(p[k])) + '" placeholder="' + (ph == null ? '' : ph) + '"' + dis + ' aria-label="' + k + '">'; }
      return '<tr' + (bulkSel()[p.sku] ? ' class="selrow"' : '') + '>' + selCell(p) + '<td>' + pname(a) + '</td><td><select data-f="p|' + esc(p.sku) + '|supplierId"' + dis + ' aria-label="Supplier"><option value="">—</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (p.supplierId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></td>' +
        '<td><input type="text" style="width:130px" data-f="p|' + esc(p.sku) + '|supplierSku" value="' + esc(p.supplierSku || '') + '"' + dis + ' aria-label="Supplier SKU"></td>' +
        '<td class="r">' + n('prodLead', sp ? sp.prodLead : '') + '</td><td class="r">' + n('transit', sp ? sp.shipLead : '') + '</td><td class="r"><b>' + a.L + 'd</b></td><td class="r">' + n('moq', sp ? sp.moq : '') + '</td><td class="r">' + n('casePack') + '</td><td class="r">' + n('cost') + '</td><td class="r">' + n('price') + '</td><td class="r">' + n('stylistPrice') + '</td>' +
        '<td><select data-f="p|' + esc(p.sku) + '|status"' + dis + ' aria-label="Product status">' + statusOptions(p.status) + '</select></td>' +
        '<td><span class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn ghost sm" data-act="prod-edit|' + esc(p.sku) + '"' + dis + '>Edit</button><button class="btn ghost sm" data-act="open-product|' + esc(p.sku) + '">Open</button></span></td></tr>';
    }).join('') + '</tbody></table></div></section>';
}

/* ---------- Product detail ---------- */
function pageProduct() {
  var a = A[UI.sku]; if (!a) return '<div class="empty"><b>Product not found</b><button class="btn" data-act="nav|inventory">Back to inventory</button></div>';
  var p = a.p, sp = sup(p.supplierId), ov = p.overrides || {}, dis = Store.canWrite ? '' : ' disabled';
  var hasOv = Object.keys(ov).some(function (k) { return ov[k] != null && ov[k] !== ''; });
  var headline = a.status === 'untracked' ? 'Not tracked in inventory' : a.status === 'disc' ? 'Discontinued: no reorder' : a.status === 'oos' && !a.orderNow ? 'Out of stock · already on ' + a.onOrder.join(', ') : a.qty > 0 && (a.status === 'now' || a.status === 'oos') ? 'Order ' + num(a.qty) + ' units today' : a.qty > 0 && a.status === 'soon' ? 'Order ' + num(a.qty) + ' units by ' + dNice(a.orderDate) : a.orderT != null ? 'No order yet · next order ~' + dNice(a.orderDate) : 'No order needed';
  var hist = E.history(p, WS.meta.asOf, 364).reverse();
  var weeks = [], wl = [], woos = [];
  for (var i = 0; i < hist.length; i += 7) { var s = 0, o = 0; hist.slice(i, i + 7).forEach(function (h) { s += h.u; if (h.oos) o++; }); weeks.push(s); wl.push(dNice(hist[i].date)); woos.push(o); }
  var bands = []; woos.forEach(function (o, i) { if (o >= 3) bands.push({ from: Math.max(0, i - .5), to: Math.min(weeks.length - 1, i + .5), color: '--now', op: .1 }); });
  var txs = WS.txns.filter(function (t) { return t.sku === p.sku; }).slice(0, 12);
  var pos = WS.pos.filter(function (x) { return x.lines.some(function (l) { return l.sku === p.sku; }); });
  function ovField(k, label, type, auto, help) {
    var v = ov[k]; var set = v != null && v !== '';
    return '<label class="field"><span>' + label + (set ? ' <span class="tag manual">Manual</span>' : '') + '</span><div class="row" style="gap:6px;flex-wrap:nowrap"><input type="' + type + '" ' + (type === 'number' ? 'step="any" min="0"' : '') + ' style="width:100%" data-f="ov|' + esc(p.sku) + '|' + k + '" value="' + (set ? esc(v) : '') + '" placeholder="' + esc(auto) + '"' + dis + '>' + (set ? '<button class="btn ghost sm" data-act="ov-reset|' + k + '" title="Return to automatic">Reset</button>' : '') + '</div><small>' + help + '</small></label>';
  }
  return '<div class="ph"><div><div class="row small"><button class="btn ghost sm" data-act="nav|inventory">← Inventory</button><span class="faint">' + esc(p.collection) + '</span></div><h1>' + esc(p.name) + '</h1><div class="sub">' + esc(p.sku) + ' · ' + esc(p.variant || '') + ' · ' + esc(supName(p.supplierId)) + '</div><div class="row" style="margin-top:8px">' + pill(a.status) + trendTag(a) + (hasOv ? '<span class="tag manual">Manual overrides on</span>' : '') + '</div></div>' +
    '<div class="actions">' + (Store.canWrite ? (UI.prodDel ? '<span class="row"><span class="small" style="color:var(--now)">Delete this product and its history?</span><button class="btn sm" data-act="prod-del-no">Keep</button><button class="btn sm primary" data-act="prod-del-yes|' + esc(p.sku) + '">Delete</button></span>' : '<button class="btn ghost danger" data-act="prod-del">Delete</button>') : '') + '<button class="btn" data-act="open-forecast|' + esc(p.sku) + '">Forecast</button><button class="btn" data-act="prod-edit|' + esc(p.sku) + '"' + dis + '>Edit product</button><button class="btn" data-act="np-open|' + esc(p.sku) + '"' + dis + '>Add variant</button><button class="btn" data-act="inv-adjust|' + esc(p.sku) + '"' + dis + '>Adjust stock</button>' + (a.qty > 0 && a.status !== 'disc' ? '<button class="btn primary" data-act="po-from|' + esc(p.sku) + '"' + dis + '>Create PO for ' + num(a.qty) + '</button>' : '') + '</div></div>' +

    '<section class="banner ' + a.status + '"><div><div class="rt">Recommendation</div><div class="rh">' + headline + '</div><p>' + esc(a.summary) + '</p>' + (a.qtyWhy ? '<p class="small" style="margin-top:6px"><b>Quantity:</b> ' + esc(a.qtyWhy) + '</p>' : '') + (a.atRisk ? '<p class="small" style="margin-top:6px;color:var(--now)"><b>Stockout gap:</b> projected to run out ' + dNice(a.stockDate) + ', ' + a.lateGap + ' days before any new order could arrive (~' + num(a.lateUnits) + ' units of missed sales).' + (a.incoming ? ' Ask ' + esc(supName(p.supplierId)) + ' to expedite ' + a.incomingLines[0].po + '.' : '') + '</p>' : '') + '</div>' +
    '<div class="stats" style="grid-template-columns:repeat(2,minmax(110px,1fr))"><div class="stat"><span>Order by</span><b>' + (a.orderT == null ? '—' : a.orderT <= 0 ? 'Today' : dNice(a.orderDate, true)) + (a.orderOverridden ? ' <span class="tag manual">Manual</span>' : '') + '</b></div><div class="stat"><span>Projected stockout</span><b>' + (a.stockT == null ? 'Not projected' : dNice(a.stockDate, true)) + '</b></div><div class="stat"><span>Arrives if ordered then</span><b>' + dNice(a.arriveDate) + '</b></div><div class="stat"><span>Order cost</span><b>' + money(a.qty * a.cost) + '</b></div></div></section>' +

    '<div class="grid2e">' +
    productImageCard(p) +
    '<section class="card"><div class="hd"><h2>Product information</h2></div><div class="bd"><dl class="dl"><dt>SKU</dt><dd>' + esc(p.sku) + '</dd><dt>Shopify variant</dt><dd class="small">' + esc(p.shopifyId || '—') + '</dd><dt>Supplier</dt><dd>' + (sp ? '<button class="btn ghost sm" style="padding:0" data-act="sup-open|' + sp.id + '">' + esc(sp.name) + '</button>' : '—') + '</dd><dt>Supplier SKU</dt><dd>' + esc(p.supplierSku || '—') + '</dd><dt>Lead time</dt><dd>' + a.L + ' days (' + a.prodLead + ' production + ' + a.transit + ' transit)</dd><dt>MOQ · case</dt><dd>' + (a.moq || '—') + ' · ' + (a.pack || 1) + '</dd>' + (function () { var m = moqInfo(a); return m.moq ? '<dt>MOQ timing</dt><dd>Arrives ' + m.arrive + ' days after ordering; ' + (m.lasts == null ? 'no recent sales to measure how long it lasts' : 'lasts about ' + num(m.lasts) + ' days at ' + rate(a.base) + '/day' + (m.slow ? ' <span class="tag down">Slow to use</span>' : '')) + '</dd>' : ''; })() + '<dt>Unit cost</dt><dd>' + money(a.cost, 2) + '</dd><dt>Retail (DTC)</dt><dd>' + money(a.price, 2) + ' <span class="small faint">' + (a.price ? Math.round((1 - a.cost / a.price) * 100) : 0) + '% margin</span></dd><dt>Stylist price</dt><dd>' + (p.stylistPrice != null && p.stylistPrice !== '' ? money(+p.stylistPrice, 2) + ' <span class="small faint">' + (+p.stylistPrice ? Math.round((1 - a.cost / p.stylistPrice) * 100) : 0) + '% margin</span>' : '<span class="faint">Not set</span>') + '</dd>' + (p.locations ? '<dt>Locations</dt><dd>' + Object.keys(p.locations).map(function (k) { return esc(k) + ': ' + p.locations[k]; }).join(', ') + '</dd>' : '') + '</dl></div></section>' +
    '<section class="card"><div class="hd"><h2>Inventory</h2></div><div class="bd"><div class="stats"><div class="stat"><span>On hand</span><b>' + num(a.onHand) + '</b></div><div class="stat"><span>Committed</span><b>' + num(a.committed) + '</b><em>unfulfilled orders</em></div><div class="stat"><span>Available</span><b>' + num(a.available) + '</b></div><div class="stat"><span>Incoming</span><b>' + num(a.incoming) + '</b><em>' + (a.incomingLines.map(function (l) { return l.po + ' ' + dNice(l.due); }).join(', ') || 'none') + '</em></div><div class="stat"><span>Days of cover</span><b>' + (a.daysCover === Infinity ? '∞' : num(a.daysCover)) + '</b></div><div class="stat"><span>Value at cost</span><b>' + money(a.onHand * a.cost) + '</b></div></div></div></section>' +
    '<section class="card"><div class="hd"><h2>Sales</h2><span class="small faint">in-stock days only for averages</span></div><div class="bd"><div class="stats">' +
    [['7-day', a.w.d7], ['30-day', a.w.d30], ['60-day', a.w.d60], ['90-day', a.w.d90], ['12-month', a.w.d365]].map(function (x) { return '<div class="stat"><span>' + x[0] + ' sales</span><b>' + num(x[1].sold) + '</b><em>' + (x[1].rate == null ? 'too few in-stock days' : rate(x[1].rate) + '/day') + (x[1].oosDays ? ' · ' + x[1].oosDays + 'd out' : '') + '</em></div>'; }).join('') +
    '<div class="stat"><span>Per week · month</span><b>' + rate(a.base * 7) + ' · ' + num(a.base * 30) + '</b><em>at forecast rate</em></div></div></div></section>' +
    '<section class="card"><div class="hd"><h2>Forecast</h2></div><div class="bd"><div class="stats"><div class="stat"><span>Daily velocity</span><b>' + rate(a.base) + '</b><em>' + (ov.velocity != null && ov.velocity !== '' ? 'manual' : 'forecast') + '</em></div><div class="stat"><span>Lead-time demand</span><b>' + num(a.DL) + '</b><em>' + a.L + ' days</em></div><div class="stat"><span>Safety stock</span><b>' + num(a.SS) + '</b><em>' + esc(a.ssDesc) + '</em></div><div class="stat"><span>Reorder point</span><b>' + num(a.ROP) + '</b></div><div class="stat"><span>Projected stockout</span><b>' + (a.stockT == null ? '—' : dNice(a.stockDate)) + '</b></div><div class="stat"><span>Recommended qty</span><b>' + num(a.qty) + '</b></div></div>' +
    '<details class="why"><summary>How this was calculated</summary>' + reasonsDl(a) + '</details></div></section></div>' +

    '<section class="card"><div class="hd"><h2>Weekly sales, last 12 months</h2><div class="legend"><span><i style="background:var(--chart-1)"></i>Units sold</span><span><i style="background:var(--now);opacity:.3"></i>Out of stock</span></div></div><div class="bd">' +
    chart({ labels: wl, series: [{ values: weeks, color: '--chart-1', area: true }], bands: bands, h: 200, label: 'Weekly unit sales', tip: function (i) { return 'Week of ' + wl[i] + ': <b>' + weeks[i] + '</b> units' + (woos[i] ? ' · ' + woos[i] + 'd out of stock' : ''); } }) +
    (a.outlierDays.length ? '<p class="small muted" style="margin:8px 0 0">Capped as unusual: ' + a.outlierDays.slice(0, 3).map(function (o) { return dNice(o.date) + ' (' + o.units + ' units, counted as ' + o.capped + ')'; }).join(', ') + '.</p>' : '') + '</div></section>' +

    '<div class="grid2e"><section class="card"><div class="hd"><div><h2>Manual overrides</h2><div class="small muted">Leave blank to use the automatic value shown.</div></div></div><div class="bd"><div class="fields">' +
    ovField('velocity', 'Sales forecast (units/day)', 'number', rate(a.rawBase), 'Replaces trend and seasonality') +
    ovField('lead', 'Total lead time (days)', 'number', a.prodLead + a.transit, 'Production + transit') +
    ovField('safety', 'Safety stock (units)', 'number', num(a.SS), a.ssDesc) +
    ovField('qty', 'Order quantity', 'number', a.rawQty ? num(a.qty) : '0', 'Used as is: skips MOQ and rounding') +
    ovField('orderDate', 'Reorder date', 'date', a.orderDate || '', 'Fixes the order-by date') +
    '<label class="field"><span>Forecast period' + (ov.period ? ' <span class="tag manual">Manual</span>' : '') + '</span><select data-f="ov|' + esc(p.sku) + '|period"' + dis + '>' + periodOpts(ov.period, true) + '</select><small>Which sales window drives the rate</small></label>' +
    '</div></div></section>' +
    '<section class="card"><div class="hd"><div><h2>Ordering rules</h2><div class="small muted">Product settings that override global defaults.</div></div></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Safety stock method</span><select data-f="p|' + esc(p.sku) + '|ssMethod"' + dis + '><option value="">Global default</option>' + [['days', 'Days of sales'], ['units', 'Fixed units'], ['pct', '% of lead-time demand']].map(function (o) { return '<option value="' + o[0] + '"' + (p.ssMethod === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
    pField(p, 'ssDays', 'Safety stock days', settings().ssDays) + pField(p, 'ssUnits', 'Safety stock units', settings().ssUnits) + pField(p, 'ssPct', 'Safety stock %', settings().ssPct) +
    pField(p, 'coverDays', 'Days to cover after arrival', settings().coverDays) + pField(p, 'targetLevel', 'Target inventory level', 'auto') +
    '</div>' +
    '<h3 style="margin:18px 0 8px">Planned promotions</h3>' + ((p.promos || []).length ? '<table class="t"><tbody>' + p.promos.map(function (pr, i) { return '<tr><td>' + esc(pr.label || 'Promotion') + '</td><td>' + dNice(pr.start) + ' – ' + dNice(pr.end) + '</td><td class="r">+' + pr.lift + '%</td><td><button class="btn ghost sm" data-act="promo-del|' + i + '"' + dis + '>Remove</button></td></tr>'; }).join('') + '</tbody></table>' : '<p class="small muted" style="margin:0">None. Promotions raise the forecast for their dates.</p>') +
    '<div class="row" style="margin-top:10px"><input type="text" id="pr-label" placeholder="Label" style="width:120px"' + dis + '><input type="date" id="pr-start"' + dis + '><input type="date" id="pr-end"' + dis + '><input type="number" id="pr-lift" placeholder="Lift %" style="width:80px"' + dis + '><button class="btn sm" data-act="promo-add"' + dis + '>Add</button></div>' +
    '</div></section></div>' +

    '<div class="grid2e"><section class="card"><div class="hd"><h2>Purchase orders</h2></div><div class="bd flush">' + (pos.length ? '<table class="t"><tbody>' + pos.map(function (x) { var l = x.lines.filter(function (l) { return l.sku === p.sku; })[0]; return '<tr class="click" data-act="po-open|' + x.id + '"><td><b>' + x.id + '</b><div class="small faint">' + dNice(x.created, true) + '</div></td><td>' + poPill(x.status) + '</td><td class="r">' + num(l.qty) + ' ordered<div class="small faint">' + num(l.received || 0) + ' received</div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No purchase orders yet.</div>') + '</div></section>' +
    productLedgerCard(p) + '</div>';
}
function pField(p, k, label, ph) { var dis = Store.canWrite ? '' : ' disabled'; return '<label class="field"><span>' + label + '</span><input type="number" min="0" data-f="p|' + esc(p.sku) + '|' + k + '" value="' + (p[k] == null ? '' : esc(p[k])) + '" placeholder="' + esc(ph) + '"' + dis + '></label>'; }
function periodOpts(v, allowDefault) {
  return (allowDefault ? '<option value="">Global default</option>' : '') + [['smart', 'Smart blend (recommended)'], ['7', '7-day average'], ['30', '30-day average'], ['60', '60-day average'], ['90', '90-day average'], ['365', '12-month average']].map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
}

function productImageCard(p) {
  var can = Store.canWrite;
  return '<section class="card"><div class="bd prodimg">' +
    (p.image ? '<img src="' + esc(mediaUrl('/uploads/' + p.image)) + '" alt="' + esc(p.name) + '">' : '<div class="noimg">No photo yet</div>') +
    '<div style="display:flex;flex-direction:column;gap:8px;min-width:0"><h2>Photo</h2><p class="small muted" style="margin:0">Shown next to this product throughout Addendum-Stockline, so the team can tell shades apart at a glance. PNG, JPG, WebP or GIF.</p>' +
    (can ? '<div class="row"><label class="btn sm">' + (p.image ? 'Replace photo' : 'Upload photo') + '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img="product|' + esc(p.sku) + '" hidden></label>' + (p.image ? '<button class="btn ghost sm danger" data-act="img-remove|' + esc(p.sku) + '">Remove</button>' : '') + '</div>' : '') +
    '</div></div></section>';
}
