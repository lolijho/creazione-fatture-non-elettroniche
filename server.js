'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const storage = require('./src/storage');
const auth = require('./src/auth');
const authRouter = require('./src/routes/auth');
const invoicesRouter = require('./src/routes/invoices');
const settingsRouter = require('./src/routes/settings');
const importRouter = require('./src/routes/import');
const woocommerceRouter = require('./src/routes/woocommerce');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data dir exists
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

storage.init();

// Eagerly initialize auth so any warnings (default password, missing
// SESSION_SECRET) are logged at startup rather than on first login.
auth._getUser();

// Honor X-Forwarded-* when behind Coolify / reverse proxy
app.set('trust proxy', true);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Public endpoints: health + login page assets + auth routes
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);

// Login page + its assets are served without auth
const publicDir = path.join(__dirname, 'public');
app.get(['/login', '/login.html'], (req, res) =>
  res.sendFile(path.join(publicDir, 'login.html'))
);
app.get('/login.js', (req, res) => res.sendFile(path.join(publicDir, 'login.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(publicDir, 'style.css')));

// All /api/* routes below require authentication
app.use('/api', auth.apiGuard);
app.use('/api/invoices', invoicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/import', importRouter);
app.use('/api/woocommerce', woocommerceRouter);

// Protected static UI: serve index.html only when logged in
app.get('/', auth.pageGuard, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/index.html', auth.pageGuard, (req, res) =>
  res.sendFile(path.join(publicDir, 'index.html'))
);

// Protect remaining static assets
app.use(auth.pageGuard, express.static(publicDir));

// Central error handler
app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  console.error('[error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Errore interno del server',
  });
});

app.listen(PORT, () => {
  console.log(
    `\nGeneratore fatture non elettroniche in ascolto su http://localhost:${PORT}`
  );
  console.log(`Data dir: ${dataDir}\n`);
});
