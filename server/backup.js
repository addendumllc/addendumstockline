// One-file backups: the database, the key that unlocks saved store credentials, and uploaded logos and photos.
// Used to move a workspace to another computer or to a hosted server, and to restore after a mistake.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const shopify = require('./shopify');

const UPLOADS = path.join(db.DATA_DIR, 'uploads');
const KEY_FILE = path.join(db.DATA_DIR, 'secret.key');

function create() {
  const uploads = {};
  if (fs.existsSync(UPLOADS)) fs.readdirSync(UPLOADS).forEach(f => {
    const p = path.join(UPLOADS, f);
    if (fs.statSync(p).isFile()) uploads[f] = fs.readFileSync(p).toString('base64');
  });
  return {
    app: 'addendum-stockline', version: 1, createdAt: new Date().toISOString(),
    db: db.exportBuffer().toString('base64'),
    secretKey: fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : null,
    uploads
  };
}

function restore(b) {
  if (shopify.state.running) throw new Error('A sync is running. Wait for it to finish, then restore.');
  if (!b || b.app !== 'addendum-stockline' || !b.db) throw new Error('That file is not an Addendum-Stockline backup.');
  if (b.version !== 1) throw new Error('This backup comes from a newer version of Addendum-Stockline. Update this copy first.');
  const buf = Buffer.from(String(b.db), 'base64');
  db.checkBuffer(buf); // throws before anything changes if the file is damaged
  const uploads = b.uploads && typeof b.uploads === 'object' ? b.uploads : {};
  Object.keys(uploads).forEach(f => { if (!/^[A-Za-z0-9._-]+$/.test(f) || f.startsWith('.')) throw new Error('The backup contains an unexpected file name: ' + f); });
  // Keep the current files beside the new ones until the swap has worked.
  const stamp = Date.now();
  if (fs.existsSync(db.DB_FILE)) fs.copyFileSync(db.DB_FILE, db.DB_FILE + '.before-restore-' + stamp);
  if (fs.existsSync(KEY_FILE)) fs.copyFileSync(KEY_FILE, KEY_FILE + '.before-restore-' + stamp);
  if (b.secretKey) fs.writeFileSync(KEY_FILE, String(b.secretKey).trim(), { mode: 0o600 });
  fs.mkdirSync(UPLOADS, { recursive: true });
  Object.keys(uploads).forEach(f => fs.writeFileSync(path.join(UPLOADS, f), Buffer.from(String(uploads[f]), 'base64')));
  db.replaceWith(buf);
  shopify.clearTokens();
  return { ok: true, uploads: Object.keys(uploads).length };
}

module.exports = { create, restore };
