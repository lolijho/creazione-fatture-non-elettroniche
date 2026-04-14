'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

const TOKEN_COOKIE = 'ft_session';
const TOKEN_TTL = '30d';

let cachedSecret = null;
let cachedUser = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getSessionSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }
  ensureDataDir();
  if (fs.existsSync(SECRET_FILE)) {
    cachedSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (cachedSecret.length >= 16) return cachedSecret;
  }
  cachedSecret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, cachedSecret, { mode: 0o600 });
  try { fs.chmodSync(SECRET_FILE, 0o600); } catch (_) { /* windows */ }
  console.warn(
    '[auth] SESSION_SECRET non impostato: generato e salvato in data/secret.key. ' +
      'Per deploy in produzione imposta SESSION_SECRET come variabile di ambiente.'
  );
  return cachedSecret;
}

function getUser() {
  if (cachedUser) return cachedUser;
  const username = (process.env.AUTH_USERNAME || 'admin').trim();
  const hashEnv = process.env.AUTH_PASSWORD_HASH;
  const plainEnv = process.env.AUTH_PASSWORD;

  let passwordHash;
  if (hashEnv && hashEnv.startsWith('$2')) {
    passwordHash = hashEnv;
  } else if (plainEnv && plainEnv.length > 0) {
    passwordHash = bcrypt.hashSync(plainEnv, 10);
  } else {
    // Insecure default — log a prominent warning
    passwordHash = bcrypt.hashSync('changeme', 10);
    console.warn(
      '\n[auth] ATTENZIONE: AUTH_PASSWORD non impostato. Uso credenziali di default ' +
        'admin/changeme. Impostare AUTH_USERNAME e AUTH_PASSWORD (o AUTH_PASSWORD_HASH) ' +
        'nelle variabili di ambiente prima di esporre il servizio in produzione.\n'
    );
  }
  cachedUser = { username, passwordHash };
  return cachedUser;
}

function signToken(payload) {
  return jwt.sign(payload, getSessionSecret(), { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, getSessionSecret());
  } catch (_) {
    return null;
  }
}

function cookieOptions(req) {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    (req.secure || req.headers['x-forwarded-proto'] === 'https');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  };
}

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username e password sono richiesti' });
  }
  const user = getUser();
  const userOk = String(username).trim().toLowerCase() === user.username.toLowerCase();
  const passOk = userOk ? await bcrypt.compare(String(password), user.passwordHash) : false;
  if (!userOk || !passOk) {
    // Constant-ish time compare to avoid trivial timing hints
    await bcrypt.compare('dummy', '$2a$10$C6UzMDM.H6dfI/f/IKcEeO8s0l9Q6nJH1ZRr5cS0oQ3jC5c2X6M2u').catch(() => {});
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  const token = signToken({ sub: user.username });
  res.cookie(TOKEN_COOKIE, token, cookieOptions(req));
  res.json({ ok: true, username: user.username });
}

function logout(req, res) {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
  res.json({ ok: true });
}

function me(req, res) {
  const token = req.cookies?.[TOKEN_COOKIE];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: payload.sub });
}

function apiGuard(req, res, next) {
  const token = req.cookies?.[TOKEN_COOKIE];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Non autenticato' });
  req.user = payload;
  next();
}

// Serves the HTML app only to logged-in users; redirects others to /login.html
function pageGuard(req, res, next) {
  const token = req.cookies?.[TOKEN_COOKIE];
  const payload = token && verifyToken(token);
  if (!payload) {
    res.redirect('/login.html');
    return;
  }
  next();
}

module.exports = {
  login,
  logout,
  me,
  apiGuard,
  pageGuard,
  TOKEN_COOKIE,
  // exported for tests / tools
  _getUser: getUser,
};
