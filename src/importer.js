'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

/**
 * Campi canonici della fattura. La UI mostra una mappatura
 * "colonna del file" → "campo canonico".
 */
const INVOICE_FIELDS = [
  { key: 'numero', label: 'Numero fattura', section: 'Fattura' },
  { key: 'data', label: 'Data', section: 'Fattura', required: true },
  { key: 'scadenza', label: 'Scadenza', section: 'Fattura' },
  { key: 'metodo_pagamento', label: 'Metodo pagamento', section: 'Fattura' },
  { key: 'note', label: 'Note', section: 'Fattura' },
  { key: 'cliente_ragione_sociale', label: 'Cliente: Ragione sociale', section: 'Cliente', required: true },
  { key: 'cliente_indirizzo', label: 'Cliente: Indirizzo', section: 'Cliente' },
  { key: 'cliente_cap', label: 'Cliente: CAP', section: 'Cliente' },
  { key: 'cliente_citta', label: 'Cliente: Città', section: 'Cliente' },
  { key: 'cliente_provincia', label: 'Cliente: Provincia', section: 'Cliente' },
  { key: 'cliente_paese', label: 'Cliente: Paese', section: 'Cliente' },
  { key: 'cliente_piva', label: 'Cliente: P.IVA', section: 'Cliente' },
  { key: 'cliente_cf', label: 'Cliente: Codice fiscale', section: 'Cliente' },
  { key: 'cliente_email', label: 'Cliente: Email', section: 'Cliente' },
  { key: 'cliente_telefono', label: 'Cliente: Telefono', section: 'Cliente' },
  { key: 'descrizione', label: 'Riga: Descrizione', section: 'Riga', required: true },
  { key: 'codice', label: 'Riga: Codice', section: 'Riga' },
  { key: 'unita_misura', label: 'Riga: Unità di misura', section: 'Riga' },
  { key: 'quantita', label: 'Riga: Quantità', section: 'Riga', required: true },
  { key: 'prezzo_unitario', label: 'Riga: Prezzo unitario', section: 'Riga', required: true },
  { key: 'aliquota_iva', label: 'Riga: Aliquota IVA %', section: 'Riga' },
  { key: 'sconto_pct', label: 'Riga: Sconto %', section: 'Riga' },
];

// Aliasi noti: una intestazione che normalizzata combacia con uno di questi
// alias viene mappata sul campo canonico corrispondente.
const FIELD_ALIASES = {
  numero: ['numero', 'n_fattura', 'n_doc', 'numero_fattura', 'invoice_number', 'fattura'],
  data: ['data', 'data_fattura', 'date', 'data_documento'],
  scadenza: ['scadenza', 'data_scadenza', 'due_date'],
  metodo_pagamento: ['metodo_pagamento', 'metodo_di_pagamento', 'pagamento', 'payment_method'],
  note: ['note', 'annotazioni', 'notes', 'descrizione_aggiuntiva'],
  cliente_ragione_sociale: [
    'cliente_ragione_sociale',
    'cliente',
    'ragione_sociale',
    'cliente_nome',
    'nome_cliente',
    'company',
    'customer',
    'customer_name',
    'denominazione',
  ],
  cliente_indirizzo: ['cliente_indirizzo', 'indirizzo', 'address', 'via'],
  cliente_cap: ['cliente_cap', 'cap', 'zip', 'postal_code'],
  cliente_citta: ['cliente_citta', 'citta', 'city', 'comune'],
  cliente_provincia: ['cliente_provincia', 'provincia', 'pr', 'state'],
  cliente_paese: ['cliente_paese', 'paese', 'nazione', 'country'],
  cliente_piva: ['cliente_piva', 'cliente_partita_iva', 'p_iva', 'partita_iva', 'piva', 'vat'],
  cliente_cf: ['cliente_cf', 'cliente_codice_fiscale', 'codice_fiscale', 'cf', 'tax_id'],
  cliente_email: ['cliente_email', 'email', 'mail', 'email_cliente'],
  cliente_telefono: ['cliente_telefono', 'telefono', 'phone', 'tel'],
  descrizione: ['descrizione', 'description', 'prodotto', 'item', 'articolo', 'voce'],
  codice: ['codice', 'sku', 'code', 'codice_articolo', 'codice_prodotto'],
  unita_misura: ['unita_misura', 'um', 'unita', 'unit'],
  quantita: ['quantita', 'qta', 'qty', 'quantity', 'q_ta'],
  prezzo_unitario: [
    'prezzo_unitario',
    'prezzo',
    'price',
    'unit_price',
    'importo_unitario',
    'costo',
  ],
  aliquota_iva: ['aliquota_iva', 'iva', 'aliquota', 'vat_rate', 'tax'],
  sconto_pct: ['sconto_pct', 'sconto', 'discount', 'sconto_percentuale'],
};

function normalizeKey(k) {
  return String(k || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    const content = fs.readFileSync(filePath, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      delimiter: detectDelimiter(content),
    });
    return records;
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.ods') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  throw new Error(`Formato non supportato: ${ext}`);
}

function detectDelimiter(sample) {
  const firstLine = sample.split(/\r?\n/)[0] || '';
  const counts = {
    ';': (firstLine.match(/;/g) || []).length,
    ',': (firstLine.match(/,/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

function getHeaders(rows) {
  const headers = new Set();
  for (const r of rows) Object.keys(r).forEach((k) => headers.add(k));
  return Array.from(headers);
}

function suggestMapping(headers) {
  const mapping = {};
  const normalizedToOriginal = new Map();
  for (const h of headers) {
    const n = normalizeKey(h);
    if (!normalizedToOriginal.has(n)) normalizedToOriginal.set(n, h);
  }
  for (const field of INVOICE_FIELDS) {
    const aliases = FIELD_ALIASES[field.key] || [field.key];
    for (const alias of aliases) {
      const original = normalizedToOriginal.get(alias);
      if (original) {
        mapping[field.key] = original;
        break;
      }
    }
  }
  return mapping;
}

function applyMapping(rows, mapping) {
  const entries = Object.entries(mapping || {}).filter(([, src]) => src);
  return rows.map((row) => {
    const out = {};
    for (const [canonical, srcHeader] of entries) {
      let val = row[srcHeader];
      if (typeof val === 'string') val = val.trim();
      out[canonical] = val;
    }
    return out;
  });
}

function toNumber(v, format) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/\s/g, '').replace(/[€$£]/g, '');
  if (format === 'comma') {
    // Italian style: dot = thousands separator, comma = decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Default: dot = decimal separator. Strip thousands commas only when
    // they appear with three-digit groups (e.g. "1,234.56" → "1234.56").
    if (/,\d{3}(\D|$)/.test(s) && /\.\d+/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      // No clear thousands grouping: leave dots as decimals, treat a lone
      // comma as decimal (e.g. "365,34" still becomes 365.34 even in dot mode)
      if (s.indexOf('.') === -1 && s.indexOf(',') !== -1) {
        s = s.replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    }
  }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function toDate(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const utc = new Date(Math.round((v - 25569) * 86400 * 1000));
    return utc.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? '20' + y : y;
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}

function groupKey(row) {
  if (row.numero) return `num:${row.numero}`;
  return `auto:${row.cliente_ragione_sociale || ''}|${row.data || ''}`;
}

function rowsToInvoices(rows, opts = {}) {
  const fmt = opts.numberFormat === 'comma' ? 'comma' : 'dot';
  const num = (v) => toNumber(v, fmt);
  const groups = new Map();
  rows.forEach((r) => {
    if (!r.descrizione && !r.cliente_ragione_sociale) return;
    const key = groupKey(r);
    if (!groups.has(key)) {
      groups.set(key, {
        numero: r.numero || '',
        data: toDate(r.data) || new Date().toISOString().slice(0, 10),
        scadenza: toDate(r.scadenza) || '',
        metodoPagamento: r.metodo_pagamento || 'Bonifico bancario',
        note: r.note || '',
        origine: 'import',
        cliente: {
          ragioneSociale: r.cliente_ragione_sociale || '',
          indirizzo: r.cliente_indirizzo || '',
          cap: r.cliente_cap || '',
          citta: r.cliente_citta || '',
          provincia: r.cliente_provincia || '',
          paese: r.cliente_paese || 'Italia',
          partitaIva: r.cliente_piva || '',
          codiceFiscale: r.cliente_cf || '',
          email: r.cliente_email || '',
          telefono: r.cliente_telefono || '',
        },
        righe: [],
      });
    }
    if (r.descrizione) {
      groups.get(key).righe.push({
        descrizione: r.descrizione,
        codice: r.codice || '',
        unitaMisura: r.unita_misura || 'pz',
        quantita: num(r.quantita) || 1,
        prezzoUnitario: num(r.prezzo_unitario),
        aliquotaIva:
          r.aliquota_iva === '' || r.aliquota_iva == null ? 22 : num(r.aliquota_iva),
        scontoPct: num(r.sconto_pct),
      });
    }
  });
  return Array.from(groups.values());
}

function parseHeaders(filePath, originalName) {
  const rows = parseFile(filePath, originalName);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('File vuoto o formato non riconosciuto');
  }
  const headers = getHeaders(rows);
  return {
    headers,
    suggestedMapping: suggestMapping(headers),
    fields: INVOICE_FIELDS,
    sampleRows: rows.slice(0, 3),
  };
}

function importFromFile(filePath, originalName, mapping, opts = {}) {
  const rows = parseFile(filePath, originalName);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('File vuoto o formato non riconosciuto');
  }
  const headers = getHeaders(rows);
  const finalMapping =
    mapping && Object.keys(mapping).length ? mapping : suggestMapping(headers);
  const mapped = applyMapping(rows, finalMapping);
  return rowsToInvoices(mapped, opts);
}

module.exports = {
  importFromFile,
  parseHeaders,
  rowsToInvoices,
  applyMapping,
  suggestMapping,
  INVOICE_FIELDS,
};
