const ActivityLog = require('../models/ActivityLog');
const Setting = require('../models/Setting');

exports.getLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ timestamp: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const settings = await Setting.find({ key: { $in: ['apiId', 'apiHash'] } });
    const config = {};
    settings.forEach(s => config[s.key] = s.value);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { apiId, apiHash } = req.body;
    if (apiId) await Setting.findOneAndUpdate({ key: 'apiId' }, { value: apiId }, { upsert: true });
    if (apiHash) await Setting.findOneAndUpdate({ key: 'apiHash' }, { value: apiHash }, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
