// Salon usage: extensions taken from stock for in-salon services (installs, move-ups, color matches).
// Tracked in Addendum-Stockline only; Shopify inventory is never changed.
//
// Each logged item:
//  * is recorded in the salon usage log (date, stylist, service, client, items),
//  * counts as demand unless unticked, so forecasts and reorder quantities include what the salon uses,
//  * optionally (Settings → Salon usage → "Subtract from stock in Addendum-Stockline") lowers Addendum-Stockline's own
//    stock counts. Shopify's counts stay as they are either way.
//
// Status per entry:
//   tracked     recorded only; stock counts unchanged
//   local       subtracted from Addendum-Stockline's stock (on top of Shopify's count) while the setting is on
//   applied     demo / CSV data with the setting on: on-hand was lowered directly
const crypto = require('crypto');
const db = require('./db');
const shopify = require('./shopify');

const isLive = () => shopify.anyStore() && (db.config('meta', {}) || {}).source === 'shopify';
const deductOn = () => !!(db.config('settings', {}) || {}).salonDeduct;

function list(limit) {
  return db.all('SELECT * FROM salon_usage ORDER BY date DESC, created_at DESC LIMIT ?', [limit || 1000]).map(r => ({
    id: r.id, group: r.group_id, date: r.date, sku: r.sku, qty: r.qty, stylist: r.stylist, clientRef: r.client_ref, service: r.service, note: r.note,
    countsDemand: !!r.counts_demand, status: r.status, createdBy: r.created_by, createdAt: r.created_at
  }));
}

function validate(input) {
  const date = String(input.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose the date the items were used.');
  if (Date.parse(date) > Date.now() + 2 * 86400000) throw new Error('That date is in the future.');
  const lines = (input.lines || []).map(l => ({ sku: String(l.sku || '').trim(), qty: Number(l.qty) })).filter(l => l.sku || l.qty);
  if (!lines.length) throw new Error('Add at least one item.');
  lines.forEach(l => {
    if (!db.get('SELECT 1 AS x FROM products WHERE sku = ?', [l.sku])) throw new Error('Unknown product: ' + l.sku);
    if (!(l.qty > 0) || l.qty > 10000 || Math.round(l.qty * 100) !== l.qty * 100) throw new Error('Enter a quantity above zero for ' + l.sku + '.');
  });
  return { date, lines };
}

function log(input, user) {
  const { date, lines } = validate(input);
  const live = isLive(), deduct = deductOn();
  const group = 'SAL-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex');
  const base = { stylist: String(input.stylist || '').trim().slice(0, 60) || null, client: String(input.clientRef || '').trim().slice(0, 80) || null,
    service: String(input.service || '').trim().slice(0, 60) || null, note: String(input.note || '').trim().slice(0, 300) || null, demand: input.countsDemand === false ? 0 : 1 };
  const status = !deduct ? 'tracked' : live ? 'local' : 'applied';
  db.tx(() => {
    lines.forEach((l, i) => {
      const id = group + '-' + (i + 1);
      db.run(`INSERT INTO salon_usage (id, group_id, date, sku, qty, stylist, client_ref, service, note, counts_demand, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, group, date, l.sku, l.qty, base.stylist, base.client, base.service, base.note, base.demand, status, user ? user.name : null, new Date().toISOString()]);
      if (deduct) db.upsertTxn({ id: 'TX-' + id, date, sku: l.sku, type: 'salon', qty: -l.qty, ref: 'Salon' + (base.service ? ' · ' + base.service : ''), note: [base.stylist, base.client].filter(Boolean).join(' · ') });
      if (status === 'applied') db.run('UPDATE products SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?', [l.qty, l.sku]);
    });
  });
  if (status === 'local') shopify.recomputeInventory();
  return { group, status };
}

function undo(group) {
  const rows = db.all('SELECT * FROM salon_usage WHERE group_id = ?', [group]);
  if (!rows.length) throw new Error('That entry was already removed.');
  db.tx(() => {
    rows.forEach(r => {
      if (r.status === 'applied') db.run('UPDATE products SET on_hand = on_hand + ? WHERE sku = ?', [r.qty, r.sku]);
      db.run('DELETE FROM inventory_txns WHERE id = ?', ['TX-' + r.id]);
    });
    db.run('DELETE FROM salon_usage WHERE group_id = ?', [group]);
  });
  if (rows[0].status === 'local') shopify.recomputeInventory();
}

module.exports = { list, log, undo, isLive, deductOn };
