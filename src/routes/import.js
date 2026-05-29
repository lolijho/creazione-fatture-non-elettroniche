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

function parseNumberingOpts(req) {
  const body = req.body || {};
  const raw = body.startNumber;
  const startNumber =
    raw === '' || raw == null ? null : Number.isFinite(Number(raw)) ? parseInt(raw, 10) : null;
  return {
    startNumber: startNumber && startNumber > 0 ? startNumber : null,
    useInvoiceYear: body.useInvoiceYear !== 'false', // default true
    sortByDate: body.sortByDate !== 'false',         // default true
  };
}

function yearOf(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})/.exec(String(dateStr));
  if (m) return parseInt(m[1], 10);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.getFullYear();
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
router.post('/preview', upload.single('file'), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const mapping = parseMapping(req);
    const opts = parseOpts(req);
    const numbering = parseNumberingOpts(req);
    const settings = await storage.getSettings();
    const senzaIva = !!settings.fatturazione?.senzaIva;
    const prefix = settings.fatturazione?.prefissoNumero || '';

    let parsed = importFromFile(file.path, file.originalname, mapping, opts);
    if (numbering.sortByDate) {
      parsed = [...parsed].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    }

    let counter = numbering.startNumber !== null
      ? numbering.startNumber
      : settings.fatturazione?.prossimoNumero || 1;

    const enriched = parsed.map((inv) => {
      let numero = inv.numero;
      if (!numero) {
        const year = numbering.useInvoiceYear
          ? yearOf(inv.data) || new Date().getFullYear()
          : new Date().getFullYear();
        numero = storage.formatInvoiceNumber({ prefix, year, num: counter });
        counter++;
      }
      return buildInvoice({ ...inv, numero }, { senzaIva });
    });

    res.json({
      count: enriched.length,
      invoices: enriched,
      mapping,
      numberFormat: opts.numberFormat,
      numbering: { startNumber: numbering.startNumber, nextCounter: counter },
    });
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
    const numbering = parseNumberingOpts(req);
    const settings = await storage.getSettings();
    const senzaIva = !!settings.fatturazione?.senzaIva;
    const prefix = settings.fatturazione?.prefissoNumero || '';

    let parsed = importFromFile(file.path, file.originalname, mapping, opts);

    if (numbering.sortByDate) {
      parsed = [...parsed].sort((a, b) => {
        const da = a.data || '';
        const db = b.data || '';
        return da.localeCompare(db);
      });
    }

    // Decide starting counter and whether to bump the live settings counter.
    const useBatch = numbering.startNumber !== null;
    let counter = useBatch
      ? numbering.startNumber
      : settings.fatturazione?.prossimoNumero || 1;

    const saved = [];
    for (const inv of parsed) {
      let numero = inv.numero;
      if (!numero) {
        const year = numbering.useInvoiceYear
          ? yearOf(inv.data) || new Date().getFullYear()
          : new Date().getFullYear();
        numero = storage.formatInvoiceNumber({ prefix, year, num: counter });
        counter++;
      }
      const finalInv = buildInvoice({ ...inv, numero }, { senzaIva });
      await storage.upsertInvoice(finalInv);
      saved.push(finalInv);
    }

    // Only advance the live counter if the batch consumed it.
    if (!useBatch && saved.length) {
      const consumed = parsed.filter((p) => !p.numero).length;
      for (let i = 0; i < consumed; i++) await storage.bumpInvoiceCounter();
    }

    res.json({
      count: saved.length,
      invoices: saved,
      numbering: { startNumber: numbering.startNumber, nextCounter: counter },
    });
  } catch (err) {
    next(err);
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

module.exports = router;
