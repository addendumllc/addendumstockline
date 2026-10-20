/* ---------- Add a product with its variants: each color (and length) gets its own SKU ---------- */
function npDraft() {
  var m = UI.modal; if (!m.draft || !m.draft.variants) m.draft = Object.assign({ groupName: '', collection: '', length: '', supplierId: '', price: '', stylistPrice: '', cost: '', moq: '', casePack: '1', prodLead: '', transit: '', prefix: '', variants: [{ color: '', length: '', sku: '', onHand: '', price: '' }] }, m.draft || {});
  if (!m.draft.variants) m.draft.variants = [{ color: '', length: '', sku: '', onHand: '', price: '' }];
  return m.draft;
}
function groupVariants(name) {
  var k = String(name || '').trim().toLowerCase(); if (!k) return [];
  return WS.products.filter(function (p) { return productGroup(p).toLowerCase() === k; });
}
// Short code for a color in a SKU: "1B Off Black" → 1B, "6/613" → 6613.
function colorCode(c) { var w = String(c || '').trim().split(/\s+/)[0] || ''; return w.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
function npSkuFor(d, v) {
  var len = String(v.length || d.length || '').replace(/[^0-9A-Za-z]/g, ''), pre = String(d.prefix || '').trim().toUpperCase();
  return [pre, colorCode(v.color), len].filter(Boolean).join('-');
}
function groupHint(name) {
  var existing = groupVariants(name);
  if (!existing.length) return 'Each variant is named after it, e.g. "Redefined Weft 1B 22""';
  return 'Already has ' + existing.length + ' variant' + (existing.length === 1 ? '' : 's') + ': ' + existing.map(function (p) { return (p.shade || p.variant || p.sku) + (p.length ? ' ' + p.length + '"' : ''); }).slice(0, 8).join(', ') + (existing.length > 8 ? '…' : '') + '. New ones are added alongside.';
}
function newProductModal(m) {
  var d = npDraft(), groups = {}, cols = collections();
  WS.products.forEach(function (p) { groups[productGroup(p)] = 1; });
  function f(k, label, type, help, ph) { return '<label class="field"><span>' + label + '</span><input type="' + (type || 'text') + '" id="np-' + k + '" data-f="np||' + k + '" value="' + esc(d[k] == null ? '' : d[k]) + '"' + (type === 'number' ? ' min="0" step="any"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + (help ? '<small>' + help + '</small>' : '') + '</label>'; }
  function vc(i, k, w, ph, type) { var v = d.variants[i]; return '<td><input type="' + (type || 'text') + '" id="npv-' + i + '-' + k + '" data-f="npv|' + i + '|' + k + '" value="' + esc(v[k] == null ? '' : v[k]) + '" style="width:' + w + '"' + (type === 'number' ? ' min="0" step="any"' : '') + ' placeholder="' + esc(ph || '') + '" aria-label="' + esc(k) + ' for variant ' + (i + 1) + '"></td>'; }
  return '<div class="mh"><div><div class="eyebrow">Products</div><h2>Add a product</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') +
    '<section class="card"><div class="hd"><div><h2>Product</h2><div class="small muted">The details every color shares.</div></div></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Product name</span><input type="text" id="np-groupName" data-f="np||groupName" list="np-groups" value="' + esc(d.groupName) + '" placeholder="e.g. Redefined Weft"><datalist id="np-groups">' + Object.keys(groups).sort().map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
    '<small id="np-ghint">' + esc(groupHint(d.groupName)) + '</small></label>' +
    '<label class="field"><span>Collection</span><input type="text" id="np-collection" data-f="np||collection" list="np-cols" value="' + esc(d.collection) + '"><datalist id="np-cols">' + cols.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></label>' +
    f('length', 'Length (inches)', 'text', 'Optional. Can differ per variant', 'e.g. 22') +
    '<label class="field"><span>Supplier</span><select id="np-supplierId" data-f="np||supplierId"><option value="">—</option>' + WS.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (d.supplierId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label></div>' +
    '<div class="fields" style="margin-top:12px">' + f('price', 'Retail (DTC) price', 'number') + f('stylistPrice', 'Stylist price', 'number') + f('cost', 'Unit cost', 'number') + '</div></div></section>' +

    '<section class="card"><div class="hd"><div><h2>Variants</h2><div class="small muted">One row per color (or color and length). Each has its own SKU and starting stock.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">' +
    '<div class="row small" style="gap:8px">SKU starts with <input type="text" id="np-prefix" data-f="np||prefix" value="' + esc(d.prefix) + '" placeholder="e.g. RW" style="width:90px"><button class="btn sm" data-act="np-fill-skus">Fill in SKUs</button><span class="faint">Makes SKUs like RW-1B-22 from the prefix, color and length. Edit any of them after.</span></div>' +
    '<div class="tw"><table class="t npv"><thead><tr><th>Color / shade</th><th>Length</th><th>SKU</th><th class="r">Starting stock</th><th class="r">Retail <span class="faint">if different</span></th><th></th></tr></thead><tbody>' +
    d.variants.map(function (v, i) {
      var taken = v.sku && prod(String(v.sku).trim());
      return '<tr>' + vc(i, 'color', '150px', 'e.g. 1B Off Black') + vc(i, 'length', '64px', d.length || '22') + '<td><input type="text" id="npv-' + i + '-sku" data-f="npv|' + i + '|sku" value="' + esc(v.sku) + '" style="width:150px" placeholder="SKU" aria-label="SKU for variant ' + (i + 1) + '">' + (taken ? '<div class="small" style="color:var(--now)">Already used</div>' : '') + '</td>' +
        vc(i, 'onHand', '80px', '0', 'number') + vc(i, 'price', '84px', d.price || '', 'number') +
        '<td>' + (d.variants.length > 1 ? '<button class="btn ghost sm" data-act="np-var-del|' + i + '" aria-label="Remove variant">✕</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="row"><button class="btn sm" data-act="np-var-add">+ Add variant</button><button class="btn sm ghost" data-act="np-var-paste">Paste a list of colors</button></div>' +
    (m.paste ? '<div class="stack" style="gap:6px"><textarea id="np-paste" rows="4" placeholder="One color per line, optionally with SKU and stock:&#10;1B Off Black, RW-1B-22, 40&#10;4 Dark Brown&#10;6/613" style="width:100%;font:13px/1.5 ui-monospace,Menlo,monospace;border:1px solid var(--line-2);border-radius:var(--r-sm);padding:8px;background:var(--surface);color:var(--ink)"></textarea><div class="row"><button class="btn sm" data-act="np-paste-apply">Add these</button></div></div>' : '') +
    '</div></section>' +
    '<section class="card"><div class="hd"><h2>Ordering</h2><span class="small muted">optional; can be set later</span></div><div class="bd"><div class="fields">' +
    f('moq', 'MOQ', 'number') + f('casePack', 'Case size', 'number') + f('prodLead', 'Production lead (days)', 'number', 'Blank uses the supplier\'s') + f('transit', 'Transit (days)', 'number') + '</div></div></section>' +
    '<div class="row"><button class="btn primary" data-act="np-save"' + (m.busy ? ' disabled' : '') + '>' + (m.busy ? 'Saving…' : 'Add ' + npCount(d) + ' SKU' + (npCount(d) === 1 ? '' : 's')) + '</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}
function npCount(d) { return d.variants.filter(function (v) { return v.sku || v.color; }).length || 1; }

(function () {
  var base = onField;
  onField = function (e) {
    var el = e.target, f = el.dataset && el.dataset.f; if (!f) return base(e);
    var parts = f.split('|'), kind = parts[0];
    if (kind === 'np') { if (e.type === 'input') return; var d = npDraft(); d[parts[2]] = el.value; if (parts[2] === 'groupName') { var h = document.getElementById('np-ghint'); if (h) h.textContent = groupHint(el.value); } return; }
    if (kind === 'npv') { if (e.type === 'input') return; var v = npDraft().variants[+parts[1]]; if (v) { v[parts[2]] = el.value; if (parts[2] === 'sku') render(); } return; }
    return base(e);
  };
})();
function npReadAll() {
  var d = npDraft();
  ['groupName', 'collection', 'length', 'supplierId', 'price', 'stylistPrice', 'cost', 'moq', 'casePack', 'prodLead', 'transit', 'prefix'].forEach(function (k) { var el = document.getElementById('np-' + k); if (el) d[k] = el.value.trim(); });
  d.variants.forEach(function (v, i) { ['color', 'length', 'sku', 'onHand', 'price'].forEach(function (k) { var el = document.getElementById('npv-' + i + '-' + k); if (el) v[k] = el.value.trim(); }); });
  return d;
}
Object.assign(ACTIONS, {
  'np-open': function (sku) {
    var p = sku ? prod(sku) : null;
    UI.modal = { type: 'newprod' };
    if (p) UI.modal.draft = { groupName: productGroup(p), collection: p.collection || '', length: p.length != null ? String(p.length) : '', supplierId: p.supplierId || '', price: p.price != null ? p.price : '', stylistPrice: p.stylistPrice != null ? p.stylistPrice : '', cost: p.cost != null ? p.cost : '', moq: p.moq != null ? p.moq : '', casePack: p.casePack || 1, prodLead: p.prodLead != null ? p.prodLead : '', transit: p.transit != null ? p.transit : '', prefix: (p.sku.split('-')[0] || ''), variants: [{ color: '', length: '', sku: '', onHand: '', price: '' }] };
    render(); setTimeout(function () { var i = document.getElementById(p ? 'npv-0-color' : 'np-groupName'); if (i) i.focus(); }, 0);
  },
  'np-var-add': function () { var d = npReadAll(); d.variants.push({ color: '', length: '', sku: '', onHand: '', price: '' }); render(); var i = document.getElementById('npv-' + (d.variants.length - 1) + '-color'); if (i) i.focus(); },
  'np-var-del': function (i) { var d = npReadAll(); d.variants.splice(+i, 1); render(); },
  'np-var-paste': function () { npReadAll(); UI.modal.paste = !UI.modal.paste; render(); var t = document.getElementById('np-paste'); if (t) t.focus(); },
  'np-paste-apply': function () {
    var d = npReadAll(), t = (document.getElementById('np-paste') || {}).value || '';
    var rows = t.split(/\r?\n/).map(function (l) { return qeSplit(l); }).filter(function (r) { return r[0]; });
    if (!rows.length) { toast('Type at least one color.'); return; }
    d.variants = d.variants.filter(function (v) { return v.color || v.sku; });
    rows.forEach(function (r) { d.variants.push({ color: r[0], length: '', sku: r[1] || '', onHand: r[2] || '', price: '' }); });
    UI.modal.paste = false; render(); toast(rows.length + ' variant' + (rows.length === 1 ? '' : 's') + ' added');
  },
  'np-fill-skus': function () {
    var d = npReadAll(); if (!d.prefix) { toast('Type the start of the SKU first, e.g. RW.'); var p = document.getElementById('np-prefix'); if (p) p.focus(); return; }
    var n = 0; d.variants.forEach(function (v) { if (!v.sku && (v.color || v.length || d.length)) { v.sku = npSkuFor(d, v); n++; } });
    render(); toast(n ? n + ' SKU' + (n === 1 ? '' : 's') + ' filled in' : 'Every variant already has a SKU');
  },
  'np-save': async function () {
    var m = UI.modal, d = npReadAll();
    if (!d.groupName) { m.error = 'Enter the product name, e.g. Redefined Weft.'; render(); return; }
    var vars = d.variants.filter(function (v) { return v.sku || v.color; });
    if (!vars.length) { m.error = 'Add at least one variant with a SKU.'; render(); return; }
    var noSku = vars.filter(function (v) { return !v.sku; });
    if (noSku.length) { m.error = (noSku[0].color || 'A variant') + ' needs a SKU. Type one, or use Fill in SKUs.'; render(); return; }
    m.busy = true; m.error = null; render();
    try {
      var r = await API.req('POST', '/api/products', Object.assign({}, d, { variants: vars }));
      UI.modal = null; await loadWorkspace();
      toast(r.skus.length > 1 ? r.skus.length + ' variants added' : 'Product added');
      go('product', r.sku);
    } catch (e) { m.busy = false; m.error = e.message; render(); }
  }
});
