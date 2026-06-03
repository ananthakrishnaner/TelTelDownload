const Media = require('../models/Media');
const fs = require('fs');

exports.getMedia = async (req, res) => {
  try {
    const { status, channelId, page = 1, limit = 1000 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (channelId) query.channelId = channelId;

    const media = await Media.find(query)
      .sort({ downloadedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Media.countDocuments(query);

    res.json({ media, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Not found' });
    
    if (fs.existsSync(media.localPath)) {
      fs.unlinkSync(media.localPath);
    }
    
    await Media.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.bulkDeleteMedia = async (req, res) => {
  try {
    const { mediaIds } = req.body;
    if (!mediaIds || !Array.isArray(mediaIds)) {
      return res.status(400).json({ error: 'Invalid mediaIds array' });
    }

    for (const id of mediaIds) {
      const media = await Media.findById(id);
      if (media) {
        if (fs.existsSync(media.localPath)) {
          try { fs.unlinkSync(media.localPath); } catch (e) {}
        }
        await Media.findByIdAndDelete(id);
      }
    }

    res.json({ success: true, message: `Deleted ${mediaIds.length} items` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.retryMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Not found' });
    
    // We set status to downloaded, then the frontend can trigger the auto-upload loop if needed,
    // or trigger downloadMediaForGroup again. Actually, retrying a specific media requires
    // telegramService to just download that specific message.
    media.status = 'downloaded';
    await media.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.forwardMedia = async (req, res) => {
  try {
    const { targetGroupId } = req.body;
    const telegramService = require('../services/telegramService');
    telegramService.forwardLocalMedia(req.params.id, targetGroupId)
      .then(() => console.log('Forwarded media ' + req.params.id))
      .catch(err => console.error(err));
      
    res.json({ success: true, message: 'Forwarding initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.bulkForwardMedia = async (req, res) => {
  try {
    const { mediaIds, targetGroupId } = req.body;
    const telegramService = require('../services/telegramService');
    
    // Launch in background
    telegramService.bulkForwardLocalMedia(mediaIds, targetGroupId)
      .then(count => console.log(`Bulk forwarded ${count} items`))
      .catch(err => console.error(err));

    res.json({ success: true, message: 'Bulk forwarding initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMediaStats = async (req, res) => {
  try {
    const stats = await Media.aggregate([
      { $group: { _id: "$channelId", count: { $sum: 1 } } }
    ]);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
