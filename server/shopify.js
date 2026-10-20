// Shopify Admin GraphQL sync for one or more stores that share the same inventory.
//
// * One store is the "stock source": its on-hand counts are your physical stock.
// * Every store adds its orders to sales history, and its unfulfilled orders to committed stock.
// * Products are matched across stores by SKU.
//
// Idempotent: orders and order lines are keyed on store + Shopify ID, so a sync can be repeated or
// interrupted without double-counting. Incremental: after the first import, only orders updated since the
// last sync are fetched. Requests retry on rate limits, server errors and network drops; every run is logged.
const crypto = require('crypto');
const db = require('./db');
const ws = require('./workspace');

const state = { running: false, startedAt: null, step: '', progress: '', store: '', lastResult: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/* ---------- Store records ---------- */
function rowToStore(r) {
  return r && {
    id: r.id, name: r.name || r.shop_name || r.domain, domain: r.domain, role: r.role, auth: r.auth, clientId: r.client_id,
    hasSecret: !!r.client_secret_enc, hasToken: !!r.admin_token_enc, apiVersion: r.api_version || defaultVersion(), enabled: !!r.enabled,
    timezone: r.timezone, currency: r.currency, shopName: r.shop_name, lastSync: r.last_sync, lastStatus: r.last_status, lastMessage: r.last_message,
    apiUrl: r.api_url || null, tokenUrl: r.token_url || null, logo: r.logo || null, priceList: r.price_list || 'retail'
  };
}
const defaultVersion = () => process.env.SHOPIFY_API_VERSION || '2026-10';
function listStores() { return db.all("SELECT * FROM stores ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at").map(rowToStore); }
function getStoreRow(id) { return db.get('SELECT * FROM stores WHERE id = ?', [id]); }

function saveStore(input, id) {
  const domain = cleanDomain(input.domain);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('Use the store\'s myshopify.com address, e.g. yourstore.myshopify.com.');
  const existing = id ? getStoreRow(id) : null;
  if (id && !existing) throw new Error('Store not found.');
  const dup = db.get('SELECT id FROM stores WHERE domain = ?', [domain]);
  if (dup && dup.id !== id) throw new Error('That store is already connected.');
  const auth = input.auth === 'token' ? 'token' : (input.auth === 'app' || input.auth === 'exchange') ? (existing && existing.auth === 'exchange' ? 'exchange' : 'app') : 'client';
  const secret = input.clientSecret ? db.encrypt(input.clientSecret) : existing ? existing.client_secret_enc : null;
  const token = input.adminToken ? db.encrypt(input.adminToken) : existing ? existing.admin_token_enc : null;
  if (auth === 'client' && (!input.clientId || !secret)) throw new Error('Enter the app\'s client ID and client secret.');
  const keepExchange = auth === 'exchange' || auth === 'app';
  if (auth === 'token' && !token) throw new Error('Enter the Admin API access token.');
  const count = db.get('SELECT COUNT(*) AS n FROM stores').n;
  let role = input.role === 'primary' || (!existing && count === 0) ? 'primary' : 'sales';
  const newId = id || 'st_' + crypto.randomBytes(5).toString('hex');
  // Custom endpoints exist only for automated tests; ignored unless STOCKLINE_TEST_HOOKS=1.
  if (process.env.STOCKLINE_TEST_HOOKS !== '1') { input.apiUrl = null; input.tokenUrl = null; }
  db.tx(() => {
    if (role === 'primary') db.run("UPDATE stores SET role = 'sales' WHERE id <> ?", [newId]);
    db.run(`INSERT INTO stores (id, name, domain, role, auth, client_id, client_secret_enc, admin_token_enc, api_version, api_url, token_url, enabled, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, domain=excluded.domain, role=excluded.role, auth=excluded.auth, client_id=excluded.client_id,
            client_secret_enc=excluded.client_secret_enc, admin_token_enc=excluded.admin_token_enc, api_version=excluded.api_version,
            api_url=excluded.api_url, token_url=excluded.token_url, enabled=excluded.enabled`,
    [newId, String(input.name || '').trim().slice(0, 60) || null, domain, role, auth, keepExchange ? null : input.clientId || null, keepExchange ? null : secret, keepExchange ? (existing && existing.admin_token_enc) || null : token, input.apiVersion || defaultVersion(),
      input.apiUrl || (process.env.STOCKLINE_TEST_HOOKS === '1' && existing && existing.api_url) || null, input.tokenUrl || (process.env.STOCKLINE_TEST_HOOKS === '1' && existing && existing.token_url) || null, input.enabled === false ? 0 : 1, existing ? existing.created_at : new Date().toISOString()]);
    // With no store marked as stock source, the first one takes the role.
    if (!db.get("SELECT 1 AS x FROM stores WHERE role = 'primary'")) db.run("UPDATE stores SET role = 'primary' WHERE id = (SELECT id FROM stores ORDER BY created_at LIMIT 1)");
  });
  delete tokens[newId];
  if (existing && existing.domain !== domain) db.tx(() => db.run('UPDATE stores SET sync_state = NULL WHERE id = ?', [newId]));
  recomputeInventory(); refreshMeta();
  return rowToStore(getStoreRow(newId));
}

function removeStore(id) {
  const st = getStoreRow(id); if (!st) throw new Error('Store not found.');
  db.tx(() => {
    const dates = db.all('SELECT DISTINCT local_date AS d FROM orders WHERE store_id = ?', [id]).map(r => r.d);
    db.run('DELETE FROM order_lines WHERE store_id = ?', [id]);
    db.run('DELETE FROM orders WHERE store_id = ?', [id]);
    db.run('DELETE FROM store_inventory WHERE store_id = ?', [id]);
    db.run('DELETE FROM stores WHERE id = ?', [id]);
    if (st.role === 'primary') db.run("UPDATE stores SET role = 'primary' WHERE id = (SELECT id FROM stores ORDER BY created_at LIMIT 1)");
    db.rebuildDailyFromOrders(new Set(dates));
  });
  recomputeInventory(); refreshMeta();
}

// First run after upgrading: a store configured in .env becomes the first saved store.
function importEnvStore() {
  const domain = cleanDomain(process.env.SHOPIFY_STORE_DOMAIN);
  const token = process.env.SHOPIFY_ADMIN_TOKEN, cid = process.env.SHOPIFY_CLIENT_ID, sec = process.env.SHOPIFY_CLIENT_SECRET;
  if (!domain || !(token || (cid && sec))) return null;
  if (db.get('SELECT id FROM stores WHERE domain = ?', [domain])) return null;
  const st = saveStore({ domain, auth: token ? 'token' : 'client', adminToken: token, clientId: cid, clientSecret: sec, role: db.get('SELECT 1 AS x FROM stores') ? 'sales' : 'primary',
    apiUrl: process.env.SHOPIFY_API_URL, tokenUrl: process.env.SHOPIFY_TOKEN_URL });
  // carry over the single-store sync position so the next sync stays incremental
  const old = db.config('sync_state', null);
  if (old && old.ordersUpdatedAt) {
    db.tx(() => {
      db.run('UPDATE stores SET sync_state = ? WHERE id = ?', [JSON.stringify(old), st.id]);
      db.run('UPDATE orders SET store_id = ? WHERE store_id IS NULL', [st.id]);
      db.run('UPDATE order_lines SET store_id = ? WHERE store_id IS NULL', [st.id]);
    });
  }
  return st;
}

/* ---------- API calls ---------- */
const tokens = {};
function clearTokens() { Object.keys(tokens).forEach(k => delete tokens[k]); }
// Stores connected by opening the Shopify app hold an expiring offline token (1 hour) plus a refresh token.
async function refreshExchanged(st) {
  const fresh = db.get('SELECT * FROM stores WHERE id = ?', [st.id]) || st;
  if (fresh.admin_token_enc && fresh.token_expires && Date.parse(fresh.token_expires) > Date.now() + 120000) return db.decrypt(fresh.admin_token_enc);
  if (!fresh.refresh_token_enc) throw new Error(st.domain + ' needs to be reconnected: open Addendum-Stockline from that store\'s Shopify admin once.');
  const key = process.env.SHOPIFY_API_KEY, secret = process.env.SHOPIFY_API_SECRET;
  if (!key || !secret) throw new Error('SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set to refresh ' + st.domain + '\'s access.');
  const url = process.env.SHOPIFY_TOKEN_URL_TEMPLATE ? process.env.SHOPIFY_TOKEN_URL_TEMPLATE.replace('{shop}', st.domain) : `https://${st.domain}/admin/oauth/access_token`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: db.decrypt(fresh.refresh_token_enc) }).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    db.tx(() => db.run("UPDATE stores SET last_status = 'error', last_message = ? WHERE id = ?", ['Access expired. Open Addendum-Stockline from this store\'s Shopify admin to reconnect.', st.id]));
    throw new Error(st.domain + '\'s access could not be renewed (HTTP ' + res.status + '). Open Addendum-Stockline from that store\'s Shopify admin to reconnect.');
  }
  storeTokens(st.id, j);
  return j.access_token;
}
function storeTokens(id, t) {
  db.tx(() => db.run('UPDATE stores SET admin_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires = ? WHERE id = ?',
    [db.encrypt(t.access_token), t.refresh_token ? db.encrypt(t.refresh_token) : null, t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null, id]));
}
// Called the first time a store opens the embedded app (or after a reinstall).
function saveExchangedStore(shop, t) {
  let row = db.get('SELECT * FROM stores WHERE domain = ?', [shop]);
  if (!row) {
    const id = 'st_' + crypto.randomBytes(5).toString('hex');
    const first = !db.get('SELECT 1 AS x FROM stores');
    db.tx(() => db.run('INSERT INTO stores (id, domain, role, auth, api_version, enabled, created_at) VALUES (?,?,?,?,?,?,?)',
      [id, shop, first ? 'primary' : 'sales', 'exchange', defaultVersion(), 1, new Date().toISOString()]));
    row = getStoreRow(id);
  } else db.tx(() => db.run("UPDATE stores SET auth = 'exchange', enabled = 1, last_status = NULL, last_message = NULL WHERE id = ?", [row.id]));
  storeTokens(row.id, t);
  delete tokens[row.id];
  console.log(new Date().toLocaleTimeString(), 'Connected', shop, 'through the Shopify app');
  testStore(row.id).catch(e => console.error('Store check failed:', e.message));
  return rowToStore(getStoreRow(row.id));
}

async function accessToken(st, force) {
  if (st.auth === 'token') return db.decrypt(st.admin_token_enc);
  if (st.auth === 'exchange') return refreshExchanged(force ? Object.assign({}, st, { token_expires: null }) : st);
  if (st.auth === 'app') throw new Error(st.domain + ' isn\'t connected yet. Install Addendum-Stockline on that store and open it once from its Shopify admin.');
  const c = tokens[st.id];
  if (!force && c && Date.now() < c.until) return c.token;
  const url = st.token_url || `https://${st.domain}/admin/oauth/access_token`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: st.client_id, client_secret: db.decrypt(st.client_secret_enc) }).toString() });
  } catch (e) { throw new Error('Could not reach ' + st.domain + ' to get an access token (' + (e.cause && e.cause.code || e.message) + ').'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('Shopify did not issue an access token for ' + st.domain + ' (HTTP ' + res.status + (j.error ? ': ' + (j.error_description || j.error) : '') + '). Check the client ID and secret, that the app is installed on this store, and that the app and store are in the same Shopify organization.');
  tokens[st.id] = { token: j.access_token, until: Date.now() + Math.max(60, (+j.expires_in || 86399) - 300) * 1000 };
  return j.access_token;
}

async function gql(st, query, variables) {
  const testUrl = process.env.STOCKLINE_TEST_HOOKS === '1' && process.env.SHOPIFY_API_URL_TEMPLATE ? process.env.SHOPIFY_API_URL_TEMPLATE.replace('{shop}', st.domain) : null;
  const url = st.api_url || testUrl || `https://${st.domain}/admin/api/${st.api_version || defaultVersion()}/graphql.json`;
  let attempt = 0, refreshed = false;
  for (;;) {
    attempt++;
    let res, body;
    const tok = await accessToken(st);
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tok }, body: JSON.stringify({ query, variables }) });
    } catch (e) {
      if (attempt >= 6) throw new Error('Could not reach ' + st.domain + ' (' + (e.cause && e.cause.code || e.message) + '). Check your internet connection and the store address.');
      await sleep(1000 * Math.pow(2, attempt)); continue;
    }
    if (res.status === 401 && (st.auth === 'client' || st.auth === 'exchange') && !refreshed) { refreshed = true; await accessToken(st, true); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(st.domain + ' rejected the credentials (HTTP ' + res.status + '). Check them in Settings → Stores and the app\'s API scopes.');
    if (res.status === 404) throw new Error(st.domain + ' was not found (HTTP 404). Check the store address and API version.');
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new Error(st.domain + ' kept returning HTTP ' + res.status + ' after ' + attempt + ' attempts.');
      const ra = parseFloat(res.headers.get('retry-after'));
      await sleep(isNaN(ra) ? 1000 * Math.pow(2, attempt) : ra * 1000); continue;
    }
    try { body = await res.json(); } catch (e) { throw new Error(st.domain + ' returned an unreadable response (HTTP ' + res.status + ').'); }
    const throttled = (body.errors || []).some(e => e.extensions && e.extensions.code === 'THROTTLED');
    const ts = body.extensions && body.extensions.cost && body.extensions.cost.throttleStatus;
    if (throttled) {
      if (attempt >= 8) throw new Error('Shopify rate limit on ' + st.domain + ' did not clear.');
      const need = body.extensions && body.extensions.cost ? body.extensions.cost.requestedQueryCost : 500;
      const wait = ts ? Math.max(1, (need - ts.currentlyAvailable) / (ts.restoreRate || 50)) : Math.pow(2, attempt);
      await sleep(wait * 1000 + 250); continue;
    }
    if (body.errors && body.errors.length) {
      const msg = body.errors.map(e => e.message).join('; ');
      if (/access denied|read_all_orders|scope/i.test(msg)) throw new Error('Missing API permission on ' + st.domain + ': ' + msg + ' The app needs read_products, read_inventory, read_orders and read_all_orders.');
      throw new Error('Shopify error from ' + st.domain + ': ' + msg);
    }
    if (ts && ts.currentlyAvailable < 150) await sleep(Math.ceil((150 - ts.currentlyAvailable) / (ts.restoreRate || 50)) * 1000);
    return body.data;
  }
}

const Q_SHOP = `{ shop { name myshopifyDomain ianaTimezone currencyCode } }`;
const Q_VARIANTS = `query($cursor: String) {
  productVariants(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sku title displayName price
      selectedOptions { name value }
      product { id title productType status }
      inventoryItem {
        id tracked unitCost { amount }
        inventoryLevels(first: 8) { nodes { location { id name } quantities(names: ["available", "on_hand", "committed"]) { name quantity } } }
      }
    }
  }
}`;
const Q_ORDERS = `query($cursor: String, $q: String) {
  orders(first: 25, after: $cursor, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt displayFinancialStatus
      lineItems(first: 30) { pageInfo { hasNextPage endCursor } nodes { id sku quantity currentQuantity originalUnitPriceSet { shopMoney { amount } } variant { id } } }
    }
  }
}`;
const Q_MORE_LINES = `query($id: ID!, $cursor: String) {
  order(id: $id) { lineItems(first: 50, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id sku quantity currentQuantity originalUnitPriceSet { shopMoney { amount } } variant { id } } } }
}`;

function localDate(isoTs, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(isoTs)); }
  catch (e) { return String(isoTs).slice(0, 10); }
}
const numId = gid => String(gid || '').split('/').pop();

async function testStore(id) {
  const st = getStoreRow(id); if (!st) throw new Error('Store not found.');
  const shop = (await gql(st, Q_SHOP)).shop;
  db.tx(() => db.run('UPDATE stores SET shop_name = ?, timezone = ?, currency = ?, name = COALESCE(name, ?) WHERE id = ?', [shop.name, shop.ianaTimezone, shop.currencyCode, shop.name, id]));
  refreshMeta();
  return shop;
}

/* ---------- Combine stores into one inventory picture ---------- */
// On hand comes from the stock-source store (or, for a SKU it doesn't carry, the largest count among the others).
// Committed adds up every store's unfulfilled orders.
function recomputeInventory() {
  const stores = db.all('SELECT id, role, enabled FROM stores');
  if (!stores.length) return;
  const roleOf = {}; stores.forEach(s => { roleOf[s.id] = s.enabled ? s.role : 'off'; });
  const by = {};
  db.all('SELECT * FROM store_inventory').forEach(r => { if (roleOf[r.store_id] && roleOf[r.store_id] !== 'off') (by[r.sku] = by[r.sku] || []).push(r); });
  const today = localDate(new Date().toISOString(), (db.config('meta', {}) || {}).timezone);
  const noSync = new Set(db.all('SELECT sku FROM products WHERE no_sync = 1').map(r => r.sku));
  db.tx(() => {
    Object.keys(by).forEach(sku => {
      const rows = by[sku], prim = rows.filter(r => roleOf[r.store_id] === 'primary')[0];
      const src = prim || rows.slice().sort((a, b) => (b.on_hand || 0) - (a.on_hand || 0))[0];
      const committed = rows.reduce((s, r) => s + (r.committed || 0), 0);
      // Excluded from inventory sync: keep our own on-hand count; unfulfilled orders still count as committed.
      if (noSync.has(sku)) { db.run('UPDATE products SET committed = ? WHERE sku = ?', [committed, sku]); return; }
      const locs = {};
      try { Object.assign(locs, JSON.parse(src.locations || '{}')); } catch (e) {}
      // Salon usage is tracked in Addendum-Stockline only. When "Subtract from stock" is on, it comes off Shopify's count here.
      const salonOff = (db.config('settings', {}) || {}).salonDeduct ? ((db.get("SELECT COALESCE(SUM(qty), 0) AS n FROM salon_usage WHERE sku = ? AND status = 'local'", [sku]) || {}).n || 0) : 0;
      const onHand = Math.max(0, (src.on_hand || 0) - salonOff);
      const before = db.get('SELECT on_hand FROM products WHERE sku = ?', [sku]);
      if (before && before.on_hand != null && before.on_hand !== onHand) db.upsertTxn({ id: 'TX-SYNC-' + today + '-' + sku, date: today, sku, type: 'sync', qty: onHand - before.on_hand + ((db.get('SELECT qty FROM inventory_txns WHERE id = ?', ['TX-SYNC-' + today + '-' + sku]) || {}).qty || 0), ref: 'Shopify count', note: '' });
      db.run('UPDATE products SET on_hand = ?, committed = ?, locations = ? WHERE sku = ?', [onHand, committed, JSON.stringify(locs), sku]);
      const avail = onHand - committed;
      db.run('INSERT INTO inventory_snapshots (sku, date, available, on_hand) VALUES (?,?,?,?) ON CONFLICT(sku, date) DO UPDATE SET available = excluded.available, on_hand = excluded.on_hand', [sku, today, avail, onHand]);
    });
  });
}

/* ---------- Sync ---------- */
async function syncStore(st, opts, counts, notes, dates) {
  state.store = st.name || st.domain;
  state.step = 'Connecting';
  const shop = (await gql(st, Q_SHOP)).shop;
  const tz = shop.ianaTimezone, isPrimary = st.role === 'primary';
  db.tx(() => db.run('UPDATE stores SET shop_name = ?, timezone = ?, currency = ?, name = COALESCE(name, ?) WHERE id = ?', [shop.name, tz, shop.currencyCode, shop.name, st.id]));
  const settings = db.config('settings', {});

  // ---- Products, variants and this store's inventory ----
  state.step = 'Products & inventory';
  let cursor = null, pages = 0;
  const seen = new Set(), storeLocs = {};
  do {
    const conn = (await gql(st, Q_VARIANTS, { cursor })).productVariants;
    db.tx(() => {
      conn.nodes.forEach(v => {
        const sku = (v.sku || '').trim() || 'VARIANT-' + numId(v.id);
        seen.add(sku);
        // Products are matched by SKU only. Product details (name, collection, prices, cost, status) are internal:
        // a sync reads Shopify's inventory for a SKU we already have and never changes those details.
        // A SKU we don't have yet is added once, starting from Shopify's details. Nothing is ever written to Shopify.
        const existing = db.get('SELECT * FROM products WHERE sku = ?', [sku]);
        if (!existing) {
          const opts2 = (v.selectedOptions || []).map(o => o.value).filter(x => x && x !== 'Default Title');
          const cost = v.inventoryItem && v.inventoryItem.unitCost ? parseFloat(v.inventoryItem.unitCost.amount) : NaN;
          const p = { sku, supplierId: settings.defaultSupplier || null, casePack: 1, overrides: {}, promos: [], oos: [], needsSetup: true, status: 'active', onHand: 0, committed: 0 };
          if (isPrimary) { p.shopifyId = v.id; p.shopifyProductId = v.product.id; p.inventoryItemId = v.inventoryItem && v.inventoryItem.id; }
          p.name = v.product.title + (opts2.length ? ' ' + opts2.join(' / ') : '');
          p.variant = opts2.join(' / '); p.collection = v.product.productType || v.product.title;
          p.price = parseFloat(v.price) || 0;
          if (!isNaN(cost)) p.cost = cost;
          if (v.product.status === 'ARCHIVED') p.status = 'discontinued';
          else if (v.inventoryItem && v.inventoryItem.tracked === false) p.status = 'untracked'; // "Track quantity" is off in Shopify
          db.upsertProduct(p);
          counts.added = (counts.added || 0) + 1;
        } else if (isPrimary && existing.shopify_variant_id !== v.id) {
          // Remember which Shopify variant this SKU is, for reference only.
          db.run('UPDATE products SET shopify_variant_id = ?, shopify_product_id = ?, inventory_item_id = ? WHERE sku = ?', [v.id, v.product.id, v.inventoryItem && v.inventoryItem.id, sku]);
        }
        let on = 0, av = 0, cm = 0; const locs = {}, levels = {};
        ((v.inventoryItem && v.inventoryItem.inventoryLevels.nodes) || []).forEach(l => {
          const q = {}; (l.quantities || []).forEach(x => { q[x.name] = x.quantity; });
          on += q.on_hand || 0; av += q.available || 0; cm += q.committed || 0; locs[l.location.name] = q.on_hand || 0;
          if (l.location.id) { levels[l.location.id] = { available: q.available || 0, onHand: q.on_hand || 0 }; storeLocs[l.location.id] = l.location.name; }
        });
        db.run(`INSERT INTO store_inventory (store_id, sku, variant_id, inventory_item_id, on_hand, available, committed, locations, levels, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(store_id, sku) DO UPDATE SET variant_id=excluded.variant_id, inventory_item_id=excluded.inventory_item_id, on_hand=excluded.on_hand, available=excluded.available,
                committed=excluded.committed, locations=excluded.locations, levels=excluded.levels, synced_at=excluded.synced_at`,
        [st.id, sku, v.id, v.inventoryItem && v.inventoryItem.id, on, av, cm, JSON.stringify(locs), JSON.stringify(levels), new Date().toISOString()]);
        counts.products++;
      });
    });
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    state.progress = counts.products + ' variants';
    pages++;
  } while (cursor && pages < 2000);
  if (Object.keys(storeLocs).length) db.tx(() => db.run('UPDATE stores SET locations = ? WHERE id = ?', [JSON.stringify(storeLocs), st.id]));
  // Variants deleted from this store no longer count toward its inventory.
  const gone = db.all('SELECT sku FROM store_inventory WHERE store_id = ?', [st.id]).filter(r => !seen.has(r.sku));
  if (gone.length) db.tx(() => gone.forEach(r => db.run('DELETE FROM store_inventory WHERE store_id = ? AND sku = ?', [st.id, r.sku])));

  // ---- Orders (incremental after the first run) ----
  state.step = 'Orders';
  let ss = {}; try { ss = JSON.parse(st.sync_state || '{}') || {}; } catch (e) {}
  const full = opts.full || !ss.ordersUpdatedAt;
  const since = full ? new Date(Date.now() - ws.HIST_DAYS * 86400000).toISOString() : new Date(Date.parse(ss.ordersUpdatedAt) - 3600000).toISOString();
  const q = (full ? 'created_at:>=' : 'updated_at:>=') + "'" + since + "'";
  let maxUpdated = ss.ordersUpdatedAt || null, storeOrders = 0;
  const key = gid => st.id + ':' + gid;
  cursor = null; pages = 0;
  do {
    const conn = (await gql(st, Q_ORDERS, { cursor, q })).orders;
    for (const o of conn.nodes) {
      let lines = o.lineItems.nodes.slice(), lc = o.lineItems.pageInfo;
      while (lc.hasNextPage) { const more = (await gql(st, Q_MORE_LINES, { id: o.id, cursor: lc.endCursor })).order.lineItems; lines = lines.concat(more.nodes); lc = more.pageInfo; }
      o._lines = lines;
    }
    db.tx(() => {
      conn.nodes.forEach(o => {
        const ld = localDate(o.createdAt, tz), oid = key(o.id);
        const prev = db.get('SELECT local_date FROM orders WHERE shopify_id = ?', [oid]);
        if (prev && prev.local_date) dates.add(prev.local_date);
        dates.add(ld);
        db.run(`INSERT INTO orders (shopify_id, store_id, name, created_at, local_date, updated_at, cancelled_at, financial_status, synced_at) VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(shopify_id) DO UPDATE SET store_id=excluded.store_id, name=excluded.name, created_at=excluded.created_at, local_date=excluded.local_date, updated_at=excluded.updated_at,
                cancelled_at=excluded.cancelled_at, financial_status=excluded.financial_status, synced_at=excluded.synced_at`,
        [oid, st.id, o.name, o.createdAt, ld, o.updatedAt, o.cancelledAt, o.displayFinancialStatus, new Date().toISOString()]);
        db.run('DELETE FROM order_lines WHERE order_id = ?', [oid]);
        o._lines.forEach(l => {
          if (!l.sku && !l.variant) { counts.skipped++; return; }
          const sku = (l.sku || '').trim() || 'VARIANT-' + numId(l.variant.id);
          db.run('INSERT INTO order_lines (shopify_id, order_id, store_id, sku, variant_id, quantity, net_quantity, unit_price) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(shopify_id) DO UPDATE SET order_id=excluded.order_id, store_id=excluded.store_id, sku=excluded.sku, variant_id=excluded.variant_id, quantity=excluded.quantity, net_quantity=excluded.net_quantity, unit_price=excluded.unit_price',
            [key(l.id), oid, st.id, sku, l.variant && l.variant.id, l.quantity, l.currentQuantity == null ? l.quantity : l.currentQuantity, parseFloat(l.originalUnitPriceSet && l.originalUnitPriceSet.shopMoney.amount) || 0]);
          counts.lines++;
        });
        if (!maxUpdated || o.updatedAt > maxUpdated) maxUpdated = o.updatedAt;
        counts.orders++; storeOrders++;
      });
    });
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    state.progress = counts.orders + ' orders';
    pages++;
  } while (cursor && pages < 20000);

  if (full && storeOrders > 0) {
    const first = db.get('SELECT MIN(local_date) AS d FROM orders WHERE store_id = ?', [st.id]);
    if (first && first.d && Date.parse(first.d) > Date.now() - 62 * 86400000) notes.push((st.name || st.domain) + ': only the last 60 days of orders came back. Add the read_all_orders scope for older history.');
  }
  db.tx(() => db.run('UPDATE stores SET sync_state = ?, last_sync = ? WHERE id = ?', [JSON.stringify({ ordersUpdatedAt: maxUpdated, lastFullSync: full ? new Date().toISOString() : ss.lastFullSync }), new Date().toISOString(), st.id]));
  return { shop, full };
}

async function syncAll(opts) {
  opts = opts || {};
  let stores = db.all("SELECT * FROM stores WHERE enabled = 1 AND auth NOT IN ('app', 'manual')" + (opts.storeId ? ' AND id = ?' : '') + " ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at", opts.storeId ? [opts.storeId] : undefined);
  if (!stores.length) throw new Error(opts.storeId ? 'That store is not connected or is turned off.' : 'No Shopify store is connected. Add one in Settings → Stores.');
  if (state.running) throw new Error('A sync is already running.');
  Object.assign(state, { running: true, startedAt: new Date().toISOString(), step: 'Starting', progress: '', store: '' });
  const results = [];
  try {
    const meta = db.config('meta', {});
    let demoNote = '';
    if (meta.source === 'demo' || meta.source === undefined) {
      db.tx(() => db.clearAll());
      demoNote = 'Demo data removed; your store data replaced it. ';
    } else if (meta.source === 'shopify-csv') {
      // Keep your suppliers, purchase orders and product settings; replace CSV sales with live orders.
      db.tx(() => { db.run('DELETE FROM base_sales'); db.run('UPDATE stores SET sync_state = NULL'); });
      demoNote = 'Sales history from CSV files replaced by live store orders. ';
    }
    if (demoNote) {
      stores = db.all("SELECT * FROM stores WHERE enabled = 1 AND auth NOT IN ('app', 'manual')" + (opts.storeId ? ' AND id = ?' : '') + " ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at", opts.storeId ? [opts.storeId] : undefined);
    }
    const dates = new Set();
    let failed = 0;
    for (const st of stores) {
      const counts = { products: 0, orders: 0, lines: 0, skipped: 0 }, notes = [];
      try {
        const r = await syncStore(st, opts, counts, notes, dates);
        const entry = { kind: (opts.kind || 'Manual sync') + (r.full ? ' (full)' : ''), store: st.name || r.shop.name, status: 'success', products: counts.products, orders: counts.orders, lines: counts.lines, skipped: counts.skipped, message: (results.length ? '' : demoNote) + (counts.added ? counts.added + ' new SKU' + (counts.added === 1 ? '' : 's') + ' added from Shopify. ' : '') + notes.join(' ') };
        db.addSyncLog(entry); results.push(entry);
        db.tx(() => db.run("UPDATE stores SET last_status = 'success', last_message = ? WHERE id = ?", [entry.message, st.id]));
      } catch (e) {
        failed++;
        const entry = { kind: opts.kind || 'Manual sync', store: st.name || st.domain, status: 'error', products: counts.products, orders: counts.orders, lines: counts.lines, skipped: counts.skipped, message: e.message + (counts.orders || counts.products ? ' Progress so far was saved; the next sync continues from there.' : '') };
        db.addSyncLog(entry); results.push(entry);
        db.tx(() => db.run("UPDATE stores SET last_status = 'error', last_message = ? WHERE id = ?", [e.message, st.id]));
      }
    }
    state.step = 'Combining stores'; state.store = '';
    db.tx(() => db.rebuildDailyFromOrders(dates));
    recomputeInventory();
    const prim = db.get("SELECT * FROM stores WHERE role = 'primary'") || stores[0];
    const all = listStores();
    const m = Object.assign({}, db.config('meta', {}), {
      source: 'shopify', store: prim.domain, storeName: all.length > 1 ? all.map(s => s.name).join(' + ') : (prim.name || prim.shop_name), timezone: prim.timezone,
      currency: prim.currency, stores: all.length, histStart: (db.get('SELECT MIN(local_date) AS d FROM orders') || {}).d || meta.histStart
    });
    db.setConfig('meta', m);
    const st2 = db.config('settings', {});
    if (prim.currency && (!st2.currency || (st2.currency === 'USD' && prim.currency !== 'USD'))) { st2.currency = prim.currency; db.setConfig('settings', st2); }
    const ss = db.config('sync_state', {}); ss.lastSync = new Date().toISOString(); db.setConfig('sync_state', ss);
    const newSkus = db.get('SELECT COUNT(*) AS n FROM products WHERE needs_setup = 1').n;
    const sum = results.reduce((a, r) => ({ products: a.products + r.products, orders: a.orders + r.orders, lines: a.lines + r.lines }), { products: 0, orders: 0, lines: 0 });
    const result = Object.assign(sum, { status: failed === results.length ? 'error' : failed ? 'partial' : 'success', stores: results.length, failed,
      message: (failed ? failed + ' of ' + results.length + ' store' + (results.length > 1 ? 's' : '') + ' failed: ' + results.filter(r => r.status === 'error').map(r => r.store + ': ' + r.message).join(' ') + ' ' : '') +
        (newSkus ? newSkus + ' SKU' + (newSkus > 1 ? 's need' : ' needs') + ' a supplier and lead time on the Products page.' : '') });
    state.lastResult = result;
    if (failed === results.length) throw new Error(result.message);
    return result;
  } finally {
    Object.assign(state, { running: false, step: '', progress: '', store: '' });
  }
}

// Keep the workspace's store names current after stores are added, renamed or removed.
function refreshMeta() {
  const m = db.config('meta', {}); if (m.source !== 'shopify') return;
  const all = listStores(); if (!all.length) return;
  const prim = all.filter(s => s.role === 'primary')[0] || all[0];
  db.setConfig('meta', Object.assign(m, { store: prim.domain, storeName: all.length > 1 ? all.map(s => s.name).join(' + ') : prim.name, stores: all.length, timezone: prim.timezone || m.timezone }));
}

function anyStore() { return !!db.get("SELECT 1 AS x FROM stores WHERE enabled = 1 AND auth NOT IN ('app', 'manual')"); }

module.exports = { clearTokens, saveExchangedStore, syncAll, testStore, saveStore, removeStore, listStores, importEnvStore, recomputeInventory, anyStore, state, gql, getStoreRow, defaultVersion };
