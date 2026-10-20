// Addendum-Stockline server: serves the app, stores data in SQLite, syncs Shopify.
const fs = require('fs');
const path = require('path');

// ---- Load .env (no extra dependency) ----
(function loadEnv() {
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) return;
    let v = m[2].replace(/\s+#.*$/, '');
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
})();

const express = require('express');
const db = require('./db');
const ws = require('./workspace');
const shopify = require('./shopify');
const stockpush = require('./stockpush');
const auth = require('./auth');
const salon = require('./salon');
const uploads = require('./uploads');
const embedded = require('./embedded');
const manual = require('./manual');
const ledger = require('./ledger');
const crypto = require('crypto');

// Images are requested by <img> tags, which can't carry a Shopify session token, so signed-in pages get a
// daily key to put on image links instead.
function mediaKey(day) { return db.mac('media:' + (day || new Date().toISOString().slice(0, 10))).slice(0, 22); }
function mediaOk(k) { if (!k) return false; const t = Date.now(); return [0, 1].some(d => k === mediaKey(new Date(t - d * 86400000).toISOString().slice(0, 10))); }

// The app page. Inside the Shopify admin it loads App Bridge; standalone it works as before.
const INDEX_HTML = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function indexHtml() {
  const c = embedded.config();
  if (!c.enabled) return INDEX_HTML;
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const stores = db.all("SELECT id, COALESCE(name, shop_name, domain) AS name FROM stores ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, created_at");
  const navLinks = [['dashboard', 'Dashboard'], ['usage', 'Monthly Usage'], ['inventory', 'Inventory'], ['ledger', 'Stock History'], ['recs', 'Order Recommendations']]
    .concat(stores.length ? stores.map(s => ['store/' + encodeURIComponent(s.id), s.name]) : [['sales', 'Record Sales']])
    .concat([['salon', 'Salon Usage'], ['pos', 'Purchase Orders'], ['products', 'Products'], ['edit', 'Edit All Products'], ['suppliers', 'Suppliers'], ['analytics', 'Sales Analytics'], ['forecast', 'Forecast'], ['settings', 'Settings']]);
  return INDEX_HTML
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="shopify-api-key" content="' + esc(c.key) + '">\n<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>')
    .replace('<div id="app"></div>', '<ui-nav-menu>' + navLinks.map((l, i) => '<a href="/app/' + l[0] + '"' + (i === 0 ? ' rel="home"' : '') + '>' + l[1] + '</a>').join('') + '</ui-nav-menu>\n<div id="app"></div>');
}

// Colors and logo for the whole app. Shown on the sign-in page too, so it is public.
const HEX = /^#[0-9a-f]{6}$/i;
function branding() {
  const b = db.config('branding', {}) || {};
  const prim = db.get("SELECT logo, COALESCE(name, shop_name, domain) AS name FROM stores WHERE role = 'primary' AND logo IS NOT NULL")
    || db.get('SELECT logo, COALESCE(name, shop_name, domain) AS name FROM stores WHERE logo IS NOT NULL ORDER BY created_at LIMIT 1');
  return { appName: b.appName || 'Addendum-Stockline', accent: b.accent || null, sidebar: b.sidebar || null, background: b.background || null,
    logo: b.logo ? '/brand/' + b.logo : prim ? '/brand/' + prim.logo : null, appLogo: !!b.logo };
}
const ENGINE = require('../public/js/engine.js');

const PORT = +process.env.PORT || +process.env.BACKEND_PORT || 3000;
// Shopify CLI sets HOST to the tunnel URL; only a bare address is used to bind the server.
const HOST = process.env.BIND_HOST || (process.env.HOST && !/^https?:/.test(process.env.HOST) ? process.env.HOST : '127.0.0.1');
if (process.env.HOST && /^https?:/.test(process.env.HOST) && !process.env.APP_URL) process.env.APP_URL = process.env.HOST;

function log(...a) { console.log(new Date().toLocaleTimeString(), ...a); }

// Save today's recommendations so you can look back at what the app advised.
function snapshotForecasts() {
  try {
    const w = ws.build();
    const ctx = { settings: ENGINE.settingsOf(w.settings), asOf: w.meta.asOf, pos: w.pos, suppliers: w.suppliers };
    let due = [];
    db.tx(() => {
      w.products.forEach(p => {
        const a = ENGINE.analyze(p, ctx);
        db.run(`INSERT INTO forecasts (sku, date, status, velocity, lead_days, safety_stock, reorder_point, order_by, stockout, recommended_qty) VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(sku, date) DO UPDATE SET status=excluded.status, velocity=excluded.velocity, lead_days=excluded.lead_days, safety_stock=excluded.safety_stock,
                reorder_point=excluded.reorder_point, order_by=excluded.order_by, stockout=excluded.stockout, recommended_qty=excluded.recommended_qty`,
        [p.sku, w.meta.asOf, a.status, a.base, a.L, a.SS, a.ROP, a.orderDate, a.stockDate, a.qty]);
        if (a.needsOrder && (a.orderT <= 0 || a.status === 'oos')) due.push(p.name + ' × ' + a.qty);
      });
    });
    if (due.length) log('ORDER TODAY (' + due.length + '): ' + due.join(', '));
    else log('No orders due today.');
  } catch (e) { log('Forecast snapshot failed:', e.message); }
}

async function runSync(kind, full, storeId) {
  log('Shopify sync started' + (full ? ' (full history)' : ''));
  try {
    const r = await shopify.syncAll({ kind, full, storeId });
    log(`Sync done: ${r.stores} store(s), ${r.products} variants, ${r.orders} orders, ${r.lines} lines. ${r.message || ''}`);
    snapshotForecasts();
    return r;
  } catch (e) { log('Sync failed:', e.message); throw e; }
}

async function main() {
  await db.open();
  const args = process.argv.slice(2);
  if (args.includes('--reset-demo')) { ws.seedDemo(); db.save(true); log('Demo data loaded into', db.DB_FILE); return; }
  if (args.includes('--reset-password')) {
    const email = args[args.indexOf('--reset-password') + 1];
    const u = email && auth.findByEmail(email);
    if (!u) { console.error('No account with that email. Usage: npm run reset-password -- you@example.com'); process.exitCode = 1; return; }
    const temp = require('crypto').randomBytes(9).toString('base64url');
    db.tx(() => { db.run('UPDATE users SET password_hash = ?, must_change = 1, disabled = 0 WHERE id = ?', [auth.hashPassword(temp), u.id]); db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]); });
    db.save(true); console.log(`Temporary password for ${u.email}: ${temp}\nThey'll be asked to choose a new one after signing in.`); return;
  }
  if (ws.isEmpty()) { ws.seedDemo(); log('First run: loaded demo data. Connect a Shopify store in Settings → Stores to use your own.'); }
  const imported = shopify.importEnvStore();
  if (imported) log(`Added ${imported.domain} from .env as a connected store. Manage stores in Settings → Stores.`);
  if (args.includes('--sync-once')) {
    try { await runSync('Command-line sync', args.includes('--full')); } catch (e) { process.exitCode = 1; }
    db.save(true); return;
  }

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  // Shopify installs the app with its managed install flow; anyone landing on the old OAuth callback goes to the app.
  app.get('/auth/callback', (req, res) => res.redirect('/app' + (req.query.shop ? '?shop=' + encodeURIComponent(req.query.shop) : '')));
  // Shopify webhooks need the raw body to check their signature, so they come before the JSON parser.
  app.post('/webhooks', express.raw({ type: '*/*', limit: '2mb' }), embedded.handleWebhook);
  app.use(express.json({ limit: '100mb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Inside Shopify the admin frames our pages; only Shopify admin and connected stores may do that.
    if (embedded.config().enabled) res.set('Content-Security-Policy', embedded.frameAncestors(req));
    else { res.set('X-Frame-Options', 'DENY'); res.set('Content-Security-Policy', "frame-ancestors 'none';"); }
    next();
  });
  app.use(auth.attach);
  app.use(embedded.attach);
  // Changes must arrive as JSON from this app's own pages (blocks cross-site form posts).
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
    next();
  });

  const wrap = fn => async (req, res) => {
    try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); }
    catch (e) { log('API error', req.method, req.path, e.message); if (!res.headersSent) res.status(400).json({ error: e.message }); }
  };
  const PUB = path.join(__dirname, '..', 'public');

  // ---- Sign-in (public) ----
  app.get('/login', (req, res) => { if (req.user && !req.user.must_change) return res.redirect('/'); res.sendFile(path.join(PUB, 'login.html')); });
  app.get('/api/auth/state', wrap(req => ({ setup: auth.userCount() === 0, user: auth.publicUser(req.user), mustChange: !!(req.user && req.user.must_change), branding: branding() })));
  // Only the logos in use as branding are public (the sign-in page shows them).
  app.get('/brand/:name', (req, res) => {
    const b = branding(); if (!b.logo || b.logo !== '/brand/' + req.params.name) return res.status(404).end();
    uploads.serve(req, res);
  });
  app.post('/api/auth/setup', wrap((req, res) => {
    if (auth.userCount() > 0) throw new Error('An owner account already exists. Sign in instead.');
    const u = auth.createUser({ email: req.body.email, name: req.body.name, role: 'owner', password: req.body.password });
    const s2 = auth.newSession(u, true, req); auth.setCookie(res, req, s2.token, s2.maxAge);
    log('Owner account created for', u.email);
    return { user: auth.publicUser(u) };
  }));
  app.post('/api/auth/login', wrap((req, res) => {
    const email = auth.normEmail(req.body.email), ipKey = 'ip:' + req.ip, emKey = 'em:' + email;
    if (auth.limited(ipKey) || auth.limited(emKey)) { res.status(429); return { error: 'Too many attempts. Wait 15 minutes and try again.' }; }
    const u = auth.findByEmail(email);
    if (!u || u.disabled || !auth.checkPassword(String(req.body.password || ''), u.password_hash)) {
      auth.noteFail(ipKey); auth.noteFail(emKey); res.status(401); return { error: 'That email and password don\'t match.' };
    }
    auth.clearFails(ipKey); auth.clearFails(emKey);
    const s2 = auth.newSession(u, !!req.body.remember, req); auth.setCookie(res, req, s2.token, s2.maxAge);
    return { user: auth.publicUser(u), mustChange: !!u.must_change };
  }));
  app.post('/api/auth/logout', wrap((req, res) => { auth.endSession(req); auth.clearCookie(res); return { ok: true }; }));
  app.get('/api/auth/me', auth.need('viewer'), wrap(req => auth.publicUser(req.user)));
  app.post('/api/auth/password', auth.need('viewer'), wrap(req => {
    const u = req.user;
    if (!u.must_change && !auth.checkPassword(String(req.body.current || ''), u.password_hash)) throw new Error('Your current password is not right.');
    const bad = auth.validPassword(req.body.next); if (bad) throw new Error(bad);
    db.tx(() => db.run('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', [auth.hashPassword(req.body.next), u.id]));
    auth.endAllSessions(u.id, req);
    return { ok: true };
  }));

  // The app page. Opened from the Shopify admin it signs in with Shopify; elsewhere it needs a Stockline sign-in.
  const fromShopify = req => embedded.config().enabled && (req.query.embedded === '1' || embedded.SHOP_RE.test(String(req.query.shop || '')) || req.get('Sec-Fetch-Dest') === 'iframe');
  const appPage = (req, res, next) => {
    if (fromShopify(req)) return res.type('html').set('Cache-Control', 'no-store').send(indexHtml());
    if (!req.user) return res.redirect('/login' + (req.path !== '/' ? '?next=' + encodeURIComponent(req.originalUrl) : ''));
    if (req.user.must_change) return res.redirect('/login');
    res.type('html').set('Cache-Control', 'no-store').send(indexHtml());
  };
  app.get(['/', '/index.html', '/app', '/app/:page', '/app/store/:id'], appPage);

  // Everything below needs a signed-in user. Pages redirect to the sign-in page; API calls get 401.
  app.use((req, res, next) => {
    const open = req.path.startsWith('/js/') || req.path.startsWith('/css/') || req.path === '/favicon.svg' || req.path === '/demo-data.js' || (req.path.startsWith('/uploads/') && mediaOk(req.query.k));
    if (open) return next();
    if (!req.user) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please sign in.' });
      return res.redirect('/login' + (req.path && req.path !== '/' ? '?next=' + encodeURIComponent(req.originalUrl) : ''));
    }
    if (req.user.must_change && !req.path.startsWith('/api/')) return res.redirect('/login');
    next();
  });
  const DEMO_JS = 'var DEMO = ' + JSON.stringify(require('./demo-data.json')) + ';';
  app.get('/demo-data.js', (req, res) => res.type('application/javascript').send(DEMO_JS));
  app.use(express.static(PUB, { extensions: ['html'], index: false }));

  const V = auth.need('viewer'), ED = auth.need('editor'), AD = auth.need('admin');

  // ---- Data ----
  app.get('/api/workspace', V, wrap(() => ws.build()));
  app.get('/api/status', V, wrap(req => {
    const ss = db.config('sync_state', {});
    const stores = shopify.listStores().map(s2 => ({ id: s2.id, name: s2.name, domain: s2.domain, role: s2.role, auth: s2.auth, clientId: s2.clientId, hasSecret: s2.hasSecret, hasToken: s2.hasToken, apiVersion: s2.apiVersion, enabled: s2.enabled, timezone: s2.timezone, currency: s2.currency, lastSync: s2.lastSync, lastStatus: s2.lastStatus, lastMessage: s2.lastMessage }));
    stores.forEach(x => { const r2 = shopify.listStores().find(y => y.id === x.id); x.logo = r2 && r2.logo ? '/uploads/' + r2.logo : null; x.priceList = r2 ? r2.priceList : 'retail'; });
    return { branding: branding(), stores, sync: { running: shopify.state.running, step: shopify.state.step, store: shopify.state.store, progress: shopify.state.progress, last: shopify.state.lastResult, lastSync: ss.lastSync || null },
      user: auth.publicUser(req.user), dbFile: db.DB_FILE, network: HOST, mediaKey: mediaKey(), embedded: !!req.embedded, shop: req.shop || null,
      shopifyApp: { enabled: embedded.config().enabled, staffRole: (db.config('settings', {}) || {}).shopifyStaffRole || 'editor' } };
  }));
  // Sending stock to Shopify: preview first (changes nothing), then send what was confirmed. Admins only.
  app.get('/api/stock-send/preview', AD, wrap(req => stockpush.plan(req.query.location ? String(req.query.location) : null)));
  app.post('/api/stock-send', AD, wrap(req => stockpush.send(req.body.skus, req.body.locationId ? String(req.body.locationId) : null, req.user)));
  app.post('/api/sync', ED, (req, res) => {
    if (!shopify.anyStore()) return res.status(400).json({ error: 'No Shopify store is connected yet. An admin can add one in Settings → Stores.' });
    if (shopify.state.running) return res.status(409).json({ error: 'A sync is already running.' });
    runSync('Manual sync', !!(req.body && req.body.full), req.body && req.body.storeId).catch(() => {});
    res.json({ started: true });
  });
  app.put('/api/products/:sku', ED, wrap(req => { db.tx(() => db.upsertProduct(Object.assign({}, req.body, { sku: req.params.sku }))); return { ok: true }; }));
  app.post('/api/products/:sku/edit', ED, wrap(req => manual.editProduct(req.params.sku, req.body || {}, req.user)));
  app.post('/api/products-delete', ED, wrap(req => manual.deleteMany(req.body.skus)));
  app.post('/api/products-bulk', ED, wrap(req => manual.bulkSet(req.body.skus, req.body.field, req.body.op, req.body.value, req.user)));
  app.post('/api/products-bulk-rows', ED, wrap(req => manual.bulkRows(req.body.rows, { reason: req.body.reason, note: req.body.note }, req.user)));
  app.post('/api/stock-adjust', ED, wrap(req => manual.adjustMany(req.body.items, req.user)));
  app.get('/api/ledger', V, wrap(req => ledger.ledger(req.query)));
  app.get('/api/usage-monthly', V, wrap(req => ledger.usageMonthly(req.query)));
  app.get('/api/sales-summary', V, wrap(req => ledger.salesSummary(req.query)));
  app.put('/api/stores/:id/price-list', AD, wrap(req => {
    const pl = req.body.priceList === 'stylist' ? 'stylist' : 'retail';
    if (!db.get('SELECT 1 AS x FROM stores WHERE id = ?', [req.params.id])) throw new Error('Store not found.');
    db.tx(() => db.run('UPDATE stores SET price_list = ? WHERE id = ?', [pl, req.params.id])); return { ok: true };
  }));
  app.delete('/api/products/:sku', ED, wrap(req => { manual.deleteProduct(req.params.sku); return { ok: true }; }));
  app.put('/api/suppliers/:id', ED, wrap(req => { db.tx(() => db.upsertSupplier(Object.assign({}, req.body, { id: req.params.id }))); return { ok: true }; }));
  app.delete('/api/suppliers/:id', ED, wrap(req => { db.tx(() => db.run('DELETE FROM suppliers WHERE id = ?', [req.params.id])); return { ok: true }; }));
  app.put('/api/pos/:id', ED, wrap(req => { db.tx(() => db.upsertPO(Object.assign({}, req.body, { id: req.params.id }))); return { ok: true }; }));
  app.delete('/api/pos/:id', ED, wrap(req => { db.tx(() => { db.run('DELETE FROM po_lines WHERE po_id = ?', [req.params.id]); db.run('DELETE FROM purchase_orders WHERE id = ?', [req.params.id]); }); return { ok: true }; }));
  app.put('/api/txns/:id', ED, wrap(req => { db.tx(() => db.upsertTxn(Object.assign({}, req.body, { id: req.params.id, user: req.user && req.user.name }))); return { ok: true }; }));
  app.put('/api/config/:key', AD, wrap(req => {
    const k = req.params.key;
    if (k === 'settings') {
      const was = !!(db.config('settings', {}) || {}).salonDeduct;
      db.setConfig('settings', req.body);
      if (was !== !!req.body.salonDeduct) shopify.recomputeInventory(); // salon usage starts or stops coming off stock
    }
    else if (k === 'meta') { const m = db.config('meta', {}); db.setConfig('meta', Object.assign(m, { store: req.body.store })); }
    else if (k === 'sync') { /* the sync log is written by the server */ }
    else throw new Error('Unknown setting group');
    return { ok: true };
  }));
  app.post('/api/workspace', AD, wrap(req => { ws.replace(req.body); shopify.recomputeInventory(); return { ok: true }; }));
  app.post('/api/reset-demo', AD, wrap(() => { ws.seedDemo(); return { ok: true }; }));
  app.get('/api/forecast-history/:sku', V, wrap(req => db.all('SELECT * FROM forecasts WHERE sku = ? ORDER BY date DESC LIMIT 120', [req.params.sku])));

  // ---- Images & branding ----
  app.get('/uploads/:name', (req, res) => { if (!req.user && !mediaOk(req.query.k)) return res.status(401).end(); uploads.serve(req, res); });
  app.post('/api/uploads', ED, wrap(req => ({ name: uploads.save(req.body.data) })));
  app.put('/api/products/:sku/image', ED, wrap(req => {
    const name = req.body.image ? uploads.save(req.body.image) : null;
    db.tx(() => db.run('UPDATE products SET image = ? WHERE sku = ?', [name, req.params.sku]));
    if (!name) uploads.prune();
    return { image: name };
  }));
  app.put('/api/stores/:id/logo', AD, wrap(req => {
    const name = req.body.logo ? uploads.save(req.body.logo) : null;
    db.tx(() => db.run('UPDATE stores SET logo = ? WHERE id = ?', [name, req.params.id]));
    if (!name) uploads.prune();
    return { logo: name };
  }));
  app.get('/api/branding', V, wrap(() => Object.assign(branding(), { custom: db.config('branding', {}) || {} })));
  app.put('/api/branding', AD, wrap(req => {
    const b = req.body || {}, cur = db.config('branding', {}) || {}, out = {};
    ['accent', 'sidebar', 'background'].forEach(k => { if (b[k] && !HEX.test(b[k])) throw new Error('Colors must look like #6b2d5c.'); out[k] = b[k] || null; });
    out.appName = String(b.appName || '').trim().slice(0, 40) || null;
    out.logo = b.logo === undefined ? cur.logo || null : b.logo ? uploads.save(b.logo) : null;
    db.setConfig('branding', out);
    if (!out.logo) uploads.prune();
    return branding();
  }));

  // ---- Salon usage ----
  app.get('/api/salon', V, wrap(() => ({ entries: salon.list(1000), live: salon.isLive(), deduct: salon.deductOn() })));
  app.post('/api/salon', ED, wrap(req => salon.log(req.body, req.user)));
  app.delete('/api/salon/:group', ED, wrap(req => { salon.undo(req.params.group); return { ok: true }; }));

  // ---- Manual mode ----
  app.get('/api/sales', V, wrap(req => manual.listSales(req.query.store ? Math.min(5000, +req.query.limit || 2000) : 500, { storeId: req.query.store ? String(req.query.store) : null, since: /^\d{4}-\d{2}-\d{2}$/.test(req.query.since || '') ? req.query.since : null })));
  app.post('/api/sales', ED, wrap(req => manual.recordSale(req.body, req.user)));
  app.delete('/api/sales/:id', ED, wrap(req => { manual.undoSale(req.params.id); return { ok: true }; }));
  app.post('/api/import/orders', ED, wrap(req => manual.importOrders(req.body.storeId, req.body.rows, { deduct: !!req.body.deduct, userName: req.user && req.user.name })));
  app.post('/api/import/products', AD, wrap(req => manual.importProducts(req.body.rows, { stock: !!req.body.stock })));
  app.post('/api/products', ED, wrap(req => (Array.isArray(req.body.variants) ? manual.createVariants(req.body, req.user) : manual.createProduct(Object.assign({}, req.body, { userName: req.user && req.user.name })))));
  app.post('/api/stock-count', ED, wrap(req => manual.countStock(req.body.counts, req.user, req.body.note, { sync: !!req.body.sync })));
  app.post('/api/products-sync', ED, wrap(req => manual.setSync(req.body.skus, !!req.body.sync)));
  app.post('/api/start-fresh', AD, wrap(req => { manual.startFresh(!!req.body.keepSuppliers); return { ok: true }; }));

  // ---- Stores (admin) ----
  app.post('/api/stores', AD, wrap(async req => {
    if (req.body.auth === 'manual') { manual.saveManualStore(req.body); return { info: 'Store added. It has its own page in the menu for logging purchases.' }; }
    const st = shopify.saveStore(req.body);
    if (st.auth === 'app') return { store: st, info: 'Saved. Install Addendum-Stockline on ' + st.domain + ' and open it once from that store\'s Shopify admin to finish connecting.' };
    try { const shop = await shopify.testStore(st.id); return { store: st, shop }; }
    catch (e) { return { store: st, warning: 'Saved, but the connection test failed: ' + e.message }; }
  }));
  app.put('/api/stores/:id', AD, wrap(async req => {
    const cur = db.get('SELECT auth FROM stores WHERE id = ?', [req.params.id]);
    if (req.body.auth === 'manual' || (cur && cur.auth === 'manual' && !req.body.domain)) { manual.saveManualStore(req.body, req.params.id); return { info: 'Store saved.' }; }
    const st = shopify.saveStore(req.body, req.params.id);
    if (!req.body.testOnly && st.auth !== 'app' && (req.body.clientSecret || req.body.adminToken || req.body.domain)) {
      try { const shop = await shopify.testStore(st.id); return { store: st, shop }; } catch (e) { return { store: st, warning: 'Saved, but the connection test failed: ' + e.message }; }
    }
    return { store: st };
  }));
  app.post('/api/stores/:id/test', AD, wrap(async req => ({ shop: await shopify.testStore(req.params.id) })));
  app.delete('/api/stores/:id', AD, wrap(req => { if (shopify.state.running) throw new Error('Wait for the current sync to finish.'); shopify.removeStore(req.params.id); return { ok: true }; }));

  // ---- Team (admin) ----
  const canManage = (actor, target) => auth.ROLES[actor.role] > auth.ROLES[target.role] || actor.role === 'owner';
  app.get('/api/users', AD, wrap(() => db.all('SELECT * FROM users ORDER BY created_at').map(auth.publicUser)));
  app.post('/api/users', AD, wrap(req => {
    if (req.body.role === 'owner') throw new Error('There is one owner per workspace.');
    if (req.body.role === 'admin' && req.user.role !== 'owner') throw new Error('Only the owner can add admins.');
    return auth.publicUser(auth.createUser(req.body));
  }));
  app.put('/api/users/:id', AD, wrap(req => {
    const t = auth.findById(req.params.id); if (!t) throw new Error('User not found.');
    if (t.id === req.user.id && (req.body.role || req.body.disabled != null)) throw new Error('You can\'t change your own role or access.');
    if (!canManage(req.user, t)) throw new Error('You can\'t change this person\'s account.');
    const b = req.body;
    if (b.role) { if (!auth.ROLES[b.role] || b.role === 'owner') throw new Error('Choose Admin, Editor or Viewer.'); if (b.role === 'admin' && req.user.role !== 'owner') throw new Error('Only the owner can make admins.'); }
    if (b.password) { const bad = auth.validPassword(b.password); if (bad) throw new Error(bad); }
    db.tx(() => {
      if (b.name != null) db.run('UPDATE users SET name = ? WHERE id = ?', [String(b.name).trim().slice(0, 80), t.id]);
      if (b.role) db.run('UPDATE users SET role = ? WHERE id = ?', [b.role, t.id]);
      if (b.disabled != null) db.run('UPDATE users SET disabled = ? WHERE id = ?', [b.disabled ? 1 : 0, t.id]);
      if (b.password) db.run('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?', [auth.hashPassword(b.password), t.id]);
    });
    if (b.password || b.disabled || b.role) auth.endAllSessions(t.id);
    return auth.publicUser(auth.findById(t.id));
  }));
  app.delete('/api/users/:id', AD, wrap(req => {
    const t = auth.findById(req.params.id); if (!t) throw new Error('User not found.');
    if (t.id === req.user.id) throw new Error('You can\'t remove yourself.');
    if (t.role === 'owner' || !canManage(req.user, t)) throw new Error('You can\'t remove this person.');
    db.tx(() => { db.run('DELETE FROM sessions WHERE user_id = ?', [t.id]); db.run('DELETE FROM users WHERE id = ?', [t.id]); });
    return { ok: true };
  }));

  // ---- Scheduled sync ----
  setInterval(() => {
    if (!shopify.anyStore() || shopify.state.running) return;
    const mode = (db.config('settings', {}).autoSync) || 'daily';
    if (mode === 'off') return;
    const ss = db.config('sync_state', {}), last = ss.lastSync ? Date.parse(ss.lastSync) : 0, now = new Date();
    const due = mode === 'hourly' ? Date.now() - last > 3600000 : (now.getHours() >= 6 && new Date(last).toDateString() !== now.toDateString());
    if (due) runSync('Scheduled sync').catch(() => {});
  }, 60000);

  const server = app.listen(PORT, HOST, () => {
    const stores = shopify.listStores();
    log(`Addendum-Stockline is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    log(stores.length ? 'Shopify: ' + stores.map(s2 => s2.domain + (s2.role === 'primary' ? ' (stock source)' : ' (sales)')).join(', ') : 'Shopify: no store connected yet (showing demo data). Add one in Settings → Stores.');
    if (!auth.userCount()) log('Open the address above to create the owner account.');
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !auth.userCount()) log('WARNING: the server is reachable on your network and no owner exists yet. Create the owner account now.');
    snapshotForecasts();
  });
  server.on('error', e => { if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is in use. Set PORT=3001 in .env or stop the other process.`); process.exit(1); } throw e; });
  const shutdown = () => { db.save(true); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

main().catch(e => { console.error(e); process.exit(1); });
