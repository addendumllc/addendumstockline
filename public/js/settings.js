/* ---------- Settings: stores, sync, team, account, forecasting defaults ---------- */
var ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
function me() { return (Store.status && Store.status.user) || null; }
function isAdmin() { var u = me(); return Store.mode === 'preview' || !!(u && ROLE_RANK[u.role] >= 3); }
function fmtWhen(t) { return t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'; }

function pageSettings() {
  var tab = UI.setTab || 'stores';
  var tabs = [['stores', 'Stores & sync'], ['planning', 'Inventory & forecasting'], ['appearance', 'Appearance'], ['team', 'Team'], ['account', 'Your account']];
  if (!isAdmin()) tabs = tabs.filter(function (t) { return t[0] !== 'team' && t[0] !== 'appearance'; });
  if (!tabs.some(function (t) { return t[0] === tab; })) tab = 'stores';
  return '<div class="ph"><div><h1>Settings</h1><div class="sub">' + (isAdmin() ? 'Store connections, forecasting defaults and who can use Addendum-Stockline.' : 'Only admins can change these settings. You can update your own account.') + '</div></div></div>' +
    (Store.mode === 'preview' ? '<div class="note warn">The Addendum-Stockline server is not reachable, so changes are not saved. Start it from VS Code (Run → Start Debugging) and reload.</div>' : '') +
    '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button role="tab" aria-selected="' + (tab === t[0]) + '" data-act="set-tab|' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    (tab === 'stores' ? setStores() : tab === 'planning' ? setPlanning() : tab === 'appearance' ? setAppearance() : tab === 'team' ? setTeam() : setAccount());
}

function setStores() {
  var st = Store.status || {}, stores = st.stores || [], sy = st.sync || {}, admin = isAdmin(), canSync = Store.canWrite && stores.length && !sy.running;
  var log = WS.sync.log || [], s = settings(), dis = admin ? '' : ' disabled';
  var running = sy.running ? 'Syncing ' + esc(sy.store || '') + '… ' + esc(sy.step || '') + (sy.progress ? ' · ' + esc(sy.progress) : '') : '';
  return '<section class="card"><div class="hd"><div><h2>Shopify stores</h2><div class="small muted">' + esc(dataAsOf()) + '</div></div><div class="row">' +
    '<button class="btn" data-act="sync-full"' + (canSync ? '' : ' disabled') + '>Re-import full history</button><button class="btn primary" data-act="sync"' + (canSync ? '' : ' disabled') + '>' + (running || (stores.length > 1 ? 'Sync all stores' : 'Sync now')) + '</button></div></div>' +
    (stores.length ? '<div class="bd flush tw"><table class="t"><thead><tr><th>Store</th><th>Inventory role</th><th>Connection</th><th>Last sync</th><th></th></tr></thead><tbody>' + stores.map(function (x) {
      return '<tr><td><div class="pwrap">' + (x.logo ? '<img class="thumb logo" src="' + esc(mediaUrl(x.logo)) + '" alt="">' : '<span class="thumb ph" aria-hidden="true">' + esc(String(x.name || '?').charAt(0).toUpperCase()) + '</span>') + '<div class="pname"><b>' + esc(x.name) + (x.enabled ? '' : ' <span class="tag">Paused</span>') + '</b><span>' + (x.auth === 'manual' ? 'Sales recorded by hand or imported' : esc(x.domain) + (x.timezone ? ' · ' + esc(x.timezone) : '')) + '</span></div></div></td>' +
        '<td>' + (x.role === 'primary' ? '<span class="tag manual">Stock source</span><div class="small faint">On-hand counts come from here</div>' : '<span class="tag">Sales</span><div class="small faint">Adds orders and committed stock</div>') + '</td>' +
        '<td class="small">' + (x.auth === 'manual' ? 'Manual (no Shopify)' : x.auth === 'exchange' ? 'Addendum-Stockline app' : x.auth === 'app' ? '<b style="color:var(--soon)">Waiting for app install</b>' : x.auth === 'token' ? '<b style="color:var(--soon)">Old Admin API token: switch to a Dev Dashboard app</b>' : 'Dev Dashboard app') + '<div class="faint">API ' + esc(x.apiVersion) + '</div></td>' +
        '<td class="wrap small" style="max-width:320px">' + (x.lastStatus === 'error' ? '<b style="color:var(--now)">Failed</b> · ' : x.lastStatus === 'success' ? '<b style="color:var(--ok)">OK</b> · ' : '') + esc(fmtWhen(x.lastSync)) + (x.lastStatus === 'error' && x.lastMessage ? '<div class="faint">' + esc(x.lastMessage) + '</div>' : '') + '</td>' +
        '<td><div class="row" style="flex-wrap:nowrap;gap:4px">' + (x.auth === 'manual' ? '<button class="btn sm" data-act="nav|sales">Record sales</button>' : '<button class="btn sm" data-act="store-sync|' + x.id + '"' + (canSync && x.enabled ? '' : ' disabled') + '>Sync</button>') + (admin ? '<button class="btn ghost sm" data-act="store-edit|' + x.id + '">Edit</button>' : '') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="bd"><div class="empty"><b>No store connected</b>' + (admin ? 'Add your first Shopify store to replace the demo data with your own.' : 'Ask an admin to connect your Shopify store.') + '</div></div>') +
    '<div class="bd" style="display:flex;flex-direction:column;gap:12px">' +
    (admin ? '<div class="row"><button class="btn primary" data-act="store-new">Add a store</button></div>' : '') +
    (stores.length > 1 || !stores.length ? '<div class="note"><b>Several stores, one stockroom.</b> When your stores sell from the same inventory, connect them all. Products match by SKU. The <b>stock source</b> store supplies on-hand counts; every store adds its orders to sales history and its unfulfilled orders to committed stock. Forecasts use the combined sales.</div>' : '') +
    '<div class="row"><label class="field"><span>Automatic sync</span><select data-f="s||autoSync"' + dis + '>' + [['off', 'Off'], ['daily', 'Daily at 6 AM'], ['hourly', 'Hourly']].map(function (o) { return '<option value="' + o[0] + '"' + (s.autoSync === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select><small>Runs while the server is running</small></label></div>' +
    '</div></section>' +

    salonSettingsCard() +
    '<section class="card"><div class="hd"><div><h2>Import products and stock from Shopify exports</h2><div class="small muted">For when API access isn\'t set up. Existing products are updated by SKU; nothing is deleted. Import each store\'s orders on the Record Sales page.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:12px">' +
    '<div class="grid2e" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">' +
    dropZone('products', 'Products export', 'Shopify admin → Products → Export, from the store that holds your stock. Adds or updates SKUs, names, shades, prices and cost.') +
    dropZone('inventory', 'Inventory export (optional)', 'Products → Inventory → Export. Sets on-hand stock (all locations added together). Logged as a stock count.') + '</div>' +
    (UI.imp && UI.imp.products && !UI.imp.inventory ? '<label class="check small"><input type="checkbox" data-f="impstock||"' + (UI.impStock ? ' checked' : '') + '> Also set stock from the products file\'s inventory column</label>' : '') +
    '<div class="row"><button class="btn primary" data-act="import-run"' + (UI.imp && (UI.imp.products || UI.imp.inventory) && admin ? '' : ' disabled') + '>Import files</button>' + (UI.imp && (UI.imp.products || UI.imp.inventory) ? '<button class="btn ghost" data-act="import-clear">Clear</button>' : '') + (admin ? '' : '<span class="small muted">Admins only</span>') + '</div></div></section>' +

    '<section class="card"><div class="hd"><h2>Sync log</h2></div><div class="bd flush tw"><table class="t"><thead><tr><th>When</th><th>Store</th><th>Type</th><th>Status</th><th class="r">Variants</th><th class="r">Orders</th><th class="r">Lines</th><th>Notes</th></tr></thead><tbody>' +
    (log.length ? log.slice(0, 15).map(function (l) { return '<tr><td>' + esc(fmtWhen(l.at)) + '</td><td>' + esc(l.store || '—') + '</td><td>' + esc(l.kind) + '</td><td>' + (l.status === 'success' ? '<span class="pill healthy">Success</span>' : '<span class="pill now">Error</span>') + '</td><td class="r">' + num(l.products) + '</td><td class="r">' + num(l.orders) + '</td><td class="r">' + num(l.lines) + '</td><td class="wrap small" style="min-width:220px">' + esc(l.message || '') + (l.skipped ? ' ' + l.skipped + ' rows skipped.' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="8"><div class="empty">No syncs yet.</div></td></tr>') + '</tbody></table></div></section>' +

    '<section class="card"><div class="hd"><h2>Data</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:10px"><p class="small muted" style="margin:0">' + num(WS.products.length) + ' products, ' + num(WS.pos.length) + ' purchase orders, ' + num(WS.txns.length) + ' inventory transactions. Source: ' + (WS.meta.source === 'demo' ? 'demo store' : WS.meta.source === 'shopify' ? 'live Shopify sync' : 'CSV import') + '. Database: <code>' + esc(st.dbFile || 'data/stockline.db') + '</code></p>' +
    (UI.confirmReset ? '<div class="note bad">Replace everything with the demo store? Products, POs, suppliers and synced orders are removed. Store connections and accounts stay. <div class="row" style="margin-top:8px"><button class="btn sm" data-act="reset-no">Keep my data</button><button class="btn sm primary" data-act="reset-yes">Replace with demo</button></div></div>' : (admin ? '<div class="row"><button class="btn" data-act="reset-ask">Reset to demo data</button>' + (UI.freshAsk ? '' : '<button class="btn" data-act="fresh-ask">Start with an empty catalog</button>') + '</div>' : '')) +
    (UI.freshAsk ? '<div class="note bad">Remove all products, sales, purchase orders, salon usage and manual stores so you can enter your own? Accounts, settings, appearance and Shopify connections stay.<label class="check small" style="margin-top:8px"><input type="checkbox" id="fresh-keep"> Keep suppliers</label><div class="row" style="margin-top:8px"><button class="btn sm" data-act="fresh-no">Cancel</button><button class="btn sm primary" data-act="fresh-yes">Start empty</button></div></div>' : '') + '</div></section>';
}

function setPlanning() {
  var s = settings(), dis = isAdmin() ? '' : ' disabled', n = s.notify || {};
  function sel(k, opts) { return '<select data-f="s||' + k + '"' + dis + '>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(s[k]) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
  function numf(k, label, help) { return '<label class="field"><span>' + label + '</span><input type="number" min="0" data-f="s||' + k + '" value="' + esc(s[k]) + '"' + dis + '>' + (help ? '<small>' + help + '</small>' : '') + '</label>'; }
  function chk(k, label, path) { var v = path ? n[k] : s[k]; return '<label class="check"><input type="checkbox" data-f="' + (path ? 'sn' : 'sb') + '||' + k + '"' + (v ? ' checked' : '') + dis + '> ' + label + '</label>'; }
  return '<div class="grid2e"><section class="card"><div class="hd"><h2>Forecasting</h2></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Default forecast period</span><select data-f="s||period"' + dis + '>' + periodOpts(s.period) + '</select><small>Smart blends 7/30/90-day rates with trend and seasonality</small></label>' +
    numf('coverDays', 'Days to cover after an order lands', 'How long each order should last') + numf('soonDays', '"Reorder soon" window (days)') + numf('watchDays', '"Watch" window (days)') + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">' + chk('inferStockouts', 'Treat long zero-sale runs as stockouts and leave them out of averages') + chk('trimOutliers', 'Cap unusual one-day spikes (wholesale orders, glitches)') + chk('useSeasonality', 'Apply seasonality when a product has a strong 12-month pattern') + '</div></div></section>' +
    '<section class="card"><div class="hd"><h2>Inventory page</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:12px">' + chk('showMoqTiming', 'Show MOQ timing on the Inventory page') +
    '<p class="small muted" style="margin:0">Adds three columns for each product: the minimum order quantity (and its cost), how long an MOQ order takes to arrive (production + transit), and how long the MOQ lasts at the current sales rate.</p>' +
    '<div class="fields">' + numf('moqSlowDays', 'Flag MOQ as slow to use after (days)', 'Highlights products where the minimum order sits on the shelf a long time') + '</div></div></section>' +
    '<section class="card"><div class="hd"><h2>Safety stock & reorder rules</h2></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Safety stock method</span>' + sel('ssMethod', [['days', 'Days of sales'], ['units', 'Fixed units'], ['pct', '% of lead-time demand']]) + '</label>' + numf('ssDays', 'Safety stock days') + numf('ssUnits', 'Safety stock units') + numf('ssPct', 'Safety stock %') + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">' + chk('roundPractical', 'Round recommended quantities up to practical amounts (7 → 10, 23 → 25)') + chk('roundToCase', 'Round orders up to full cases') + chk('countDrafts', 'Count draft purchase orders as incoming stock') + '<p class="small muted" style="margin:0">Recommendations are never below the minimum order quantity. You can still type any quantity on the Order recommendations page.</p></div></div></section>' +
    '<section class="card"><div class="hd"><h2>Defaults</h2></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Currency</span>' + sel('currency', [['USD', 'USD $'], ['CAD', 'CAD $'], ['EUR', 'EUR €'], ['GBP', 'GBP £'], ['AUD', 'AUD $']]) + '</label>' +
    numf('defaultProdLead', 'Default production lead (days)', 'For products with no supplier') + numf('defaultTransit', 'Default transit (days)') +
    '<label class="field"><span>Default supplier</span><select data-f="s||defaultSupplier"' + dis + '><option value="">None</option>' + WS.suppliers.map(function (x) { return '<option value="' + x.id + '"' + (s.defaultSupplier === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select><small>Assigned to newly synced products</small></label></div></div></section>' +
    '<section class="card"><div class="hd"><h2>Alerts</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:8px">' + chk('stockout', 'Stockout risk and out of stock', 1) + chk('order', 'Order recommendations', 1) + chk('low', 'Below reorder point', 1) + chk('supplier', 'Supplier running late', 1) + chk('spike', 'Unexpected sales increases', 1) + chk('overdue', 'Overdue deliveries', 1) +
    '<small class="faint">Each scheduled sync also prints the day\'s orders in the server terminal.</small>' +
    (Object.keys(UI.dismissed).length ? '<button class="btn sm" style="align-self:flex-start;margin-top:6px" data-act="undismiss">Restore ' + Object.keys(UI.dismissed).length + ' dismissed alerts</button>' : '') + '</div></section></div>';
}

var ROLE_HELP = { owner: 'Everything, including adding admins', admin: 'Everything: stores, settings and the team', editor: 'Create and receive purchase orders, edit products and suppliers, sync', viewer: 'Read-only: sees every page, changes nothing' };
function setTeam() {
  if (!UI.users) { loadUsers(); return '<div class="loading">Loading the team…</div>'; }
  var u = me() || {}, owner = u.role === 'owner';
  return '<section class="card"><div class="hd"><div><h2>Team</h2><div class="small muted">' + UI.users.length + ' account' + (UI.users.length === 1 ? '' : 's') + '</div></div><button class="btn primary" data-act="user-new">Add a person</button></div><div class="bd flush tw"><table class="t"><thead><tr><th>Person</th><th>Role</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>' +
    UI.users.map(function (x) {
      var self = x.id === u.id, canEdit = !self && x.role !== 'owner' && (owner || x.role !== 'admin');
      return '<tr><td><div class="pname"><b>' + esc(x.name) + (self ? ' <span class="tag">You</span>' : '') + (x.source === 'shopify' ? ' <span class="tag">Shopify</span>' : '') + '</b><span>' + esc(/@[a-z0-9-]+\.myshopify\.com$/.test(x.email) ? 'Shopify staff (no email shared)' : x.email) + '</span></div></td>' +
        '<td>' + (canEdit ? '<select data-f="urole|' + x.id + '|role" aria-label="Role for ' + esc(x.name) + '">' + ['admin', 'editor', 'viewer'].filter(function (r) { return owner || r !== 'admin'; }).map(function (r) { return '<option value="' + r + '"' + (x.role === r ? ' selected' : '') + '>' + r[0].toUpperCase() + r.slice(1) + '</option>'; }).join('') + '</select>' : '<b>' + esc(x.roleLabel) + '</b>') + '<div class="small faint">' + esc(ROLE_HELP[x.role]) + '</div></td>' +
        '<td class="small">' + esc(fmtWhen(x.lastLogin)) + '</td><td>' + (x.disabled ? '<span class="pill disc">Turned off</span>' : '<span class="pill healthy">Active</span>') + '</td>' +
        '<td>' + (canEdit ? '<div class="row" style="gap:4px;min-width:200px"><button class="btn ghost sm" data-act="user-reset|' + x.id + '">Reset password</button><button class="btn ghost sm" data-act="user-toggle|' + x.id + '">' + (x.disabled ? 'Turn on' : 'Turn off') + '</button><button class="btn ghost sm danger" data-act="user-remove|' + x.id + '">Remove</button></div>' : '') + '</td></tr>' +
        (UI.userConfirm === x.id ? '<tr><td colspan="5"><div class="note bad row" style="justify-content:space-between"><span>Remove ' + esc(x.name) + '? They are signed out and can\'t sign in again.</span><span class="row"><button class="btn sm" data-act="user-remove-no">Keep</button><button class="btn sm primary" data-act="user-remove-yes|' + x.id + '">Remove</button></span></div></td></tr>' : '') +
        (UI.userTemp && UI.userTemp.id === x.id ? '<tr><td colspan="5"><div class="note warn">Temporary password for ' + esc(x.email) + ': <code style="font-size:14px;user-select:all">' + esc(UI.userTemp.pw) + '</code> <button class="btn sm" data-act="copy-temp">Copy</button><div class="small" style="margin-top:4px">Share it privately. They\'ll choose their own password when they sign in. It won\'t be shown again.</div></div></td></tr>' : '');
    }).join('') + '</tbody></table></div></section>' +
    (Store.status && Store.status.shopifyApp && Store.status.shopifyApp.enabled ? '<section class="card"><div class="hd"><h2>Shopify staff</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:10px"><p class="small muted" style="margin:0">Anyone who opens Addendum-Stockline from your Shopify admin gets an account automatically, matched by email when they already have one. Store owners become admins. Everyone else starts with this role:</p>' +
      '<label class="field" style="max-width:260px"><span>Role for new Shopify staff</span><select data-f="s||shopifyStaffRole">' + ['editor', 'viewer'].concat((me() || {}).role === 'owner' ? ['admin'] : []).map(function (r) { return '<option value="' + r + '"' + ((settings().shopifyStaffRole || 'editor') === r ? ' selected' : '') + '>' + r[0].toUpperCase() + r.slice(1) + '</option>'; }).join('') + '</select></label><p class="small faint" style="margin:0">Shopify still decides who can open the app: staff need permission for it in Shopify admin → Settings → Users.</p></div></section>' : '') +
    '<section class="card"><div class="hd"><h2>Roles</h2></div><div class="bd"><dl class="dl">' + ['owner', 'admin', 'editor', 'viewer'].map(function (r) { return '<dt>' + r[0].toUpperCase() + r.slice(1) + '</dt><dd>' + ROLE_HELP[r] + '</dd>'; }).join('') + '</dl></div></section>' +
    '<section class="card"><div class="hd"><h2>Who can reach Addendum-Stockline</h2></div><div class="bd"><p class="small" style="margin:0">' + ((Store.status && /^(127\.0\.0\.1|localhost)$/.test(Store.status.network || '')) ? 'Right now only this computer can open Addendum-Stockline. To let the team in from other computers on your network, set <code>HOST=0.0.0.0</code> in <code>.env</code> and restart. Everyone still has to sign in.' : 'Addendum-Stockline accepts connections from your network. Everyone has to sign in.') + '</p></div></section>';
}
function loadUsers() { API.req('GET', '/api/users').then(function (u) { UI.users = u; render(); }).catch(function (e) { UI.users = []; toast(e.message); render(); }); }
function tempPassword() { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', a = new Uint32Array(14), o = ''; crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) o += c[a[i] % c.length]; return o.slice(0, 4) + '-' + o.slice(4, 9) + '-' + o.slice(9); }

function setAccount() {
  var u = me() || {}, shop = Store.status && Store.status.shop;
  var info = '<section class="card"><div class="hd"><h2>Your account</h2></div><div class="bd"><dl class="dl"><dt>Name</dt><dd>' + esc(u.name || '—') + '</dd><dt>Email</dt><dd>' + esc(/@[a-z0-9-]+\.myshopify\.com$/.test(u.email || '') ? 'Not shared by Shopify' : (u.email || '—')) + '</dd><dt>Role</dt><dd><b>' + esc(u.roleLabel || '—') + '</b> · ' + esc(ROLE_HELP[u.role] || '') + '</dd>' +
    (EMBED ? '<dt>Signed in</dt><dd>Through Shopify' + (shop ? ' (' + esc(shop) + ')' : '') + '</dd>' : '') + '</dl>' +
    (EMBED ? '' : '<div class="row" style="margin-top:14px"><button class="btn" data-act="logout">Sign out</button></div>') + '</div></section>';
  var pw = u.hasPassword === false
    ? '<section class="card"><div class="hd"><h2>Password</h2></div><div class="bd"><p class="small muted" style="margin:0">You sign in through Shopify, so you don\'t have a separate password. To also use Addendum-Stockline outside Shopify, ask an admin to reset your password under Settings → Team; you\'ll get a temporary one.</p></div></section>'
    : '<section class="card"><div class="hd"><h2>Change password</h2></div><div class="bd"><div class="fields" style="grid-template-columns:1fr">' +
      '<label class="field"><span>Current password</span><input type="password" id="pw-cur" autocomplete="current-password"></label>' +
      '<label class="field"><span>New password</span><input type="password" id="pw-new" autocomplete="new-password"><small>At least 10 characters. Other devices are signed out.</small></label>' +
      '<label class="field"><span>Type it again</span><input type="password" id="pw-new2" autocomplete="new-password"></label></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="pw-change">Change password</button></div></div></section>';
  return '<div class="grid2e">' + info + pw + '</div>';
}

/* ---------- Store & user modals ---------- */
function storeModal(m) {
  var appOn = !!(Store.status && Store.status.shopifyApp && Store.status.shopifyApp.enabled);
  var x = m.id ? ((Store.status && Store.status.stores) || []).filter(function (s) { return s.id === m.id; })[0] || {} : { auth: appOn ? 'app' : 'client', role: ((Store.status && Store.status.stores) || []).length ? 'sales' : 'primary', apiVersion: '2026-10', enabled: true };
  var d = m.draft || x, isNew = !m.id;
  // Shopify no longer issues Admin API access tokens, so stores still using one are moved to a Dev Dashboard app.
  var oldToken = d.auth === 'token';
  var auth = d.auth === 'exchange' ? 'app' : d.auth === 'token' ? 'client' : (d.auth || 'client');
  if (auth === 'manual') return manualStoreModal(m, x, d, isNew);
  return '<div class="mh"><div><div class="eyebrow">Shopify store</div><h2>' + (isNew ? 'Add a store' : esc(x.name)) + '</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') + (m.ok ? '<div class="note" style="background:var(--ok-soft);color:var(--ink)">' + esc(m.ok) + '</div>' : '') +
    (isNew ? storeTypeSeg('shopify') : '') +
    '<section class="card"><div class="hd"><h2>Store</h2></div><div class="bd"><div class="fields">' +
    '<label class="field"><span>Store address</span><input type="text" id="sm-domain" value="' + esc(d.domain || '') + '" placeholder="yourstore.myshopify.com" autocomplete="off"><small>The myshopify.com address, not your custom domain</small></label>' +
    '<label class="field"><span>Name in Addendum-Stockline</span><input type="text" id="sm-name" value="' + esc(d.name && d.name !== d.domain ? d.name : '') + '" placeholder="e.g. Retail or Pro"><small>Leave blank to use the store\'s Shopify name</small></label>' +
    '</div><fieldset style="border:0;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:8px"><legend class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Inventory role</legend>' +
    '<label class="check"><input type="radio" name="sm-role" value="primary"' + (d.role === 'primary' ? ' checked' : '') + '> <span><b>Stock source</b>: on-hand counts come from this store</span></label>' +
    '<label class="check"><input type="radio" name="sm-role" value="sales"' + (d.role !== 'primary' ? ' checked' : '') + '> <span><b>Sales</b>: sells the same stock; adds its orders and committed units</span></label></fieldset>' +
    '<label class="check" style="margin-top:12px"><input type="checkbox" id="sm-enabled"' + (d.enabled !== false ? ' checked' : '') + '> Include in syncs</label></div></section>' +
    (isNew ? '' : '<section class="card"><div class="hd"><h2>Logo</h2></div><div class="bd row" style="gap:16px">' + (x.logo ? '<img class="logo-lg" src="' + esc(mediaUrl(x.logo)) + '" alt="' + esc(x.name) + ' logo">' : '<span class="logo-lg ph">No logo</span>') +
      '<div style="display:flex;flex-direction:column;gap:8px"><span class="small muted">Shown with this store across Addendum-Stockline. The stock-source store\'s logo also appears in the sidebar and on the sign-in page unless an app logo is set under Appearance. Square images work best.</span><div class="row"><label class="btn sm">' + (x.logo ? 'Replace logo' : 'Upload logo') + '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img="store|' + x.id + '" hidden></label>' + (x.logo ? '<button class="btn ghost sm danger" data-act="logo-remove|' + x.id + '">Remove</button>' : '') + '</div></div></div></section>') +
    '<section class="card"><div class="hd"><h2>Connection</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:12px">' +
    '<div class="seg" role="group" aria-label="Connection type">' + (appOn || auth === 'app' ? '<button aria-pressed="' + (auth === 'app') + '" data-act="sm-auth|app">Addendum-Stockline app</button>' : '') + '<button aria-pressed="' + (auth === 'client') + '" data-act="sm-auth|client">Dev Dashboard app</button></div>' +
    (oldToken ? '<div class="note warn">This store was connected with an Admin API access token, which Shopify no longer offers. Enter a Dev Dashboard app\'s client ID and secret below to keep it syncing.</div>' : '') +
    (auth === 'app'
      ? (x.auth === 'exchange' ? '<div class="note" style="background:var(--ok-soft);color:var(--ink)">Connected through the Addendum-Stockline app installed on this store. Access renews automatically.</div>'
        : '<p class="small muted" style="margin:0">Recommended. Save the store here, then install Addendum-Stockline on it and open the app once from that store\'s Shopify admin. It connects itself; there\'s nothing to paste.</p>')
      : '<p class="small muted" style="margin:0">For apps created in Shopify\'s Dev Dashboard (dev.shopify.com). Addendum-Stockline swaps the ID and secret for a 24-hour token and renews it. The app must be installed on this store and belong to the same Shopify organization.</p><div class="fields"><label class="field"><span>Client ID</span><input type="text" id="sm-cid" value="' + esc(d.clientId || '') + '" autocomplete="off"></label><label class="field"><span>Client secret</span><input type="password" id="sm-secret" autocomplete="new-password" placeholder="' + (x.hasSecret ? 'Saved. Leave blank to keep it' : '') + '"></label></div>') +
    '<div class="fields"><label class="field"><span>API version</span><input type="text" id="sm-ver" value="' + esc(d.apiVersion || '2026-10') + '"><small>Shopify releases one each quarter, like 2026-10</small></label></div>' +
    '<p class="small faint" style="margin:0">Required scopes: read_products, read_inventory, read_orders, read_all_orders. Secrets are encrypted in the database and never sent back to the browser.</p></div></section>' +
    '<div class="row"><button class="btn primary" data-act="store-save"' + (m.busy ? ' disabled' : '') + '>' + (m.busy ? 'Checking connection…' : isNew ? 'Connect store' : 'Save changes') + '</button>' + (!isNew ? '<button class="btn" data-act="store-test"' + (m.busy ? ' disabled' : '') + '>Test connection</button>' : '') + '<button class="btn ghost" data-act="modal-close">Cancel</button>' +
    (!isNew ? (m.confirmRemove ? '<span class="row" style="margin-left:auto"><span class="small" style="color:var(--now)">Remove this store and its synced orders?</span><button class="btn sm" data-act="store-remove-no">Keep</button><button class="btn sm primary" data-act="store-remove-yes">Remove</button></span>' : '<button class="btn ghost danger" style="margin-left:auto" data-act="store-remove">Remove store</button>') : '') + '</div></div>';
}
function userModal(m) {
  var owner = (me() || {}).role === 'owner';
  return '<div class="mh"><div><div class="eyebrow">Team</div><h2>Add a person</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') +
    '<div class="fields"><label class="field"><span>Name</span><input type="text" id="um-name" autocomplete="off"></label><label class="field"><span>Email</span><input type="email" id="um-email" autocomplete="off"></label>' +
    '<label class="field"><span>Role</span><select id="um-role">' + ['editor', 'viewer'].concat(owner ? ['admin'] : []).map(function (r) { return '<option value="' + r + '">' + r[0].toUpperCase() + r.slice(1) + ' · ' + ROLE_HELP[r] + '</option>'; }).join('') + '</select></label></div>' +
    '<p class="small muted" style="margin:0">Addendum-Stockline creates a temporary password to share with them privately. They choose their own when they first sign in.</p>' +
    '<div class="row"><button class="btn primary" data-act="user-create">Add person</button><button class="btn ghost" data-act="modal-close">Cancel</button></div></div>';
}
function readStoreForm() {
  function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  var role = (document.querySelector('input[name="sm-role"]:checked') || {}).value || 'sales';
  if (UI.modal.auth === 'manual') { var pl = document.querySelector('input[name="sm-pl"]:checked'); return { auth: 'manual', name: v('sm-name'), role: role, priceList: pl ? pl.value : undefined }; }
  var d = { domain: v('sm-domain'), name: v('sm-name'), role: role, auth: UI.modal.auth || 'client', apiVersion: v('sm-ver') || '2026-10', enabled: (document.getElementById('sm-enabled') || {}).checked !== false };
  if (d.auth === 'token') d.auth = 'client';
  if (d.auth === 'client') { d.clientId = v('sm-cid'); var sec = v('sm-secret'); if (sec) d.clientSecret = sec; }
  return d;
}

/* ---------- Actions for settings ---------- */
Object.assign(ACTIONS, {
  'set-tab': function (t) { UI.setTab = t; if (t === 'team') UI.users = null; if (UI.page !== 'settings') go('settings'); else render(); },
  'sm-type': function (t) { UI.modal.draft = null; UI.modal.error = null; UI.modal.auth = t === 'manual' ? 'manual' : (Store.status && Store.status.shopifyApp && Store.status.shopifyApp.enabled ? 'app' : 'client'); render(); },
  logout: function () { API.req('POST', '/api/auth/logout').catch(function () {}).then(function () { location.href = '/login'; }); },
  'store-new': function () { UI.modal = { type: 'store', auth: 'manual' }; render(); setTimeout(function () { var i = document.getElementById('sm-domain'); if (i) i.focus(); }, 0); },
  'store-edit': function (id) { var x = (Store.status.stores || []).filter(function (s) { return s.id === id; })[0]; UI.modal = { type: 'store', id: id, auth: x ? x.auth : 'client' }; render(); },
  'sm-auth': function (a) { UI.modal.draft = readStoreForm(); UI.modal.auth = a; UI.modal.draft.auth = a; render(); },
  'store-save': async function () {
    var m = UI.modal, d = readStoreForm(); m.draft = d; m.error = null; m.ok = null; m.busy = true; render();
    try {
      var r = await API.req(m.id ? 'PUT' : 'POST', m.id ? '/api/stores/' + m.id : '/api/stores', d);
      await loadStatus(); m.busy = false;
      if (r.warning) { m.id = r.store.id; m.draft = null; m.error = r.warning; render(); return; }
      UI.modal = null; if (d.auth === 'manual') await loadWorkspace(); toast(r.info || ((r.shop ? 'Connected to ' + r.shop.name : 'Store saved') + '. Press Sync to bring in its data.')); render();
    } catch (e) { m.busy = false; m.error = e.message; render(); }
  },
  'store-test': async function () {
    var m = UI.modal; m.busy = true; m.error = null; m.ok = null; render();
    try { var r = await API.req('POST', '/api/stores/' + m.id + '/test', {}); m.ok = 'Connected to ' + r.shop.name + ' (' + r.shop.myshopifyDomain + '), ' + r.shop.ianaTimezone + ', ' + r.shop.currencyCode + '.'; await loadStatus(); }
    catch (e) { m.error = e.message; }
    m.busy = false; render();
  },
  'store-remove': function () { UI.modal.confirmRemove = true; render(); },
  'store-remove-no': function () { UI.modal.confirmRemove = false; render(); },
  'store-remove-yes': async function () {
    try { await API.req('DELETE', '/api/stores/' + UI.modal.id); UI.modal = null; await Promise.all([loadStatus(), loadWorkspace()]); toast('Store removed'); }
    catch (e) { UI.modal.error = e.message; UI.modal.confirmRemove = false; render(); }
  },
  'store-sync': function (id) { startSync(false, id); },
  'user-new': function () { UI.modal = { type: 'user' }; render(); setTimeout(function () { var i = document.getElementById('um-name'); if (i) i.focus(); }, 0); },
  'user-create': async function () {
    var pw = tempPassword(), body = { name: document.getElementById('um-name').value, email: document.getElementById('um-email').value, role: document.getElementById('um-role').value, password: pw };
    try { var u = await API.req('POST', '/api/users', body); UI.modal = null; UI.users = null; UI.userTemp = { id: u.id, pw: pw }; await new Promise(function (r) { API.req('GET', '/api/users').then(function (l) { UI.users = l; r(); }).catch(r); }); render(); }
    catch (e) { UI.modal.error = e.message; render(); }
  },
  'user-reset': async function (id) { var pw = tempPassword(); try { await API.req('PUT', '/api/users/' + id, { password: pw }); UI.userTemp = { id: id, pw: pw }; render(); } catch (e) { toast(e.message); } },
  'user-toggle': async function (id) { var x = UI.users.filter(function (u) { return u.id === id; })[0]; try { await API.req('PUT', '/api/users/' + id, { disabled: !x.disabled }); UI.users = null; render(); } catch (e) { toast(e.message); } },
  'user-remove': function (id) { UI.userConfirm = id; render(); },
  'user-remove-no': function () { UI.userConfirm = null; render(); },
  'user-remove-yes': async function (id) { try { await API.req('DELETE', '/api/users/' + id); UI.userConfirm = null; UI.users = null; toast('Removed'); render(); } catch (e) { toast(e.message); } },
  'copy-temp': function () { var t = UI.userTemp && UI.userTemp.pw; if (!t) return; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copied'); }).catch(function () { toast('Select the password and copy it'); }); },
  'pw-change': async function () {
    var c = document.getElementById('pw-cur').value, a = document.getElementById('pw-new').value, b = document.getElementById('pw-new2').value;
    if (a.length < 10) { toast('Use at least 10 characters.'); return; } if (a !== b) { toast('The new passwords don\'t match.'); return; }
    try { await API.req('POST', '/api/auth/password', { current: c, next: a }); toast('Password changed. Other devices were signed out.'); render(); } catch (e) { toast(e.message); }
  }
});

function salonSettingsCard() {
  var s = settings(), dis = isAdmin() ? '' : ' disabled';
  return '<section class="card"><div class="hd"><div><h2>Salon usage</h2><div class="small muted">Items logged on the Salon Usage page are tracked in Addendum-Stockline only. Shopify is never changed.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">' +
    '<label class="check"><input type="checkbox" data-f="sb||salonDeduct"' + (s.salonDeduct ? ' checked' : '') + dis + '> Also subtract salon usage from Addendum-Stockline\'s stock counts</label>' +
    '<p class="small muted" style="margin:0">Leave this off if you only want a record, or if salon product is already taken out of Shopify some other way. Turn it on if the salon pulls from the same shelf Shopify counts, so reorder timing reflects what is really there. It applies to entries logged while it is on.</p></div></section>';
}

/* ---------- Appearance: app name, app logo, colors ---------- */
var COLOR_FIELDS = [['accent', 'Accent', 'Buttons, links, highlights and the main chart line'], ['sidebar', 'Sidebar', 'The navigation bar and the sign-in panel'], ['background', 'Page background', 'Light mode only; dark mode keeps a dark background']];
function brandDraft() {
  if (!UI.brandDraft) { var c = (Store.status && Store.status.branding) || {}; UI.brandDraft = { appName: c.appName === 'Addendum-Stockline' ? '' : (c.appName || ''), accent: c.accent || '', sidebar: c.sidebar || '', background: c.background || '' }; }
  return UI.brandDraft;
}
function setAppearance() {
  var d = brandDraft(), cur = (Store.status && Store.status.branding) || {};
  var logoSrc = d.logo === null ? null : d.logoPreview || (cur.appLogo ? cur.logo : null);
  var def = BRAND.presets[0];
  return '<div class="grid2"><div class="stack">' +
    '<section class="card"><div class="hd"><div><h2>Colors</h2><div class="small muted">Changes preview right away. Press Save to keep them for everyone.</div></div></div><div class="bd" style="display:flex;flex-direction:column;gap:16px">' +
    '<div><div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:8px">Start from a palette</div><div class="swatches">' + BRAND.presets.map(function (p, i) {
      var on = (d.accent || def.accent).toLowerCase() === p.accent && (d.sidebar || def.sidebar).toLowerCase() === p.sidebar;
      return '<button class="swatch' + (on ? ' on' : '') + '" data-act="brand-preset|' + i + '" aria-pressed="' + on + '"><span style="background:' + p.sidebar + '"></span><span style="background:' + p.accent + '"></span><span style="background:' + p.background + '"></span><em>' + esc(p.name) + '</em></button>';
    }).join('') + '</div></div>' +
    '<div class="fields">' + COLOR_FIELDS.map(function (f) {
      var v = d[f[0]] || def[f[0]];
      return '<label class="field"><span>' + f[1] + '</span><div class="row" style="flex-wrap:nowrap;gap:8px"><input type="color" value="' + esc(v) + '" data-f="brand||' + f[0] + '" aria-label="' + f[1] + ' color" class="colorpick"><input type="text" id="bc-' + f[0] + '" value="' + esc(v) + '" data-f="brand||' + f[0] + '" maxlength="7" style="width:96px;font-family:ui-monospace,monospace" aria-label="' + f[1] + ' hex"></div><small>' + f[2] + '</small></label>';
    }).join('') + '</div>' +
    (d.accent && BRAND.ok(d.accent) && BRAND.lum(d.accent) > 0.5 ? '<p class="note warn small" style="margin:0">That accent is very light, so button text switches to dark. Check that links stay easy to read on white.</p>' : '') +
    '</div></section>' +
    '<section class="card"><div class="hd"><h2>Name and logo</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:14px">' +
    '<label class="field" style="max-width:320px"><span>App name</span><input type="text" id="bc-appName" data-f="brand||appName" value="' + esc(d.appName) + '" placeholder="Addendum-Stockline" maxlength="40"><small>Shown in the sidebar, browser tab and sign-in page</small></label>' +
    '<div class="row" style="gap:16px">' + (logoSrc ? '<img class="logo-lg" src="' + esc(logoSrc) + '" alt="App logo">' : '<span class="logo-lg ph">No app logo</span>') +
    '<div style="display:flex;flex-direction:column;gap:8px"><span class="small muted">Optional. Without one, the stock-source store\'s logo is used. Each store\'s own logo is set when you edit it under Stores & sync.</span><div class="row"><label class="btn sm">' + (logoSrc ? 'Replace logo' : 'Upload logo') + '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img="app|" hidden></label>' + (logoSrc ? '<button class="btn ghost sm danger" data-act="brand-logo-remove">Remove</button>' : '') + '</div></div></div></div></section>' +
    '<div class="row"><button class="btn primary" data-act="brand-save">Save appearance</button><button class="btn ghost" data-act="brand-cancel">Discard changes</button><button class="btn ghost" data-act="brand-reset">Restore default look</button></div></div>' +
    '<section class="card brand-preview"><div class="hd"><h2>Preview</h2></div><div class="bd flush"><div class="pv"><div class="pv-side">' + (logoSrc ? '<img src="' + esc(logoSrc) + '" alt="">' : '') + '<b>' + esc(d.appName || 'Addendum-Stockline') + '</b><span class="pv-nav on">Dashboard</span><span class="pv-nav">Inventory</span><span class="pv-nav">Purchase Orders</span></div>' +
    '<div class="pv-main"><div class="eyebrow">Today</div><div class="pv-h">Order 210 units</div><div class="row"><button class="btn primary sm" tabindex="-1">Create purchase order</button><span class="pill now">Order now</span><span class="tag manual">Manual</span></div><div class="mixbar" style="margin-top:6px"><span style="width:62%;background:var(--accent)"></span></div><a href="#" tabindex="-1" onclick="return false">A link looks like this</a></div></div></div></section></div>';
}
function previewBrand() {
  var d = brandDraft(), cur = (Store.status && Store.status.branding) || {};
  UI.brandPreview = { appName: d.appName || 'Addendum-Stockline', logo: d.logo === null ? null : d.logoPreview || cur.logo, accent: d.accent, sidebar: d.sidebar, background: d.background };
  BRAND.apply(UI.brandPreview);
}
Object.assign(ACTIONS, {
  'brand-preset': function (i) { var p = BRAND.presets[+i], d = brandDraft(); d.accent = p.accent; d.sidebar = p.sidebar; d.background = p.background; previewBrand(); render(); },
  'brand-logo-remove': function () { var d = brandDraft(); d.logo = null; d.logoPreview = null; UI.brandHasAppLogo = false; previewBrand(); render(); },
  'brand-cancel': function () { UI.brandDraft = null; UI.brandPreview = null; UI.brandHasAppLogo = undefined; BRAND.apply(Store.status && Store.status.branding); render(); },
  'brand-reset': function () { UI.brandDraft = { appName: '', accent: '', sidebar: '', background: '', logo: null }; UI.brandHasAppLogo = false; previewBrand(); render(); toast('Default look previewed. Press Save to keep it.'); },
  'brand-save': async function () {
    var d = brandDraft(), body = { appName: d.appName, accent: d.accent || null, sidebar: d.sidebar || null, background: d.background || null };
    if (d.logo !== undefined) body.logo = d.logo;
    for (var k of ['accent', 'sidebar', 'background']) if (body[k] && !BRAND.ok(body[k])) { toast(k[0].toUpperCase() + k.slice(1) + ' must be a color like #6b2d5c.'); return; }
    try { await API.req('PUT', '/api/branding', body); UI.brandDraft = null; UI.brandPreview = null; UI.brandHasAppLogo = undefined; await loadStatus(); toast('Appearance saved for everyone'); render(); }
    catch (e) { toast(e.message); }
  }
});

function storeTypeSeg(cur) {
  return '<div><div class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">How sales get in</div><div class="seg" role="group" aria-label="Store type"><button aria-pressed="' + (cur === 'manual') + '" data-act="sm-type|manual">Manual (no Shopify connection)</button><button aria-pressed="' + (cur === 'shopify') + '" data-act="sm-type|shopify">Connect to Shopify</button></div></div>';
}
function manualStoreModal(m, x, d, isNew) {
  return '<div class="mh"><div><div class="eyebrow">Store</div><h2>' + (isNew ? 'Add a store' : esc(x.name)) + '</h2></div><button class="btn ghost" data-act="modal-close" aria-label="Close">✕</button></div><div class="mb">' +
    (m.error ? '<div class="note bad">' + esc(m.error) + '</div>' : '') + (isNew ? storeTypeSeg('manual') : '') +
    '<section class="card"><div class="hd"><h2>Store</h2></div><div class="bd"><label class="field" style="max-width:360px"><span>Name</span><input type="text" id="sm-name" value="' + esc(d.name || '') + '" placeholder="e.g. Addendum Salon" autocomplete="off"></label>' +
    '<p class="small muted" style="margin:10px 0 0">No Shopify connection needed. The store gets its own page in the menu for logging purchases or importing its Shopify orders export. Stock is shared across all stores.</p>' +
    '<fieldset style="border:0;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:8px"><legend class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Prices this store charges</legend>' +
    '<label class="check"><input type="radio" name="sm-pl" value="retail"' + ((d.priceList || (isNew ? '' : x.priceList)) === 'retail' || (!isNew && !x.priceList) ? ' checked' : '') + '> <span><b>Retail (DTC)</b>: for shoppers, e.g. Addendum Hair</span></label>' +
    '<label class="check"><input type="radio" name="sm-pl" value="stylist"' + ((d.priceList || (isNew ? '' : x.priceList)) === 'stylist' ? ' checked' : '') + '> <span><b>Stylist</b>: for stylists and salons, e.g. Addendum Hair Pro</span></label>' + (isNew ? '<small class="faint">Not sure? Leave it: stores with “Pro” in the name use stylist prices, others retail.</small>' : '') + '</fieldset>' +
    '<fieldset style="border:0;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:8px"><legend class="small" style="font-weight:600;color:var(--ink-2);margin-bottom:6px">Role</legend>' +
    '<label class="check"><input type="radio" name="sm-role" value="primary"' + (d.role === 'primary' ? ' checked' : '') + '> <span><b>Main store</b>: where your stock is kept</span></label>' +
    '<label class="check"><input type="radio" name="sm-role" value="sales"' + (d.role !== 'primary' ? ' checked' : '') + '> <span><b>Sells the same stock</b></span></label></fieldset></div></section>' +
    (isNew ? '' : '<section class="card"><div class="hd"><h2>Logo</h2></div><div class="bd row" style="gap:16px">' + (x.logo ? '<img class="logo-lg" src="' + esc(mediaUrl(x.logo)) + '" alt="">' : '<span class="logo-lg ph">No logo</span>') +
      '<div class="row"><label class="btn sm">' + (x.logo ? 'Replace logo' : 'Upload logo') + '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img="store|' + x.id + '" hidden></label>' + (x.logo ? '<button class="btn ghost sm danger" data-act="logo-remove|' + x.id + '">Remove</button>' : '') + '</div></div></section>') +
    '<div class="row"><button class="btn primary" data-act="store-save">' + (isNew ? 'Add store' : 'Save changes') + '</button><button class="btn ghost" data-act="modal-close">Cancel</button>' +
    (!isNew ? (m.confirmRemove ? '<span class="row" style="margin-left:auto"><span class="small" style="color:var(--now)">Remove this store and the sales recorded for it?</span><button class="btn sm" data-act="store-remove-no">Keep</button><button class="btn sm primary" data-act="store-remove-yes">Remove</button></span>' : '<button class="btn ghost danger" style="margin-left:auto" data-act="store-remove">Remove store</button>') : '') + '</div></div>';
}
