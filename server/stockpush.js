// Send this app's on-hand counts to the stock-source Shopify store, matched by SKU.
// This is the only place Addendum-Stockline writes to Shopify, and it only ever sets inventory quantities,
// after someone previews the changes and confirms. Product details are never sent.
// Shopify stays the source of truth: the next sync reads its counts back as usual.
const crypto = require('crypto');
const db = require('./db');
const shopify = require('./shopify');

const BATCH = 100;
const M_SET = `mutation setOnHand($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { id }
    userErrors { code field message }
  }
}`;

function stockStore() {
  const st = db.get("SELECT * FROM stores WHERE enabled = 1 AND role = 'primary' AND auth NOT IN ('app', 'manual')");
  if (!st) throw new Error('Sending stock needs the stock-source store connected to Shopify. Set it up in Settings → Stores & sync.');
  return st;
}
function parse(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }

// Per-location on hand from the last sync. Older syncs stored only "available"; those need a fresh sync.
function onHandAt(row, loc) {
  const lv = parse(row.levels, {})[loc];
  return lv && typeof lv === 'object' && lv.onHand != null ? +lv.onHand : null;
}

// What would change. Nothing is sent. Every number comes from the database, never from the browser.
function plan(locationId) {
  const st = stockStore();
  const locNames = parse(st.locations, {});
  const rows = db.all('SELECT * FROM store_inventory WHERE store_id = ?', [st.id]);
  if (!rows.length) throw new Error('Sync ' + (st.name || st.domain) + ' first, so its current Shopify counts are known.');
  // Default location: the one holding the most stock.
  const totals = {};
  rows.forEach(r => { Object.keys(parse(r.levels, {})).forEach(id => { totals[id] = (totals[id] || 0) + (onHandAt(r, id) || 0); }); });
  const locations = Object.keys(locNames).map(id => ({ id, name: locNames[id], units: totals[id] || 0 })).sort((a, b) => b.units - a.units);
  const loc = locationId && locNames[locationId] ? locationId : (locations[0] || {}).id;
  if (!loc) throw new Error('No Shopify locations are known yet. Run a sync, then try again.');
  const byStore = {}; rows.forEach(r => { byStore[r.sku] = r; });
  const changes = [], skipped = { excluded: [], untracked: [], missing: [], notAtLocation: [], negative: [], needsSync: [] };
  let same = 0;
  db.all('SELECT sku, name, on_hand, status, no_sync FROM products ORDER BY sku').forEach(p => {
    const r = byStore[p.sku];
    if (p.status === 'untracked') { skipped.untracked.push(p.sku); return; }
    if (p.no_sync) { skipped.excluded.push(p.sku); return; }
    if (!r || !r.inventory_item_id) { skipped.missing.push(p.sku); return; }
    const app = Math.max(0, Math.round(+p.on_hand || 0)), shop = Math.round(+r.on_hand || 0);
    if (app === shop) { same++; return; }
    if (!(loc in parse(r.levels, {}))) { skipped.notAtLocation.push(p.sku); return; }
    const from = onHandAt(r, loc);
    if (from == null) { skipped.needsSync.push(p.sku); return; }
    const to = from + (app - shop); // other locations keep their stock; this one makes up the difference
    if (to < 0) { skipped.negative.push(p.sku); return; }
    changes.push({ sku: p.sku, name: p.name, shopify: shop, app, from, to, inventoryItemId: r.inventory_item_id, syncedAt: r.synced_at });
  });
  const synced = rows.map(r => r.synced_at).filter(Boolean).sort();
  return { store: { id: st.id, name: st.name || st.shop_name || st.domain }, locationId: loc, locations, changes, skipped, same, lastSync: synced[synced.length - 1] || null };
}

async function send(skus, locationId, user) {
  if (shopify.state.running) throw new Error('A sync is running. Wait for it to finish, then send stock.');
  const want = new Set((skus || []).map(String));
  if (!want.size) throw new Error('Choose at least one product to send.');
  const p = plan(locationId), st = stockStore();
  const items = p.changes.filter(c => want.has(c.sku));
  if (!items.length) throw new Error('Nothing to send: those counts already match Shopify, or changed since the preview. Open the preview again.');
  const locName = (p.locations.find(l => l.id === p.locationId) || {}).name || 'location';
  let sent = 0; const failed = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH), key = crypto.randomUUID();
    let res;
    try {
      res = (await shopify.gql(st, M_SET, { key, input: {
        name: 'on_hand', reason: 'correction', referenceDocumentUri: 'gid://addendum-stockline/StockSend/' + key,
        quantities: batch.map(c => ({ inventoryItemId: c.inventoryItemId, locationId: p.locationId, quantity: c.to, changeFromQuantity: c.from }))
      } })).inventorySetQuantities;
    } catch (e) {
      if (/access denied|write_inventory|scope|permission/i.test(e.message)) throw new Error('Shopify refused to change inventory on ' + p.store.name + '. The app needs the write_inventory permission: add it to the app\'s scopes in the Shopify Dev Dashboard, release a new version and approve it on the store. ' + (sent ? sent + ' SKU(s) were already sent.' : 'Nothing was changed.'));
      throw new Error(e.message + (sent ? ' ' + sent + ' SKU(s) were already sent.' : ' Nothing was changed.'));
    }
    if (res.userErrors && res.userErrors.length) {
      // Treat a batch with errors as not applied and stop; the next sync shows exactly what Shopify has.
      res.userErrors.forEach(u => {
        const idx = (u.field || []).map(Number).filter(n => !isNaN(n))[0];
        const c = batch[idx];
        failed.push((c ? c.sku + ': ' : '') + (u.code === 'CHANGE_FROM_QUANTITY_STALE' ? 'its Shopify count changed since the last sync' : u.message));
      });
      break;
    }
    // Keep our copy of Shopify's numbers in step until the next sync reads them back.
    db.tx(() => batch.forEach(c => {
      const r = db.get('SELECT levels, locations FROM store_inventory WHERE store_id = ? AND sku = ?', [st.id, c.sku]);
      const levels = parse(r.levels, {}), locs = parse(r.locations, {});
      levels[p.locationId] = Object.assign({}, levels[p.locationId], { onHand: c.to });
      locs[locName] = c.to;
      db.run('UPDATE store_inventory SET on_hand = on_hand + ?, levels = ?, locations = ? WHERE store_id = ? AND sku = ?', [c.to - c.from, JSON.stringify(levels), JSON.stringify(locs), st.id, c.sku]);
    }));
    sent += batch.length;
  }
  const message = sent + ' SKU' + (sent === 1 ? '' : 's') + ' set to this app\'s on-hand count at ' + locName + (user && user.name ? ' by ' + user.name : '') + '.' +
    (failed.length ? ' Stopped: ' + failed.slice(0, 5).join('; ') + (failed.length > 5 ? '…' : '') + '. Run a sync, then send again.' : '');
  db.addSyncLog({ kind: 'Stock sent to Shopify', store: p.store.name, status: failed.length ? 'error' : 'success', products: sent, message });
  return { sent, failed, message };
}

module.exports = { plan, send };
