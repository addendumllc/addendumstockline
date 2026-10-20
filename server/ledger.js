// Stock history (every logged change to on-hand, with running balances) and monthly usage per product.
const db = require('./db');

const TYPE_LABEL = { receive: 'PO received', sale: 'Store purchase', salon: 'Salon use', count: 'Stock count', adjust: 'Adjustment', sync: 'Shopify sync' };

// Running balance is worked backwards from today's on-hand, in the order changes were entered
// (a purchase dated yesterday but logged today came after this morning's count).
function ledger(q) {
  q = q || {};
  const where = [], args = [];
  if (q.sku) { where.push('t.sku = ?'); args.push(String(q.sku)); }
  const products = {};
  db.all('SELECT sku, name, variant, on_hand FROM products' + (q.sku ? ' WHERE sku = ?' : ''), q.sku ? [String(q.sku)] : []).forEach(p => { products[p.sku] = p; });
  const rows = db.all(`SELECT t.*, COALESCE(s.name, s.shop_name, s.domain) AS store_name FROM inventory_txns t LEFT JOIN stores s ON s.id = t.store_id
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(t.created_at, t.date || 'T23:59:59') DESC, t.id DESC`, args);
  const bal = {};
  rows.forEach(r => {
    const p = products[r.sku];
    if (!(r.sku in bal)) bal[r.sku] = p ? (p.on_hand || 0) : null;
    r.after = bal[r.sku];
    if (bal[r.sku] != null) { r.before = bal[r.sku] - (r.qty || 0); bal[r.sku] = r.before; } else r.before = null;
  });
  const from = q.from || '', to = q.to || '', type = q.type || '', store = q.store || '';
  const text = String(q.q || '').toLowerCase();
  let out = rows.filter(r => (!from || r.date >= from) && (!to || r.date <= to) && (!type || r.type === type) && (!store || r.store_id === store) &&
    (!text || [r.sku, r.ref, r.note, r.user_name, (products[r.sku] || {}).name].join(' ').toLowerCase().includes(text)));
  const totals = { in: 0, out: 0, count: out.length };
  out.forEach(r => { if (r.qty > 0) totals.in += r.qty; else totals.out += -r.qty; });
  const limit = Math.min(+q.limit || 500, 5000);
  out = out.slice(0, limit).map(r => ({ id: r.id, date: r.date, at: r.created_at, sku: r.sku, name: (products[r.sku] || {}).name || r.sku, variant: (products[r.sku] || {}).variant || '',
    type: r.type, label: TYPE_LABEL[r.type] || r.type, qty: r.qty, before: r.before, after: r.after, ref: r.ref || '', note: r.note || '', store: r.store_name || '', storeId: r.store_id || '', user: r.user_name || '' }));
  return { rows: out, totals, shown: out.length };
}

function monthKeys(end, n) {
  const [y, m] = end.split('-').map(Number), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

// Units used per product per month, split by channel: each store, salon use, and sales history from imports/demo.
function usageMonthly(q) {
  q = q || {};
  const meta = db.config('meta', {}) || {};
  const end = (meta.source === 'demo' && meta.asOf ? meta.asOf : new Date().toISOString()).slice(0, 7);
  const months = monthKeys(end, Math.max(3, Math.min(+q.months || 12, 24)));
  const start = months[0] + '-01';
  const channels = db.all("SELECT id, COALESCE(name, shop_name, domain) AS name, price_list FROM stores ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at")
    .map(s => ({ id: s.id, name: s.name, kind: 'store', priceList: s.price_list || 'retail' }));
  const rows = [];
  db.all(`SELECT o.store_id AS ch, l.sku, substr(o.local_date, 1, 7) AS m, SUM(l.net_quantity) AS u, SUM(l.net_quantity * l.unit_price) AS r
          FROM order_lines l JOIN orders o ON o.shopify_id = l.order_id
          WHERE o.local_date >= ? AND o.cancelled_at IS NULL AND COALESCE(o.financial_status, '') NOT IN ('REFUNDED', 'VOIDED')
          GROUP BY o.store_id, l.sku, m`, [start]).forEach(r => rows.push({ ch: r.ch || 'other', sku: r.sku, m: r.m, u: r.u || 0, r: Math.round((r.r || 0) * 100) / 100 }));
  const salon = db.all(`SELECT sku, substr(date, 1, 7) AS m, SUM(qty) AS u FROM salon_usage WHERE date >= ? GROUP BY sku, m`, [start]);
  salon.forEach(r => rows.push({ ch: 'salon', sku: r.sku, m: r.m, u: r.u || 0, r: 0 }));
  const hist = db.all(`SELECT sku, substr(date, 1, 7) AS m, SUM(units) AS u, SUM(revenue) AS r FROM base_sales WHERE date >= ? GROUP BY sku, m`, [start]);
  hist.forEach(r => rows.push({ ch: 'history', sku: r.sku, m: r.m, u: r.u || 0, r: Math.round((r.r || 0) * 100) / 100 }));
  if (salon.length) channels.push({ id: 'salon', name: 'Salon use', kind: 'salon' });
  if (hist.length) channels.push({ id: 'history', name: meta.source === 'demo' ? 'Demo sales history' : 'Earlier sales (imported)', kind: 'history' });
  if (rows.some(r => r.ch === 'other')) channels.push({ id: 'other', name: 'Other', kind: 'store' });
  return { months, channels, rows: rows.filter(r => r.sku && months.includes(r.m)), currentMonth: end };
}

// Sales between two store-local dates (inclusive): per product, per day, and totals, plus the same number of days just before.
// Counts Shopify and manual-store orders net of removed or refunded items; cancelled, refunded and voided orders are left out.
// Salon use isn't a sale. Each order line is stored once (keyed by its Shopify id), so re-syncs don't double count.
function salesSummary(q) {
  q = q || {};
  const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (!okDate(q.from) || !okDate(q.to) || q.from > q.to) throw new Error('Give a from and to date (YYYY-MM-DD).');
  const DAY = 86400000, span = Math.round((Date.parse(q.to) - Date.parse(q.from)) / DAY) + 1;
  const pFrom = new Date(Date.parse(q.from) - span * DAY).toISOString().slice(0, 10), pTo = new Date(Date.parse(q.from) - DAY).toISOString().slice(0, 10);
  const VALID = "o.cancelled_at IS NULL AND COALESCE(o.financial_status, '') NOT IN ('REFUNDED', 'VOIDED') AND l.sku IS NOT NULL AND l.sku <> ''";
  function lines(from, to) {
    return db.all(`SELECT l.sku, o.local_date AS d, o.shopify_id AS oid, SUM(l.net_quantity) AS u, SUM(l.net_quantity * l.unit_price) AS r
                   FROM order_lines l JOIN orders o ON o.shopify_id = l.order_id
                   WHERE o.local_date >= ? AND o.local_date <= ? AND ${VALID} GROUP BY l.sku, o.local_date, o.shopify_id`, [from, to]);
  }
  // Older imported or demo history has no orders; revenue falls back to units × current retail price.
  function base(from, to) {
    return db.all(`SELECT b.sku, b.date AS d, b.units AS u, CASE WHEN b.revenue > 0 THEN b.revenue ELSE b.units * COALESCE(p.price, 0) END AS r, b.revenue > 0 AS real
                   FROM base_sales b LEFT JOIN products p ON p.sku = b.sku WHERE b.date >= ? AND b.date <= ? AND b.units <> 0`, [from, to]);
  }
  const per = {}, daily = {}, orders = new Set(), tot = { units: 0, revenue: 0 };
  let estimated = false;
  function add(r) {
    const o = per[r.sku] = per[r.sku] || { sku: r.sku, units: 0, revenue: 0, orders: 0 };
    o.units += r.u || 0; o.revenue += r.r || 0;
    const d = daily[r.d] = daily[r.d] || { date: r.d, units: 0, revenue: 0 };
    d.units += r.u || 0; d.revenue += r.r || 0;
    tot.units += r.u || 0; tot.revenue += r.r || 0;
  }
  lines(q.from, q.to).forEach(r => { add(r); if (r.u > 0) { per[r.sku].orders++; orders.add(r.oid); } });
  base(q.from, q.to).forEach(r => { add(r); if (!r.real) estimated = true; });
  const prev = { units: 0, revenue: 0, orders: new Set() };
  lines(pFrom, pTo).forEach(r => { prev.units += r.u || 0; prev.revenue += r.r || 0; if (r.u > 0) prev.orders.add(r.oid); });
  base(pFrom, pTo).forEach(r => { prev.units += r.u || 0; prev.revenue += r.r || 0; });
  const r2 = n => Math.round(n * 100) / 100;
  return {
    from: q.from, to: q.to, days: span, estimated,
    products: Object.values(per).filter(o => o.units > 0).map(o => Object.assign(o, { revenue: r2(o.revenue) })).sort((a, b) => b.units - a.units || b.revenue - a.revenue),
    daily: Object.values(daily).sort((a, b) => a.date < b.date ? -1 : 1).map(d => Object.assign(d, { revenue: r2(d.revenue) })),
    totals: { units: tot.units, revenue: r2(tot.revenue), orders: orders.size },
    prev: { from: pFrom, to: pTo, units: prev.units, revenue: r2(prev.revenue), orders: prev.orders.size }
  };
}

module.exports = { ledger, usageMonthly, salesSummary, TYPE_LABEL };
