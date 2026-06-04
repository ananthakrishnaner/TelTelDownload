const express = require('express');
const router = express.Router();
const telegramController = require('../controllers/telegramController');

router.post('/credentials', telegramController.saveApiCredentials);
router.post('/send-code', telegramController.sendCode);
router.post('/sign-in', telegramController.signIn);
router.get('/groups', telegramController.getGroups);
router.get('/group-media/:id', telegramController.getGroupMedia);
router.get('/active-jobs', telegramController.getActiveJobs);
router.get('/job-history', telegramController.getJobHistory);
router.post('/stop-job/:id', telegramController.stopJob);
router.post('/download', telegramController.triggerDownload);
router.post('/download-specific', telegramController.downloadSpecific);

// Session state + manual reconnect.
router.get('/session', telegramController.getSession);
router.post('/session/reconnect', telegramController.reconnectNow);

module.exports = router;
