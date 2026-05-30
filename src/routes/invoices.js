'use strict';

const express = require('express');
const archiver = require('archiver');
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

function yearOf(inv) {
  const s = inv.data || '';
  const m = /^(\d{4})/.exec(s);
  if (m) return parseInt(m[1], 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}

router.get('/export.zip', async (req, res, next) => {
  try {
    const yearFilter = req.query.year ? parseInt(req.query.year, 10) : null;
    const settings = await storage.getSettings();
    let list = await storage.getInvoices();
    if (yearFilter) list = list.filter((i) => yearOf(i) === yearFilter);

    if (!list.length) {
      return res.status(404).json({ error: 'Nessuna fattura da esportare' });
    }

    const filename = yearFilter
      ? `invoices-${yearFilter}.zip`
      : `invoices-all-${new Date().toISOString().slice(0, 10)}.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[export] archive error:', err.message);
      try { res.end(); } catch (_) { /* ignore */ }
    });
    archive.pipe(res);

    for (const inv of list) {
      try {
        const { buffer } = await pdfStore.getOrBuild(inv, settings);
        const folder = String(yearOf(inv) || 'sconosciuto');
        const fname = pdfStore.safeFileName(inv);
        archive.append(buffer, { name: `${folder}/${fname}` });
      } catch (err) {
        console.error(`[export] error on invoice ${inv.id}:`, err.message);
      }
    }
    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const numero = body.numero || (await storage.nextInvoiceNumber());
    const settings = await storage.getSettings();
    const inv = buildInvoice(
      { ...body, numero },
      { senzaIva: !!settings.fatturazione?.senzaIva }
    );
    await storage.upsertInvoice(inv);
    if (!body.numero) await storage.bumpInvoiceCounter();
    pdfStore.buildAndStore(inv, settings).catch((err) =>
      console.error('[invoices] PDF persist error:', err.message)
    );
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
    const settings = await storage.getSettings();
    const inv = buildInvoice(
      {
        ...existing,
        ...req.body,
        id: existing.id,
        creataIl: existing.creataIl,
      },
      { senzaIva: !!settings.fatturazione?.senzaIva }
    );
    await storage.upsertInvoice(inv);
    pdfStore.buildAndStore(inv, settings).catch((err) =>
      console.error('[invoices] PDF rebuild error:', err.message)
    );
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
    const settings = await storage.getSettings();
    const inv = buildInvoice(
      { ...(req.body || {}), numero: req.body?.numero || 'PREVIEW' },
      { senzaIva: !!settings.fatturazione?.senzaIva }
    );
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

router.post('/regenerate-pdfs', async (req, res, next) => {
  try {
    const settings = await storage.getSettings();
    const senzaIva = !!settings.fatturazione?.senzaIva;
    const list = await storage.getInvoices();
    const errors = [];
    let ok = 0;
    for (const inv of list) {
      try {
        // Recompute totals with the current senzaIva setting so existing
        // invoices stored with aliquotaIva > 0 get their totals corrected.
        const rebuilt = buildInvoice(inv, { senzaIva });
        // preserve original ID and creation timestamp
        rebuilt.id = inv.id;
        rebuilt.creataIl = inv.creataIl || rebuilt.creataIl;
        await storage.upsertInvoice(rebuilt);
        await pdfStore.buildAndStore(rebuilt, settings);
        ok++;
      } catch (err) {
        errors.push({ id: inv.id, numero: inv.numero, error: err.message });
      }
    }
    res.json({ total: list.length, regenerated: ok, errors });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
