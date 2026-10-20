// Image uploads: store logos and product photos.
// Files live in data/uploads/ and are only served to signed-in users. The type is checked from the file's
// own bytes, not its name, and SVG is refused (it can carry scripts).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DIR = path.join(db.DATA_DIR, 'uploads');
const MAX = 5 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'gif';
  return null;
}

// body: { data: "data:image/png;base64,..." } → returns the stored file name
function save(dataUrl) {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Choose a PNG, JPG, WebP or GIF image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX) throw new Error('That image is over 5 MB. Use a smaller one.');
  const ext = sniff(buf);
  if (!ext) throw new Error('That file isn\'t a PNG, JPG, WebP or GIF image.');
  fs.mkdirSync(DIR, { recursive: true });
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + ext;
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return name;
}

function serve(req, res) {
  const name = String(req.params.name || '');
  if (!/^[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(name)) return res.status(404).end();
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Content-Type', TYPES[name.split('.').pop()]);
  res.set('Cache-Control', 'private, max-age=31536000, immutable'); // names are content hashes
  res.set('Content-Security-Policy', "default-src 'none'");
  fs.createReadStream(file).pipe(res);
}

// Remove files nothing points at any more.
function prune() {
  if (!fs.existsSync(DIR)) return 0;
  const used = new Set();
  db.all('SELECT image FROM products WHERE image IS NOT NULL').forEach(r => used.add(r.image));
  db.all('SELECT logo FROM stores WHERE logo IS NOT NULL').forEach(r => used.add(r.logo));
  const b = db.config('branding', {}) || {}; if (b.logo) used.add(b.logo);
  let n = 0;
  fs.readdirSync(DIR).forEach(f => { if (!used.has(f)) { try { fs.unlinkSync(path.join(DIR, f)); n++; } catch (e) {} } });
  return n;
}

module.exports = { save, serve, prune };
