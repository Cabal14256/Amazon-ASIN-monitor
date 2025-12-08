const express = require('express');
const router = express.Router();
const { addAsin, getAsins } = require('../controllers/asinController');

router.post('/asins', addAsin);
router.get('/asins', getAsins);

module.exports = router;


