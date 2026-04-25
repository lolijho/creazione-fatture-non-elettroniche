'use strict';

const express = require('express');
const storage = require('../storage');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await storage.getSettings());
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const saved = await storage.saveSettings(req.body || {});
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
