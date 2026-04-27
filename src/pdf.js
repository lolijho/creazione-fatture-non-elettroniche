'use strict';

const PDFDocument = require('pdfkit');

const EUR = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

const DATE = (d) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-GB');
};

function line(doc, y, color = '#cccccc') {
  doc
    .strokeColor(color)
    .lineWidth(0.5)
    .moveTo(40, y)
    .lineTo(555, y)
    .stroke();
}

function renderHeader(doc, settings) {
  const az = settings.azienda || {};
  doc
    .fillColor('#111')
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(az.ragioneSociale || 'Your company', 40, 45);

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#444')
    .text(
      [
        az.indirizzo,
        [az.cap, az.citta, az.provincia].filter(Boolean).join(' '),
        az.paese,
      ]
        .filter(Boolean)
        .join('\n'),
      40,
      70
    );

  const right = [];
  if (az.partitaIva) right.push(`VAT no.: ${az.partitaIva}`);
  if (az.codiceFiscale) right.push(`Tax ID: ${az.codiceFiscale}`);
  if (az.telefono) right.push(`Tel: ${az.telefono}`);
  if (az.email) right.push(`Email: ${az.email}`);
  if (az.sitoWeb) right.push(az.sitoWeb);

  doc
    .fontSize(9)
    .fillColor('#444')
    .text(right.join('\n'), 350, 45, { width: 205, align: 'right' });
}

function renderInvoiceMeta(doc, invoice) {
  const y = 130;
  doc
    .fillColor('#111')
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('INVOICE', 40, y);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111')
    .text(`Invoice no.: ${invoice.numero || '-'}`, 350, y, { width: 205, align: 'right' })
    .text(`Date: ${DATE(invoice.data)}`, 350, y + 16, { width: 205, align: 'right' });

  if (invoice.scadenza) {
    doc.text(`Due date: ${DATE(invoice.scadenza)}`, 350, y + 32, {
      width: 205,
      align: 'right',
    });
  }
}

function renderClient(doc, invoice) {
  const y = 185;
  const c = invoice.cliente || {};
  doc
    .fillColor('#111')
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('Bill to', 40, y);

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(c.ragioneSociale || '-', 40, y + 14)
    .fontSize(9)
    .fillColor('#444')
    .text(
      [
        c.indirizzo,
        [c.cap, c.citta, c.provincia].filter(Boolean).join(' '),
        c.paese,
        c.partitaIva ? `VAT no.: ${c.partitaIva}` : '',
        c.codiceFiscale ? `Tax ID: ${c.codiceFiscale}` : '',
        c.email,
        c.telefono,
      ]
        .filter(Boolean)
        .join('\n'),
      40,
      y + 28
    );
}

function renderTable(doc, invoice, settings) {
  const senzaIva = !!settings?.fatturazione?.senzaIva;
  const startY = 300;
  const cols = senzaIva
    ? [
        { key: 'desc', label: 'Description', x: 40, width: 290, align: 'left' },
        { key: 'qta', label: 'Qty', x: 335, width: 35, align: 'right' },
        { key: 'prezzo', label: 'Price', x: 375, width: 60, align: 'right' },
        { key: 'sconto', label: 'Discount', x: 440, width: 40, align: 'right' },
        { key: 'totale', label: 'Total', x: 485, width: 70, align: 'right' },
      ]
    : [
        { key: 'desc', label: 'Description', x: 40, width: 230, align: 'left' },
        { key: 'qta', label: 'Qty', x: 275, width: 35, align: 'right' },
        { key: 'prezzo', label: 'Price', x: 315, width: 55, align: 'right' },
        { key: 'sconto', label: 'Discount', x: 375, width: 40, align: 'right' },
        { key: 'iva', label: 'VAT %', x: 420, width: 35, align: 'right' },
        { key: 'imponibile', label: 'Net', x: 460, width: 60, align: 'right' },
        { key: 'totale', label: 'Total', x: 520, width: 40, align: 'right' },
      ];

  doc.rect(40, startY - 4, 515, 18).fill('#f0f0f0');
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(9);
  cols.forEach((c) =>
    doc.text(c.label, c.x, startY, { width: c.width, align: c.align })
  );

  let y = startY + 20;
  doc.font('Helvetica').fontSize(9).fillColor('#111');

  const colByKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  const draw = (key, value) => {
    const c = colByKey[key];
    if (!c) return;
    doc.text(value, c.x, y, { width: c.width, align: c.align });
  };

  (invoice.righe || []).forEach((r) => {
    if (y > 720) {
      doc.addPage();
      y = 60;
    }
    const desc = r.codice ? `[${r.codice}] ${r.descrizione}` : r.descrizione;
    const heights = doc.heightOfString(desc, { width: colByKey.desc.width });
    draw('desc', desc);
    draw('qta', String(r.quantita));
    draw('prezzo', EUR(r.prezzoUnitario));
    draw('sconto', r.scontoPct ? `${r.scontoPct}%` : '-');
    draw('iva', String(r.aliquotaIva));
    draw('imponibile', EUR(r.imponibile));
    draw('totale', EUR(r.totale));
    y += Math.max(heights, 12) + 6;
    line(doc, y - 2, '#eeeeee');
  });

  return y + 10;
}

function renderTotals(doc, invoice, settings, startY) {
  let y = Math.max(startY, 560);
  if (y > 680) {
    doc.addPage();
    y = 60;
  }
  const senzaIva = !!settings?.fatturazione?.senzaIva;
  const t = invoice.totali || {};
  const boxX = 340;
  doc.font('Helvetica').fontSize(10).fillColor('#111');

  if (!senzaIva) {
    doc.text('Subtotal:', boxX, y, { width: 120, align: 'right' });
    doc.text(EUR(t.imponibile), boxX + 125, y, { width: 90, align: 'right' });
    y += 16;

    Object.entries(t.ripartizioneIva || {}).forEach(([aliq, val]) => {
      doc.text(`VAT ${aliq}%:`, boxX, y, { width: 120, align: 'right' });
      doc.text(EUR(val.iva), boxX + 125, y, { width: 90, align: 'right' });
      y += 14;
    });

    doc
      .moveTo(boxX, y + 2)
      .lineTo(boxX + 215, y + 2)
      .strokeColor('#aaaaaa')
      .stroke();
    y += 8;
  }

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('TOTAL', boxX, y, { width: 120, align: 'right' });
  doc.text(EUR(t.totale), boxX + 125, y, { width: 90, align: 'right' });

  return y + 30;
}

function renderFooter(doc, invoice, settings, startY) {
  let y = startY;
  doc.font('Helvetica').fontSize(9).fillColor('#333');

  if (invoice.metodoPagamento) {
    doc.text(`Payment method: ${invoice.metodoPagamento}`, 40, y);
    y += 14;
  }
  if (settings.azienda?.iban) {
    doc.text(`IBAN: ${settings.azienda.iban}`, 40, y);
    y += 14;
  }
  if (settings.fatturazione?.senzaIva && settings.fatturazione?.notaSenzaIva) {
    y += 4;
    doc
      .font('Helvetica-Oblique')
      .fillColor('#444')
      .text(settings.fatturazione.notaSenzaIva, 40, y, { width: 515 });
    y += doc.heightOfString(settings.fatturazione.notaSenzaIva, { width: 515 }) + 6;
    doc.font('Helvetica').fillColor('#333');
  }
  if (invoice.note) {
    y += 6;
    doc.font('Helvetica-Bold').text('Notes:', 40, y);
    y += 12;
    doc.font('Helvetica').text(invoice.note, 40, y, { width: 515 });
    y += doc.heightOfString(invoice.note, { width: 515 }) + 8;
  }

  const disclaimer =
    settings.fatturazione?.dichiarazioneNonElettronica ||
    'This document is a paper invoice and is not an electronic invoice for the Italian SdI system.';
  const discY = 770;
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#777')
    .text(disclaimer, 40, discY, { width: 515, align: 'center' });
}

function generatePDF(invoice, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderHeader(doc, settings);
      line(doc, 115);
      renderInvoiceMeta(doc, invoice);
      renderClient(doc, invoice);
      const afterTable = renderTable(doc, invoice, settings);
      const afterTotals = renderTotals(doc, invoice, settings, afterTable);
      renderFooter(doc, invoice, settings, afterTotals);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePDF };
