'use strict';

const express = require('express');
const auth = require('../auth');

const router = express.Router();

router.post('/login', (req, res, next) => auth.login(req, res).catch(next));
router.post('/logout', auth.logout);
router.get('/me', auth.me);

module.exports = router;
