const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');

router.get('/', mediaController.getMedia);
router.get('/stats', mediaController.getMediaStats);
router.delete('/:id', mediaController.deleteMedia);
router.post('/:id/retry', mediaController.retryMedia);
router.post('/:id/forward', mediaController.forwardMedia);

module.exports = router;
