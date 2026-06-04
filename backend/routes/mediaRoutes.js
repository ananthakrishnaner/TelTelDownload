const express = require('express');
const multer = require('multer');
const router = express.Router();
const mediaController = require('../controllers/mediaController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ---- Read ---------------------------------------------------------------
router.get('/', mediaController.getMedia);
router.get('/from-disk', mediaController.getMediaFromDisk);
router.get('/stats', mediaController.getMediaStats);
router.get('/channels', mediaController.getMediaChannels);

// ---- Lookup / search (image-based reverse search, see plan) -----------
router.post('/lookup', upload.single('image'), mediaController.searchByImage);
router.post('/reindex', express.json(), mediaController.reindexMedia);
router.get('/lookup/thumb/:mediaId/:idx', mediaController.getLookupThumb);

// ---- Write --------------------------------------------------------------
router.delete('/:id', mediaController.deleteMedia);
router.post('/bulk-delete', mediaController.bulkDeleteMedia);
router.post('/wipe-all', mediaController.wipeAllMedia);
router.post('/bulk-forward', mediaController.bulkForwardMedia);
router.post('/bulk-retry', mediaController.bulkRetryMedia);
router.post('/:id/retry', mediaController.retryMedia);
router.post('/:id/forward', mediaController.forwardMedia);

module.exports = router;
