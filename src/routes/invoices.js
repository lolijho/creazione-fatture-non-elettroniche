'use strict';

const express = require('express');
const storage = require('../storage');
const { buildInvoice } = require('../invoice');
const { generatePDF } = require('../pdf');
const pdfStore = require('../pdfStore');
const mailer = require('../mailer');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const list = await storage.getInvoices();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get('/next-number', async (req, res, next) => {
  try {
    res.json({ numero: await storage.nextInvoiceNumber() });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const numero = body.numero || (await storage.nextInvoiceNumber());
    const inv = buildInvoice({ ...body, numero });
    await storage.upsertInvoice(inv);
    if (!body.numero) await storage.bumpInvoiceCounter();
    // Persist PDF to volume (best effort — don't fail the create on PDF error)
    storage.getSettings()
      .then((settings) => pdfStore.buildAndStore(inv, settings))
      .catch((err) => console.error('[invoices] PDF persist error:', err.message));
    res.status(201).json(inv);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const inv = await storage.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Fattura non trovata' });
    res.json(inv);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await storage.getInvoice(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Fattura non trovata' });
    const inv = buildInvoice({
      ...existing,
      ...req.body,
      id: existing.id,
      creataIl: existing.creataIl,
    });
    await storage.upsertInvoice(inv);
    // Rebuild persisted PDF after update
    storage.getSettings()
      .then((settings) => pdfStore.buildAndStore(inv, settings))
      .catch((err) => console.error('[invoices] PDF rebuild error:', err.message));
    res.json(inv);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await storage.deleteInvoice(req.params.id);
    await pdfStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const inv = await storage.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Fattura non trovata' });
    const settings = await storage.getSettings();
    const { buffer } = await pdfStore.getOrBuild(inv, settings);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdfStore.safeFileName(inv)}"`,
      })
      .send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/preview-pdf', async (req, res, next) => {
  try {
    const inv = buildInvoice({ ...(req.body || {}), numero: req.body?.numero || 'ANTEPRIMA' });
    const settings = await storage.getSettings();
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

router.post('/:id/send-email', async (req, res, next) => {
  try {
    const inv = await storage.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Fattura non trovata' });
    const to = (req.body && req.body.to) || inv.cliente?.email;
    if (!to) {
      return res
        .status(400)
        .json({ error: 'Email destinatario mancante. Imposta cliente.email o passa "to" nel body.' });
    }
    const settings = await storage.getSettings();
    const { buffer } = await pdfStore.getOrBuild(inv, settings);
    const result = await mailer.sendInvoiceEmail({
      invoice: inv,
      settings,
      pdfBuffer: buffer,
      to,
    });
    await storage.markEmailSent(inv.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/email/test', async (req, res, next) => {
  try {
    const result = await mailer.verifyConnection();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
