'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { generatePDF } = require('./pdf');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const PDF_DIR = path.join(DATA_DIR, 'invoices');

function ensureDir() {
  if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
}

function pathFor(invoiceId) {
  ensureDir();
  return path.join(PDF_DIR, `${invoiceId}.pdf`);
}

async function buildAndStore(invoice, settings) {
  ensureDir();
  const buffer = await generatePDF(invoice, settings);
  const filePath = pathFor(invoice.id);
  await fsp.writeFile(filePath, buffer);
  return { buffer, filePath };
}

async function getOrBuild(invoice, settings) {
  const filePath = pathFor(invoice.id);
  try {
    const buffer = await fsp.readFile(filePath);
    return { buffer, filePath, fromCache: true };
  } catch (_) {
    const built = await buildAndStore(invoice, settings);
    return { ...built, fromCache: false };
  }
}

async function remove(invoiceId) {
  const filePath = pathFor(invoiceId);
  try {
    await fsp.unlink(filePath);
  } catch (_) {
    /* file may not exist */
  }
}

function safeFileName(invoice) {
  const base = (invoice.numero || invoice.id).replace(/[^a-z0-9-_]+/gi, '_');
  return `fattura-${base}.pdf`;
}

module.exports = { pathFor, buildAndStore, getOrBuild, remove, safeFileName, PDF_DIR };
