/* ---------- Salon usage: items pulled from stock for salon services ---------- */
var SAL_STATUS = { tracked: ['disc', 'Tracked'], local: ['watch', 'Subtracted from stock'], applied: ['watch', 'Subtracted from stock'] };
var SERVICES = ['Weft install', 'K-Tip install', 'Tape-in install', 'Tape-in move-up', 'Clip-in fitting', 'Color match', 'Other'];
function salForm() {
  if (!UI.salon) UI.salon = { date: todayISO(), stylist: '', service: '', client: '', note: '', demand: true, lines: [{ sku: '', qty: 1 }], range: '30', who: '' };
  return UI.salon;
}
function salGroups() {
  var g = {}, order = [];
  (WS.salon || []).forEach(function (e) { if (!g[e.group]) { g[e.group] = { group: e.group, date: e.date, stylist: e.stylist, service: e.service, client: e.clientRef, note: e.note, status: e.status, error: e.error, demand: e.countsDemand, by: e.createdBy, items: [] }; order.push(e.group); } g[e.group].items.push(e); });
  return order.map(function (k) { return g[k]; });
}
function pageSalon() {
  var f = salForm(), can = Store.canWrite, dis = can ? '' : ' disabled';
  var groups = salGroups(), asOf = WS.meta.asOf;
  var since = f.range === 'all' ? '0000' : E.addDays(todayISO(), -(+f.range));
  var shown = groups.filter(function (g) { return g.date >= since && (!f.who || g.stylist === f.who); });
  // last 30 days summary
  var d30 = E.addDays(todayISO(), -30), u30 = 0, c30 = 0, bySku = {};
  (WS.salon || []).forEach(function (e) { if (e.date >= d30) { u30 += e.qty; var p = prod(e.sku); c30 += e.qty * (p ? +p.cost || 0 : 0); bySku[e.sku] = (bySku[e.sku] || 0) + e.qty; } });
  var top = Object.keys(bySku).sort(function (a, b) { return bySku[b] - bySku[a]; })[0];
  var total30 = 0; AL.forEach(function (a) { total30 += a.w.d30.sold; }); // sales history already includes salon use
  var stylists = {}; (WS.salon || []).forEach(function (e) { if (e.stylist) stylists[e.stylist] = 1; });
  var deduct = !!settings().salonDeduct;
  var products = WS.products.slice().sort(function (a, b) { return (a.collection + a.name).localeCompare(b.collection + b.name); });

  return '<div class="ph"><div><h1>Salon usage</h1><div class="sub">Track the extensions the salon uses for services. Usage counts toward demand so reorders cover it. Shopify is never changed.</div></div></div>' +
    '<div class="grid2"><section class="card"><div class="hd"><div><h2>Log items used</h2><div class="small muted">' + (deduct ? 'Also subtracted from Addendum-Stockline\'s stock counts. Shopify is unchanged.' : 'Tracked only. Stock counts and Shopify stay as they are.') + '</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:14px">' +
    '<div class="fields"><label class="field"><span>Date used</span><input type="date" id="sal-date" data-f="sal||date" value="' + esc(f.date) + '" max="' + E.addDays(todayISO(), 1) + '"' + dis + '></label>' +
    '<label class="field"><span>Stylist</span><input type="text" id="sal-stylist" list="sal-stylists" data-f="sal||stylist" value="' + esc(f.stylist) + '" placeholder="Who used it"' + dis + '><datalist id="sal-stylists">' + Object.keys(stylists).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></label>' +
    '<label class="field"><span>Service</span><input type="text" id="sal-service" list="sal-services" data-f="sal||service" value="' + esc(f.service) + '" placeholder="e.g. Weft install"' + dis + '><datalist id="sal-services">' + SERVICES.map(function (n) { return '<option value="' + n + '">'; }).join('') + '</datalist></label>' +
    '<label class="field"><span>Client or ticket <span class="faint">(optional)</span></span><input type="text" id="sal-client" data-f="sal||client" value="' + esc(f.client) + '"' + dis + '></label></div>' +
    '<div><div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Items</div><div style="display:flex;flex-direction:column;gap:8px">' +
    f.lines.map(function (l, i) {
      var a = A[l.sku];
      return '<div class="row" style="flex-wrap:nowrap;align-items:flex-start">' + skuPicker({ id: 'sal-sku-' + i, f: 'sall|' + i + '|sku', value: l.sku, dis: dis, style: 'flex:1;min-width:0' }) +
        '<input type="number" class="qty" min="1" step="1" id="sal-qty-' + i + '" data-f="sall|' + i + '|qty" value="' + esc(l.qty) + '" aria-label="Quantity"' + dis + '>' +
        (f.lines.length > 1 ? '<button class="btn ghost sm" data-act="sal-line-del|' + i + '" aria-label="Remove item">✕</button>' : '') + '</div>' +
        (a && l.qty > a.available ? '<div class="small" style="color:var(--now)">Only ' + num(a.available) + ' available</div>' : '');
    }).join('') + '</div><button class="btn ghost sm" style="margin-top:6px" data-act="sal-line-add"' + dis + '>+ Add another item</button></div>' +
    '<label class="field"><span>Note <span class="faint">(optional)</span></span><input type="text" id="sal-note" data-f="sal||note" value="' + esc(f.note) + '"' + dis + '></label>' +
    '<label class="check"><input type="checkbox" data-f="sal||demand"' + (f.demand ? ' checked' : '') + dis + '> Count toward demand <span class="small faint">(untick for one-offs like a damaged pack or a model shoot)</span></label>' +
    '<div class="row"><button class="btn primary" data-act="sal-log"' + (can && !UI.salBusy ? '' : ' disabled') + '>' + (UI.salBusy ? 'Saving…' : 'Log usage') + '</button>' + (can ? '' : '<span class="small muted">Viewers can\'t log usage.</span>') + '</div>' +
    '</div></section>' +

    '<div class="stack"><section class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
    kpi('Units used, 30 days', num(u30), Object.keys(bySku).length + ' products') + kpi('Value at cost', money(c30), 'last 30 days') +
    kpi('Share of demand', total30 ? pct(u30 / total30) : '—', 'of all units used or sold, 30 days') + kpi('Most used', top ? esc((prod(top) || {}).name || top) : '—', top ? num(bySku[top]) + ' units' : '') + '</section>' +
    '<section class="card"><div class="hd"><h2>What tracking does</h2></div><div class="bd small" style="display:flex;flex-direction:column;gap:8px">' +
    '<p style="margin:0">Every entry is kept in the log below, by date, stylist and service.</p>' +
    '<p style="margin:0">Units count toward that day\'s demand, so the sales rate, reorder point and order quantities include salon use.</p>' +
    '<p style="margin:0">Shopify\'s inventory is never changed. ' + (deduct ? 'Addendum-Stockline also subtracts new entries from its own stock counts (turned on in Settings).' : 'Addendum-Stockline\'s stock counts stay as they are; an admin can turn on subtracting in Settings → Stores & sync.') + '</p>' +
    '<p style="margin:0">Logged something by mistake? Use <b>Undo</b>.</p></div></section></div></div>' +

    '<section class="card"><div class="hd"><div><h2>Usage log</h2><div class="small muted">' + shown.length + ' entr' + (shown.length === 1 ? 'y' : 'ies') + ' · ' + num(shown.reduce(function (s, g) { return s + g.items.reduce(function (t, e) { return t + e.qty; }, 0); }, 0)) + ' units</div></div>' +
    '<div class="row"><select data-f="sal||who" aria-label="Stylist"><option value="">All stylists</option>' + Object.keys(stylists).sort().map(function (n) { return '<option' + (f.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
    '<div class="seg" role="group" aria-label="Period">' + [['30', '30 days'], ['90', '90 days'], ['all', 'All']].map(function (o) { return '<button aria-pressed="' + (f.range === o[0]) + '" data-act="sal-range|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>' +
    '<div class="bd flush tw"><table class="t"><thead><tr><th>Date</th><th>Stylist</th><th>Service</th><th>Items</th><th class="r">Units</th><th>Status</th><th></th></tr></thead><tbody>' +
    (shown.length ? shown.map(function (g) {
      var st = SAL_STATUS[g.status] || ['disc', g.status], units = g.items.reduce(function (t, e) { return t + e.qty; }, 0);
      return '<tr><td>' + dNice(g.date, true) + '</td><td>' + esc(g.stylist || '—') + '</td><td class="wrap">' + esc(g.service || '—') + (g.client ? '<div class="small faint">' + esc(g.client) + '</div>' : '') + (g.note ? '<div class="small faint">' + esc(g.note) + '</div>' : '') + '</td>' +
        '<td class="wrap">' + g.items.map(function (e) { var p = prod(e.sku); return '<div><button class="btn ghost sm" style="padding:0" data-act="open-product|' + esc(e.sku) + '">' + esc(p ? p.name : e.sku) + '</button> × ' + num(e.qty) + '</div>'; }).join('') + (g.demand ? '' : '<div class="small faint">Not counted as demand</div>') + '</td>' +
        '<td class="r"><b>' + num(units) + '</b></td><td><span class="pill ' + st[0] + '" title="' + esc(g.error || '') + '">' + st[1] + '</span></td>' +
        '<td>' + (can ? (UI.salUndo === g.group ? '<span class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="sal-undo-no">Keep</button><button class="btn sm primary" data-act="sal-undo-yes|' + g.group + '">Undo</button></span>' : '<button class="btn ghost sm" data-act="sal-undo|' + g.group + '">Undo</button>') : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>Nothing logged' + (f.range === 'all' ? '' : ' in this period') + '</b>Use the form above whenever the salon takes product from stock.</div></td></tr>') +
    '</tbody></table></div></section>';
}

Object.assign(ACTIONS, {
  'sal-line-add': function () { salForm().lines.push({ sku: '', qty: 1 }); render(); var i = document.getElementById('sal-sku-' + (salForm().lines.length - 1)); if (i) i.focus(); },
  'sal-line-del': function (i) { salForm().lines.splice(+i, 1); render(); },
  'sal-range': function (r) { salForm().range = r; render(); },
  'sal-log': async function () {
    var f = salForm();
    // pick up anything typed but not yet committed by a change event
    ['date', 'stylist', 'service', 'client', 'note'].forEach(function (k) { var el = document.getElementById('sal-' + k); if (el) f[k] = el.value; });
    f.lines.forEach(function (l, i) { var q = document.getElementById('sal-qty-' + i); if (q) l.qty = +q.value; });
    var lines = f.lines.filter(function (l) { return l.sku; });
    if (!lines.length) { toast('Choose at least one product.'); return; }
    if (lines.some(function (l) { return !(l.qty > 0); })) { toast('Enter a quantity for each item.'); return; }
    if (Store.mode !== 'db') { toast('The server isn\'t reachable, so usage can\'t be saved.'); return; }
    UI.salBusy = true; render();
    try {
      var r = await API.req('POST', '/api/salon', { date: f.date, stylist: f.stylist, service: f.service, clientRef: f.client, note: f.note, countsDemand: f.demand, lines: lines });
      UI.salBusy = false;
      UI.salon = { date: f.date, stylist: f.stylist, service: '', client: '', note: '', demand: true, lines: [{ sku: '', qty: 1 }], range: f.range, who: f.who };
      await loadWorkspace();
      var units = lines.reduce(function (s, l) { return s + l.qty; }, 0);
      toast('Logged ' + units + ' unit' + (units === 1 ? '' : 's') + (r.status === 'tracked' ? '' : ' and subtracted from stock'));
    } catch (e) { UI.salBusy = false; render(); toast(e.message); }
  },
  'sal-undo': function (g) { UI.salUndo = g; render(); },
  'sal-undo-no': function () { UI.salUndo = null; render(); },
  'sal-undo-yes': async function (g) { UI.salUndo = null; try { await API.req('DELETE', '/api/salon/' + encodeURIComponent(g)); await loadWorkspace(); toast('Entry removed'); } catch (e) { toast(e.message); render(); } },
});
