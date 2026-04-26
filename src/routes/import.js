'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const storage = require('../storage');
const { buildInvoice } = require('../invoice');
const { importFromFile, parseHeaders } = require('../importer');

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

function parseMapping(req) {
  const raw = req.body?.mapping;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function parseOpts(req) {
  const fmt = req.body?.numberFormat;
  return { numberFormat: fmt === 'comma' ? 'comma' : 'dot' };
}

// Inspect: parse file headers + suggested mapping (no parsing into invoices)
router.post('/headers', upload.single('file'), (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const result = parseHeaders(file.path, file.originalname);
    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

// Preview: parse file with given mapping, return parsed invoices without saving
router.post('/preview', upload.single('file'), (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const mapping = parseMapping(req);
    const opts = parseOpts(req);
    const invoices = importFromFile(file.path, file.originalname, mapping, opts);
    const enriched = invoices.map((inv) =>
      buildInvoice({ ...inv, numero: inv.numero || '(auto)' })
    );
    res.json({ count: enriched.length, invoices: enriched, mapping, numberFormat: opts.numberFormat });
  } catch (err) {
    next(err);
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

// Commit: parse file with given mapping and save invoices
router.post('/commit', upload.single('file'), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const mapping = parseMapping(req);
    const opts = parseOpts(req);
    const parsed = importFromFile(file.path, file.originalname, mapping, opts);
    const saved = [];
    for (const inv of parsed) {
      const numero = inv.numero || (await storage.nextInvoiceNumber());
      const finalInv = buildInvoice({ ...inv, numero });
      await storage.upsertInvoice(finalInv);
      if (!inv.numero) await storage.bumpInvoiceCounter();
      saved.push(finalInv);
    }
    res.json({ count: saved.length, invoices: saved });
  } catch (err) {
    next(err);
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

module.exports = router;
