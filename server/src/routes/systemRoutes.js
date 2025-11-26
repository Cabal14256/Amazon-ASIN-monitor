const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

router.get('/system/alert', systemController.getAlert);

module.exports = router;
