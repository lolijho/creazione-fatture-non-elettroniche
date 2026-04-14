'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const storage = require('./src/storage');
const invoicesRouter = require('./src/routes/invoices');
const settingsRouter = require('./src/routes/settings');
const importRouter = require('./src/routes/import');
const woocommerceRouter = require('./src/routes/woocommerce');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data dir exists
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

storage.init();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/invoices', invoicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/import', importRouter);
app.use('/api/woocommerce', woocommerceRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Central error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Errore interno del server',
  });
});

app.listen(PORT, () => {
  console.log(`\nGeneratore fatture non elettroniche in ascolto su http://localhost:${PORT}\n`);
});
