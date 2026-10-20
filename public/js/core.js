/* ---------- Utilities ---------- */
var E = ENGINE;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function num(n) { return n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'); }
function rate(n) { return n == null || !isFinite(n) ? '—' : E.fx(n); }
function money(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (WS.settings && WS.settings.currency) || 'USD', maximumFractionDigits: dp || 0, minimumFractionDigits: dp || 0 }).format(n); }
  catch (e) { return '$' + Math.round(n).toLocaleString(); }
}
function pct(n, signed) { if (n == null || !isFinite(n)) return '—'; var v = Math.round(n * 100); return (signed && v > 0 ? '+' : '') + v + '%'; }
function dNice(iso, yr) { if (!iso) return '—'; var t = new Date(E.parseD(iso)); return E.MON[t.getUTCMonth()] + ' ' + t.getUTCDate() + (yr ? ', ' + t.getUTCFullYear() : ''); }
function dLong(iso) { if (!iso) return '—'; var t = new Date(E.parseD(iso)); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][t.getUTCDay()] + ', ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][t.getUTCMonth()] + ' ' + t.getUTCDate() + ', ' + t.getUTCFullYear(); }
function rel(t) { if (t == null) return ''; if (t === 0) return 'today'; if (t === 1) return 'tomorrow'; if (t === -1) return 'yesterday'; return t > 0 ? 'in ' + t + ' days' : Math.abs(t) + ' days ago'; }
function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function docId(s) { var c = String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 150); if (c !== s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; c += '-' + (h >>> 0).toString(36); } return c || 'x'; }
var STATUS = {
  oos: { label: 'Out of stock', order: 0 }, now: { label: 'Order now', order: 1 }, soon: { label: 'Reorder soon', order: 2 },
  watch: { label: 'Watch', order: 3 }, healthy: { label: 'Healthy', order: 4 }, disc: { label: 'Discontinued', order: 5 },
  untracked: { label: 'Not tracked', order: 6 }
};
// Product status choices. 'Not tracked' keeps a product (a service, gift card, sample) out of inventory, forecasts and reorders.
var PRODUCT_STATUSES = [['active', 'Active'], ['launch', 'New launch'], ['discontinued', 'Discontinued'], ['untracked', 'Not tracked']];
function statusOptions(cur) { return PRODUCT_STATUSES.map(function (o) { return '<option value="' + o[0] + '"' + ((cur || 'active') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); }
function pill(s) { return '<span class="pill ' + s + '">' + STATUS[s].label + '</span>'; }
var PO_STATUS = { draft: 'Draft', submitted: 'Submitted', in_production: 'In production', shipped: 'Shipped', partially_received: 'Partially received', received: 'Received', cancelled: 'Cancelled' };
var PO_FLOW = ['draft', 'submitted', 'in_production', 'shipped', 'partially_received', 'received'];
function poPill(s) {
  var c = { draft: 'disc', submitted: 'watch', in_production: 'watch', shipped: 'soon', partially_received: 'soon', received: 'healthy', cancelled: 'disc' }[s];
  return '<span class="pill ' + c + '">' + PO_STATUS[s] + '</span>';
}
function trendTag(a) {
  var t = '';
  if (a.isLaunch) t += '<span class="tag launch">New · ' + a.ageDays + 'd</span> ';
  if (a.trend === 'increasing') t += '<span class="tag up">↑ Rising</span> ';
  else if (a.trend === 'decreasing') t += '<span class="tag down">↓ Slowing</span> ';
  else t += '<span class="tag">Stable</span> ';
  if (a.seasonal) t += '<span class="tag">Seasonal</span>';
  return t;
}
var ICONS = {
  dashboard: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
  inventory: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  recs: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  pos: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
  products: '<path d="M4 4h16v6H4zM4 14h16v6H4z"/><path d="M8 7h.01M8 17h.01"/>',
  suppliers: '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  forecast: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7.1 19.8l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.2 14H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.2 7.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.2V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9c.3.6.9 1 1.6 1H21a2 2 0 0 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/>',
  sales: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  salon: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  store: '<path d="M4 7h16l-1.2 12.1a2 2 0 0 1-2 1.9H7.2a2 2 0 0 1-2-1.9z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  usage: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M8 17v-3M12 17v-5M16 17v-2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4M13 20h7"/>',
  ledger: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'
};
function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[n] + '</svg>'; }

/* ---------- State ---------- */
var WS = clone(DEMO);           // workspace data
var A = {}, AL = [], ALL = [];  // analyses by sku; inventory list (tracked products only); every product
var UI = {
  page: 'dashboard', sku: null, cart: {}, modal: null, toast: null, navOpen: false,
  inv: { q: '', col: '', sup: '', status: '' }, sort: { k: 'status', d: 1 },
  an: { range: '90', col: '', q: '', from: '', to: '', rank: 'units' },
  fc: { tab: 'timeline', sku: null }, wi: { sku: '', salesPct: 0, leadDays: 0, seasonPct: 0, promoLift: 0, promoStart: '', promoDays: 7 },
  recSel: {}, recQty: {}, poFilter: 'open', dismissed: {}, prodTab: 'overview'
};
// UI.recQty holds only quantities the user typed; they stay until reset or a purchase order is created.
try { var saved = JSON.parse(localStorage.getItem('stockline-ui') || '{}'); if (saved.dismissed) UI.dismissed = saved.dismissed; if (saved.recQty) UI.recQty = saved.recQty; } catch (e) {}
function saveUI() { try { localStorage.setItem('stockline-ui', JSON.stringify({ dismissed: UI.dismissed, recQty: UI.recQty })); } catch (e) {} }
function recQty(a) { return UI.recQty[a.sku] != null ? UI.recQty[a.sku] : a.qty; }

var Store = { mode: 'loading', canWrite: false, status: null, queues: {} };

function settings() { return E.settingsOf(WS.settings); }
function ctx(whatif) { return { settings: settings(), asOf: WS.meta.asOf, pos: WS.pos, suppliers: WS.suppliers, whatif: whatif }; }
function recompute() {
  A = {}; AL = []; ALL = [];
  var c = ctx();
  WS.products.forEach(function (p) { try { var a = E.analyze(p, c); A[p.sku] = a; ALL.push(a); if (a.status !== 'untracked') AL.push(a); } catch (err) { console.error('analyze', p.sku, err); } });
  var byStatus = function (x, y) { return STATUS[x.status].order - STATUS[y.status].order || (x.orderT == null ? 999 : x.orderT) - (y.orderT == null ? 999 : y.orderT); };
  AL.sort(byStatus); ALL.sort(byStatus);
}
function prod(sku) { return WS.products.filter(function (p) { return p.sku === sku; })[0]; }
function sup(id) { return WS.suppliers.filter(function (s) { return s.id === id; })[0]; }
function supName(id) { var s = sup(id); return s ? s.name : 'No supplier'; }
function po(id) { return WS.pos.filter(function (p) { return p.id === id; })[0]; }
function collections() { var o = {}; WS.products.forEach(function (p) { o[p.collection || 'Uncategorized'] = 1; }); return Object.keys(o).sort(); }

/* ---------- Persistence (local Addendum-Stockline server) ---------- */
// Opened inside the Shopify admin? App Bridge then signs every request with a fresh session token.
var EMBED = !!document.querySelector('meta[name="shopify-api-key"]') && window.top !== window.self;
var API = {
  req: async function (method, url, body, retried) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') opts.body = JSON.stringify(body || {});
    if (EMBED && window.shopify && shopify.idToken) {
      try { opts.headers.Authorization = 'Bearer ' + await shopify.idToken(); } catch (e) { /* fall back to cookie */ }
    }
    var r = await fetch(url, opts);
    if (r.status === 401 && EMBED && !retried) return API.req(method, url, body, true); // token expired in flight
    if (r.status === 401 && !EMBED && url.indexOf('/api/auth/') !== 0) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); return new Promise(function () {}); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
};
// Image links carry a daily key, because <img> requests can't carry a Shopify session token.
function mediaUrl(u) { if (!u) return u; var k = Store.status && Store.status.mediaKey; return k && u.indexOf('/uploads/') === 0 ? u + (u.indexOf('?') < 0 ? '?' : '&') + 'k=' + encodeURIComponent(k) : u; }
function queueWrite(path, fn) {
  var q = Store.queues[path] || Promise.resolve();
  var next = q.then(fn).catch(function (e) {
    console.error('save failed', path, e);
    if (!e.status) return new Promise(function (r) { setTimeout(r, 800); }).then(fn).catch(function () { toast('Could not save. Is the Addendum-Stockline server still running?'); });
    toast('Not saved: ' + e.message);
  });
  Store.queues[path] = next; return next;
}
function persist(coll, id, data) {
  if (Store.mode !== 'db') return Promise.resolve();
  var path = '/api/' + coll + '/' + encodeURIComponent(id), body = clone(data);
  if (coll === 'products') delete body.daily;
  return queueWrite(path, function () { return API.req('PUT', path, body); });
}
function unpersist(coll, id) {
  if (Store.mode !== 'db') return Promise.resolve();
  var path = '/api/' + coll + '/' + encodeURIComponent(id);
  return queueWrite(path, function () { return API.req('DELETE', path); });
}
function saveProduct(p) { persist('products', p.sku, p); }
function saveSupplier(s) { persist('suppliers', s.id, s); }
function savePO(x) { persist('pos', x.id, x); }
function saveTxn(t) { persist('txns', t.id, t); }
function saveConfig(which) { if (which === 'sync') return; persist('config', which, which === 'settings' ? WS.settings : WS.meta); }

function changed() { recompute(); render(); }
var _cs = null;
function changedSoon() { clearTimeout(_cs); _cs = setTimeout(changed, 30); }

function loadWorkspace() {
  return API.req('GET', '/api/workspace').then(function (w) { WS = w; Store.mode = 'db'; changed(); });
}
function loadStatus() {
  return API.req('GET', '/api/status').then(function (s) { Store.status = s; if (!UI.brandPreview) BRAND.apply(s.branding); var r = { viewer: 1, editor: 2, admin: 3, owner: 4 }[s.user && s.user.role] || 0; Store.canWrite = r >= 2; return s; }).catch(function () { return null; });
}
async function initStore() {
  try { await loadStatus(); await loadWorkspace(); render(); if (Store.status && Store.status.sync.running) pollSync(); }
  catch (e) {
    console.error(e);
    if (EMBED && e.status && e.status !== 404) { Store.mode = 'blocked'; Store.blocked = e.message; render(); return; }
    Store.mode = 'preview'; Store.canWrite = true; changed(); toast('Could not reach the Addendum-Stockline server. Showing demo data.');
  }
}
async function writeWorkspace(ws, label) {
  if (Store.mode !== 'db') { WS = ws; changed(); return; }
  toast(label || 'Saving…');
  try { await API.req('POST', '/api/workspace', ws); await loadWorkspace(); toast('Saved'); }
  catch (e) { toast('Could not save: ' + e.message); }
}
async function startSync(full, storeId) {
  try { await API.req('POST', '/api/sync', { full: !!full, storeId: storeId || null }); toast('Shopify sync started'); setTimeout(pollSync, 300); }
  catch (e) { toast(e.message); go('settings'); }
}
function pollSync() {
  loadStatus().then(function (s) {
    render();
    if (s && s.sync.running) { setTimeout(pollSync, 1500); return; }
    loadWorkspace().then(function () { var l = s && s.sync.last; if (l) toast(l.status === 'success' ? 'Sync complete: ' + num(l.orders) + ' orders, ' + num(l.products) + ' variants' + (l.stores > 1 ? ' from ' + l.stores + ' stores' : '') : l.status === 'partial' ? 'Sync finished with problems: ' + l.message : 'Sync failed: ' + l.message); });
  });
}

/* ---------- Toast & tooltip ---------- */
var _tt;
function toast(msg) { UI.toast = msg; renderToast(); clearTimeout(_tt); _tt = setTimeout(function () { UI.toast = null; renderToast(); }, 3200); }
function renderToast() {
  var el = document.getElementById('toast');
  if (!el) return;
  el.hidden = !UI.toast; el.textContent = UI.toast || '';
}
var tipEl;
function showTip(x, y, html) { if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); } tipEl.innerHTML = html; tipEl.hidden = false; var w = tipEl.offsetWidth; tipEl.style.left = Math.min(window.innerWidth - w - 8, x + 12) + 'px'; tipEl.style.top = (y - 36) + 'px'; }
function hideTip() { if (tipEl) tipEl.hidden = true; }

/* ---------- Charts (drawn at real pixel width after render) ---------- */
var CHARTS = {}, _cid = 0;
function chart(spec) { var id = 'c' + (++_cid); CHARTS[id] = spec; return '<div class="chart" data-chart="' + id + '" style="height:' + (spec.h || 220) + 'px"></div>'; }
function drawCharts() {
  document.querySelectorAll('[data-chart]').forEach(function (el) { var s = CHARTS[el.dataset.chart]; if (s) el.innerHTML = s.type === 'bar' ? barSvg(s, el.clientWidth) : lineSvg(s, el.clientWidth); bindChart(el, s); });
}
function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); var n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function gridDiv(r) { if (r < 4) return 4; return (r / 4) % 1 === 0 ? 4 : (r / 5) % 1 === 0 ? 5 : 2; }
function niceMin(v) { if (v >= 0) return 0; return -niceMax(-v); }
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }
function lineSvg(s, W) {
  var H = s.h || 220, pl = 44, pr = 14, pt = 12, pb = 26;
  var n = s.labels.length, all = [];
  s.series.forEach(function (se) { se.values.forEach(function (v) { if (v != null) all.push(v); }); });
  (s.hlines || []).forEach(function (h) { all.push(h.v); });
  var mx = niceMax(Math.max.apply(null, all.concat([1])) * 1.05), mn = s.allowNeg ? niceMin(Math.min.apply(null, all.concat([0]))) : 0;
  var iw = W - pl - pr, ih = H - pt - pb;
  function X(i) { return pl + (n <= 1 ? 0 : i * iw / (n - 1)); }
  function Y(v) { return pt + ih - (v - mn) / (mx - mn) * ih; }
  var o = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(s.label || 'chart') + '">';
  var dv = gridDiv(mx - mn);
  for (var g = 0; g <= dv; g++) { var gv = mn + (mx - mn) * g / dv, gy = Y(gv); o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" stroke="' + css('--grid') + '"/><text x="' + (pl - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + esc(s.yfmt ? s.yfmt(gv) : num(gv)) + '</text>'; }
  if (mn < 0) o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="' + css('--ink-3') + '"/>';
  var step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  for (var i = 0; i < n; i += step) o += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + esc(s.labels[i]) + '</text>';
  (s.bands || []).forEach(function (b) { o += '<rect x="' + X(b.from) + '" y="' + pt + '" width="' + Math.max(1, X(b.to) - X(b.from)) + '" height="' + ih + '" fill="' + css(b.color) + '" opacity="' + (b.op || .12) + '"/>'; });
  (s.hlines || []).forEach(function (h) { o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(h.v) + '" y2="' + Y(h.v) + '" stroke="' + css(h.color) + '" stroke-dasharray="5 4"/><text x="' + (W - pr) + '" y="' + (Y(h.v) - 5) + '" text-anchor="end" style="fill:' + css(h.color) + '">' + esc(h.label) + '</text>'; });
  s.series.forEach(function (se) {
    var c = css(se.color), d = '', started = false, first = null, last = null;
    se.values.forEach(function (v, i) { if (v == null) { started = false; return; } d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); started = true; if (first == null) first = i; last = i; });
    if (se.area && first != null) o += '<path d="' + d + 'L' + X(last) + ' ' + Y(Math.max(mn, 0)) + 'L' + X(first) + ' ' + Y(Math.max(mn, 0)) + 'Z" fill="' + c + '" opacity=".10"/>';
    o += '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + (se.w || 2) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round"/>';
    if (last != null && !se.noEnd) o += '<circle cx="' + X(last) + '" cy="' + Y(se.values[last]) + '" r="3.5" fill="' + c + '"/>';
  });
  (s.vlines || []).forEach(function (vl) {
    if (vl.i < 0 || vl.i > n - 1) return; var x = X(vl.i), c = css(vl.color);
    o += '<line x1="' + x + '" x2="' + x + '" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="' + c + '" stroke-width="1.5"' + (vl.dash ? ' stroke-dasharray="3 3"' : '') + '/>';
    var anchor = x > W - 110 ? 'end' : 'start';
    o += '<text x="' + (x + (anchor === 'end' ? -5 : 5)) + '" y="' + (pt + 12 + (vl.row || 0) * 14) + '" text-anchor="' + anchor + '" style="fill:' + c + ';font-weight:600">' + esc(vl.label) + '</text>';
  });
  o += '<rect class="hit" x="' + pl + '" y="' + pt + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
  s._geo = { pl: pl, iw: iw, n: n };
  return o;
}
function barSvg(s, W) {
  var H = s.h || 220, pl = 44, pr = 10, pt = 12, pb = 26;
  var n = s.labels.length, all = [0];
  s.series.forEach(function (se) { se.values.forEach(function (v) { if (v != null) all.push(v); }); });
  var mx = niceMax(Math.max.apply(null, all) * 1.05), iw = W - pl - pr, ih = H - pt - pb;
  var bw = iw / n, k = s.series.length, inner = Math.min(28, (bw - 6) / k);
  function Y(v) { return pt + ih - v / mx * ih; }
  var o = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(s.label || 'chart') + '">';
  var dv = gridDiv(mx);
  for (var g = 0; g <= dv; g++) { var gv = mx * g / dv; o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(gv) + '" y2="' + Y(gv) + '" stroke="' + css('--grid') + '"/><text x="' + (pl - 8) + '" y="' + (Y(gv) + 4) + '" text-anchor="end">' + esc(s.yfmt ? s.yfmt(gv) : num(gv)) + '</text>'; }
  var step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));
  s.labels.forEach(function (l, i) {
    var cx = pl + bw * i + bw / 2;
    s.series.forEach(function (se, j) { var v = se.values[i]; if (v == null) return; var x = cx - inner * k / 2 + j * inner; o += '<rect x="' + (x + 1) + '" y="' + Y(Math.max(0, v)) + '" width="' + Math.max(1, inner - 2) + '" height="' + Math.max(0, Y(0) - Y(Math.max(0, v))) + '" rx="2" fill="' + css(se.color) + '"' + (se.op ? ' opacity="' + se.op + '"' : '') + '/>'; });
    if (i % step === 0) o += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l) + '</text>';
  });
  (s.hlines || []).forEach(function (h) { o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(h.v) + '" y2="' + Y(h.v) + '" stroke="' + css(h.color) + '" stroke-dasharray="4 4"/>'; });
  o += '<rect class="hit" x="' + pl + '" y="' + pt + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
  s._geo = { pl: pl, iw: iw, n: n, bar: true };
  return o;
}
function bindChart(el, s) {
  var hit = el.querySelector('.hit'); if (!hit || !s.tip) return;
  function at(e) { var r = el.getBoundingClientRect(), g = s._geo, x = e.clientX - r.left - g.pl; var i = g.bar ? Math.floor(x / (g.iw / g.n)) : Math.round(x / (g.iw / Math.max(1, g.n - 1))); return Math.max(0, Math.min(g.n - 1, i)); }
  hit.addEventListener('pointermove', function (e) { showTip(e.clientX, e.clientY, s.tip(at(e))); });
  hit.addEventListener('pointerleave', hideTip);
}
var _rz; window.addEventListener('resize', function () { clearTimeout(_rz); _rz = setTimeout(drawCharts, 120); });

/* ---------- Sales aggregation ---------- */
function dailySeries(p, days) { // returns array oldest->newest of {date,u}
  var h = E.history(p, WS.meta.asOf, days); return h.reverse();
}
function weekLabel(iso) { return dNice(iso); }
