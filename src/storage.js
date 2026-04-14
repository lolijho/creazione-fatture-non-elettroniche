'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

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
    noteDefault: 'Pagamento a 30 giorni dalla data fattura.',
    dichiarazioneNonElettronica:
      'Documento cartaceo non avente valore di fattura elettronica ai fini del SdI.',
  },
  woocommerce: {
    url: '',
    consumerKey: '',
    consumerSecret: '',
    version: 'wc/v3',
  },
};

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[storage] errore lettura ${file}:`, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function init() {
  if (!fs.existsSync(INVOICES_FILE)) writeJSON(INVOICES_FILE, []);
  if (!fs.existsSync(SETTINGS_FILE)) writeJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
}

function getInvoices() {
  return readJSON(INVOICES_FILE, []);
}

function saveInvoices(list) {
  writeJSON(INVOICES_FILE, list);
}

function getInvoice(id) {
  return getInvoices().find((i) => i.id === id);
}

function upsertInvoice(invoice) {
  const list = getInvoices();
  const idx = list.findIndex((i) => i.id === invoice.id);
  if (idx >= 0) list[idx] = invoice;
  else list.push(invoice);
  saveInvoices(list);
  return invoice;
}

function deleteInvoice(id) {
  const list = getInvoices().filter((i) => i.id !== id);
  saveInvoices(list);
}

function getSettings() {
  const current = readJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
  // Merge with defaults to account for newly added fields
  return {
    azienda: { ...DEFAULT_SETTINGS.azienda, ...(current.azienda || {}) },
    fatturazione: { ...DEFAULT_SETTINGS.fatturazione, ...(current.fatturazione || {}) },
    woocommerce: { ...DEFAULT_SETTINGS.woocommerce, ...(current.woocommerce || {}) },
  };
}

function saveSettings(settings) {
  const merged = {
    ...getSettings(),
    ...settings,
  };
  writeJSON(SETTINGS_FILE, merged);
  return merged;
}

function nextInvoiceNumber() {
  const s = getSettings();
  const num = s.fatturazione.prossimoNumero || 1;
  const prefix = s.fatturazione.prefissoNumero || '';
  const year = new Date().getFullYear();
  return `${prefix}${year}-${String(num).padStart(4, '0')}`;
}

function bumpInvoiceCounter() {
  const s = getSettings();
  s.fatturazione.prossimoNumero = (s.fatturazione.prossimoNumero || 1) + 1;
  saveSettings(s);
}

module.exports = {
  init,
  getInvoices,
  saveInvoices,
  getInvoice,
  upsertInvoice,
  deleteInvoice,
  getSettings,
  saveSettings,
  nextInvoiceNumber,
  bumpInvoiceCounter,
};
