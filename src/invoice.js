'use strict';

const { nanoid } = require('nanoid');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizeRiga(r) {
  const quantita = Number(r.quantita) || 0;
  const prezzoUnitario = Number(r.prezzoUnitario) || 0;
  const aliquotaIva = r.aliquotaIva == null ? 22 : Number(r.aliquotaIva);
  const scontoPct = Number(r.scontoPct) || 0;

  const imponibileLordo = quantita * prezzoUnitario;
  const sconto = round2(imponibileLordo * (scontoPct / 100));
  const imponibile = round2(imponibileLordo - sconto);
  const iva = round2(imponibile * (aliquotaIva / 100));
  const totale = round2(imponibile + iva);

  return {
    descrizione: String(r.descrizione || '').trim(),
    codice: r.codice ? String(r.codice).trim() : '',
    unitaMisura: r.unitaMisura ? String(r.unitaMisura).trim() : 'pz',
    quantita,
    prezzoUnitario: round2(prezzoUnitario),
    aliquotaIva,
    scontoPct,
    sconto,
    imponibile,
    iva,
    totale,
  };
}

function computeTotals(righe) {
  const totals = righe.reduce(
    (acc, r) => {
      acc.imponibile = round2(acc.imponibile + r.imponibile);
      acc.iva = round2(acc.iva + r.iva);
      acc.totale = round2(acc.totale + r.totale);
      const key = String(r.aliquotaIva);
      acc.ripartizioneIva[key] = acc.ripartizioneIva[key] || { imponibile: 0, iva: 0 };
      acc.ripartizioneIva[key].imponibile = round2(
        acc.ripartizioneIva[key].imponibile + r.imponibile
      );
      acc.ripartizioneIva[key].iva = round2(acc.ripartizioneIva[key].iva + r.iva);
      return acc;
    },
    { imponibile: 0, iva: 0, totale: 0, ripartizioneIva: {} }
  );
  return totals;
}

function buildInvoice(input, { numero } = {}) {
  const righe = (input.righe || []).map(normalizeRiga).filter((r) => r.descrizione);
  const totali = computeTotals(righe);

  return {
    id: input.id || nanoid(10),
    numero: input.numero || numero,
    data: input.data || new Date().toISOString().slice(0, 10),
    scadenza: input.scadenza || '',
    metodoPagamento: input.metodoPagamento || 'Bonifico bancario',
    note: input.note || '',
    origine: input.origine || 'manuale', // manuale | csv | excel | woocommerce
    riferimentoEsterno: input.riferimentoEsterno || '',
    cliente: {
      ragioneSociale: input.cliente?.ragioneSociale || '',
      indirizzo: input.cliente?.indirizzo || '',
      cap: input.cliente?.cap || '',
      citta: input.cliente?.citta || '',
      provincia: input.cliente?.provincia || '',
      paese: input.cliente?.paese || 'Italia',
      partitaIva: input.cliente?.partitaIva || '',
      codiceFiscale: input.cliente?.codiceFiscale || '',
      email: input.cliente?.email || '',
      telefono: input.cliente?.telefono || '',
    },
    righe,
    totali,
    creataIl: input.creataIl || new Date().toISOString(),
    aggiornataIl: new Date().toISOString(),
  };
}

module.exports = {
  buildInvoice,
  normalizeRiga,
  computeTotals,
  round2,
};
