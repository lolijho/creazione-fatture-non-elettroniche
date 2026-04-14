'use strict';

const express = require('express');
const storage = require('../storage');
const { buildInvoice } = require('../invoice');
const wc = require('../woocommerce');

const router = express.Router();

router.get('/test', async (req, res, next) => {
  try {
    const settings = storage.getSettings();
    const result = await wc.testConnection(settings);
    res.json(result);
  } catch (err) {
    next(describeWcError(err));
  }
});

router.get('/orders', async (req, res, next) => {
  try {
    const settings = storage.getSettings();
    const result = await wc.fetchOrders(settings, {
      page: Number(req.query.page) || 1,
      perPage: Number(req.query.per_page) || 20,
      status: req.query.status || 'any',
      search: req.query.search || '',
    });
    res.json(result);
  } catch (err) {
    next(describeWcError(err));
  }
});

router.post('/orders/:id/import', async (req, res, next) => {
  try {
    const settings = storage.getSettings();
    const order = await wc.fetchOrder(settings, req.params.id);
    const input = wc.orderToInvoiceInput(order);
    const numero = storage.nextInvoiceNumber();
    const inv = buildInvoice({ ...input, numero });
    storage.upsertInvoice(inv);
    storage.bumpInvoiceCounter();
    res.status(201).json(inv);
  } catch (err) {
    next(describeWcError(err));
  }
});

function describeWcError(err) {
  if (err.response) {
    const e = new Error(
      `WooCommerce ${err.response.status}: ${
        err.response.data?.message || err.response.statusText
      }`
    );
    e.status = err.response.status;
    return e;
  }
  return err;
}

module.exports = router;
