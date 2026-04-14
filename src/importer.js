'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

/**
 * Colonne attese (case-insensitive, spazi/accenti normalizzati):
 *   - numero (opzionale): se assente viene generato
 *   - data
 *   - scadenza (opzionale)
 *   - metodo_pagamento (opzionale)
 *   - note (opzionale)
 *   - cliente_ragione_sociale
 *   - cliente_indirizzo, cliente_cap, cliente_citta, cliente_provincia, cliente_paese
 *   - cliente_piva, cliente_cf, cliente_email, cliente_telefono
 *   - descrizione
 *   - codice (opzionale)
 *   - unita_misura (opzionale)
 *   - quantita
 *   - prezzo_unitario
 *   - aliquota_iva
 *   - sconto_pct (opzionale)
 *
 * Più righe con lo stesso "numero" (o stesso cliente+data se numero vuoto)
 * vengono raggruppate in un'unica fattura con più righe.
 */

function normalizeKey(k) {
  return String(k || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRow(row) {
  const out = {};
  Object.keys(row).forEach((k) => {
    out[normalizeKey(k)] = typeof row[k] === 'string' ? row[k].trim() : row[k];
  });
  return out;
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

function toNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v)
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function toDate(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date
    const utc = new Date(Math.round((v - 25569) * 86400 * 1000));
    return utc.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // try ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // try dd/mm/yyyy or dd-mm-yyyy
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

function rowsToInvoices(rows) {
  const groups = new Map();
  rows.map(normalizeRow).forEach((r) => {
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
          partitaIva: r.cliente_piva || r.cliente_partita_iva || '',
          codiceFiscale: r.cliente_cf || r.cliente_codice_fiscale || '',
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
        quantita: toNumber(r.quantita) || 1,
        prezzoUnitario: toNumber(r.prezzo_unitario),
        aliquotaIva: r.aliquota_iva === '' || r.aliquota_iva == null ? 22 : toNumber(r.aliquota_iva),
        scontoPct: toNumber(r.sconto_pct),
      });
    }
  });
  return Array.from(groups.values());
}

function importFromFile(filePath, originalName) {
  const rows = parseFile(filePath, originalName);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('File vuoto o formato non riconosciuto');
  }
  return rowsToInvoices(rows);
}

module.exports = { importFromFile, rowsToInvoices };
