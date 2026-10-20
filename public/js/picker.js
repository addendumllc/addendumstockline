/* ---------- Product search: find a variant by SKU, color/shade, collection or name ---------- */
// Every word typed must match somewhere (SKU, name, color, length, collection or product), so "weft 1b 22" or "rw1b" both work.
function productHay(p) {
  var h = [p.sku, p.name, p.variant, p.shade, p.length != null ? p.length + '"' : '', p.collection, p.groupName, p.supplierSku].filter(Boolean).join(' ').toLowerCase();
  return { text: h, compact: h.replace(/[^a-z0-9]/g, '') };
}
function productMatches(p, q) {
  var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return true;
  var h = productHay(p);
  return words.every(function (w) { var c = w.replace(/[^a-z0-9]/g, ''); return h.text.indexOf(w) >= 0 || (c && h.compact.indexOf(c) >= 0); });
}
function productGroup(p) { return p.groupName || (p.name || '').replace(/\s+\S*\d+\S*"?.*$/, '') || p.collection || 'Other'; }
function productLabel(p) { return p ? p.name + ' · ' + p.sku : ''; }

// A search box that stands in for a product <select>. The hidden input keeps the id and data-f of the old select,
// so forms read and react to it exactly as before.
var PICK_ONLY = {};
function skuPicker(o) {
  if (o.only) { PICK_ONLY[o.id] = {}; o.only.forEach(function (s) { PICK_ONLY[o.id][s] = 1; }); } else delete PICK_ONLY[o.id];
  var p = o.value ? prod(o.value) : null;
  return '<div class="pick" data-pick="' + esc(o.id) + '"' + (o.style ? ' style="' + o.style + '"' : '') + '>' +
    '<input type="text" class="pick-q" id="' + esc(o.id) + '-q" value="' + esc(p ? productLabel(p) : o.value && o.empty ? '' : '') + '" placeholder="' + esc(o.placeholder || (o.empty || 'Search SKU, color or collection')) + '" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="' + esc(o.id) + '-list" aria-label="' + esc(o.label || 'Product') + '"' + (o.dis || '') + '>' +
    '<input type="hidden" id="' + esc(o.id) + '"' + (o.f ? ' data-f="' + esc(o.f) + '"' : '') + ' value="' + esc(o.value || '') + '">' +
    (p && !o.dis ? '<button type="button" class="pick-x" data-pick-clear="' + esc(o.id) + '" aria-label="Clear">✕</button>' : '') +
    '<div class="pick-list" id="' + esc(o.id) + '-list" role="listbox" hidden' + (o.empty ? ' data-empty="' + esc(o.empty) + '"' : '') + (o.all ? ' data-all="1"' : '') + '></div></div>';
}
function pickOptions(listEl, q) {
  var showAll = listEl.dataset.all === '1', only = PICK_ONLY[listEl.id.replace(/-list$/, '')];
  var list = WS.products.filter(function (p) { return (!only || only[p.sku]) && (showAll || p.status !== 'discontinued') && productMatches(p, q); })
    .sort(function (a, b) { return ((a.collection || '') + productGroup(a) + a.name).localeCompare((b.collection || '') + productGroup(b) + b.name); });
  var total = list.length; list = list.slice(0, 60);
  var html = '', lastGroup = null;
  if (listEl.dataset.empty && !q) html += '<div class="pick-opt" role="option" data-sku="">' + esc(listEl.dataset.empty) + '</div>';
  list.forEach(function (p) {
    var g = (p.collection || 'Uncategorized') + ' · ' + productGroup(p);
    if (g !== lastGroup) { html += '<div class="pick-grp">' + esc(g) + '</div>'; lastGroup = g; }
    var a = A[p.sku];
    html += '<div class="pick-opt" role="option" data-sku="' + esc(p.sku) + '"><span class="pick-main"><b>' + esc(p.shade || p.variant || p.name) + (p.length != null && p.shade ? ' <span class="faint">' + esc(p.length) + '"</span>' : '') + '</b><span class="small faint">' + esc(p.name) + '</span></span>' +
      '<span class="pick-meta"><code>' + esc(p.sku) + '</code><span class="small faint">' + num(a ? a.onHand : p.onHand) + ' in stock</span></span></div>';
  });
  if (!total) html = '<div class="pick-none">No product matches “' + esc(q) + '”. Try part of the SKU, a color like 1B, or a collection.</div>';
  else if (total > list.length) html += '<div class="pick-none">' + (total - list.length) + ' more. Keep typing to narrow it down.</div>';
  listEl.innerHTML = html;
  var first = listEl.querySelector('.pick-opt[data-sku]:not([data-sku=""])') || listEl.querySelector('.pick-opt'); if (first) first.classList.add('on');
}
function pickOpen(box, q) {
  var l = box.querySelector('.pick-list'), inp = box.querySelector('.pick-q');
  pickOptions(l, q); l.hidden = false; inp.setAttribute('aria-expanded', 'true');
}
function pickClose(box) { if (!box) return; var l = box.querySelector('.pick-list'); if (l) l.hidden = true; var i = box.querySelector('.pick-q'); if (i) i.setAttribute('aria-expanded', 'false'); }
function pickChoose(box, sku) {
  var hid = box.querySelector('input[type=hidden]'), inp = box.querySelector('.pick-q'), p = prod(sku);
  inp.value = p ? productLabel(p) : ''; hid.value = sku || '';
  pickClose(box); inp.blur();
  hid.dispatchEvent(new Event('change', { bubbles: true }));
}
document.addEventListener('focusin', function (e) { var inp = e.target; if (!inp.classList || !inp.classList.contains('pick-q')) return; var box = inp.closest('.pick'); var hid = box.querySelector('input[type=hidden]'); inp.select(); pickOpen(box, hid.value && inp.value === productLabel(prod(hid.value)) ? '' : inp.value); });
document.addEventListener('input', function (e) { var inp = e.target; if (!inp.classList || !inp.classList.contains('pick-q')) return; e.stopImmediatePropagation(); pickOpen(inp.closest('.pick'), inp.value); }, true);
document.addEventListener('keydown', function (e) {
  var inp = e.target; if (!inp.classList || !inp.classList.contains('pick-q')) return;
  var box = inp.closest('.pick'), l = box.querySelector('.pick-list');
  if (e.key === 'Escape' && !l.hidden) { e.stopPropagation(); e.preventDefault(); pickClose(box); return; }
  if (l.hidden && (e.key === 'ArrowDown' || e.key === 'Enter')) { pickOpen(box, ''); e.preventDefault(); return; }
  var opts = Array.prototype.slice.call(l.querySelectorAll('.pick-opt')), i = opts.findIndex(function (o) { return o.classList.contains('on'); });
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!opts.length) return;
    if (i >= 0) opts[i].classList.remove('on');
    i = e.key === 'ArrowDown' ? Math.min(opts.length - 1, i + 1) : Math.max(0, i - 1);
    opts[i].classList.add('on'); opts[i].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') { e.preventDefault(); if (i >= 0) pickChoose(box, opts[i].dataset.sku); }
  else if (e.key === 'Tab' && !l.hidden) { pickClose(box); }
}, true);
document.addEventListener('mousedown', function (e) {
  var opt = e.target.closest && e.target.closest('.pick-opt');
  if (opt) { e.preventDefault(); pickChoose(opt.closest('.pick'), opt.dataset.sku); return; }
  var x = e.target.closest && e.target.closest('[data-pick-clear]');
  if (x) { e.preventDefault(); pickChoose(x.closest('.pick'), ''); var q = x.closest('.pick').querySelector('.pick-q'); if (q) q.focus(); return; }
  document.querySelectorAll('.pick-list:not([hidden])').forEach(function (l) { if (!l.parentNode.contains(e.target)) pickClose(l.parentNode); });
}, true);
// Leaving the box without choosing puts back the current product's name.
document.addEventListener('focusout', function (e) {
  var inp = e.target; if (!inp.classList || !inp.classList.contains('pick-q')) return;
  setTimeout(function () { var box = inp.closest('.pick'); if (!box || box.contains(document.activeElement)) return; pickClose(box); var hid = box.querySelector('input[type=hidden]'); inp.value = hid.value ? productLabel(prod(hid.value)) : ''; }, 120);
});
