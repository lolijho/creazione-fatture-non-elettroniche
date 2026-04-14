'use strict';

const PDFDocument = require('pdfkit');

const EUR = (n) =>
  new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

const DATE = (d) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('it-IT');
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
    .text(az.ragioneSociale || 'La tua azienda', 40, 45);

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
  if (az.partitaIva) right.push(`P.IVA: ${az.partitaIva}`);
  if (az.codiceFiscale) right.push(`C.F.: ${az.codiceFiscale}`);
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
    .text('FATTURA', 40, y);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111')
    .text(`Numero: ${invoice.numero || '-'}`, 350, y, { width: 205, align: 'right' })
    .text(`Data: ${DATE(invoice.data)}`, 350, y + 16, { width: 205, align: 'right' });

  if (invoice.scadenza) {
    doc.text(`Scadenza: ${DATE(invoice.scadenza)}`, 350, y + 32, {
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
    .text('Cliente', 40, y);

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
        c.partitaIva ? `P.IVA: ${c.partitaIva}` : '',
        c.codiceFiscale ? `C.F.: ${c.codiceFiscale}` : '',
        c.email,
        c.telefono,
      ]
        .filter(Boolean)
        .join('\n'),
      40,
      y + 28
    );
}

function renderTable(doc, invoice) {
  const startY = 300;
  const cols = [
    { label: 'Descrizione', x: 40, width: 230, align: 'left' },
    { label: 'Q.tà', x: 275, width: 35, align: 'right' },
    { label: 'Prezzo', x: 315, width: 55, align: 'right' },
    { label: 'Sconto', x: 375, width: 40, align: 'right' },
    { label: 'IVA %', x: 420, width: 35, align: 'right' },
    { label: 'Imponibile', x: 460, width: 60, align: 'right' },
    { label: 'Totale', x: 520, width: 40, align: 'right' },
  ];

  doc.rect(40, startY - 4, 515, 18).fill('#f0f0f0');
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(9);
  cols.forEach((c) =>
    doc.text(c.label, c.x, startY, { width: c.width, align: c.align })
  );

  let y = startY + 20;
  doc.font('Helvetica').fontSize(9).fillColor('#111');

  (invoice.righe || []).forEach((r) => {
    if (y > 720) {
      doc.addPage();
      y = 60;
    }
    const desc = r.codice ? `[${r.codice}] ${r.descrizione}` : r.descrizione;
    const heights = doc.heightOfString(desc, { width: cols[0].width });
    doc.text(desc, cols[0].x, y, { width: cols[0].width });
    doc.text(String(r.quantita), cols[1].x, y, {
      width: cols[1].width,
      align: 'right',
    });
    doc.text(EUR(r.prezzoUnitario), cols[2].x, y, {
      width: cols[2].width,
      align: 'right',
    });
    doc.text(r.scontoPct ? `${r.scontoPct}%` : '-', cols[3].x, y, {
      width: cols[3].width,
      align: 'right',
    });
    doc.text(String(r.aliquotaIva), cols[4].x, y, {
      width: cols[4].width,
      align: 'right',
    });
    doc.text(EUR(r.imponibile), cols[5].x, y, {
      width: cols[5].width,
      align: 'right',
    });
    doc.text(EUR(r.totale), cols[6].x, y, {
      width: cols[6].width,
      align: 'right',
    });
    y += Math.max(heights, 12) + 6;
    line(doc, y - 2, '#eeeeee');
  });

  return y + 10;
}

function renderTotals(doc, invoice, startY) {
  let y = Math.max(startY, 560);
  if (y > 680) {
    doc.addPage();
    y = 60;
  }
  const t = invoice.totali || {};
  const boxX = 340;
  doc.font('Helvetica').fontSize(10).fillColor('#111');
  doc.text('Imponibile:', boxX, y, { width: 120, align: 'right' });
  doc.text(EUR(t.imponibile), boxX + 125, y, { width: 90, align: 'right' });
  y += 16;

  Object.entries(t.ripartizioneIva || {}).forEach(([aliq, val]) => {
    doc.text(`IVA ${aliq}%:`, boxX, y, { width: 120, align: 'right' });
    doc.text(EUR(val.iva), boxX + 125, y, { width: 90, align: 'right' });
    y += 14;
  });

  doc
    .moveTo(boxX, y + 2)
    .lineTo(boxX + 215, y + 2)
    .strokeColor('#aaaaaa')
    .stroke();
  y += 8;

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('TOTALE', boxX, y, { width: 120, align: 'right' });
  doc.text(EUR(t.totale), boxX + 125, y, { width: 90, align: 'right' });

  return y + 30;
}

function renderFooter(doc, invoice, settings, startY) {
  let y = startY;
  doc.font('Helvetica').fontSize(9).fillColor('#333');

  if (invoice.metodoPagamento) {
    doc.text(`Metodo di pagamento: ${invoice.metodoPagamento}`, 40, y);
    y += 14;
  }
  if (settings.azienda?.iban) {
    doc.text(`IBAN: ${settings.azienda.iban}`, 40, y);
    y += 14;
  }
  if (invoice.note) {
    y += 6;
    doc.font('Helvetica-Bold').text('Note:', 40, y);
    y += 12;
    doc.font('Helvetica').text(invoice.note, 40, y, { width: 515 });
    y += doc.heightOfString(invoice.note, { width: 515 }) + 8;
  }

  const disclaimer =
    settings.fatturazione?.dichiarazioneNonElettronica ||
    'Documento cartaceo non avente valore di fattura elettronica ai fini del SdI.';
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
      const afterTable = renderTable(doc, invoice);
      const afterTotals = renderTotals(doc, invoice, afterTable);
      renderFooter(doc, invoice, settings, afterTotals);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePDF };
