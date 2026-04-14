'use strict';

const express = require('express');
const storage = require('../storage');
const { buildInvoice } = require('../invoice');
const { generatePDF } = require('../pdf');

const router = express.Router();

router.get('/', (req, res) => {
  const list = storage.getInvoices().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  res.json(list);
});

router.get('/next-number', (req, res) => {
  res.json({ numero: storage.nextInvoiceNumber() });
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body || {};
    const numero = body.numero || storage.nextInvoiceNumber();
    const inv = buildInvoice({ ...body, numero });
    storage.upsertInvoice(inv);
    if (!body.numero) storage.bumpInvoiceCounter();
    res.status(201).json(inv);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res) => {
  const inv = storage.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Fattura non trovata' });
  res.json(inv);
});

router.put('/:id', (req, res, next) => {
  try {
    const existing = storage.getInvoice(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Fattura non trovata' });
    const inv = buildInvoice({
      ...existing,
      ...req.body,
      id: existing.id,
      creataIl: existing.creataIl,
    });
    storage.upsertInvoice(inv);
    res.json(inv);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res) => {
  storage.deleteInvoice(req.params.id);
  res.json({ ok: true });
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const inv = storage.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Fattura non trovata' });
    const settings = storage.getSettings();
    const pdf = await generatePDF(inv, settings);
    const safeName = (inv.numero || inv.id).replace(/[^a-z0-9-_]+/gi, '_');
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="fattura-${safeName}.pdf"`,
      })
      .send(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/preview-pdf', async (req, res, next) => {
  try {
    const inv = buildInvoice({ ...(req.body || {}), numero: req.body?.numero || 'ANTEPRIMA' });
    const settings = storage.getSettings();
    const pdf = await generatePDF(inv, settings);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="anteprima.pdf"',
      })
      .send(pdf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
