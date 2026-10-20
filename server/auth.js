// Accounts, sessions and roles.
// Passwords are hashed with scrypt. Sessions are random tokens kept in an HttpOnly cookie; only a SHA-256
// of each token is stored, so a copy of the database can't be used to sign in.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'stockline_session';
const ROLES = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const ROLE_LABEL = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin', owner: 'Owner' };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}
function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
function validPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

function publicUser(u) { return u && { id: u.id, email: u.email, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role], disabled: !!u.disabled, createdAt: u.created_at, lastLogin: u.last_login, source: u.source || 'password', hasPassword: String(u.password_hash || '').startsWith('scrypt$') }; }
function userCount() { return db.get('SELECT COUNT(*) AS n FROM users').n; }
function findByEmail(email) { return db.get('SELECT * FROM users WHERE email = ?', [normEmail(email)]); }
function findById(id) { return db.get('SELECT * FROM users WHERE id = ?', [id]); }

function createUser({ email, name, role, password }) {
  email = normEmail(email);
  if (!validEmail(email)) throw new Error('Enter a valid email address.');
  if (!ROLES[role]) throw new Error('Choose a role.');
  const bad = validPassword(password); if (bad) throw new Error(bad);
  if (findByEmail(email)) throw new Error('Someone with that email already has an account.');
  const id = 'u_' + crypto.randomBytes(9).toString('base64url');
  db.tx(() => db.run('INSERT INTO users (id, email, name, role, password_hash, created_at, must_change) VALUES (?,?,?,?,?,?,?)',
    [id, email, String(name || '').trim().slice(0, 80) || email.split('@')[0], role, hashPassword(password), new Date().toISOString(), role === 'owner' ? 0 : 1]));
  return findById(id);
}

// ---- Sessions ----
function newSession(user, remember, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = remember ? 30 : 1;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  db.tx(() => {
    db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)', [sha(token), user.id, new Date().toISOString(), expires, String(req.headers['user-agent'] || '').slice(0, 200)]);
    db.run('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);
    db.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
  });
  return { token, maxAge: remember ? days * 86400 : null };
}
function setCookie(res, req, token, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}` + (maxAge ? `; Max-Age=${maxAge}` : ''));
}
function clearCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); }
function readToken(req) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
function sessionUser(req) {
  const t = readToken(req); if (!t) return null;
  const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', [sha(t)]);
  if (!s || s.expires_at < new Date().toISOString()) return null;
  const u = findById(s.user_id);
  if (!u || u.disabled) return null;
  return u;
}
function endSession(req) { const t = readToken(req); if (t) db.tx(() => db.run('DELETE FROM sessions WHERE token_hash = ?', [sha(t)])); }
function endAllSessions(userId, exceptReq) {
  const keep = exceptReq ? readToken(exceptReq) : null;
  db.tx(() => db.run('DELETE FROM sessions WHERE user_id = ?' + (keep ? ' AND token_hash <> ?' : ''), keep ? [userId, sha(keep)] : [userId]));
}

// ---- Brute-force protection: 5 failed attempts for one email (or 25 from one network address) → 15-minute pause ----
const fails = new Map();
function limited(key) { const f = fails.get(key); return f && f.n >= (key.startsWith('ip:') ? 25 : 5) && Date.now() - f.t < 15 * 60000; }
function noteFail(key) { const f = fails.get(key); if (f && Date.now() - f.t < 15 * 60000) { f.n++; f.t = Date.now(); } else fails.set(key, { n: 1, t: Date.now() }); }
function clearFails(key) { fails.delete(key); }

// ---- Middleware ----
function attach(req, res, next) { req.user = sessionUser(req); next(); }
function need(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (ROLES[req.user.role] < ROLES[role]) return res.status(403).json({ error: 'Your role (' + ROLE_LABEL[req.user.role] + ') can\'t do that. Ask an admin.' });
    next();
  };
}

module.exports = {
  ROLES, ROLE_LABEL, hashPassword, checkPassword, validPassword, normEmail, publicUser, userCount, findByEmail, findById, createUser,
  newSession, setCookie, clearCookie, sessionUser, endSession, endAllSessions, limited, noteFail, clearFails, attach, need
};
