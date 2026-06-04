const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');

router.get('/', mediaController.getMedia);
router.get('/stats', mediaController.getMediaStats);
router.get('/channels', mediaController.getMediaChannels);
router.delete('/:id', mediaController.deleteMedia);
router.post('/bulk-delete', mediaController.bulkDeleteMedia);
router.post('/wipe-all', mediaController.wipeAllMedia);
router.post('/bulk-forward', mediaController.bulkForwardMedia);
router.post('/bulk-retry', mediaController.bulkRetryMedia);
router.post('/:id/retry', mediaController.retryMedia);
router.post('/:id/forward', mediaController.forwardMedia);

module.exports = router;
