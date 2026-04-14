'use strict';

const express = require('express');
const storage = require('../storage');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(storage.getSettings());
});

router.put('/', (req, res, next) => {
  try {
    const saved = storage.saveSettings(req.body || {});
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
