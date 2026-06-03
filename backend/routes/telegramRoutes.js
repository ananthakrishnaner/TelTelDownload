const express = require('express');
const router = express.Router();
const telegramController = require('../controllers/telegramController');

router.post('/credentials', telegramController.saveApiCredentials);
router.post('/send-code', telegramController.sendCode);
router.post('/sign-in', telegramController.signIn);
router.get('/groups', telegramController.getGroups);
router.post('/download', telegramController.triggerDownload);

module.exports = router;
