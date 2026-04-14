'use strict';

const axios = require('axios');

function buildClient(settings) {
  const wc = settings?.woocommerce || {};
  if (!wc.url || !wc.consumerKey || !wc.consumerSecret) {
    const err = new Error(
      'Credenziali WooCommerce non configurate. Compila URL, Consumer Key e Consumer Secret nelle Impostazioni.'
    );
    err.status = 400;
    throw err;
  }
  const version = wc.version || 'wc/v3';
  const baseURL = `${wc.url.replace(/\/$/, '')}/wp-json/${version}`;
  return axios.create({
    baseURL,
    auth: { username: wc.consumerKey, password: wc.consumerSecret },
    timeout: 20000,
  });
}

async function fetchOrders(settings, { page = 1, perPage = 20, status = 'any', search = '' } = {}) {
  const client = buildClient(settings);
  const params = { page, per_page: perPage, status };
  if (search) params.search = search;
  const res = await client.get('/orders', { params });
  return {
    total: Number(res.headers['x-wp-total'] || 0),
    totalPages: Number(res.headers['x-wp-totalpages'] || 1),
    orders: res.data,
  };
}

async function fetchOrder(settings, id) {
  const client = buildClient(settings);
  const res = await client.get(`/orders/${id}`);
  return res.data;
}

function orderToInvoiceInput(order) {
  const b = order.billing || {};
  const righe = (order.line_items || []).map((item) => {
    const qty = Number(item.quantity) || 1;
    const total = Number(item.total) || 0;
    const subtotal = Number(item.subtotal) || total;
    const totalTax = Number(item.total_tax) || 0;
    const subtotalTax = Number(item.subtotal_tax) || totalTax;
    const unit = qty > 0 ? subtotal / qty : subtotal;
    const rate = subtotal > 0 ? (subtotalTax / subtotal) * 100 : 0;
    const scontoPct = subtotal > 0 ? Math.max(0, ((subtotal - total) / subtotal) * 100) : 0;
    return {
      descrizione: item.name || 'Prodotto',
      codice: item.sku || '',
      unitaMisura: 'pz',
      quantita: qty,
      prezzoUnitario: Number(unit.toFixed(2)),
      aliquotaIva: Math.round(rate * 100) / 100,
      scontoPct: Number(scontoPct.toFixed(2)),
    };
  });

  // Shipping as dedicated line
  (order.shipping_lines || []).forEach((ship) => {
    const total = Number(ship.total) || 0;
    const totalTax = Number(ship.total_tax) || 0;
    const rate = total > 0 ? (totalTax / total) * 100 : 0;
    if (total > 0) {
      righe.push({
        descrizione: `Spedizione${ship.method_title ? ' - ' + ship.method_title : ''}`,
        codice: '',
        unitaMisura: 'pz',
        quantita: 1,
        prezzoUnitario: total,
        aliquotaIva: Math.round(rate * 100) / 100,
        scontoPct: 0,
      });
    }
  });

  // Fees
  (order.fee_lines || []).forEach((fee) => {
    const total = Number(fee.total) || 0;
    const totalTax = Number(fee.total_tax) || 0;
    const rate = total > 0 ? (totalTax / total) * 100 : 0;
    if (total !== 0) {
      righe.push({
        descrizione: fee.name || 'Costo aggiuntivo',
        codice: '',
        unitaMisura: 'pz',
        quantita: 1,
        prezzoUnitario: total,
        aliquotaIva: Math.round(rate * 100) / 100,
        scontoPct: 0,
      });
    }
  });

  return {
    data: (order.date_created || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    metodoPagamento: order.payment_method_title || 'Online',
    note: order.customer_note || '',
    origine: 'woocommerce',
    riferimentoEsterno: `WC#${order.id}`,
    cliente: {
      ragioneSociale:
        b.company ||
        [b.first_name, b.last_name].filter(Boolean).join(' ').trim() ||
        'Cliente',
      indirizzo: [b.address_1, b.address_2].filter(Boolean).join(', '),
      cap: b.postcode || '',
      citta: b.city || '',
      provincia: b.state || '',
      paese: b.country || 'IT',
      partitaIva: '',
      codiceFiscale: '',
      email: b.email || '',
      telefono: b.phone || '',
    },
    righe,
  };
}

async function testConnection(settings) {
  const client = buildClient(settings);
  const res = await client.get('/system_status', { validateStatus: () => true });
  if (res.status >= 400) {
    // system_status needs admin permissions; fall back to /orders HEAD
    const r2 = await client.get('/orders', { params: { per_page: 1 } });
    return { ok: true, orderCount: Number(r2.headers['x-wp-total'] || 0) };
  }
  return { ok: true, environment: res.data?.environment?.site_url };
}

module.exports = {
  fetchOrders,
  fetchOrder,
  orderToInvoiceInput,
  testConnection,
};
