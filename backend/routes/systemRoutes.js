const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

router.get('/logs', systemController.getLogs);
router.get('/settings', systemController.getSettings);
router.put('/settings', systemController.updateSettings);

module.exports = router;
