const telegramService = require('../services/telegramService');
const Setting = require('../models/Setting');

exports.saveApiCredentials = async (req, res) => {
  try {
    const { apiId, apiHash } = req.body;
    await Setting.findOneAndUpdate({ key: 'apiId' }, { value: apiId }, { upsert: true });
    await Setting.findOneAndUpdate({ key: 'apiHash' }, { value: apiHash }, { upsert: true });
    res.json({ success: true, message: 'API Credentials saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.sendCode = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const phoneCodeHash = await telegramService.sendCode(phoneNumber);
    res.json({ success: true, phoneCodeHash });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.signIn = async (req, res) => {
  try {
    const { phoneNumber, phoneCodeHash, code, password } = req.body;
    await telegramService.signIn(phoneNumber, phoneCodeHash, code, password);
    res.json({ success: true, message: 'Successfully logged in' });
  } catch (error) {
    if (error.message === '2FA_REQUIRED') {
      return res.status(403).json({ error: '2FA_REQUIRED' });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.getGroups = async (req, res) => {
  try {
    const groups = await telegramService.getGroups();
    res.json({ success: true, groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.triggerDownload = async (req, res) => {
  try {
    const { groupId } = req.body;
    // We run it asynchronously so it doesn't block the request
    telegramService.downloadMediaForGroup(groupId).then(count => {
      console.log(`Finished manual download for ${groupId}. Downloaded: ${count}`);
    }).catch(console.error);
    
    res.json({ success: true, message: 'Download started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
