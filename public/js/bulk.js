/* ---------- Editing many products and stock levels at once ---------- */

/* ===== Products: select rows, change one field on all of them ===== */
var BULK_FIELDS = [
  ['price', 'Retail (DTC) price', 'money'], ['stylistPrice', 'Stylist price', 'money'], ['cost', 'Unit cost', 'money'],
  ['supplierId', 'Supplier', 'supplier'], ['status', 'Status', 'status'], ['collection', 'Collection', 'text'],
  ['moq', 'MOQ', 'num'], ['casePack', 'Case size', 'num'], ['prodLead', 'Production lead (days)', 'num'], ['transit', 'Transit (days)', 'num']
];
var BULK_OPS = [['set', 'Set to'], ['pct_up', 'Raise by %'], ['pct_down', 'Lower by %'], ['amt_up', 'Raise by $'], ['amt_down', 'Lower by $']];
function bulkState() { if (!UI.bulk) UI.bulk = { sel: {}, field: 'price', op: 'set', value: '' }; return UI.bulk; }
function bulkSel() { return bulkState().sel; }
function selCount() { var s = bulkSel(); return Object.keys(s).filter(function (k) { return s[k] && prod(k); }).length; }
function selCell(p) { return Store.canWrite ? '<td class="selc"><input type="checkbox" data-f="psel|' + esc(p.sku) + '|"' + (bulkSel()[p.sku] ? ' checked' : '') + ' aria-label="Select ' + esc(p.name) + '"></td>' : ''; }
function selAllCell(list) {
  if (!Store.canWrite) return '';
  var all = list.length && list.every(function (a) { return bulkSel()[a.sku]; });
  return '<th class="selc"><input type="checkbox" data-f="pselall||"' + (all ? ' checked' : '') + ' aria-label="Select all shown"></th>';
}
function bulkFieldDef(k) { return BULK_FIELDS.filter(function (f) { return f[0] === k; })[0] || BULK_FIELDS[0]; }
function bulkBar(list) {
  if (!Store.canWrite) return '';
  var b = bulkState(), n = selCount(), def = bulkFieldDef(b.field), kind = def[2];
  if (!n) return '<p class="small muted" style="margin:0">Tick products to change several at once, or use <b>Download spreadsheet</b> to edit everything in Excel or Google Sheets and upload it back.</p>';
  var val;
  if (kind === 'supplier') val = '<select id="bk-value" aria-label="New supplier"><option value="">— None —</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (b.value === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>';
  else if (kind === 'status') val = '<select id="bk-value" aria-label="New status">' + statusOptions(b.value) + '</select>';
  else if (kind === 'text') val = '<input type="text" id="bk-value" list="bk-cols" value="' + esc(b.value) + '" placeholder="Collection name" aria-label="New collection"><datalist id="bk-cols">' + collections().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>';
  else val = '<input type="number" id="bk-value" min="0" step="any" value="' + esc(b.value) + '" style="width:110px" placeholder="' + (b.op.indexOf('pct') === 0 ? '%' : kind === 'money' ? '$' : 'Value') + '" aria-label="Value">';
  return '<div class="bulkbar" role="region" aria-label="Change selected products"><b>' + n + ' selected</b>' +
    '<span class="row" style="gap:6px">Change <select data-f="bk||field" aria-label="Field">' + BULK_FIELDS.map(function (f) { return '<option value="' + f[0] + '"' + (b.field === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>' +
    (kind === 'money' ? '<select data-f="bk||op" aria-label="How">' + BULK_OPS.map(function (o) { return '<option value="' + o[0] + '"' + (b.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' : '<span>to</span>') + val + '</span>' +
    '<span class="row" style="gap:6px;margin-left:auto"><button class="btn sm ghost" data-act="bk-clear">Clear selection</button><button class="btn sm primary" data-act="bk-apply"' + (UI.bkBusy ? ' disabled' : '') + '>' + (UI.bkBusy ? 'Saving…' : 'Apply to ' + n) + '</button></span></div>';
}

/* ===== Spreadsheet round trip ===== */
var SHEET_COLS = [
  ['sku', 'SKU'], ['name', 'Name'], ['collection', 'Collection'], ['variant', 'Shade / length'], ['status', 'Status'], ['supplier', 'Supplier'], ['supplierSku', 'Supplier SKU'],
  ['price', 'Retail price'], ['stylistPrice', 'Stylist price'], ['cost', 'Unit cost'], ['moq', 'MOQ'], ['casePack', 'Case size'], ['prodLead', 'Production lead days'], ['transit', 'Transit days'], ['onHand', 'On hand']
];
var SHEET_NUM = { price: 1, stylistPrice: 1, cost: 1, moq: 1, casePack: 1, prodLead: 1, transit: 1, onHand: 1 };
var STATUS_LABEL = {}; PRODUCT_STATUSES.forEach(function (o) { STATUS_LABEL[o[0]] = o[1]; });
function sheetButtons() {
  return '<button class="btn" data-act="sheet-download">Download spreadsheet</button>' +
    (Store.canWrite ? '<label class="btn">Upload changes<input type="file" accept=".csv,text/csv" data-bulkfile="1" hidden></label>' : '');
}
function sheetValue(p, k) {
  if (k === 'supplier') return (sup(p.supplierId) || {}).name || '';
  if (k === 'status') return STATUS_LABEL[p.status || 'active'] || p.status;
  var v = p[k]; return v == null ? '' : v;
}
// Compare a spreadsheet row with the saved product; only real differences are sent.
function sheetDiff(rows) {
  var out = [], errors = [], seen = {};
  rows.forEach(function (r, i) {
    var get = function (label) { return r[label] != null ? String(r[label]).trim() : undefined; };
    var sku = get('SKU') || get('Variant SKU') || get('sku'); if (!sku) return;
    if (seen[sku]) { errors.push('Row ' + (i + 2) + ': ' + sku + ' appears twice.'); return; } seen[sku] = 1;
    var p = prod(sku), changes = [], row = { sku: sku };
    SHEET_COLS.forEach(function (c) {
      if (c[0] === 'sku') return;
      var v = get(c[1]); if (v === undefined) return;
      if (SHEET_NUM[c[0]]) {
        v = v.replace(/[$,\s]/g, '');
        if (v !== '' && (isNaN(+v) || +v < 0)) { errors.push('Row ' + (i + 2) + ' (' + sku + '): ' + c[1] + ' "' + get(c[1]) + '" isn\'t a number of 0 or more.'); return; }
        if (c[0] === 'onHand' && v === '') return; // blank on hand = leave stock alone
      }
      var cur = p ? sheetValue(p, c[0]) : '';
      var same = SHEET_NUM[c[0]] ? (v === '' ? cur === '' || cur == null : cur !== '' && cur != null && Math.abs(+v - +cur) < 0.005) : String(cur).toLowerCase() === v.toLowerCase();
      if (p && same) return;
      if (!p && v === '') return;
      if (c[0] === 'supplier' && v && !WS.suppliers.some(function (s) { return s.name.toLowerCase() === v.toLowerCase() || s.id === v; })) { errors.push('Row ' + (i + 2) + ' (' + sku + '): supplier "' + v + '" isn\'t on the Suppliers page.'); return; }
      row[c[0]] = SHEET_NUM[c[0]] && v !== '' ? +v : v;
      changes.push({ label: c[1], from: p ? cur : '', to: v, key: c[0] });
    });
    if (!p && !row.name) { errors.push('Row ' + (i + 2) + ': ' + sku + ' is new, so it needs a name.'); return; }
    if (changes.length) out.push({ sku: sku, name: p ? p.name : row.name, isNew: !p, row: row, changes: changes });
  });
  return { items: out, errors: errors };
}
function sheetModal(m) {
  var d = m.diff, stockN = d.items.filter(function (it) { return it.changes.some(function (c) { return c.key === 'onHand'; }); }).length;
  var newN = d.items.filter(function (it) { return it.isNew; }).length;
  return '<div class="mh"><div><div class="eyebrow">Upload changes</div><h2>' + esc(m.file) + '</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') +
    (d.errors.length ? '<div class="note bad"><b>Fix these rows in the file and upload it again:</b><ul style="margin:6px 0 0;padding-left:18px">' + d.errors.slice(0, 12).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + (d.errors.length > 12 ? '<li>…and ' + (d.errors.length - 12) + ' more</li>' : '') + '</ul></div>' : '') +
    (!d.items.length ? '<div class="empty"><b>No changes found</b>Every row matches what\'s saved. Edit the file and upload it again.</div>' :
    '<p class="muted" style="margin:0"><b>' + d.items.length + ' product' + (d.items.length === 1 ? '' : 's') + '</b> will change' + (newN ? ', including ' + newN + ' new' : '') + '. Nothing is saved until you press Apply.</p>' +
    (stockN ? '<section class="card"><div class="hd"><div><h2>Stock changes</h2><div class="small muted">' + stockN + ' on-hand count' + (stockN === 1 ? '' : 's') + ' will change and be logged in Stock history.</div></div></div><div class="bd"><div class="fields">' +
      '<label class="field"><span>Reason</span>' + reasonSelect('sh-reason', 'count') + '</label><label class="field"><span>Note <span class="faint">(optional)</span></span><input type="text" id="sh-note" placeholder="e.g. October stock take"></label></div></div></section>' : '') +
    '<section class="card"><div class="bd flush tw"><table class="t"><thead><tr><th>Product</th><th>Change</th><th>From</th><th>To</th></tr></thead><tbody>' +
    d.items.slice(0, 300).map(function (it) {
      return it.changes.map(function (c, j) {
        return '<tr>' + (j === 0 ? '<td rowspan="' + it.changes.length + '"><b>' + esc(it.name) + '</b>' + (it.isNew ? ' <span class="tag manual">New</span>' : '') + '<div class="small faint">' + esc(it.sku) + '</div></td>' : '') +
          '<td>' + esc(c.label) + '</td><td class="faint">' + (c.from === '' || c.from == null ? '—' : esc(c.from)) + '</td><td><b>' + (c.to === '' ? '<span class="faint">(cleared)</span>' : esc(c.to)) + '</b></td></tr>';
      }).join('');
    }).join('') + '</tbody></table></div></section>') +
    '<div class="row"><button class="btn primary" data-act="sheet-apply"' + (d.items.length && !d.errors.length && !UI.bkBusy ? '' : ' disabled') + '>' + (UI.bkBusy ? 'Saving…' : 'Apply ' + d.items.length + ' change' + (d.items.length === 1 ? '' : 's')) + '</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}
// Hook the preview into the modal renderer.
(function () {
  var base = modalHtml;
  modalHtml = function () {
    var m = UI.modal;
    if (m && m.type === 'sheet') return '<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">' + sheetModal(m) + '</div></div>';
    return base();
  };
})();
document.addEventListener('change', function (e) {
  var el = e.target; if (!el.dataset || !el.dataset.bulkfile) return;
  e.stopImmediatePropagation();
  var file = el.files[0]; if (!file) return;
  var r = new FileReader();
  r.onload = function () {
    try { var rows = parseCSV(String(r.result)); if (!rows.length) { toast(file.name + ' has no rows.'); return; } UI.modal = { type: 'sheet', file: file.name, diff: sheetDiff(rows) }; render(); }
    catch (err) { toast('Could not read ' + file.name + ': ' + err.message); }
  };
  r.readAsText(file); el.value = '';
}, true);

/* ===== Inventory: update many stock levels at once ===== */
function stockMode() { return UI.stockMode || 'set'; }
function countChanges() {
  var c = UI.counts || {}, mode = stockMode();
  return Object.keys(c).map(function (k) {
    var p = prod(k), raw = String(c[k] == null ? '' : c[k]).trim().replace(/[−–]/, '-'); if (!p || raw === '' || isNaN(+raw)) return null;
    var v = +raw;
    if (mode === 'set') return v >= 0 && v !== +p.onHand ? { sku: k, mode: 'set', qty: v } : null;
    return v ? { sku: k, mode: 'delta', qty: v } : null;
  }).filter(Boolean);
}
function countBar() {
  if (!UI.counting) return '';
  var n = countChanges().length, mode = stockMode();
  return '<div class="note stockbar"><div class="row" style="justify-content:space-between;gap:10px">' +
    '<div class="row" style="gap:10px"><b>Update stock</b><div class="seg" role="group" aria-label="How to enter stock">' +
    [['set', 'Enter counts'], ['delta', 'Add or remove']].map(function (o) { return '<button aria-pressed="' + (mode === o[0]) + '" data-act="stock-mode|' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
    '<span class="row"><button class="btn sm" data-act="count-cancel">Cancel</button><button class="btn sm primary" id="count-save" data-act="count-save"' + (n && !UI.countBusy ? '' : ' disabled') + '>' + (UI.countBusy ? 'Saving…' : 'Save ' + n + ' change' + (n === 1 ? '' : 's')) + '</button></span></div>' +
    '<div class="small" style="margin-top:6px">' + (mode === 'set' ? 'Type what\'s on the shelf for each product you counted; leave the rest blank.' : 'Type how many to add (e.g. 10) or remove (e.g. -2) for each product; leave the rest blank.') + '</div>' +
    '<div class="row" style="gap:8px;margin-top:8px"><label class="row small" style="gap:6px">Reason ' + reasonSelect('cnt-reason', UI.countReason || (mode === 'set' ? 'count' : 'correction')) + '</label>' +
    '<label class="row small" style="gap:6px">Note <input type="text" id="cnt-note" value="' + esc(UI.countNote || '') + '" placeholder="Optional" style="width:180px"></label>' +
    '<span class="row small" style="gap:6px;margin-left:auto">' + (mode === 'set' ? 'Set every product shown to' : 'Add to every product shown') + ' <input type="number" id="cnt-fill" step="1"' + (mode === 'set' ? ' min="0"' : '') + ' style="width:80px" aria-label="Value for every product shown"><button class="btn sm" data-act="count-fill">Fill</button></span></div></div>';
}
function countCell(a) {
  var v = UI.counts && UI.counts[a.sku] != null ? UI.counts[a.sku] : '', set = stockMode() === 'set';
  return '<input type="' + (set ? 'number' : 'text') + '"' + (set ? ' min="0"' : ' inputmode="numeric"') + ' class="qty" id="cnt-' + esc(a.sku) + '" data-f="count|' + esc(a.sku) + '|" value="' + esc(v) + '" placeholder="' + (set ? num(a.onHand) : '±0') + '" aria-label="' + (set ? 'Counted on hand for ' : 'Units to add or remove for ') + esc(a.p.name) + '">' +
    (!set && v !== '' && !isNaN(+String(v).replace(/[−–]/, '-')) ? '<div class="small faint">→ ' + num(Math.max(0, a.onHand + +String(v).replace(/[−–]/, '-'))) + '</div>' : '');
}
function refreshCountBar() {
  var b = document.getElementById('count-save'); if (!b) return;
  var n = countChanges().length; b.disabled = !n || !!UI.countBusy; b.textContent = 'Save ' + n + ' change' + (n === 1 ? '' : 's');
}

/* ===== Fields and actions ===== */
(function () {
  var base = onField;
  onField = function (e) {
    var el = e.target, f = el.dataset && el.dataset.f; if (!f) return base(e);
    var parts = f.split('|'), kind = parts[0], id = parts[1], key = parts[2];
    if (kind === 'count') { if (e.type === 'input' && !el.dataset.live) return; UI.counts = UI.counts || {}; UI.counts[id] = el.value; refreshCountBar(); return; }
    if (kind === 'psel') { bulkSel()[id] = el.checked; render(); return; }
    if (kind === 'psync') { setSync([id], el.checked); return; }
    if (kind === 'pselall') { var s = bulkSel(); sortRows(filtered()).forEach(function (a) { if (el.checked) s[a.sku] = true; else delete s[a.sku]; }); render(); return; }
    if (kind === 'bk') { var b = bulkState(); b[key] = el.value; if (key === 'field') { b.value = ''; if (bulkFieldDef(el.value)[2] !== 'money') b.op = 'set'; } render(); return; }
    return base(e);
  };
})();
// Typing in a stock cell shouldn't wait for a change event to enable Save.
document.addEventListener('input', function (e) { var el = e.target; if (el.dataset && /^count\|/.test(el.dataset.f || '')) { UI.counts = UI.counts || {}; UI.counts[el.dataset.f.split('|')[1]] = el.value; refreshCountBar(); } });

Object.assign(ACTIONS, {
  'sync-shown': function (on) { on = on === '1'; setSync(filtered().filter(function (a) { return !a.p.noSync !== on; }).map(function (a) { return a.sku; }), on); },
  'bk-clear': function () { bulkState().sel = {}; render(); },
  'bk-apply': async function () {
    var b = bulkState(), el = document.getElementById('bk-value'), skus = Object.keys(b.sel).filter(function (k) { return b.sel[k] && prod(k); });
    b.value = el ? el.value.trim() : '';
    var def = bulkFieldDef(b.field);
    if (def[2] !== 'text' && def[2] !== 'supplier' && def[2] !== 'status' && b.value === '' && b.op !== 'set') { toast('Enter a value.'); return; }
    if (Store.mode !== 'db') { toast('The server isn\'t reachable, so changes can\'t be saved.'); return; }
    UI.bkBusy = true; render();
    try {
      var r = await API.req('POST', '/api/products-bulk', { skus: skus, field: b.field, op: def[2] === 'money' ? b.op : 'set', value: b.value });
      UI.bkBusy = false; b.value = ''; await loadWorkspace();
      toast(r.changed ? def[1] + ' changed on ' + r.changed + ' product' + (r.changed === 1 ? '' : 's') : 'Nothing to change');
    } catch (e) { UI.bkBusy = false; render(); toast(e.message); }
  },
  'sheet-download': function () {
    var list = WS.products.slice().sort(function (a, b) { return ((a.collection || '') + a.name).localeCompare((b.collection || '') + b.name); });
    downloadCSV('addendum-products-' + todayISO() + '.csv', [SHEET_COLS.map(function (c) { return c[1]; })].concat(list.map(function (p) { return SHEET_COLS.map(function (c) { return c[0] === 'sku' ? p.sku : sheetValue(p, c[0]); }); })));
    toast('Edit the file, save it as CSV, then press Upload changes');
  },
  'sheet-apply': async function () {
    var m = UI.modal; if (!m || m.type !== 'sheet') return;
    var reason = (document.getElementById('sh-reason') || {}).value, note = (document.getElementById('sh-note') || {}).value;
    UI.bkBusy = true; render();
    try {
      var r = await API.req('POST', '/api/products-bulk-rows', { rows: m.diff.items.map(function (it) { return it.row; }), reason: reason, note: note });
      UI.bkBusy = false; UI.modal = null; await loadWorkspace();
      toast([r.updated ? r.updated + ' updated' : '', r.added ? r.added + ' added' : '', r.stock ? r.stock + ' stock change' + (r.stock === 1 ? '' : 's') + ' logged' : ''].filter(Boolean).join(' · ') || 'No changes');
    } catch (e) { UI.bkBusy = false; m.error = e.message; render(); }
  },
  'count-start': function () { UI.counting = true; UI.counts = {}; UI.stockMode = UI.stockMode || 'set'; render(); var f = document.querySelector('[data-f^="count|"]'); if (f) f.focus(); },
  'count-cancel': function () { UI.counting = false; UI.counts = {}; render(); },
  'stock-mode': function (m) { if (m === stockMode()) return; UI.stockMode = m; UI.counts = {}; UI.countReason = null; render(); },
  'count-fill': function () {
    var v = (document.getElementById('cnt-fill') || {}).value; if (v === '' || v == null || isNaN(+v)) { toast('Enter a number to fill.'); return; }
    if (stockMode() === 'set' && +v < 0) { toast('Counts must be 0 or more.'); return; }
    UI.counts = UI.counts || {}; sortRows(filtered()).forEach(function (a) { UI.counts[a.sku] = v; });
    UI.countReason = (document.getElementById('cnt-reason') || {}).value; UI.countNote = (document.getElementById('cnt-note') || {}).value; render();
  },
  'count-save': async function () {
    var items = countChanges(); if (!items.length) return;
    var reason = (document.getElementById('cnt-reason') || {}).value || 'count', note = (document.getElementById('cnt-note') || {}).value || '';
    items.forEach(function (it) { it.reason = reason; it.note = note; });
    if (Store.mode !== 'db') { toast('The server isn\'t reachable, so stock can\'t be saved.'); return; }
    UI.countBusy = true; refreshCountBar();
    try {
      var r = await API.req('POST', '/api/stock-adjust', { items: items });
      UI.countBusy = false; UI.counting = false; UI.counts = {}; UI.countNote = ''; UI.countReason = null; await loadWorkspace();
      toast(r.changed + ' stock level' + (r.changed === 1 ? '' : 's') + ' updated');
    } catch (e) { UI.countBusy = false; refreshCountBar(); toast(e.message); }
  }
});

/* ===== Inventory: send this app's on-hand counts to Shopify (preview, then confirm) ===== */
// Shopify stays the source of truth; this is for occasional sends, e.g. after a stock count. Matched by SKU; only quantities are sent.
function stockSendStore() { return apiStores().filter(function (s) { return s.role === 'primary'; })[0]; }
function stockSendButton() { return isAdmin() && stockSendStore() && !UI.counting ? '<button class="btn" data-act="ss-open">Send stock to Shopify</button>' : ''; }
function ssLoad(loc) {
  var m = UI.modal; if (!m || m.type !== 'stocksend') return;
  m.data = null; m.error = null; render();
  API.req('GET', '/api/stock-send/preview' + (loc ? '?location=' + encodeURIComponent(loc) : '')).then(function (r) {
    if (UI.modal !== m) return;
    m.data = r; m.sel = {}; r.changes.forEach(function (c) { m.sel[c.sku] = true; }); render();
  }).catch(function (e) { if (UI.modal === m) { m.error = e.message; render(); } });
}
var SS_SKIP = [
  ['excluded', 'excluded from inventory sync'], ['untracked', 'Not tracked'], ['missing', 'not found in Shopify by SKU'],
  ['notAtLocation', 'not stocked at this location'], ['negative', 'other locations hold more than this app\'s count; change those in Shopify'], ['needsSync', 'need a fresh sync first']
];
function stockSendModal(m) {
  var head = '<div class="mh"><div><div class="eyebrow">Inventory</div><h2>Send stock to Shopify</h2><div class="small faint">Sets Shopify\'s on-hand count to this app\'s count, matched by SKU. Product names, prices and other details are never sent.</div></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">';
  var d = m.data;
  if (m.error && !d) return head + '<div class="note bad">' + esc(m.error) + '</div></div>';
  if (m.error) head += '<div class="note bad">' + esc(m.error) + '</div>';
  if (!d) return head + '<div class="loading">Comparing with Shopify\'s counts from the last sync…</div></div>';
  var n = d.changes.filter(function (c) { return m.sel[c.sku]; }).length, all = d.changes.length && n === d.changes.length;
  var loc = d.locations.filter(function (l) { return l.id === d.locationId; })[0] || {};
  var skips = SS_SKIP.filter(function (k) { return d.skipped[k[0]].length; }).map(function (k) { var l = d.skipped[k[0]]; return '<li>' + num(l.length) + ' ' + k[1] + ' <span class="faint">(' + esc(l.slice(0, 6).join(', ')) + (l.length > 6 ? '…' : '') + ')</span></li>'; }).join('');
  return head +
    '<div class="note">Compared with ' + esc(d.store.name) + ' as of the last sync' + (d.lastSync ? ' (' + esc(new Date(d.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + ')' : '') + '. If a count changed in Shopify since then, Shopify rejects that change and nothing is overwritten; run a sync and try again.</div>' +
    (d.locations.length > 1 ? '<label class="field" style="max-width:360px"><span>Shopify location to adjust</span><select data-f="ssloc||"' + (m.busy ? ' disabled' : '') + '>' + d.locations.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === d.locationId ? ' selected' : '') + '>' + esc(l.name) + ' · ' + num(l.units) + ' units</option>'; }).join('') + '</select><small>Other locations keep their stock; this one takes the difference so Shopify\'s total matches.</small></label>' : '') +
    '<section class="card"><div class="hd"><h2>' + num(d.changes.length) + ' SKU' + (d.changes.length === 1 ? '' : 's') + ' differ</h2><span class="small muted">' + num(d.same) + ' already match</span></div><div class="bd flush tw">' +
    (d.changes.length ? '<table class="t"><thead><tr><th class="selc"><input type="checkbox" data-f="ssall||"' + (all ? ' checked' : '') + ' aria-label="Select all"></th><th>Product</th><th class="r">Shopify total</th><th class="r">This app</th><th class="r">' + esc(loc.name || 'Location') + '</th></tr></thead><tbody>' +
      d.changes.map(function (c) {
        return '<tr' + (m.sel[c.sku] ? ' class="selrow"' : '') + '><td class="selc"><input type="checkbox" data-f="sssel|' + esc(c.sku) + '|"' + (m.sel[c.sku] ? ' checked' : '') + ' aria-label="Send ' + esc(c.sku) + '"></td><td><div class="pname"><b>' + esc(c.name) + '</b><span>' + esc(c.sku) + '</span></div></td>' +
          '<td class="r">' + num(c.shopify) + '</td><td class="r"><b>' + num(c.app) + '</b></td><td class="r">' + num(c.from) + ' → <b>' + num(c.to) + '</b> <span class="small ' + (c.to > c.from ? 'qin' : 'qout') + '">' + signed(c.to - c.from) + '</span></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty"><b>Nothing to send</b>Shopify\'s counts already match this app for every SKU that can be sent.</div>') + '</div></section>' +
    (skips ? '<details class="why"><summary>Left out</summary><ul class="small" style="margin:6px 0 0">' + skips + '</ul></details>' : '') +
    '<div class="row" style="justify-content:flex-end;gap:8px">' + (m.confirm
      ? '<span class="small" style="color:var(--now)">This changes on-hand counts in your live Shopify store for ' + num(n) + ' SKU' + (n === 1 ? '' : 's') + '.</span><button class="btn" data-act="ss-confirm-no"' + (m.busy ? ' disabled' : '') + '>Back</button><button class="btn primary" data-act="ss-send"' + (m.busy ? ' disabled' : '') + '>' + (m.busy ? 'Sending…' : 'Send to Shopify') + '</button>'
      : '<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" data-act="ss-confirm"' + (n ? '' : ' disabled') + '>Send ' + num(n) + ' to Shopify</button>') + '</div></div>';
}
(function () {
  var base = modalHtml;
  modalHtml = function () {
    var m = UI.modal;
    if (m && m.type === 'stocksend') return '<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">' + stockSendModal(m) + '</div></div>';
    return base();
  };
  var of = onField;
  onField = function (e) {
    var el = e.target, f = el.dataset && el.dataset.f, m = UI.modal; if (!f || !m || m.type !== 'stocksend' || !m.data) return of(e);
    var parts = f.split('|'), kind = parts[0], id = parts[1];
    if (kind === 'ssloc') { ssLoad(el.value); return; }
    if (kind === 'sssel') { m.sel[id] = el.checked; m.confirm = false; render(); return; }
    if (kind === 'ssall') { m.data.changes.forEach(function (c) { m.sel[c.sku] = el.checked; }); m.confirm = false; render(); return; }
    return of(e);
  };
})();
Object.assign(ACTIONS, {
  'ss-open': function () { UI.modal = { type: 'stocksend' }; ssLoad(); },
  'ss-confirm': function () { UI.modal.confirm = true; render(); },
  'ss-confirm-no': function () { UI.modal.confirm = false; render(); },
  'ss-send': async function () {
    var m = UI.modal, skus = Object.keys(m.sel).filter(function (k) { return m.sel[k]; });
    m.busy = true; render();
    try {
      var r = await API.req('POST', '/api/stock-send', { skus: skus, locationId: m.data.locationId });
      UI.modal = null; await loadStatus(); render();
      toast(r.failed.length ? r.message : 'Shopify updated: ' + r.sent + ' SKU' + (r.sent === 1 ? '' : 's') + ' now match this app');
    } catch (e) { m.busy = false; m.confirm = false; m.error = e.message; render(); }
  }
});
