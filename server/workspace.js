// Assembles the data the app works with, and replaces it in bulk (demo reset, CSV import).
const db = require('./db');
const DEMO = require('./demo-data.json');

const HIST_DAYS = 456; // ~15 months: 12 months for forecasting plus room for year-over-year
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(s + 'T00:00:00Z') + n * DAY);

function localToday(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return iso(Date.now()); }
}

function meta() {
  const m = db.config('meta', { source: 'demo', asOf: DEMO.meta.asOf, store: '' });
  if (m.source !== 'demo') m.asOf = localToday(m.timezone);
  return m;
}

function build() {
  const m = meta();
  const end = addDays(m.asOf, -1), start = addDays(m.asOf, -HIST_DAYS);
  const sales = {};
  db.all('SELECT sku, date, units FROM daily_sales WHERE date >= ? AND date <= ? UNION ALL SELECT sku, date, units FROM base_sales WHERE date >= ? AND date <= ?', [start, end, start, end]).forEach(r => {
    const s = (sales[r.sku] = sales[r.sku] || {}); s[r.date] = (s[r.date] || 0) + r.units;
  });
  // Items the salon used count as demand too.
  const salonDaily = new Array(HIST_DAYS).fill(0), salonCost = new Array(HIST_DAYS).fill(0), salonBySku = {};
  db.all(`SELECT u.sku, u.date, SUM(u.qty) AS q, MAX(COALESCE(p.cost, 0)) AS c FROM salon_usage u LEFT JOIN products p ON p.sku = u.sku
          WHERE u.counts_demand = 1 AND u.date >= ? AND u.date <= ? GROUP BY u.sku, u.date`, [start, end]).forEach(r => {
    const s = (sales[r.sku] = sales[r.sku] || {}); s[r.date] = (s[r.date] || 0) + r.q;
    (salonBySku[r.sku] = salonBySku[r.sku] || {})[r.date] = r.q;
    const i = Math.round((Date.parse(r.date + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY);
    if (i >= 0 && i < HIST_DAYS) { salonDaily[i] += r.q; salonCost[i] += r.q * r.c; }
  });
  const snaps = {};
  db.all('SELECT sku, date, available FROM inventory_snapshots WHERE date >= ? ORDER BY date', [start]).forEach(r => {
    (snaps[r.sku] = snaps[r.sku] || []).push(r);
  });
  const histStart = m.histStart || start;
  const products = db.all('SELECT * FROM products ORDER BY collection, name').map(r => {
    const p = db.rowToProduct(r);
    const s = sales[p.sku] || {};
    const daily = new Array(HIST_DAYS);
    let first = -1;
    for (let i = 0; i < HIST_DAYS; i++) { const v = s[addDays(start, i)] || 0; daily[i] = v; if (first < 0 && v > 0) first = i; }
    p.daily = daily; p.end = end;
    if (salonBySku[p.sku]) p.salonDays = salonBySku[p.sku]; // part of daily that was salon use (no revenue)
    // Out-of-stock days recorded by syncs (available <= 0 at sync time) join any stored ranges.
    const ranges = (p.oos || []).slice();
    let cur = null;
    (snaps[p.sku] || []).forEach(x => {
      if (x.available <= 0) { if (cur && addDays(cur[1], 1) === x.date) cur[1] = x.date; else { cur = [x.date, x.date]; ranges.push(cur); } }
      else cur = null;
    });
    p.oos = ranges;
    // A product whose first sale comes well after the start of history is treated as a launch.
    if (!p.launch && m.source !== 'demo' && first > 0) {
      const firstDate = addDays(start, first);
      if (firstDate > addDays(histStart, 30) && firstDate > addDays(m.asOf, -120)) p.launch = firstDate;
    }
    return p;
  });
  const lastSyncRows = db.all('SELECT * FROM sync_log ORDER BY id DESC LIMIT 40');
  // Units and revenue per store per day, for the sales-by-store breakdown.
  const storeRows = db.all("SELECT id, COALESCE(name, shop_name, domain) AS name, role FROM stores ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at");
  const storeSales = storeRows.map(st => {
    const u = new Array(HIST_DAYS).fill(0), rv = new Array(HIST_DAYS).fill(0);
    db.all(`SELECT o.local_date AS d, SUM(l.net_quantity) AS u, SUM(l.net_quantity * l.unit_price) AS r FROM order_lines l JOIN orders o ON o.shopify_id = l.order_id
            WHERE o.store_id = ? AND o.local_date >= ? AND o.local_date <= ? AND o.cancelled_at IS NULL AND COALESCE(o.financial_status, '') NOT IN ('REFUNDED', 'VOIDED')
            GROUP BY o.local_date`, [st.id, start, end]).forEach(r => { const i = Math.round((Date.parse(r.d + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY); if (i >= 0 && i < HIST_DAYS) { u[i] = r.u; rv[i] = Math.round(r.r * 100) / 100; } });
    return { id: st.id, name: st.name, role: st.role, units: u, revenue: rv };
  });
  if (salonDaily.some(v => v)) storeSales.push({ id: 'salon', name: 'Salon use', role: 'salon', units: salonDaily, revenue: new Array(HIST_DAYS).fill(0), cost: salonCost.map(v => Math.round(v * 100) / 100) });
  return {
    meta: m,
    salon: require('./salon').list(600),
    settings: db.config('settings', DEMO.settings),
    suppliers: db.all('SELECT * FROM suppliers ORDER BY name').map(db.rowToSupplier),
    products,
    pos: db.listPOs(),
    txns: db.all('SELECT * FROM inventory_txns ORDER BY date DESC, id DESC LIMIT 2000'),
    storeSales,
    sync: { log: lastSyncRows.map(r => ({ at: r.at, kind: r.kind, store: r.store, status: r.status, products: r.products, orders: r.orders, lines: r.lines, skipped: r.skipped, message: r.message })) }
  };
}

// Replace everything with the given workspace (used by "Reset to demo" and CSV import).
function replace(ws) {
  db.tx(() => {
    const keepOrders = ws.meta && ws.meta.source === 'shopify';
    if (!keepOrders) db.clearAll();
    else ['po_lines', 'purchase_orders', 'inventory_txns', 'base_sales', 'products', 'suppliers', 'sync_log'].forEach(t => db.run('DELETE FROM ' + t));
    (ws.suppliers || []).forEach(s => db.upsertSupplier(s));
    (ws.products || []).forEach(p => {
      db.upsertProduct(p);
      if (p.daily && p.daily.length && p.end) db.setDailyFromArray(p.sku, p.end, p.daily, ws.meta.source || 'import');
    });
    (ws.pos || []).forEach(x => db.upsertPO(x));
    (ws.txns || []).forEach(t => db.upsertTxn(Object.assign({ createdAt: t.created_at || t.createdAt || t.date + 'T12:00:00Z' }, t)));
    db.run("INSERT INTO app_config (key, value) VALUES ('meta', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(ws.meta || {})]);
    db.run("INSERT INTO app_config (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(ws.settings || DEMO.settings)]);
    (ws.sync && ws.sync.log || []).slice().reverse().forEach(e => db.run('INSERT INTO sync_log (at, kind, status, products, orders, lines, skipped, message, store) VALUES (?,?,?,?,?,?,?,?,?)',
      [e.at, e.kind, e.status, e.products || 0, e.orders || 0, e.lines || 0, e.skipped || 0, e.message || '', e.store || null]));
  });
}

function seedDemo() {
  replace(JSON.parse(JSON.stringify(DEMO)));
  // A few weeks of example salon usage so the Salon Usage page has something to show.
  const stylists = ['Jennifer', 'Tori', 'Michael', 'Kristoff', 'Aubrie', 'Carlos'];
  const jobs = [['Weft install', 'RW-1B-22', 2], ['K-Tip install', 'KT-4-22', 1], ['Tape-in move-up', 'RT-1B-22', 1], ['Weft install', 'RW-6613-22', 2],
    ['K-Tip install', 'KT-1B-18', 1], ['Color match', 'RW-418-18', 1], ['Tape-in install', 'RT-4-22', 2], ['Weft install', 'RW-4-22', 2]];
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  db.tx(() => {
    for (let d = 1; d <= 42; d++) {
      if (d % 7 === 1 || rnd() < 0.45) continue; // salon closed some days
      const date = addDays(DEMO.meta.asOf, -d), job = jobs[Math.floor(rnd() * jobs.length)], who = stylists[Math.floor(rnd() * stylists.length)];
      const group = 'SAL-DEMO-' + d, id = group + '-1';
      db.run(`INSERT INTO salon_usage (id, group_id, date, sku, qty, stylist, client_ref, service, note, counts_demand, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, group, date, job[1], job[2], who, null, job[0], null, 1, 'tracked', 'Demo', date + 'T18:00:00Z']);
    }
  });
}
function isEmpty() { return !db.get('SELECT 1 AS x FROM products LIMIT 1') && !db.config('meta', null); }

module.exports = { build, replace, seedDemo, isEmpty, meta, localToday, addDays, HIST_DAYS };
