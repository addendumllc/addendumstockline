// Running Addendum-Stockline inside the Shopify admin (an "embedded app").
//
// * Shopify staff are signed in by Shopify. Every API call from the admin carries a short-lived session token
//   (an HS256 JWT signed with the app's client secret). We verify it, then map the Shopify user to a
//   Stockline account. The first time we see someone, an online token exchange tells us their email and
//   whether they own the store.
// * The first time a store opens the app, an offline token exchange gives Stockline API access to that store,
//   so it connects itself; no credentials to paste.
// * Webhooks (app uninstalled, privacy requests) are verified with the client secret.
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const shopify = require('./shopify');

function config() {
  const key = process.env.SHOPIFY_API_KEY || '', secret = process.env.SHOPIFY_API_SECRET || '';
  return { key, secret, enabled: !!(key && secret), appUrl: (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '') };
}
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const b64url = b => Buffer.from(b, 'base64url');

// ---- Session token (ID token) ----
function verifyIdToken(token) {
  const c = config(); if (!c.enabled) throw new Error('Shopify app keys are not set.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed session token.');
  let header, claims;
  try { header = JSON.parse(b64url(parts[0])); claims = JSON.parse(b64url(parts[1])); } catch (e) { throw new Error('Malformed session token.'); }
  if (header.alg !== 'HS256') throw new Error('Unexpected session token algorithm.');
  const want = crypto.createHmac('sha256', c.secret).update(parts[0] + '.' + parts[1]).digest();
  const got = b64url(parts[2]);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('Session token signature does not match.');
  const now = Math.floor(Date.now() / 1000), leeway = 10;
  if (!(claims.exp > now - leeway)) throw new Error('Session token expired.');
  if (claims.nbf && claims.nbf > now + leeway) throw new Error('Session token not valid yet.');
  if (claims.aud !== c.key) throw new Error('Session token is for a different app.');
  let iss, dest;
  try { iss = new URL(claims.iss).hostname; dest = new URL(claims.dest).hostname; } catch (e) { throw new Error('Session token has no shop.'); }
  if (iss !== dest || !SHOP_RE.test(dest)) throw new Error('Session token shop does not match.');
  return { shop: dest, userId: String(claims.sub || ''), sid: claims.sid, raw: token };
}

// ---- Token exchange ----
async function exchange(shop, idToken, kind) {
  const c = config();
  const url = process.env.SHOPIFY_TOKEN_URL_TEMPLATE ? process.env.SHOPIFY_TOKEN_URL_TEMPLATE.replace('{shop}', shop) : `https://${shop}/admin/oauth/access_token`;
  const body = {
    client_id: c.key, client_secret: c.secret, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: idToken, subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: kind === 'online' ? 'urn:shopify:params:oauth:token-type:online-access-token' : 'urn:shopify:params:oauth:token-type:offline-access-token'
  };
  if (kind !== 'online') body.expiring = '1';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('Shopify token exchange failed (HTTP ' + res.status + (j.error ? ': ' + (j.error_description || j.error) : '') + ').');
  return j;
}

// Which shops may use this workspace: the first one, any store an admin added, or ALLOWED_SHOPS.
function shopAllowed(shop) {
  if (db.get('SELECT 1 AS x FROM stores WHERE domain = ?', [shop])) return true;
  const allow = String(process.env.ALLOWED_SHOPS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.includes(shop)) return true;
  return !db.get('SELECT 1 AS x FROM stores');
}

// Make sure the store is connected with a working offline token (connects it the first time).
const pendingStore = {};
async function ensureStore(shop, idToken) {
  const row = db.get('SELECT * FROM stores WHERE domain = ?', [shop]);
  if (row && row.auth === 'exchange' && row.admin_token_enc && row.enabled) return row;
  if (row && row.auth !== 'exchange' && row.auth !== 'app') return row; // connected another way; leave it
  if (pendingStore[shop]) return pendingStore[shop];
  pendingStore[shop] = (async () => {
    const t = await exchange(shop, idToken, 'offline');
    shopify.saveExchangedStore(shop, t);
    return db.get('SELECT * FROM stores WHERE domain = ?', [shop]);
  })();
  try { return await pendingStore[shop]; } finally { delete pendingStore[shop]; }
}

// Map a Shopify staff member to a Stockline account.
const pendingUser = {};
async function userFor(tok) {
  const link = db.get('SELECT u.* FROM shopify_users su JOIN users u ON u.id = su.user_id WHERE su.shop = ? AND su.shopify_user_id = ?', [tok.shop, tok.userId]);
  if (link) return link;
  const k = tok.shop + ':' + tok.userId;
  if (pendingUser[k]) return pendingUser[k];
  pendingUser[k] = (async () => {
    const t = await exchange(tok.shop, tok.raw, 'online');
    const au = t.associated_user || {};
    const email = auth.normEmail(au.email);
    let user = au.email_verified && email ? auth.findByEmail(email) : null;
    if (!user) {
      const settings = db.config('settings', {}) || {};
      const role = auth.userCount() === 0 ? 'owner' : au.account_owner ? 'admin' : (auth.ROLES[settings.shopifyStaffRole] && settings.shopifyStaffRole !== 'owner' ? settings.shopifyStaffRole : 'editor');
      const name = [au.first_name, au.last_name].filter(Boolean).join(' ') || (email ? email.split('@')[0] : 'Shopify staff');
      const id = 'u_' + crypto.randomBytes(9).toString('base64url');
      const useEmail = email && !auth.findByEmail(email) ? email : 'shopify-' + String(au.id || tok.userId) + '@' + tok.shop;
      db.tx(() => db.run('INSERT INTO users (id, email, name, role, password_hash, created_at, must_change, source) VALUES (?,?,?,?,?,?,?,?)',
        [id, useEmail, name.slice(0, 80), role, 'shopify-only', new Date().toISOString(), 0, 'shopify']));
      user = auth.findById(id);
    }
    db.tx(() => db.run('INSERT INTO shopify_users (shop, shopify_user_id, user_id, linked_at) VALUES (?,?,?,?) ON CONFLICT(shop, shopify_user_id) DO UPDATE SET user_id = excluded.user_id',
      [tok.shop, tok.userId, user.id, new Date().toISOString()]));
    return user;
  })();
  try { return await pendingUser[k]; } finally { delete pendingUser[k]; }
}

// Express middleware: signs in requests that carry a Shopify session token.
async function attach(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ') || !config().enabled) return next();
  let tok;
  try { tok = verifyIdToken(h.slice(7).trim()); }
  catch (e) { res.set('X-Shopify-Retry-Invalid-Session-Request', '1'); return res.status(401).json({ error: e.message }); }
  if (!shopAllowed(tok.shop)) return res.status(403).json({ error: tok.shop + ' isn\'t part of this workspace. An admin can add it under Settings → Stores & sync.' });
  try {
    await ensureStore(tok.shop, tok.raw);
    const user = await userFor(tok);
    if (!user || user.disabled) return res.status(403).json({ error: 'Your Addendum-Stockline access has been turned off. Ask an admin.' });
    req.user = user; req.shop = tok.shop; req.embedded = true;
    next();
  } catch (e) {
    console.error('Shopify sign-in failed:', e.message);
    res.status(502).json({ error: 'Couldn\'t sign you in through Shopify: ' + e.message });
  }
}

// ---- Framing (who may show our pages in an iframe) ----
function frameAncestors(req) {
  const shop = String(req.query.shop || '').toLowerCase();
  const list = new Set(['https://admin.shopify.com']);
  if (SHOP_RE.test(shop)) list.add('https://' + shop);
  db.all('SELECT domain FROM stores').forEach(r => list.add('https://' + r.domain));
  if (process.env.STOCKLINE_TEST_HOOKS === '1' && process.env.TEST_FRAME_ANCESTOR) list.add(process.env.TEST_FRAME_ANCESTOR);
  return 'frame-ancestors ' + Array.from(list).join(' ') + ';';
}

// ---- Webhooks ----
function verifyWebhook(req) {
  const c = config(); if (!c.enabled) return false;
  const sig = Buffer.from(String(req.get('X-Shopify-Hmac-Sha256') || ''), 'base64');
  const want = crypto.createHmac('sha256', c.secret).update(req.body || Buffer.alloc(0)).digest();
  return sig.length === want.length && crypto.timingSafeEqual(sig, want);
}
function handleWebhook(req, res) {
  if (!verifyWebhook(req)) return res.status(401).end();
  const topic = String(req.get('X-Shopify-Topic') || ''), shop = String(req.get('X-Shopify-Shop-Domain') || '').toLowerCase();
  if (topic === 'app/uninstalled' && SHOP_RE.test(shop)) {
    db.tx(() => db.run("UPDATE stores SET admin_token_enc = NULL, refresh_token_enc = NULL, token_expires = NULL, enabled = 0, last_status = 'error', last_message = 'The app was uninstalled from this store. Open it from Shopify again to reconnect.' WHERE domain = ? AND auth = 'exchange'", [shop]));
    console.log('App uninstalled from', shop, '- store paused');
  }
  // customers/data_request, customers/redact, shop/redact: Addendum-Stockline keeps no customer details
  // (only order numbers, dates, SKUs and quantities), so there is nothing to export or erase.
  res.status(200).end();
}

module.exports = { config, verifyIdToken, attach, frameAncestors, handleWebhook, exchange, SHOP_RE };
