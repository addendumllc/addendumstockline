/* ---------- Edit All Products: one table to change SKU, name, prices and stock for every product, then save once ---------- */
var QE_FIELDS = [['newSku', 'SKU', 'text'], ['name', 'Product name', 'text'], ['collection', 'Collection', 'text'], ['onHand', 'Inventory on hand', 'int'], ['stylistPrice', 'Stylist price', 'num'], ['price', 'Retail price', 'num'], ['cost', 'Our cost', 'num']];
var QE_PASTE = [
  ['onHand', 'SKU, on hand count'], ['delta', 'SKU, units to add or remove'], ['name', 'SKU, product name'], ['name_onHand', 'SKU, product name, on hand'],
  ['price', 'SKU, retail price'], ['stylistPrice', 'SKU, stylist price'], ['newSku', 'SKU, new SKU']
];
function qe() { if (!UI.qe) UI.qe = { d: {}, adds: [], q: '', col: '', sel: {}, only: false, fmt: 'onHand', paste: '', report: null, reason: 'count', note: '' }; return UI.qe; }
function qeOrig(p, k) { return k === 'newSku' ? p.sku : p[k] == null ? '' : p[k]; }
function qeVal(p, k) { var d = qe().d[p.sku]; return d && k in d ? d[k] : qeOrig(p, k); }
function qeSame(a, b, kind) { if (kind === 'text') return String(a).trim() === String(b).trim(); if (a === '' || b === '' || a == null || b == null) return (a === '' || a == null) && (b === '' || b == null); return Math.abs(+a - +b) < 0.005; }
function qeSet(sku, k, v) {
  var p = prod(sku); if (!p) return;
  var s = qe(), kind = (QE_FIELDS.filter(function (f) { return f[0] === k; })[0] || [])[2];
  s.d[sku] = s.d[sku] || {};
  if (qeSame(v, qeOrig(p, k), kind)) delete s.d[sku][k]; else s.d[sku][k] = v;
  if (!Object.keys(s.d[sku]).length) delete s.d[sku];
}
function qeCount() { var s = qe(); return Object.keys(s.d).filter(function (k) { return prod(k); }).length + s.adds.filter(function (a) { return a.sku || a.name; }).length; }
// Every word typed must appear in the SKU, name, shade/length or collection, so "weft 1b" finds Redefined Weft 1B.
function qeRows() {
  var s = qe(), words = s.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return WS.products.slice().sort(function (a, b) { return a.sku.localeCompare(b.sku); }).filter(function (p) {
    if (s.only && !s.d[p.sku]) return false;
    if (s.col && (p.collection || 'Uncategorized') !== s.col) return false;
    var hay = [p.sku, qeVal(p, 'newSku'), p.name, qeVal(p, 'name'), p.variant || '', p.collection || ''].join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  });
}
function qeCell(p, k, kind, w) {
  var v = qeVal(p, k), ch = qe().d[p.sku] && k in qe().d[p.sku];
  return '<td class="' + (kind === 'text' ? '' : 'r ') + 'qec' + (ch ? ' chg' : '') + '"><input type="' + (kind === 'text' ? 'text' : 'number') + '"' + (kind === 'text' ? '' : ' min="0" step="' + (kind === 'int' ? '1' : 'any') + '"') +
    ' id="qe-' + esc(p.sku) + '-' + k + '" data-f="qe|' + esc(p.sku) + '|' + k + '" value="' + esc(v) + '" style="width:' + w + '"' + (Store.canWrite ? '' : ' disabled') + ' aria-label="' + esc((QE_FIELDS.filter(function (f) { return f[0] === k; })[0] || [])[1]) + ' for ' + esc(p.sku) + '"></td>';
}
function qeDelta(p) { var v = qeVal(p, 'onHand'); if (v === '' || isNaN(+v)) return ''; var d = +v - (+p.onHand || 0); return d ? '<b class="' + (d > 0 ? 'qin' : 'qout') + '">' + signed(d) + '</b>' : ''; }
function qeBar() {
  var n = qeCount(), s = qe();
  var stockN = Object.keys(s.d).filter(function (k) { return s.d[k] && 'onHand' in s.d[k]; }).length;
  return '<div class="bulkbar qebar" id="qe-bar"><b id="qe-n">' + (n ? n + ' product' + (n === 1 ? '' : 's') + ' changed' : 'No changes yet') + '</b>' +
    '<span class="row small" style="gap:6px">Reason for stock changes ' + reasonSelect('qe-reason', s.reason) + '</span>' +
    '<input type="text" id="qe-note" value="' + esc(s.note) + '" placeholder="Note (optional)" style="width:170px" aria-label="Note for stock changes">' +
    '<span class="row" style="gap:6px;margin-left:auto"><button class="btn sm ghost" data-act="qe-discard"' + (n ? '' : ' disabled') + ' id="qe-discard">Discard</button><button class="btn sm primary" data-act="qe-save" id="qe-save"' + (n && !s.busy ? '' : ' disabled') + '>' + (s.busy ? 'Saving…' : 'Save all') + '</button></span>' +
    '<span class="small faint" style="flex-basis:100%" id="qe-stockn">' + (stockN ? stockN + ' on-hand change' + (stockN === 1 ? '' : 's') + ' will be logged in Stock history.' : 'Nothing is saved until you press Save all.') + '</span></div>';
}
function pageEditAll() {
  var s = qe(), can = Store.canWrite, rows = qeRows(), seln = Object.keys(s.sel).filter(function (k) { return s.sel[k] && prod(k); }).length;
  var connected = allStores().some(function (x) { return x.auth !== 'manual'; });
  var pasteOpen = s.pasteOpen || s.paste || s.report;
  var head = '<div class="ph"><div><h1>Products</h1><div class="sub">Change SKUs, names, prices and stock for every product in one table, or paste a list by SKU. Changed cells are highlighted; nothing is saved until you press Save all. Edits here are internal and never change Shopify; Shopify syncs only update on hand, matched by SKU.</div></div>' +
    '<div class="actions"><button class="btn" data-act="sheet-download">Download spreadsheet</button>' + (can ? '<button class="btn" data-act="qe-paste-toggle" aria-expanded="' + !!pasteOpen + '">Update by SKU</button><button class="btn" data-act="qe-addrow">+ Add product row</button>' : '') + '</div></div>';
  var paste = !can || !pasteOpen ? '' : '<section class="card"><div class="hd"><div><h2>Update by SKU</h2><div class="small muted">Paste or type one product per line, starting with its SKU. Columns can be separated by commas or tabs (straight from a spreadsheet).</div></div><button class="btn ghost sm" data-act="qe-paste-toggle" aria-label="Close">✕</button></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">' +
    '<label class="field" style="max-width:340px"><span>Each line has</span><select data-f="qep||fmt">' + QE_PASTE.map(function (o) { return '<option value="' + o[0] + '"' + (s.fmt === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
    '<textarea id="qe-paste" rows="5" placeholder="' + esc(qePlaceholder(s.fmt)) + '" aria-label="Lines to apply by SKU">' + esc(s.paste) + '</textarea>' +
    '<div class="row"><button class="btn" data-act="qe-paste">Fill into table</button><span class="small faint">You\'ll see every change highlighted below before saving.</span></div>' +
    (s.report ? '<div class="note' + (s.report.bad.length ? ' warn' : '') + '">' + esc(s.report.msg) + (s.report.bad.length ? '<div class="small" style="margin-top:4px">' + s.report.bad.slice(0, 15).map(esc).join('<br>') + (s.report.bad.length > 15 ? '<br>…and ' + (s.report.bad.length - 15) + ' more' : '') + '</div>' : '') + '</div>' : '') + '</div></section>';
  var filters = '<div class="filters"><input type="search" data-live="1" id="qe-q" data-f="qeu||q" value="' + esc(s.q) + '" placeholder="Search products by name, SKU or collection" aria-label="Search products" style="flex:1;min-width:220px;max-width:420px">' +
    '<select data-f="qeu||col" aria-label="Collection"><option value="">All collections</option>' + collections().map(function (c) { return '<option' + (s.col === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
    '<label class="check small"><input type="checkbox" data-f="qeu||only"' + (s.only ? ' checked' : '') + '> Only changed</label>' +
    '<span class="small muted">' + (rows.length === WS.products.length ? num(rows.length) + ' products' : num(rows.length) + ' of ' + num(WS.products.length) + ' products') + '</span>' +
    (seln && can ? '<span class="row" style="margin-left:auto;gap:6px">' + (s.delAsk ? '<span class="small" style="color:var(--now)">Delete ' + seln + ' product' + (seln === 1 ? '' : 's') + ' and their history? This can\'t be undone.</span><button class="btn sm" data-act="qe-del-no">Keep</button><button class="btn sm primary danger-fill" data-act="qe-del-yes">Delete</button>' : '<span class="small">' + seln + ' selected</span><button class="btn sm ghost" data-act="qe-sel-clear">Clear</button><button class="btn sm danger" data-act="qe-del">Delete selected</button>') + '</span>' : '') + '</div>';
  var all = rows.length && rows.every(function (p) { return s.sel[p.sku]; });
  var table = '<section class="card"><div class="bd flush tw"><table class="t qe"><thead><tr>' + (can ? '<th class="selc"><input type="checkbox" data-f="qeall||"' + (all ? ' checked' : '') + ' aria-label="Select all shown"></th>' : '') +
    '<th>SKU</th><th>Product name</th><th>Collection</th><th class="r">Inventory on hand</th><th class="r">Stylist price</th><th class="r">Retail price</th><th class="r">Our cost</th><th class="r">Stock change</th></tr></thead><tbody>' +
    s.adds.map(function (a, i) {
      function c(k, kind, w) { return '<td class="' + (kind === 'text' ? '' : 'r ') + 'qec chg"><input type="' + (kind === 'text' ? 'text' : 'number') + '"' + (kind === 'text' ? '' : ' min="0" step="any"') + ' id="qen-' + i + '-' + k + '" data-f="qen|' + i + '|' + k + '" value="' + esc(a[k] == null ? '' : a[k]) + '" style="width:' + w + '" placeholder="' + (k === 'sku' ? 'New SKU' : k === 'name' ? 'Product name' : '') + '"></td>'; }
      return '<tr class="newrow">' + (can ? '<td class="selc"><button class="btn ghost sm" data-act="qe-addrow-del|' + i + '" aria-label="Remove new row">✕</button></td>' : '') + c('sku', 'text', '140px') + c('name', 'text', '100%') + c('collection', 'text', '130px') + c('onHand', 'num', '76px') + c('stylistPrice', 'num', '82px') + c('price', 'num', '82px') + c('cost', 'num', '76px') + '<td class="r"><span class="tag manual">New</span></td></tr>';
    }).join('') +
    (rows.length ? rows.slice(0, 1000).map(function (p) {
      return '<tr' + (s.sel[p.sku] ? ' class="selrow"' : '') + '>' + (can ? '<td class="selc"><input type="checkbox" data-f="qesel|' + esc(p.sku) + '|"' + (s.sel[p.sku] ? ' checked' : '') + ' aria-label="Select ' + esc(p.sku) + '"></td>' : '') +
        qeCell(p, 'newSku', 'text', '140px') + qeCell(p, 'name', 'text', '100%') + qeCell(p, 'collection', 'text', '130px') + qeCell(p, 'onHand', 'int', '76px') + qeCell(p, 'stylistPrice', 'num', '82px') + qeCell(p, 'price', 'num', '82px') + qeCell(p, 'cost', 'num', '76px') +
        '<td class="r" id="qed-' + esc(p.sku) + '">' + qeDelta(p) + '</td></tr>';
    }).join('') : '<tr><td colspan="9"><div class="empty"><b>No products match</b>' + (s.only ? 'Untick "Only changed" to see everything.' : 'Try another SKU or name.') + '</div></td></tr>') +
    '</tbody></table></div></section>';
  return head + productTabs('edit') + (connected ? '<p class="small muted" style="margin:0">Changing a SKU here also updates its sales, stock history and purchase orders. Inventory syncs match by SKU, so for a store connected to Shopify, change the SKU in Shopify yourself too. Until they match, the renamed product\'s on hand isn\'t synced and the next sync adds the old SKU back as a separate product.</p>' : '') +
    paste + filters + (can ? qeBar() : '') + table;
}
function qePlaceholder(fmt) {
  return { onHand: 'RW-1B-22, 48\nKT-4-22, 30', delta: 'RW-1B-22, 10\nKT-4-22, -2', name: 'RW-1B-22, Redefined Weft 1B 22"', name_onHand: 'RW-1B-22, Redefined Weft 1B 22", 48', price: 'RW-1B-22, 349', stylistPrice: 'RW-1B-22, 249', newSku: 'RW-1B-22, RW-1B-22-V2' }[fmt] || '';
}
// Keep the save bar in step without re-rendering, so a click on Save isn't lost after typing.
function qeRefresh(sku) {
  var n = qeCount(), s = qe(), el = document.getElementById('qe-n'), sv = document.getElementById('qe-save'), dc = document.getElementById('qe-discard'), sn = document.getElementById('qe-stockn');
  if (el) el.textContent = n ? n + ' product' + (n === 1 ? '' : 's') + ' changed' : 'No changes yet';
  if (sv) sv.disabled = !n || !!s.busy; if (dc) dc.disabled = !n;
  var stockN = Object.keys(s.d).filter(function (k) { return s.d[k] && 'onHand' in s.d[k]; }).length;
  if (sn) sn.textContent = stockN ? stockN + ' on-hand change' + (stockN === 1 ? '' : 's') + ' will be logged in Stock history.' : 'Nothing is saved until you press Save all.';
  if (sku) {
    var p = prod(sku); if (!p) return;
    QE_FIELDS.forEach(function (f) { var i = document.getElementById('qe-' + sku + '-' + f[0]); if (i) i.parentNode.classList.toggle('chg', !!(s.d[sku] && f[0] in s.d[sku])); });
    var d = document.getElementById('qed-' + sku); if (d) d.innerHTML = qeDelta(p);
  }
}
// One pasted line: tab-separated (from a spreadsheet) or comma-separated, with "quoted, values" allowed.
function qeSplit(line) {
  if (line.indexOf('\t') >= 0) return line.split('\t').map(function (x) { return x.trim(); });
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && !cur.trim()) { q = true; cur = ''; }
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function qeApplyPaste() {
  var s = qe(), text = (document.getElementById('qe-paste') || {}).value || ''; s.paste = text;
  var bySku = {}; WS.products.forEach(function (p) { bySku[p.sku.toLowerCase()] = p; });
  var ok = 0, bad = [], added = 0;
  text.split(/\r?\n/).forEach(function (line, i) {
    if (!line.trim()) return;
    var parts = qeSplit(line);
    var sku = parts[0], p = bySku[(sku || '').toLowerCase()], v = parts[1], n = 'Line ' + (i + 1) + ' (' + (sku || 'no SKU') + '): ';
    if (!sku || /^sku$/i.test(sku)) { if (sku) return; bad.push(n + 'no SKU.'); return; }
    function numOk(x, allowNeg) { x = String(x || '').replace(/[$,\s]/g, ''); return x !== '' && !isNaN(+x) && (allowNeg || +x >= 0) ? +x : null; }
    if (!p) {
      if (s.fmt === 'name' || s.fmt === 'name_onHand') {
        if (!v) { bad.push(n + 'new SKU needs a name.'); return; }
        s.adds.push({ sku: sku, name: v, onHand: s.fmt === 'name_onHand' ? numOk(parts[2]) : null }); added++; return;
      }
      bad.push(n + 'SKU not found.'); return;
    }
    if (s.fmt === 'onHand') { var c = numOk(v); if (c == null) { bad.push(n + '"' + (v || '') + '" isn\'t a count.'); return; } qeSet(p.sku, 'onHand', Math.round(c)); }
    else if (s.fmt === 'delta') { var dl = numOk(String(v || '').replace(/[−–]/, '-'), true); if (dl == null) { bad.push(n + '"' + (v || '') + '" isn\'t a number.'); return; } var base = qeVal(p, 'onHand'); qeSet(p.sku, 'onHand', Math.max(0, Math.round((base === '' ? +p.onHand : +base) + dl))); }
    else if (s.fmt === 'name' || s.fmt === 'name_onHand') {
      if (!v) { bad.push(n + 'no name.'); return; } qeSet(p.sku, 'name', v);
      if (s.fmt === 'name_onHand' && parts[2] !== undefined && parts[2] !== '') { var c2 = numOk(parts[2]); if (c2 == null) { bad.push(n + '"' + parts[2] + '" isn\'t a count.'); return; } qeSet(p.sku, 'onHand', Math.round(c2)); }
    }
    else if (s.fmt === 'price' || s.fmt === 'stylistPrice') { var pr = numOk(v); if (pr == null) { bad.push(n + '"' + (v || '') + '" isn\'t a price.'); return; } qeSet(p.sku, s.fmt, pr); }
    else if (s.fmt === 'newSku') { if (!v) { bad.push(n + 'no new SKU.'); return; } qeSet(p.sku, 'newSku', v); }
    ok++;
  });
  s.report = { msg: (ok + added) ? (ok ? ok + ' product' + (ok === 1 ? '' : 's') + ' filled in' : '') + (added ? (ok ? ', ' : '') + added + ' new row' + (added === 1 ? '' : 's') + ' added' : '') + '. Check the highlighted cells, then press Save all.' + (bad.length ? ' ' + bad.length + ' line' + (bad.length === 1 ? '' : 's') + ' skipped:' : '') : 'Nothing was filled in.' + (bad.length ? ' ' + bad.length + ' line' + (bad.length === 1 ? '' : 's') + ' skipped:' : ''), bad: bad };
  if (ok + added) s.paste = '';
  if (ok + added) s.only = true;
  render();
}

(function () {
  var base = onField;
  onField = function (e) {
    var el = e.target, f = el.dataset && el.dataset.f; if (!f) return base(e);
    var parts = f.split('|'), kind = parts[0], id = parts[1], key = parts[2], s;
    if (kind === 'qe') { if (e.type === 'input') return; qeSet(id, key, el.value); qeRefresh(id); return; }
    if (kind === 'qen') { s = qe(); if (s.adds[+id]) { s.adds[+id][key] = el.value; qeRefresh(); } return; }
    if (kind === 'qeu') { s = qe(); s[key] = el.type === 'checkbox' ? el.checked : el.value; render(); return; }
    if (kind === 'qep') { s = qe(); s.fmt = el.value; s.paste = (document.getElementById('qe-paste') || {}).value || ''; render(); return; }
    if (kind === 'qesel') { s = qe(); if (el.checked) s.sel[id] = true; else delete s.sel[id]; s.delAsk = false; render(); return; }
    if (kind === 'qeall') { s = qe(); qeRows().forEach(function (p) { if (el.checked) s.sel[p.sku] = true; else delete s.sel[p.sku]; }); s.delAsk = false; render(); return; }
    return base(e);
  };
})();
// Typing updates the save bar right away (change events only fire on leaving the cell).
document.addEventListener('input', function (e) {
  var el = e.target, f = el.dataset && el.dataset.f || ''; if (!/^qe\|/.test(f)) return;
  var parts = f.split('|'); qeSet(parts[1], parts[2], el.value); qeRefresh(parts[1]);
});
window.addEventListener('beforeunload', function (e) { if (UI.qe && qeCount()) { e.preventDefault(); e.returnValue = ''; } });

async function qeDelete(skus, done) {
  try {
    var r = await API.req('POST', '/api/products-delete', { skus: skus });
    await loadWorkspace();
    toast((r.deleted ? r.deleted + ' product' + (r.deleted === 1 ? '' : 's') + ' deleted' : 'Nothing deleted') + (r.skipped.length ? '. Kept ' + r.skipped.length + ' that ' + (r.skipped.length === 1 ? 'is' : 'are') + ' on purchase orders: ' + r.skipped.map(function (x) { return x.sku; }).slice(0, 5).join(', ') + (r.skipped.length > 5 ? '…' : '') + '. Mark ' + (r.skipped.length === 1 ? 'it' : 'them') + ' Discontinued instead.' : ''));
    if (done) done(r);
  } catch (e) { toast(e.message); render(); }
}

Object.assign(ACTIONS, {
  'qe-addrow': function () { var s = qe(); s.adds.unshift({ sku: '', name: '', collection: '', price: '', stylistPrice: '', cost: '', onHand: '' }); render(); var i = document.getElementById('qen-0-sku'); if (i) i.focus(); },
  'qe-addrow-del': function (i) { qe().adds.splice(+i, 1); render(); },
  'qe-paste': function () { qeApplyPaste(); },
  'qe-paste-toggle': function () { var s = qe(), open = s.pasteOpen || s.paste || s.report; s.pasteOpen = !open; if (open) { s.paste = ''; s.report = null; } render(); if (s.pasteOpen) { var t = document.getElementById('qe-paste'); if (t) t.focus(); } },
  'qe-discard': function () { var s = qe(); s.d = {}; s.adds = []; s.report = null; s.only = false; render(); toast('Changes discarded'); },
  'qe-sel-clear': function () { var s = qe(); s.sel = {}; s.delAsk = false; render(); },
  'qe-del': function () { qe().delAsk = true; render(); },
  'qe-del-no': function () { qe().delAsk = false; render(); },
  'qe-del-yes': function () { var s = qe(), skus = Object.keys(s.sel).filter(function (k) { return s.sel[k]; }); s.delAsk = false; qeDelete(skus, function () { s.sel = {}; skus.forEach(function (k) { if (!prod(k)) delete s.d[k]; }); render(); }); },
  'qe-save': async function () {
    var s = qe(); s.reason = (document.getElementById('qe-reason') || {}).value || 'count'; s.note = (document.getElementById('qe-note') || {}).value || '';
    // pick up a cell still being typed in
    var ae = document.activeElement; if (ae && ae.dataset && /^qe/.test(ae.dataset.f || '')) onField({ target: ae, type: 'change' });
    var rows = [], errs = [], seen = {};
    s.adds.forEach(function (a, i) {
      if (!a.sku && !a.name) return;
      var sku = String(a.sku || '').trim();
      if (!sku) { errs.push('A new row has no SKU.'); return; }
      if (!String(a.name || '').trim()) { errs.push('New SKU ' + sku + ' needs a name.'); return; }
      if (prod(sku) || seen[sku.toLowerCase()]) { errs.push('SKU ' + sku + ' is already used.'); return; }
      seen[sku.toLowerCase()] = 1;
      var r = { sku: sku, name: String(a.name).trim() };
      ['collection', 'price', 'stylistPrice', 'cost', 'onHand'].forEach(function (k) { if (a[k] !== '' && a[k] != null) r[k] = a[k]; });
      rows.push(r);
    });
    Object.keys(s.d).forEach(function (sku) {
      var p = prod(sku), d = s.d[sku]; if (!p) return;
      var r = { sku: sku };
      Object.keys(d).forEach(function (k) { r[k] = typeof d[k] === 'string' ? d[k].trim() : d[k]; });
      if ('newSku' in r) { if (!r.newSku) { errs.push(sku + ': the SKU can\'t be blank.'); return; } if (seen[r.newSku.toLowerCase()] || (prod(r.newSku) && r.newSku !== sku)) { errs.push(sku + ' → ' + r.newSku + ': that SKU is already used.'); return; } seen[r.newSku.toLowerCase()] = 1; }
      if ('name' in r && !r.name) { errs.push(sku + ': the name can\'t be blank.'); return; }
      if ('onHand' in r && r.onHand === '') delete r.onHand;
      rows.push(r);
    });
    if (errs.length) { toast(errs[0] + (errs.length > 1 ? ' (+' + (errs.length - 1) + ' more)' : '')); return; }
    if (!rows.length) return;
    if (Store.mode !== 'db') { toast('The server isn\'t reachable, so changes can\'t be saved.'); return; }
    s.busy = true; qeRefresh();
    try {
      var r = await API.req('POST', '/api/products-bulk-rows', { rows: rows, reason: s.reason, note: s.note });
      s.busy = false; s.d = {}; s.adds = []; s.report = null; s.only = false; s.note = '';
      await loadWorkspace();
      toast(['Saved', r.updated ? r.updated + ' updated' : '', r.added ? r.added + ' added' : '', r.renamed ? r.renamed + ' SKU' + (r.renamed === 1 ? '' : 's') + ' changed' : '', r.stock ? r.stock + ' stock change' + (r.stock === 1 ? '' : 's') + ' logged' : ''].filter(Boolean).join(' · '));
    } catch (e) { s.busy = false; qeRefresh(); toast(e.message); }
  },
  // Products page: delete what's ticked there
  'bk-del': function () { UI.bkDelAsk = true; render(); },
  'bk-del-no': function () { UI.bkDelAsk = false; render(); },
  'bk-del-yes': function () { var sel = bulkSel(), skus = Object.keys(sel).filter(function (k) { return sel[k] && prod(k); }); UI.bkDelAsk = false; qeDelete(skus, function () { skus.forEach(function (k) { if (!prod(k)) delete sel[k]; }); render(); }); },
  'ep-del': function () { UI.modal.delAsk = true; render(); },
  'ep-del-no': function () { UI.modal.delAsk = false; render(); },
  'ep-del-yes': function (sku) { UI.modal = null; qeDelete([sku], function (r) { if (r.deleted && UI.page === 'product') go('products'); else render(); }); }
});

// Delete buttons on the Products bulk bar and in the Edit product window.
(function () {
  var bb = bulkBar;
  bulkBar = function (list) {
    var html = bb(list), n = selCount();
    if (!n || !Store.canWrite) return html;
    var del = UI.bkDelAsk ? '<span class="row" style="gap:6px;flex-basis:100%;justify-content:flex-end"><span class="small" style="color:var(--now)">Delete ' + n + ' product' + (n === 1 ? '' : 's') + ' and their history? This can\'t be undone.</span><button class="btn sm" data-act="bk-del-no">Keep</button><button class="btn sm primary danger-fill" data-act="bk-del-yes">Delete</button></span>'
      : '<button class="btn sm danger" data-act="bk-del">Delete ' + n + '</button>';
    return html.replace(/<\/div>$/, del + '</div>');
  };
  var em = editProductModal;
  editProductModal = function (p, m) {
    var html = em(p, m);
    var del = m.delAsk ? '<span class="row" style="margin-left:auto;gap:6px"><span class="small" style="color:var(--now)">Delete this product and its history?</span><button class="btn sm" data-act="ep-del-no">Keep</button><button class="btn sm primary danger-fill" data-act="ep-del-yes|' + esc(p.sku) + '">Delete</button></span>'
      : '<button class="btn ghost danger" style="margin-left:auto" data-act="ep-del">Delete product</button>';
    return html.replace(/<button class="btn ghost" data-act="modal-close">Cancel<\/button><\/div><\/div>$/, '<button class="btn ghost" data-act="modal-close">Cancel</button>' + del + '</div></div>');
  };
})();
