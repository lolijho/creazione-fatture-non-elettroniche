'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const LEGACY_INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
const LEGACY_SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MIGRATION_DONE_FILE = path.join(DATA_DIR, '.migrated-to-postgres');

const DEFAULT_SETTINGS = {
  azienda: {
    ragioneSociale: '',
    indirizzo: '',
    cap: '',
    citta: '',
    provincia: '',
    paese: 'Italia',
    partitaIva: '',
    codiceFiscale: '',
    telefono: '',
    email: '',
    sitoWeb: '',
    iban: '',
    regimeFiscale: 'Ordinario',
  },
  fatturazione: {
    prefissoNumero: '',
    prossimoNumero: 1,
    aliquotaIvaDefault: 22,
    valuta: 'EUR',
    noteDefault: 'Payment within 30 days from the invoice date.',
    dichiarazioneNonElettronica:
      'This document is a paper invoice and is not an electronic invoice for the Italian SdI system.',
    senzaIva: false,
    notaSenzaIva: 'Operation not subject to VAT — foreign supplier.',
  },
  woocommerce: {
    url: '',
    consumerKey: '',
    consumerSecret: '',
    version: 'wc/v3',
  },
  email: {
    oggettoTemplate: 'Invoice {numero} - {azienda}',
    corpoTemplate:
      'Dear {cliente},\n\nplease find attached invoice {numero} dated {data} for a total of {totale}.\n\nBest regards,\n{azienda}',
  },
};

async function init() {
  await db.migrate();
  await migrateLegacyJsonIfNeeded();
  await migrateItalianDefaultsToEnglish();
}

// One-shot migration: if the user has saved settings whose text fields still
// contain the previous Italian default values verbatim, replace them with the
// new English defaults. Custom text the user typed manually is preserved.
const ITALIAN_TO_ENGLISH_DEFAULTS = {
  fatturazione: {
    noteDefault: {
      from: 'Pagamento a 30 giorni dalla data fattura.',
      to: 'Payment within 30 days from the invoice date.',
    },
    dichiarazioneNonElettronica: {
      from: 'Documento cartaceo non avente valore di fattura elettronica ai fini del SdI.',
      to: 'This document is a paper invoice and is not an electronic invoice for the Italian SdI system.',
    },
    notaSenzaIva: {
      from: 'Operazione non soggetta a IVA — fornitore estero.',
      to: 'Operation not subject to VAT — foreign supplier.',
    },
  },
  email: {
    oggettoTemplate: {
      from: 'Fattura {numero} - {azienda}',
      to: 'Invoice {numero} - {azienda}',
    },
    corpoTemplate: {
      from:
        'Gentile {cliente},\n\nin allegato la fattura {numero} del {data} per un totale di {totale}.\n\nCordiali saluti,\n{azienda}',
      to:
        'Dear {cliente},\n\nplease find attached invoice {numero} dated {data} for a total of {totale}.\n\nBest regards,\n{azienda}',
    },
  },
};

async function migrateItalianDefaultsToEnglish() {
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'app'");
  if (!rows.length) return;
  const stored = rows[0].value || {};
  let changed = false;
  const next = { ...stored };
  for (const [section, fields] of Object.entries(ITALIAN_TO_ENGLISH_DEFAULTS)) {
    next[section] = { ...(stored[section] || {}) };
    for (const [field, { from, to }] of Object.entries(fields)) {
      if (next[section][field] === from) {
        next[section][field] = to;
        changed = true;
      }
    }
  }
  if (changed) {
    await db.query(
      `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'app'`,
      [next]
    );
    console.log('[storage] testi italiani di default migrati a inglese');
  }
}

function rowToInvoice(row) {
  if (!row) return null;
  const inv = row.payload || {};
  inv.id = row.id;
  return inv;
}

async function getInvoices() {
  const { rows } = await db.query(
    'SELECT id, payload FROM invoices ORDER BY data DESC NULLS LAST, created_at DESC'
  );
  return rows.map(rowToInvoice);
}

async function getInvoice(id) {
  const { rows } = await db.query('SELECT id, payload FROM invoices WHERE id = $1', [id]);
  return rowToInvoice(rows[0]);
}

async function upsertInvoice(invoice) {
  const totale = invoice?.totali?.totale ?? null;
  const data = invoice.data || null;
  await db.query(
    `INSERT INTO invoices (id, numero, data, cliente, cliente_email, totale, origine, payload, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       numero = EXCLUDED.numero,
       data = EXCLUDED.data,
       cliente = EXCLUDED.cliente,
       cliente_email = EXCLUDED.cliente_email,
       totale = EXCLUDED.totale,
       origine = EXCLUDED.origine,
       payload = EXCLUDED.payload,
       updated_at = NOW()`,
    [
      invoice.id,
      invoice.numero || null,
      data,
      invoice.cliente?.ragioneSociale || null,
      invoice.cliente?.email || null,
      totale,
      invoice.origine || 'manuale',
      invoice,
    ]
  );
  return invoice;
}

async function deleteInvoice(id) {
  await db.query('DELETE FROM invoices WHERE id = $1', [id]);
}

async function markEmailSent(id, when = new Date()) {
  await db.query('UPDATE invoices SET email_sent_at = $2, updated_at = NOW() WHERE id = $1', [
    id,
    when,
  ]);
}

function mergeSettings(current) {
  const c = current || {};
  return {
    azienda: { ...DEFAULT_SETTINGS.azienda, ...(c.azienda || {}) },
    fatturazione: { ...DEFAULT_SETTINGS.fatturazione, ...(c.fatturazione || {}) },
    woocommerce: { ...DEFAULT_SETTINGS.woocommerce, ...(c.woocommerce || {}) },
    email: { ...DEFAULT_SETTINGS.email, ...(c.email || {}) },
  };
}

async function getSettings() {
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'app'");
  const stored = rows[0]?.value || {};
  return mergeSettings(stored);
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = mergeSettings({
    azienda: { ...current.azienda, ...(partial.azienda || {}) },
    fatturazione: { ...current.fatturazione, ...(partial.fatturazione || {}) },
    woocommerce: { ...current.woocommerce, ...(partial.woocommerce || {}) },
    email: { ...current.email, ...(partial.email || {}) },
  });
  await db.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('app', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [next]
  );
  return next;
}

async function nextInvoiceNumber() {
  const s = await getSettings();
  const num = s.fatturazione.prossimoNumero || 1;
  const prefix = s.fatturazione.prefissoNumero || '';
  const year = new Date().getFullYear();
  return `${prefix}${year}-${String(num).padStart(4, '0')}`;
}

function formatInvoiceNumber({ prefix = '', year, num }) {
  const y = year || new Date().getFullYear();
  return `${prefix}${y}-${String(num).padStart(4, '0')}`;
}

async function bumpInvoiceCounter() {
  const s = await getSettings();
  s.fatturazione.prossimoNumero = (s.fatturazione.prossimoNumero || 1) + 1;
  await saveSettings(s);
}

async function migrateLegacyJsonIfNeeded() {
  if (fs.existsSync(MIGRATION_DONE_FILE)) return;

  let imported = 0;
  let settingsImported = false;

  if (fs.existsSync(LEGACY_INVOICES_FILE)) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM invoices');
    if (rows[0].n === 0) {
      try {
        const list = JSON.parse(fs.readFileSync(LEGACY_INVOICES_FILE, 'utf8'));
        if (Array.isArray(list)) {
          for (const inv of list) {
            if (inv && inv.id) {
              await upsertInvoice(inv);
              imported++;
            }
          }
        }
      } catch (err) {
        console.error('[storage] migrazione invoices.json fallita:', err.message);
      }
    }
  }

  if (fs.existsSync(LEGACY_SETTINGS_FILE)) {
    const { rows } = await db.query("SELECT 1 FROM settings WHERE key = 'app'");
    if (rows.length === 0) {
      try {
        const s = JSON.parse(fs.readFileSync(LEGACY_SETTINGS_FILE, 'utf8'));
        await saveSettings(s || {});
        settingsImported = true;
      } catch (err) {
        console.error('[storage] migrazione settings.json fallita:', err.message);
      }
    }
  }

  if (imported || settingsImported) {
    console.log(
      `[storage] migrazione completata: ${imported} fattura/e, settings=${settingsImported ? 'sì' : 'no'}`
    );
  }

  try {
    fs.writeFileSync(MIGRATION_DONE_FILE, new Date().toISOString(), 'utf8');
  } catch (_) {
    /* ignore — no persistent volume */
  }
}

module.exports = {
  init,
  getInvoices,
  getInvoice,
  upsertInvoice,
  deleteInvoice,
  markEmailSent,
  getSettings,
  saveSettings,
  nextInvoiceNumber,
  formatInvoiceNumber,
  bumpInvoiceCounter,
};
