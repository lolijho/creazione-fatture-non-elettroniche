'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const storage = require('../storage');
const { buildInvoice } = require('../invoice');
const { importFromFile } = require('../importer');

const router = express.Router();

const uploadsDir = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'uploads')
  : path.join(__dirname, '..', '..', 'data', 'uploads');
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.txt', '.xlsx', '.xls', '.ods'].includes(ext)) cb(null, true);
    else cb(new Error('Formato file non supportato. Usa CSV, XLSX o ODS.'));
  },
});

// Preview: parse file, return parsed invoices without saving
router.post('/preview', upload.single('file'), (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const invoices = importFromFile(file.path, file.originalname);
    const enriched = invoices.map((inv) => buildInvoice({
      ...inv,
      numero: inv.numero || '(auto)',
    }));
    res.json({ count: enriched.length, invoices: enriched });
  } catch (err) {
    next(err);
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

// Commit: parse and save invoices
router.post('/commit', upload.single('file'), (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const parsed = importFromFile(file.path, file.originalname);
    const saved = [];
    parsed.forEach((inv) => {
      const numero = inv.numero || storage.nextInvoiceNumber();
      const finalInv = buildInvoice({ ...inv, numero });
      storage.upsertInvoice(finalInv);
      if (!inv.numero) storage.bumpInvoiceCounter();
      saved.push(finalInv);
    });
    res.json({ count: saved.length, invoices: saved });
  } catch (err) {
    next(err);
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

module.exports = router;
