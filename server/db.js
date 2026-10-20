// SQLite database (sql.js: pure WebAssembly, nothing to compile).
// The whole database lives in memory and is saved to data/stockline.db after every change.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = process.env.STOCKLINE_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'stockline.db');
let db = null;
let saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, email TEXT, phone TEXT, country TEXT, terms TEXT,
  prod_lead INTEGER, ship_lead INTEGER, moq INTEGER, notes TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  shopify_variant_id TEXT, shopify_product_id TEXT, inventory_item_id TEXT,
  name TEXT NOT NULL, collection TEXT, variant TEXT, shade TEXT, length TEXT,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL, supplier_sku TEXT,
  cost REAL, price REAL, moq INTEGER, case_pack INTEGER, prod_lead INTEGER, transit INTEGER,
  on_hand REAL DEFAULT 0, committed REAL DEFAULT 0, incoming_shopify REAL DEFAULT 0,
  status TEXT DEFAULT 'active', launch TEXT,
  ss_method TEXT, ss_days REAL, ss_units REAL, ss_pct REAL, cover_days REAL, target_level REAL,
  overrides TEXT, promos TEXT, oos TEXT, locations TEXT, needs_setup INTEGER DEFAULT 0, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_variant ON products(shopify_variant_id);

CREATE TABLE IF NOT EXISTS orders (
  shopify_id TEXT PRIMARY KEY, name TEXT, created_at TEXT, local_date TEXT, updated_at TEXT,
  cancelled_at TEXT, financial_status TEXT, synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(local_date);

CREATE TABLE IF NOT EXISTS order_lines (
  shopify_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(shopify_id) ON DELETE CASCADE,
  sku TEXT, variant_id TEXT, quantity INTEGER, net_quantity INTEGER, unit_price REAL
);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_lines_sku ON order_lines(sku);

CREATE TABLE IF NOT EXISTS daily_sales (
  sku TEXT NOT NULL, date TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, revenue REAL NOT NULL DEFAULT 0, source TEXT,
  PRIMARY KEY (sku, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_sales(date);
-- Daily sales that don't come from individual orders (demo data, older CSV imports). Added to daily_sales.
CREATE TABLE IF NOT EXISTS base_sales (
  sku TEXT NOT NULL, date TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, revenue REAL NOT NULL DEFAULT 0, source TEXT,
  PRIMARY KEY (sku, date)
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  sku TEXT NOT NULL, date TEXT NOT NULL, available REAL, on_hand REAL, PRIMARY KEY (sku, date)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL, status TEXT NOT NULL,
  created TEXT, submitted TEXT, stated_lead INTEGER, expected_ship TEXT, expected_delivery TEXT,
  shipped_date TEXT, received_date TEXT, notes TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS po_lines (
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, line_no INTEGER NOT NULL,
  sku TEXT NOT NULL, name TEXT, qty REAL NOT NULL, cost REAL, received REAL DEFAULT 0, damaged REAL DEFAULT 0,
  PRIMARY KEY (po_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_po_lines_sku ON po_lines(sku);

CREATE TABLE IF NOT EXISTS inventory_txns (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, sku TEXT NOT NULL, type TEXT NOT NULL, qty REAL NOT NULL, ref TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_txns_sku ON inventory_txns(sku);

CREATE TABLE IF NOT EXISTS forecasts (
  sku TEXT NOT NULL, date TEXT NOT NULL, status TEXT, velocity REAL, lead_days INTEGER, safety_stock REAL,
  reorder_point REAL, order_by TEXT, stockout TEXT, recommended_qty REAL, PRIMARY KEY (sku, date)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL, password_hash TEXT NOT NULL,
  created_at TEXT, last_login TEXT, disabled INTEGER DEFAULT 0, must_change INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT, expires_at TEXT, user_agent TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY, name TEXT, domain TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'sales',
  auth TEXT NOT NULL, client_id TEXT, client_secret_enc TEXT, admin_token_enc TEXT, api_version TEXT, api_url TEXT, token_url TEXT,
  enabled INTEGER DEFAULT 1, timezone TEXT, currency TEXT, shop_name TEXT, sync_state TEXT,
  last_sync TEXT, last_status TEXT, last_message TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS store_inventory (
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE, sku TEXT NOT NULL, variant_id TEXT,
  on_hand REAL, available REAL, committed REAL, locations TEXT, synced_at TEXT, PRIMARY KEY (store_id, sku)
);

CREATE TABLE IF NOT EXISTS salon_usage (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date TEXT NOT NULL, sku TEXT NOT NULL, qty REAL NOT NULL,
  stylist TEXT, client_ref TEXT, service TEXT, note TEXT, counts_demand INTEGER DEFAULT 1,
  status TEXT NOT NULL, push_error TEXT, store_id TEXT, created_by TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_salon_group ON salon_usage(group_id);
CREATE INDEX IF NOT EXISTS idx_salon_sku_date ON salon_usage(sku, date);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT, status TEXT, products INTEGER, orders INTEGER,
  lines INTEGER, skipped INTEGER, message TEXT
);
`;

let SQL = null;
async function open() {
  SQL = SQL || await initSqlJs();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate();
  save(true);
  return db;
}

function columns(table) { return all('PRAGMA table_info(' + table + ')').map(r => r.name); }
function migrate() {
  // Databases from the first version have no store columns.
  if (columns('orders').indexOf('store_id') < 0) db.run('ALTER TABLE orders ADD COLUMN store_id TEXT');
  if (columns('order_lines').indexOf('store_id') < 0) db.run('ALTER TABLE order_lines ADD COLUMN store_id TEXT');
  if (columns('sync_log').indexOf('store') < 0) db.run('ALTER TABLE sync_log ADD COLUMN store TEXT');
  if (columns('stores').indexOf('locations') < 0) db.run('ALTER TABLE stores ADD COLUMN locations TEXT');
  if (columns('store_inventory').indexOf('inventory_item_id') < 0) db.run('ALTER TABLE store_inventory ADD COLUMN inventory_item_id TEXT');
  if (columns('store_inventory').indexOf('levels') < 0) db.run('ALTER TABLE store_inventory ADD COLUMN levels TEXT');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id)');
  // Version 1 required Shopify variant IDs to be unique; with several stores they can repeat.
  const uniq = all('PRAGMA index_list(products)').filter(i => i.unique && i.origin === 'u')
    .some(i => all('PRAGMA index_info(' + JSON.stringify(i.name) + ')').some(c => c.name === 'shopify_variant_id'));
  if (uniq) {
    const create = SCHEMA.match(/CREATE TABLE IF NOT EXISTS products \([\s\S]*?\n\);/)[0];
    db.run('PRAGMA foreign_keys = OFF');
    db.run('BEGIN');
    db.run('ALTER TABLE products RENAME TO products_v1');
    db.run(create);
    db.run('INSERT INTO products SELECT * FROM products_v1');
    db.run('DROP TABLE products_v1');
    db.run('CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_products_variant ON products(shopify_variant_id)');
    db.run('COMMIT');
    db.run('PRAGMA foreign_keys = ON');
  }
  // Images (added in v4)
  if (columns('products').indexOf('image') < 0) db.run('ALTER TABLE products ADD COLUMN image TEXT');
  if (columns('stores').indexOf('logo') < 0) db.run('ALTER TABLE stores ADD COLUMN logo TEXT');
  // Prices, purchases and stock ledger (v7)
  if (columns('products').indexOf('stylist_price') < 0) db.run('ALTER TABLE products ADD COLUMN stylist_price REAL');
  // Variants (v8): each color/length is its own SKU; group_name is the product they belong to, e.g. "Redefined Weft".
  if (columns('products').indexOf('group_name') < 0) db.run('ALTER TABLE products ADD COLUMN group_name TEXT');
  // Inventory sync selection (v9): 1 = Shopify syncs and inventory imports leave this product's on-hand count alone.
  if (columns('products').indexOf('no_sync') < 0) db.run('ALTER TABLE products ADD COLUMN no_sync INTEGER DEFAULT 0');
  if (columns('stores').indexOf('price_list') < 0) db.run("ALTER TABLE stores ADD COLUMN price_list TEXT DEFAULT 'retail'");
  if (columns('orders').indexOf('customer') < 0) db.run('ALTER TABLE orders ADD COLUMN customer TEXT');
  if (columns('orders').indexOf('note') < 0) db.run('ALTER TABLE orders ADD COLUMN note TEXT');
  if (columns('inventory_txns').indexOf('store_id') < 0) db.run('ALTER TABLE inventory_txns ADD COLUMN store_id TEXT');
  if (columns('inventory_txns').indexOf('created_at') < 0) db.run('ALTER TABLE inventory_txns ADD COLUMN created_at TEXT');
  if (columns('inventory_txns').indexOf('user_name') < 0) db.run('ALTER TABLE inventory_txns ADD COLUMN user_name TEXT');
  db.run('CREATE INDEX IF NOT EXISTS idx_txns_date ON inventory_txns(date)');
  // Manual mode (v6): daily sales not built from orders move to base_sales so recorded sales never erase them.
  if (get("SELECT COUNT(*) AS n FROM daily_sales WHERE COALESCE(source, '') <> 'shopify'").n) {
    db.run("INSERT OR REPLACE INTO base_sales (sku, date, units, revenue, source) SELECT sku, date, units, revenue, source FROM daily_sales WHERE COALESCE(source, '') <> 'shopify'");
    db.run("DELETE FROM daily_sales WHERE COALESCE(source, '') <> 'shopify'");
  }
  // Shopify-embedded app (v5)
  if (columns('stores').indexOf('refresh_token_enc') < 0) db.run('ALTER TABLE stores ADD COLUMN refresh_token_enc TEXT');
  if (columns('stores').indexOf('token_expires') < 0) db.run('ALTER TABLE stores ADD COLUMN token_expires TEXT');
  if (columns('users').indexOf('source') < 0) db.run("ALTER TABLE users ADD COLUMN source TEXT DEFAULT 'password'");
  db.run('CREATE TABLE IF NOT EXISTS shopify_users (shop TEXT NOT NULL, shopify_user_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, linked_at TEXT, PRIMARY KEY (shop, shopify_user_id))');
}

/* ---------- Backups: the whole database as one file ---------- */
function exportBuffer() { return Buffer.from(db.export()); }
// Check that a backup's database opens and is an Addendum-Stockline database, without touching the live one.
function checkBuffer(buf) {
  const t = new SQL.Database(buf);
  try {
    const names = []; const st = t.prepare("SELECT name FROM sqlite_master WHERE type = 'table'"); while (st.step()) names.push(st.getAsObject().name); st.free();
    ['products', 'users', 'stores', 'orders'].forEach(n => { if (names.indexOf(n) < 0) throw new Error('This backup is not an Addendum-Stockline database.'); });
  } finally { t.close(); }
}
// Swap in a restored database (and the key that unlocks its store credentials) without restarting.
function replaceWith(buf) {
  clearTimeout(saveTimer);
  const next = new SQL.Database(buf);
  db.close(); db = next;
  db.run('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate();
  KEY = null;
  save(true);
}

/* ---------- Secrets (store credentials) are encrypted with a key kept beside the database ---------- */
const crypto = require('crypto');
let KEY = null;
function key() {
  if (KEY) return KEY;
  const f = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  KEY = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64');
  return KEY;
}
function mac(text) { return crypto.createHmac('sha256', key()).update(String(text)).digest('base64url'); }
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [iv, tag, enc] = blob.split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (e) { throw new Error('A saved store credential could not be decrypted. If data/secret.key was replaced, re-enter the store\'s credentials in Settings.'); }
}

function save(now) {
  clearTimeout(saveTimer);
  const write = () => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, DB_FILE); // atomic replace so a crash never leaves a half-written file
  };
  if (now) write(); else saveTimer = setTimeout(write, 400);
}

function all(sql, params) {
  const st = db.prepare(sql);
  try { if (params) st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
  finally { st.free(); }
}
function get(sql, params) { return all(sql, params)[0]; }
function run(sql, params) { db.run(sql, params || []); }
// Nested calls join the outer transaction, so a bulk change is all-or-nothing.
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) { txDepth++; try { return fn(); } finally { txDepth--; } }
  db.run('BEGIN'); txDepth = 1;
  try { const r = fn(); txDepth = 0; db.run('COMMIT'); save(); return r; }
  catch (e) { txDepth = 0; db.run('ROLLBACK'); throw e; }
}

/* ---------- Config ---------- */
function config(key, fallback) { const r = get('SELECT value FROM app_config WHERE key = ?', [key]); return r ? JSON.parse(r.value) : fallback; }
function setConfig(key, value) { run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]); save(); }

/* ---------- Mapping between rows and the app's objects ---------- */
const P_FIELDS = [
  ['sku', 'sku'], ['shopifyId', 'shopify_variant_id'], ['shopifyProductId', 'shopify_product_id'], ['inventoryItemId', 'inventory_item_id'],
  ['name', 'name'], ['collection', 'collection'], ['variant', 'variant'], ['shade', 'shade'], ['length', 'length'],
  ['supplierId', 'supplier_id'], ['supplierSku', 'supplier_sku'], ['cost', 'cost'], ['price', 'price'], ['moq', 'moq'], ['casePack', 'case_pack'],
  ['prodLead', 'prod_lead'], ['transit', 'transit'], ['onHand', 'on_hand'], ['committed', 'committed'], ['status', 'status'], ['launch', 'launch'],
  ['ssMethod', 'ss_method'], ['ssDays', 'ss_days'], ['ssUnits', 'ss_units'], ['ssPct', 'ss_pct'], ['coverDays', 'cover_days'], ['targetLevel', 'target_level']
];
P_FIELDS.push(['image', 'image'], ['stylistPrice', 'stylist_price'], ['groupName', 'group_name']);
const P_JSON = [['overrides', 'overrides', {}], ['promos', 'promos', []], ['oos', 'oos', []], ['locations', 'locations', null]];
const nil = v => (v === undefined || v === '' ? null : v);

function upsertProduct(p) {
  const cols = P_FIELDS.map(f => f[1]).concat(P_JSON.map(f => f[1]), ['needs_setup', 'no_sync', 'updated_at']);
  const vals = P_FIELDS.map(f => nil(p[f[0]])).concat(P_JSON.map(f => (p[f[0]] == null ? null : JSON.stringify(p[f[0]]))), [p.needsSetup ? 1 : 0, p.noSync ? 1 : 0, new Date().toISOString()]);
  if (vals[0] == null) throw new Error('Product needs a SKU');
  const si = P_FIELDS.findIndex(f => f[0] === 'supplierId');
  if (vals[si] != null && !get('SELECT 1 AS x FROM suppliers WHERE id = ?', [vals[si]])) vals[si] = null;
  run(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
       ON CONFLICT(sku) DO UPDATE SET ${cols.slice(1).map(c => c + ' = excluded.' + c).join(', ')}`, vals);
}
function rowToProduct(r) {
  const p = {};
  P_FIELDS.forEach(f => { p[f[0]] = r[f[1]] === undefined ? null : r[f[1]]; });
  P_JSON.forEach(f => { try { p[f[0]] = r[f[1]] ? JSON.parse(r[f[1]]) : f[2]; } catch (e) { p[f[0]] = f[2]; } });
  p.needsSetup = !!r.needs_setup;
  p.noSync = !!r.no_sync;
  if (p.length != null && p.length !== '' && !isNaN(+p.length)) p.length = +p.length;
  return p;
}
function deleteProduct(sku) { run('DELETE FROM products WHERE sku = ?', [sku]); save(); }

function upsertSupplier(s) {
  if (!s.id || !s.name) throw new Error('Supplier needs an id and a name');
  run(`INSERT INTO suppliers (id, name, contact, email, phone, country, terms, prod_lead, ship_lead, moq, notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, contact=excluded.contact, email=excluded.email, phone=excluded.phone,
       country=excluded.country, terms=excluded.terms, prod_lead=excluded.prod_lead, ship_lead=excluded.ship_lead, moq=excluded.moq,
       notes=excluded.notes, updated_at=excluded.updated_at`,
  [s.id, s.name, nil(s.contact), nil(s.email), nil(s.phone), nil(s.country), nil(s.terms), nil(s.prodLead), nil(s.shipLead), nil(s.moq), nil(s.notes), new Date().toISOString()]);
}
function rowToSupplier(r) { return { id: r.id, name: r.name, contact: r.contact, email: r.email, phone: r.phone, country: r.country, terms: r.terms, prodLead: r.prod_lead, shipLead: r.ship_lead, moq: r.moq, notes: r.notes }; }

function upsertPO(x) {
  if (!x.id) throw new Error('Purchase order needs an id');
  run(`INSERT INTO purchase_orders (id, supplier_id, status, created, submitted, stated_lead, expected_ship, expected_delivery, shipped_date, received_date, notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET supplier_id=excluded.supplier_id, status=excluded.status, created=excluded.created, submitted=excluded.submitted,
       stated_lead=excluded.stated_lead, expected_ship=excluded.expected_ship, expected_delivery=excluded.expected_delivery,
       shipped_date=excluded.shipped_date, received_date=excluded.received_date, notes=excluded.notes, updated_at=excluded.updated_at`,
  [x.id, nil(x.supplierId), x.status || 'draft', nil(x.created), nil(x.submitted), nil(x.statedLead), nil(x.expectedShip), nil(x.expectedDelivery), nil(x.shippedDate), nil(x.receivedDate), nil(x.notes), new Date().toISOString()]);
  run('DELETE FROM po_lines WHERE po_id = ?', [x.id]);
  (x.lines || []).forEach((l, i) => run('INSERT INTO po_lines (po_id, line_no, sku, name, qty, cost, received, damaged) VALUES (?,?,?,?,?,?,?,?)',
    [x.id, i, l.sku, nil(l.name), +l.qty || 0, +l.cost || 0, +l.received || 0, +l.damaged || 0]));
}
function listPOs() {
  const lines = {};
  all('SELECT * FROM po_lines ORDER BY po_id, line_no').forEach(l => { (lines[l.po_id] = lines[l.po_id] || []).push({ sku: l.sku, name: l.name, qty: l.qty, cost: l.cost, received: l.received, damaged: l.damaged }); });
  return all('SELECT * FROM purchase_orders').map(r => ({
    id: r.id, supplierId: r.supplier_id, status: r.status, created: r.created, submitted: r.submitted, statedLead: r.stated_lead,
    expectedShip: r.expected_ship, expectedDelivery: r.expected_delivery, shippedDate: r.shipped_date, receivedDate: r.received_date, notes: r.notes || '',
    lines: lines[r.id] || []
  })).sort((a, b) => {
    const na = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0, nb = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
    return nb - na;
  });
}
function upsertTxn(t) {
  run(`INSERT INTO inventory_txns (id, date, sku, type, qty, ref, note, store_id, created_at, user_name) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET date=excluded.date, sku=excluded.sku, type=excluded.type, qty=excluded.qty, ref=excluded.ref, note=excluded.note,
       store_id=COALESCE(excluded.store_id, inventory_txns.store_id), user_name=COALESCE(excluded.user_name, inventory_txns.user_name)`,
  [t.id, t.date, t.sku, t.type, +t.qty || 0, nil(t.ref), nil(t.note), nil(t.storeId), t.createdAt || new Date().toISOString(), nil(t.user)]);
}

function addSyncLog(e) {
  run('INSERT INTO sync_log (at, kind, status, products, orders, lines, skipped, message, store) VALUES (?,?,?,?,?,?,?,?,?)',
    [e.at || new Date().toISOString(), e.kind, e.status, e.products || 0, e.orders || 0, e.lines || 0, e.skipped || 0, e.message || '', e.store || null]);
  run('DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 200)');
  save();
}

/* ---------- Daily sales ---------- */
function setDailyFromArray(sku, end, daily, source) {
  // daily[last] is the date `end`; zeros are stored too so a re-import replaces rather than adds
  const n = daily.length;
  const endT = Date.parse(end + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    const d = new Date(endT - (n - 1 - i) * 86400000).toISOString().slice(0, 10);
    run('INSERT INTO base_sales (sku, date, units, revenue, source) VALUES (?,?,?,?,?) ON CONFLICT(sku, date) DO UPDATE SET units=excluded.units, revenue=excluded.revenue, source=excluded.source',
      [sku, d, +daily[i] || 0, 0, source]);
  }
}

// Rebuild daily_sales for the given store-local dates from the synced Shopify orders.
function rebuildDailyFromOrders(dates) {
  const list = Array.from(dates);
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200), q = chunk.map(() => '?').join(',');
    run(`DELETE FROM daily_sales WHERE date IN (${q})`, chunk);
    run(`INSERT INTO daily_sales (sku, date, units, revenue, source)
         SELECT l.sku, o.local_date, SUM(l.net_quantity), SUM(l.net_quantity * l.unit_price), 'shopify'
         FROM order_lines l JOIN orders o ON o.shopify_id = l.order_id
         WHERE o.local_date IN (${q}) AND o.cancelled_at IS NULL
           AND COALESCE(o.financial_status, '') NOT IN ('REFUNDED', 'VOIDED')
           AND l.sku IS NOT NULL AND l.sku <> ''
         GROUP BY l.sku, o.local_date
         HAVING SUM(l.net_quantity) <> 0`, chunk);
  }
}

function clearAll() {
  ['po_lines', 'purchase_orders', 'inventory_txns', 'order_lines', 'orders', 'daily_sales', 'base_sales', 'inventory_snapshots', 'store_inventory', 'forecasts', 'salon_usage', 'products', 'suppliers', 'sync_log']
    .forEach(t => run('DELETE FROM ' + t));
  run("DELETE FROM app_config WHERE key IN ('meta', 'sync_state')");
  run('UPDATE stores SET sync_state = NULL');
}

module.exports = {
  open, save, all, get, run, tx, config, setConfig, DB_FILE, DATA_DIR, encrypt, decrypt, mac,
  upsertProduct, rowToProduct, deleteProduct, upsertSupplier, rowToSupplier, upsertPO, listPOs, upsertTxn,
  addSyncLog, setDailyFromArray, rebuildDailyFromOrders, clearAll, exportBuffer, checkBuffer, replaceWith
};
