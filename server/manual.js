// Manual mode: run Addendum-Stockline without the Shopify API.
//
// * Stores can be "manual": just a name, no Shopify connection.
// * Sales are recorded by hand per store (or imported from a store's Shopify orders export). They are kept
//   as orders, so forecasts, sales-by-store analytics and undo all work the same as synced orders.
// * Stock is one shared count per product, set by stock counts and adjusted by recorded sales,
//   purchase-order receipts and salon usage.
const crypto = require('crypto');
const db = require('./db');
const shopify = require('./shopify');

const iso = () => new Date().toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'store';

/* ---------- Stores ---------- */
function saveManualStore(input, id) {
  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) throw new Error('Give the store a name, e.g. "Addendum Salon".');
  const existing = id ? db.get('SELECT * FROM stores WHERE id = ?', [id]) : null;
  if (id && !existing) throw new Error('Store not found.');
  if (db.get('SELECT 1 AS x FROM stores WHERE LOWER(COALESCE(name, shop_name, domain)) = LOWER(?) AND id <> ?', [name, id || ''])) throw new Error('There\'s already a store called ' + name + '.');
  const newId = id || 'st_' + crypto.randomBytes(5).toString('hex');
  const domain = existing ? existing.domain : 'manual:' + slug(name) + '-' + newId.slice(3, 7);
  const first = !db.get('SELECT 1 AS x FROM stores');
  const role = input.role === 'primary' || first ? 'primary' : 'sales';
  const priceList = input.priceList === 'stylist' || input.priceList === 'retail' ? input.priceList : existing && existing.price_list ? existing.price_list : /\bpro\b/i.test(name) ? 'stylist' : 'retail';
  db.tx(() => {
    if (role === 'primary') db.run("UPDATE stores SET role = 'sales' WHERE id <> ?", [newId]);
    db.run(`INSERT INTO stores (id, name, domain, role, auth, enabled, created_at, last_status) VALUES (?,?,?,?,'manual',?,?,NULL)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, auth = 'manual', enabled = excluded.enabled`,
    [newId, name, domain, role, input.enabled === false ? 0 : 1, existing ? existing.created_at : iso()]);
    db.run('UPDATE stores SET price_list = ? WHERE id = ?', [priceList, newId]);
    if (!db.get("SELECT 1 AS x FROM stores WHERE role = 'primary'")) db.run("UPDATE stores SET role = 'primary' WHERE id = (SELECT id FROM stores ORDER BY created_at LIMIT 1)");
  });
  markManual();
  return db.get('SELECT * FROM stores WHERE id = ?', [newId]);
}

// Once someone works manually, the workspace is no longer demo data (keeps the date current).
function markManual() {
  const m = db.config('meta', {}) || {};
  if (m.source === 'demo' || !m.source) db.setConfig('meta', Object.assign({}, m, { source: 'manual', asOf: null, storeName: null }));
}

function storeName(id) { const s = db.get('SELECT COALESCE(name, shop_name, domain) AS n FROM stores WHERE id = ?', [id]); return s ? s.n : null; }

/* ---------- Products ---------- */
function createProduct(input) {
  const sku = String(input.sku || '').trim();
  if (!sku || sku.length > 80 || /[\s]/.test(sku) && sku.trim() !== sku) throw new Error('Enter a SKU.');
  if (db.get('SELECT 1 AS x FROM products WHERE sku = ?', [sku])) throw new Error('A product with SKU ' + sku + ' already exists.');
  const name = String(input.name || '').trim(); if (!name) throw new Error('Enter a product name.');
  const num = v => (v === '' || v == null || isNaN(+v) ? null : +v);
  const txt = v => (v == null ? null : String(v).trim().slice(0, 200) || null);
  db.tx(() => db.upsertProduct({
    sku, name, collection: String(input.collection || '').trim() || 'Uncategorized', variant: txt(input.variant),
    groupName: txt(input.groupName), shade: txt(input.shade), length: txt(input.length),
    supplierId: input.supplierId || null, supplierSku: input.supplierSku || null, cost: num(input.cost) || 0, price: num(input.price) || 0, stylistPrice: num(input.stylistPrice),
    moq: num(input.moq), casePack: num(input.casePack) || 1, prodLead: num(input.prodLead), transit: num(input.transit),
    onHand: Math.max(0, num(input.onHand) || 0), committed: 0, status: 'active', overrides: {}, promos: [], oos: [], needsSetup: !input.supplierId
  }));
  if (num(input.onHand)) db.tx(() => db.upsertTxn({ id: 'TX-NEW-' + crypto.randomBytes(4).toString('hex'), date: iso().slice(0, 10), sku, type: 'count', qty: num(input.onHand), ref: 'Starting stock', note: '', user: input.userName }));
  markManual();
  return { sku };
}

function deleteProduct(sku) {
  if (!db.get('SELECT 1 AS x FROM products WHERE sku = ?', [sku])) throw new Error('Product not found: ' + sku + '.');
  const used = db.get('SELECT COUNT(*) AS n FROM po_lines WHERE sku = ?', [sku]).n;
  if (used) throw new Error(sku + ' is on ' + used + ' purchase order line(s). Remove it from those orders, or mark it Discontinued instead.');
  db.tx(() => {
    ['products', 'base_sales', 'daily_sales', 'inventory_snapshots', 'store_inventory', 'forecasts'].forEach(t => db.run('DELETE FROM ' + t + ' WHERE sku = ?', [sku]));
    db.run('DELETE FROM inventory_txns WHERE sku = ?', [sku]);
  });
}

// Upsert from a Shopify Products export (already parsed in the browser). Never touches sales or orders.
function importProducts(rows, opts) {
  opts = opts || {};
  let added = 0, updated = 0, skipped = 0;
  const settings = db.config('settings', {}) || {};
  db.tx(() => {
    (rows || []).forEach(r => {
      const sku = String(r.sku || '').trim(); if (!sku) { skipped++; return; }
      const row = db.get('SELECT * FROM products WHERE sku = ?', [sku]);
      const p = row ? db.rowToProduct(row) : { sku, supplierId: settings.defaultSupplier || null, casePack: 1, overrides: {}, promos: [], oos: [], needsSetup: true, status: 'active', onHand: 0, committed: 0 };
      if (r.name) p.name = String(r.name).slice(0, 200);
      if (r.collection) p.collection = String(r.collection).slice(0, 100);
      if (r.variant != null) p.variant = String(r.variant).slice(0, 100) || null;
      if (r.groupName) p.groupName = String(r.groupName).slice(0, 200);
      if (r.shade && !p.shade) p.shade = String(r.shade).slice(0, 100);
      if (r.price != null && !isNaN(+r.price)) p.price = +r.price;
      if (r.stylistPrice != null && r.stylistPrice !== '' && !isNaN(+r.stylistPrice)) p.stylistPrice = +r.stylistPrice;
      if (r.cost != null && r.cost !== '' && !isNaN(+r.cost)) p.cost = +r.cost;
      if (opts.stock && !p.noSync && r.onHand != null && r.onHand !== '' && !isNaN(+r.onHand)) p.onHand = Math.max(0, +r.onHand);
      if (r.archived) p.status = 'discontinued';
      if (!p.name) p.name = sku;
      db.upsertProduct(p);
      row ? updated++ : added++;
    });
  });
  markManual();
  return { added, updated, skipped };
}

/* ---------- Stock counts ---------- */
// opts.sync: the counts come from an inventory export, so products excluded from inventory sync are skipped.
function countStock(counts, user, note, opts) {
  const date = iso().slice(0, 10); let changed = 0, excluded = 0;
  db.tx(() => {
    (counts || []).forEach(c => {
      const p = db.get('SELECT sku, on_hand, no_sync FROM products WHERE sku = ?', [c.sku]); if (!p) return;
      if (opts && opts.sync && p.no_sync) { excluded++; return; }
      const n = Number(c.onHand); if (!(n >= 0) || n > 1e7) throw new Error('Counts must be 0 or more (' + c.sku + ').');
      const d = n - (p.on_hand || 0); if (!d) return;
      db.run('UPDATE products SET on_hand = ? WHERE sku = ?', [n, c.sku]);
      db.run('INSERT INTO inventory_snapshots (sku, date, available, on_hand) VALUES (?,?,?,?) ON CONFLICT(sku, date) DO UPDATE SET available = excluded.available, on_hand = excluded.on_hand', [c.sku, date, n, n]);
      db.upsertTxn({ id: 'TX-CNT-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), date, sku: c.sku, type: 'count', qty: d, ref: 'Stock count', note: String(note || '').slice(0, 200), user: user && user.name });
      changed++;
    });
  });
  markManual();
  return { changed, excluded };
}

// Include products in inventory sync, or exclude them (their on-hand count is then only changed here).
function setSync(skus, on) {
  skus = Array.from(new Set((skus || []).map(String))).slice(0, 5000);
  if (!skus.length) throw new Error('Select at least one product.');
  let changed = 0;
  db.tx(() => skus.forEach(sku => {
    const row = db.get('SELECT no_sync FROM products WHERE sku = ?', [sku]); if (!row) return;
    if (!!row.no_sync === !on) return;
    db.run('UPDATE products SET no_sync = ?, updated_at = ? WHERE sku = ?', [on ? 0 : 1, iso(), sku]); changed++;
  }));
  return { changed };
}

/* ---------- Sales ---------- */
function validLines(lines) {
  const out = (lines || []).map(l => ({ sku: String(l.sku || '').trim(), qty: Number(l.qty), price: l.price === '' || l.price == null ? null : Number(l.price) })).filter(l => l.sku || l.qty);
  if (!out.length) throw new Error('Add at least one item.');
  out.forEach(l => {
    if (!db.get('SELECT 1 AS x FROM products WHERE sku = ?', [l.sku])) throw new Error('Unknown product: ' + l.sku);
    if (!(l.qty > 0) || l.qty > 100000) throw new Error('Enter a quantity above zero for ' + l.sku + '.');
    if (l.price != null && !(l.price >= 0)) throw new Error('Price can\'t be negative.');
  });
  return out;
}

function adjustStock(sku, delta, date, ref, note, idSuffix, storeId, userName) {
  if ((db.get('SELECT status FROM products WHERE sku = ?', [sku]) || {}).status === 'untracked') return false; // the sale still counts; there's no stock to take off
  db.run('UPDATE products SET on_hand = MAX(0, on_hand + ?) WHERE sku = ?', [delta, sku]);
  db.upsertTxn({ id: 'TX-SALE-' + idSuffix, date, sku, type: 'sale', qty: delta, ref, note, storeId, user: userName });
  return true;
}

// Price a store charges by default: its price list (retail DTC or stylist), falling back to retail.
function defaultPrice(store, sku) {
  const p = db.get('SELECT price, stylist_price FROM products WHERE sku = ?', [sku]) || {};
  if (store && store.price_list === 'stylist' && p.stylist_price != null) return p.stylist_price;
  return p.price || 0;
}

function recordSale(input, user) {
  const store = db.get('SELECT * FROM stores WHERE id = ?', [input.storeId]);
  if (!store) throw new Error('Choose which store the sale was in.');
  const date = String(input.date || '').slice(0, 10);
  if (!DATE.test(date)) throw new Error('Choose the date of the sale.');
  if (Date.parse(date) > Date.now() + 2 * 86400000) throw new Error('That date is in the future.');
  const lines = validLines(input.lines);
  const deduct = input.deduct !== false;
  const ref = String(input.ref || '').trim().slice(0, 60);
  const oid = store.id + ':manual:' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const name = ref || 'Manual sale';
  const customer = String(input.customer || '').trim().slice(0, 80) || null, note = String(input.note || '').trim().slice(0, 200) || null;
  db.tx(() => {
    db.run(`INSERT INTO orders (shopify_id, store_id, name, created_at, local_date, updated_at, cancelled_at, financial_status, synced_at, customer, note) VALUES (?,?,?,?,?,?,NULL,?,?,?,?)`,
      [oid, store.id, name, date + 'T12:00:00Z', date, iso(), 'MANUAL' + (deduct ? '_STOCK' : ''), iso(), customer, note]);
    lines.forEach((l, i) => {
      db.run('INSERT INTO order_lines (shopify_id, order_id, store_id, sku, variant_id, quantity, net_quantity, unit_price) VALUES (?,?,?,?,?,?,?,?)',
        [oid + ':' + (i + 1), oid, store.id, l.sku, null, l.qty, l.qty, l.price != null ? l.price : defaultPrice(store, l.sku)]);
      if (deduct) adjustStock(l.sku, -l.qty, date, storeName(store.id) + ' purchase' + (ref ? ' · ' + ref : ''), [customer, note].filter(Boolean).join(' · '), oid.split(':').pop() + '-' + (i + 1), store.id, user && user.name);
    });
    db.rebuildDailyFromOrders(new Set([date]));
  });
  markManual();
  return { id: oid };
}

function undoSale(id) {
  const o = db.get('SELECT * FROM orders WHERE shopify_id = ?', [id]);
  if (!o || !/^MANUAL/.test(o.financial_status || '')) throw new Error('Only sales recorded here can be undone. Imported orders are replaced by importing again.');
  const lines = db.all('SELECT * FROM order_lines WHERE order_id = ?', [id]);
  db.tx(() => {
    if (o.financial_status === 'MANUAL_STOCK') lines.forEach((l, i) => {
      db.run('UPDATE products SET on_hand = on_hand + ? WHERE sku = ?', [l.net_quantity, l.sku]);
      db.run('DELETE FROM inventory_txns WHERE id = ?', ['TX-SALE-' + id.split(':').pop() + '-' + (i + 1)]);
    });
    db.run('DELETE FROM order_lines WHERE order_id = ?', [id]);
    db.run('DELETE FROM orders WHERE shopify_id = ?', [id]);
    db.rebuildDailyFromOrders(new Set([o.local_date]));
  });
}

// Purchases for the store pages. With a store, every order is listed, including ones synced from Shopify;
// without one, only sales recorded or imported here (the Record Sales page).
function listSales(limit, opts) {
  opts = opts || {};
  const where = [], args = [];
  if (opts.storeId) { where.push('o.store_id = ?'); args.push(opts.storeId); }
  else where.push("(o.financial_status LIKE 'MANUAL%' OR o.financial_status = 'IMPORTED')");
  if (opts.since) { where.push('o.local_date >= ?'); args.push(opts.since); }
  const orders = db.all(`SELECT o.*, COALESCE(s.name, s.shop_name, s.domain) AS store_name FROM orders o LEFT JOIN stores s ON s.id = o.store_id
                         WHERE ${where.join(' AND ')} ORDER BY o.local_date DESC, o.created_at DESC, o.synced_at DESC LIMIT ?`, args.concat([limit || 400]));
  if (!orders.length) return [];
  const ids = orders.map(o => o.shopify_id), lines = {};
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    db.all('SELECT * FROM order_lines WHERE order_id IN (' + chunk.map(() => '?').join(',') + ')', chunk).forEach(l => (lines[l.order_id] = lines[l.order_id] || []).push({ sku: l.sku, qty: l.net_quantity == null ? l.quantity : l.net_quantity, ordered: l.quantity, price: l.unit_price }));
  }
  const kindOf = st => (/^MANUAL/.test(st || '') ? 'manual' : st === 'IMPORTED' ? 'imported' : 'shopify');
  return orders.map(o => ({ id: o.shopify_id, storeId: o.store_id, store: o.store_name, date: o.local_date, createdAt: o.created_at, ref: o.name, customer: o.customer || '', note: o.note || '',
    kind: kindOf(o.financial_status), payment: kindOf(o.financial_status) === 'shopify' ? o.financial_status || '' : '', cancelled: !!o.cancelled_at,
    deducted: o.financial_status === 'MANUAL_STOCK', lines: lines[o.shopify_id] || [] }));
}

// A store's Shopify "Orders" export, parsed in the browser into { name, date, sku, qty, price, cancelled, financial }.
// Orders are keyed by store + order name, so importing the same file again replaces rather than adds.
function importOrders(storeId, rows, opts) {
  opts = opts || {};
  const store = db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
  if (!store) throw new Error('Choose which store this export is from.');
  const byOrder = {}; let skipped = 0, excluded = 0;
  (rows || []).forEach(r => {
    const name = String(r.name || '').trim(), date = String(r.date || '').slice(0, 10);
    if (!name || !DATE.test(date)) { skipped++; return; }
    const o = byOrder[name] = byOrder[name] || { name, date, lines: [], cancelled: false, fin: '', customer: '' };
    if (r.customer && !o.customer) o.customer = r.customer;
    if (r.cancelled) o.cancelled = true;
    if (r.financial) o.fin = String(r.financial).toLowerCase();
    if (!r.sku) { skipped++; return; }
    const qty = Number(r.qty) || 0; if (!qty) return;
    o.lines.push({ sku: String(r.sku).trim(), qty, price: Number(r.price) || 0 });
  });
  const dates = new Set(); let orders = 0, lines = 0, unknown = new Set(), deducted = 0;
  const date0 = iso().slice(0, 10);
  db.tx(() => {
    Object.values(byOrder).forEach(o => {
      const oid = store.id + ':csv:' + o.name;
      const prev = db.get('SELECT local_date FROM orders WHERE shopify_id = ?', [oid]);
      if (prev) dates.add(prev.local_date);
      if (o.cancelled || o.fin === 'refunded' || o.fin === 'voided') {
        excluded++;
        if (prev) { db.run('DELETE FROM order_lines WHERE order_id = ?', [oid]); db.run('DELETE FROM orders WHERE shopify_id = ?', [oid]); }
        return;
      }
      dates.add(o.date);
      db.run(`INSERT INTO orders (shopify_id, store_id, name, created_at, local_date, updated_at, cancelled_at, financial_status, synced_at) VALUES (?,?,?,?,?,?,NULL,'IMPORTED',?)
              ON CONFLICT(shopify_id) DO UPDATE SET local_date = excluded.local_date, created_at = excluded.created_at, updated_at = excluded.updated_at, synced_at = excluded.synced_at`,
      [oid, store.id, o.name, o.date + 'T12:00:00Z', o.date, iso(), iso()]);
      if (o.customer) db.run('UPDATE orders SET customer = ? WHERE shopify_id = ?', [String(o.customer).slice(0, 80), oid]);
      db.run('DELETE FROM order_lines WHERE order_id = ?', [oid]);
      // merge duplicate SKU rows within one order
      const merged = {}; o.lines.forEach(l => { const m = merged[l.sku] = merged[l.sku] || { sku: l.sku, qty: 0, price: l.price }; m.qty += l.qty; });
      Object.values(merged).forEach((l, i) => {
        if (!db.get('SELECT 1 AS x FROM products WHERE sku = ?', [l.sku])) unknown.add(l.sku);
        db.run('INSERT INTO order_lines (shopify_id, order_id, store_id, sku, variant_id, quantity, net_quantity, unit_price) VALUES (?,?,?,?,?,?,?,?)', [oid + ':' + (i + 1), oid, store.id, l.sku, null, l.qty, l.qty, l.price]);
        lines++;
        if (opts.deduct && !prev && adjustStock(l.sku, -l.qty, date0, storeName(store.id) + ' import · ' + o.name, '', 'IMP-' + crypto.randomBytes(4).toString('hex'), store.id, opts.userName)) deducted += l.qty;
      });
      orders++;
    });
    db.rebuildDailyFromOrders(dates);
  });
  markManual();
  db.addSyncLog({ kind: 'Orders CSV import', store: storeName(store.id), status: 'success', products: 0, orders, lines, skipped,
    message: (excluded ? excluded + ' cancelled or refunded orders left out. ' : '') + (unknown.size ? unknown.size + ' SKU(s) not in your products: ' + Array.from(unknown).slice(0, 8).join(', ') + (unknown.size > 8 ? '…' : '') + '. Add them on the Products page, or check the SKUs match. ' : '') + (deducted ? deducted + ' units taken off stock.' : '') });
  return { orders, lines, skipped, excluded, unknown: Array.from(unknown), deducted };
}

// Delete several products. Ones still on purchase orders are kept and listed, so order history stays intact.
function deleteMany(skus) {
  const deleted = [], skipped = [];
  db.tx(() => Array.from(new Set((skus || []).map(String))).forEach(sku => {
    try { deleteProduct(sku); deleted.push(sku); } catch (e) { skipped.push({ sku, reason: e.message }); }
  }));
  return { deleted: deleted.length, skipped };
}

// Change a product's SKU everywhere it's used: sales, stock history, purchase orders, salon usage, forecasts.
const SKU_RE = /^[^\s].{0,79}$/;
function renameSku(from, to) {
  to = String(to || '').trim();
  if (!to || !SKU_RE.test(to)) throw new Error('Enter a SKU for ' + from + '.');
  if (to === from) return from;
  if (!db.get('SELECT 1 AS x FROM products WHERE sku = ?', [from])) throw new Error('Product not found: ' + from + '.');
  if (db.get('SELECT 1 AS x FROM products WHERE sku = ?', [to])) throw new Error('Can\'t change ' + from + ' to ' + to + ': another product already uses that SKU.');
  db.tx(() => {
    db.run('UPDATE products SET sku = ? WHERE sku = ?', [to, from]);
    ['base_sales', 'daily_sales', 'inventory_snapshots', 'store_inventory', 'forecasts', 'inventory_txns', 'order_lines', 'po_lines', 'salon_usage']
      .forEach(t => db.run('UPDATE ' + t + ' SET sku = ? WHERE sku = ?', [to, from]));
  });
  return to;
}

// A product with several variants (colors / lengths), each with its own SKU, added in one go.
function createVariants(input, user) {
  const base = String(input.groupName || input.name || '').trim();
  if (!base) throw new Error('Enter the product name, e.g. Redefined Weft.');
  const vars = (input.variants || []).filter(v => v && (String(v.sku || '').trim() || String(v.color || '').trim()));
  if (!vars.length) throw new Error('Add at least one variant with a SKU.');
  const seen = new Set();
  vars.forEach((v, i) => {
    const sku = String(v.sku || '').trim();
    if (!sku) throw new Error('Variant ' + (i + 1) + (v.color ? ' (' + v.color + ')' : '') + ' needs a SKU.');
    const k = sku.toLowerCase(); if (seen.has(k)) throw new Error('SKU ' + sku + ' is listed twice.'); seen.add(k);
    if (db.get('SELECT 1 AS x FROM products WHERE LOWER(sku) = ?', [k])) throw new Error('SKU ' + sku + ' is already used.');
  });
  const out = [];
  db.tx(() => vars.forEach(v => {
    const color = String(v.color || '').trim(), len = String(v.length != null && v.length !== '' ? v.length : input.length || '').trim();
    const lenTxt = len ? (/^\d+(\.\d+)?$/.test(len) ? len + '"' : len) : '';
    const name = [base, color, lenTxt].filter(Boolean).join(' ');
    const pick = k => (v[k] !== undefined && v[k] !== '' && v[k] !== null ? v[k] : input[k]);
    createProduct({ sku: String(v.sku).trim(), name, groupName: base, shade: color || null, length: len || null, variant: [color, lenTxt].filter(Boolean).join(' / ') || null,
      collection: input.collection, price: pick('price'), stylistPrice: pick('stylistPrice'), cost: pick('cost'), onHand: v.onHand, supplierId: input.supplierId,
      supplierSku: v.supplierSku, moq: input.moq, casePack: input.casePack, prodLead: input.prodLead, transit: input.transit, userName: user && user.name });
    out.push(String(v.sku).trim());
  }));
  return { skus: out, sku: out[0] };
}

/* ---------- Edit a product (details, both prices, and stock with a reason) ---------- */
const EDITABLE = ['name', 'groupName', 'collection', 'variant', 'shade', 'length', 'supplierId', 'supplierSku', 'cost', 'price', 'stylistPrice', 'moq', 'casePack',
  'prodLead', 'transit', 'status', 'launch', 'ssMethod', 'ssDays', 'ssUnits', 'ssPct', 'coverDays', 'targetLevel'];
const NUMERIC = new Set(['cost', 'price', 'stylistPrice', 'moq', 'casePack', 'prodLead', 'transit', 'ssDays', 'ssUnits', 'ssPct', 'coverDays', 'targetLevel']);
const REASONS = { count: 'Stock count', damaged: 'Damaged', lost: 'Lost / missing', returned: 'Customer return', found: 'Found stock', correction: 'Correction', sample: 'Sample / gift', other: 'Other' };
function editProduct(sku, input, user) {
  return db.tx(() => editRow(sku, input, user));
}
// One product's changes, inside the caller's transaction.
function editRow(sku, input, user) {
  const row = db.get('SELECT * FROM products WHERE sku = ?', [sku]);
  if (!row) throw new Error('Product not found: ' + sku + '.');
  const p = db.rowToProduct(row);
  EDITABLE.forEach(k => {
    if (!(k in (input || {}))) return;
    let v = input[k];
    if (NUMERIC.has(k)) {
      v = v === '' || v == null ? null : Number(v);
      if (v != null && (!isFinite(v) || v < 0)) throw new Error('Enter a number of 0 or more for ' + k.replace(/([A-Z])/g, ' $1').toLowerCase() + (input._label ? ' (' + input._label + ')' : '') + '.');
      if (v != null && ['cost', 'price', 'stylistPrice'].includes(k)) v = Math.round(v * 100) / 100;
    } else v = v == null ? null : String(v).trim().slice(0, 200) || null;
    p[k] = v;
  });
  if (!p.name) throw new Error('Enter a product name' + (input._label ? ' (' + input._label + ')' : '') + '.');
  if (p.status && !['active', 'launch', 'discontinued', 'untracked'].includes(p.status)) p.status = 'active';
  if (p.price == null) p.price = 0; if (p.cost == null) p.cost = 0; if (!p.casePack) p.casePack = 1;
  if (p.supplierId && !db.get('SELECT 1 AS x FROM suppliers WHERE id = ?', [p.supplierId])) throw new Error('Unknown supplier.');
  let delta = 0;
  const hasStock = input && input.onHand !== undefined && input.onHand !== '' && input.onHand !== null;
  if (hasStock) {
    const n = Number(input.onHand);
    if (!(n >= 0) || n > 1e7) throw new Error('On hand must be 0 or more' + (input._label ? ' (' + input._label + ')' : '') + '.');
    delta = n - (row.on_hand || 0);
  }
  p.onHand = row.on_hand; // stock only changes through the logged adjustment below
  db.upsertProduct(p);
  if (delta) adjust(sku, delta, input.reason, input.note, user);
  return { ok: true, delta };
}

// Change one field on many products at once. Prices and cost can also go up or down by a % or an amount.
const BULK_FIELDS = { price: 'num', stylistPrice: 'num', cost: 'num', moq: 'num', casePack: 'num', prodLead: 'num', transit: 'num', supplierId: 'text', status: 'text', collection: 'text' };
function bulkSet(skus, field, op, value, user) {
  if (!BULK_FIELDS[field]) throw new Error('That field can\'t be changed in bulk.');
  skus = Array.from(new Set((skus || []).map(String))).slice(0, 5000);
  if (!skus.length) throw new Error('Select at least one product.');
  op = op || 'set';
  const money = ['price', 'stylistPrice', 'cost'].includes(field);
  if (op !== 'set' && !money) throw new Error('Only prices and cost can go up or down.');
  const v = value === '' || value == null ? null : Number(value);
  if (BULK_FIELDS[field] === 'num' && (op !== 'set' || v != null) && !(v >= 0 && isFinite(v))) throw new Error('Enter a number of 0 or more.');
  let changed = 0;
  db.tx(() => skus.forEach(sku => {
    const row = db.get('SELECT * FROM products WHERE sku = ?', [sku]); if (!row) throw new Error('Product not found: ' + sku + '.');
    const cur = db.rowToProduct(row)[field];
    let next;
    if (BULK_FIELDS[field] === 'text') next = value == null ? '' : String(value);
    else if (op === 'set') next = v;
    else {
      if (cur == null || cur === '') return; // nothing to raise or lower
      const c = Number(cur);
      next = op === 'pct_up' ? c * (1 + v / 100) : op === 'pct_down' ? c * (1 - v / 100) : op === 'amt_up' ? c + v : op === 'amt_down' ? c - v : c;
      next = Math.max(0, Math.round(next * 100) / 100);
    }
    if (String(next ?? '') === String(cur ?? '')) return;
    editRow(sku, { [field]: next }, user); changed++;
  }));
  return { changed };
}

// Many products from a spreadsheet (already parsed in the browser). New SKUs are added; stock changes are logged with the reason.
function bulkRows(rows, opts, user) {
  opts = opts || {};
  let updated = 0, added = 0, stock = 0, renamed = 0;
  const sups = db.all('SELECT id, name FROM suppliers');
  const supId = s => { if (s == null || s === '') return ''; const k = String(s).trim().toLowerCase(); const m = sups.find(x => x.id.toLowerCase() === k || x.name.toLowerCase() === k); if (!m) throw new Error('Unknown supplier "' + s + '". Use a name from the Suppliers page.'); return m.id; };
  const statusOf = s => { const k = String(s || '').trim().toLowerCase(); if (!k) return undefined; if (/disc/.test(k)) return 'discontinued'; if (/not|untrack/.test(k)) return 'untracked'; if (/launch|new/.test(k)) return 'launch'; if (/active/.test(k)) return 'active'; throw new Error('Unknown status "' + s + '". Use Active, New launch, Discontinued or Not tracked.'); };
  db.tx(() => (rows || []).slice(0, 5000).forEach((r, i) => {
    let sku = String(r.sku || '').trim(); if (!sku) return;
    const exists0 = db.get('SELECT 1 AS x FROM products WHERE sku = ?', [sku]);
    if (exists0 && r.newSku != null && String(r.newSku).trim() !== sku) { sku = renameSku(sku, r.newSku); renamed++; }
    const input = { _label: sku };
    EDITABLE.forEach(k => { if (r[k] !== undefined) input[k] = r[k]; });
    if (r.supplier !== undefined) input.supplierId = supId(r.supplier);
    if (r.status !== undefined) { const st = statusOf(r.status); if (st) input.status = st; else delete input.status; }
    const exists = db.get('SELECT on_hand FROM products WHERE sku = ?', [sku]);
    if (!exists) {
      if (!r.name) throw new Error('Row ' + (i + 2) + ': new SKU ' + sku + ' needs a name.');
      createProduct(Object.assign({}, input, { sku, onHand: r.onHand, userName: user && user.name }));
      added++; return;
    }
    if (r.onHand !== undefined && r.onHand !== '') { input.onHand = r.onHand; input.reason = opts.reason || 'count'; input.note = opts.note || ''; }
    const res = editRow(sku, input, user);
    if (res.delta) stock++;
    updated++;
  }));
  markManual();
  return { updated, added, stock, renamed };
}

// Change stock by a number of units with a reason; always logged.
function adjust(sku, delta, reason, note, user, date) {
  const row = db.get('SELECT on_hand FROM products WHERE sku = ?', [sku]);
  if (!row) throw new Error('Product not found: ' + sku);
  const d = Number(delta); if (!d || !isFinite(d)) return 0;
  const next = Math.max(0, (row.on_hand || 0) + d), real = next - (row.on_hand || 0);
  if (!real) return 0;
  const day = DATE.test(String(date || '')) ? date : iso().slice(0, 10);
  db.run('UPDATE products SET on_hand = ? WHERE sku = ?', [next, sku]);
  db.run('INSERT INTO inventory_snapshots (sku, date, available, on_hand) VALUES (?,?,?,?) ON CONFLICT(sku, date) DO UPDATE SET available = excluded.available, on_hand = excluded.on_hand', [sku, day, next, next]);
  const r = REASONS[reason] ? reason : 'correction';
  db.upsertTxn({ id: 'TX-ADJ-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), date: day, sku, type: r === 'count' ? 'count' : 'adjust', qty: real, ref: REASONS[r], note: String(note || '').slice(0, 200), user: user && user.name });
  markManual();
  return real;
}
function adjustMany(items, user) {
  let changed = 0;
  db.tx(() => (items || []).forEach(it => {
    const mode = it.mode === 'set' ? 'set' : 'delta';
    const row = db.get('SELECT on_hand FROM products WHERE sku = ?', [it.sku]); if (!row) throw new Error('Unknown product: ' + it.sku);
    const v = Number(it.qty); if (!isFinite(v)) throw new Error('Enter a number for ' + it.sku + '.');
    if (mode === 'set' && v < 0) throw new Error('Counts must be 0 or more.');
    if (adjust(it.sku, mode === 'set' ? v - (row.on_hand || 0) : v, it.reason, it.note, user, it.date)) changed++;
  }));
  return { changed };
}

/* ---------- Start fresh ---------- */
function startFresh(keepSuppliers) {
  db.tx(() => {
    ['po_lines', 'purchase_orders', 'inventory_txns', 'order_lines', 'orders', 'daily_sales', 'base_sales', 'inventory_snapshots', 'store_inventory', 'forecasts', 'salon_usage', 'products', 'sync_log'].forEach(t => db.run('DELETE FROM ' + t));
    if (!keepSuppliers) db.run('DELETE FROM suppliers');
    db.run("DELETE FROM stores WHERE auth = 'manual'");
  });
  db.setConfig('meta', { source: 'manual', store: '', storeName: null });
}

module.exports = { setSync, createVariants, deleteMany, renameSku, bulkSet, bulkRows, saveManualStore, createProduct, deleteProduct, importProducts, countStock, recordSale, undoSale, listSales, importOrders, startFresh, editProduct, adjust, adjustMany, defaultPrice, REASONS };
