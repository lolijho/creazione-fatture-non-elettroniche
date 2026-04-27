'use strict';

const nodemailer = require('nodemailer');

let cachedTransporter = null;
let cachedConfigKey = null;

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    port === 465;

  if (!host) {
    throw new Error(
      'SMTP non configurato: imposta SMTP_HOST (e SMTP_USER/SMTP_PASS se richiesti dal provider).'
    );
  }

  const configKey = `${host}|${port}|${secure}|${user || ''}`;
  if (cachedTransporter && cachedConfigKey === configKey) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  cachedConfigKey = configKey;
  return cachedTransporter;
}

function formatEUR(n) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(
    Number(n) || 0
  );
}

function formatDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('it-IT');
}

function applyTemplate(tpl, vars) {
  if (!tpl) return '';
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] == null ? '' : String(vars[k])
  );
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendInvoiceEmail({ invoice, settings, pdfBuffer, to }) {
  const recipient = to || invoice.cliente?.email;
  if (!recipient) {
    const err = new Error('Email cliente non specificata');
    err.status = 400;
    throw err;
  }

  const transporter = buildTransporter();

  const fromEnv = process.env.SMTP_FROM;
  const replyToEnv = process.env.SMTP_REPLY_TO;
  const aziendaEmail = settings.azienda?.email;
  const aziendaName = settings.azienda?.ragioneSociale || 'Fatturazione';

  const from = fromEnv || (aziendaEmail ? `${aziendaName} <${aziendaEmail}>` : null);
  if (!from) {
    const err = new Error(
      'Mittente email non configurato: imposta SMTP_FROM o l\'email aziendale nelle impostazioni.'
    );
    err.status = 500;
    throw err;
  }

  const vars = {
    numero: invoice.numero || '',
    data: formatDate(invoice.data),
    cliente: invoice.cliente?.ragioneSociale || '',
    azienda: aziendaName,
    totale: formatEUR(invoice.totali?.totale),
    scadenza: formatDate(invoice.scadenza),
  };

  const subject =
    applyTemplate(settings.email?.oggettoTemplate, vars) ||
    `Invoice ${vars.numero} - ${vars.azienda}`;
  const text =
    applyTemplate(settings.email?.corpoTemplate, vars) ||
    `Please find attached invoice ${vars.numero} dated ${vars.data}.`;
  const html = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;

  const safeName = (invoice.numero || invoice.id).replace(/[^a-z0-9-_]+/gi, '_');

  const info = await transporter.sendMail({
    from,
    to: recipient,
    replyTo: replyToEnv || aziendaEmail || undefined,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `fattura-${safeName}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return { messageId: info.messageId, to: recipient };
}

async function verifyConnection() {
  const transporter = buildTransporter();
  await transporter.verify();
  return { ok: true };
}

module.exports = { sendInvoiceEmail, verifyConnection };
