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
    res.json({ groups });
  } catch (err) {
    console.error('[telegram/groups] failed:', err);
    res.status(500).json({ error: err.message, code: err.code || 'TELEGRAM_ERROR' });
  }
};

exports.getGroupMedia = async (req, res) => {
  try {
    const mediaList = await telegramService.getRecentMedia(req.params.id);
    res.json({ media: mediaList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.downloadSpecific = async (req, res) => {
  try {
    const { groupId, messageIds, targetGroupId } = req.body;
    // Launch in background
    telegramService.downloadSpecificMedia(groupId, messageIds, targetGroupId)
      .then(count => console.log(`Downloaded ${count} specific items`))
      .catch(err => console.error(err));
    res.json({ success: true, message: 'Selective download triggered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getActiveJobs = (req, res) => {
  try {
    const jobs = telegramService.getActiveJobs();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getJobHistory = async (req, res) => {
  try {
    const JobHistory = require('../models/JobHistory');
    const history = await JobHistory.find().sort({ startedAt: -1 }).limit(50);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.stopJob = (req, res) => {
  try {
    const success = telegramService.stopJob(req.params.id);
    if (success) res.json({ success: true, message: 'Job stopped' });
    else res.status(404).json({ error: 'Job not found or already completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.stopAllJobs = (req, res) => {
  try {
    const stopped = telegramService.stopAllJobs();
    res.json({
      success: true,
      message: `Killed ${stopped.length} job(s)`,
      jobIds: stopped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.triggerDownload = async (req, res) => {
  try {
    const { groupId, targetGroupId, taskId } = req.body;
    // We run it asynchronously so it doesn't block the request
    telegramService.downloadMediaForGroup(groupId, targetGroupId, { taskId }).then(count => {
      console.log(`Finished manual download for ${groupId}. Downloaded: ${count}`);
    }).catch(console.error);

    res.json({ success: true, message: 'Download started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Sync the Media Vault: iterate every joined group/chat and run a
 * group_pull job against it. Returns immediately with the list of
 * started jobIds so the UI can show them in ActiveJobs.
 *
 * Body: { excludeGroupIds?: string[], targetGroupId?: string, taskId?: string }
 */
exports.syncAllMedia = async (req, res) => {
  try {
    const { excludeGroupIds = [], targetGroupId = null, taskId = null } = req.body || {};
    const groups = await telegramService.getGroups();
    // Channel-style groups only (filter out private chats / bots).
    const channelish = groups.filter((g) => {
      const isGroup = g?.isGroup || g?.isChannel;
      const id = String(g?.id?.toString?.() ?? g?.id ?? '');
      if (!id) return false;
      if (excludeGroupIds.includes(id)) return false;
      return isGroup || g?.isChannel;
    });
    const jobIds = [];
    for (const g of channelish) {
      const groupId = String(g.id);
      // Pre-allocate a jobId so we can return it before the download
      // loop completes. downloadMediaForGroup accepts a providedJobId
      // and will use the same key in progressEmitter.
      const jobId = require('uuid').v4();
      telegramService.downloadMediaForGroup(
        groupId, targetGroupId, { taskId, jobId },
      ).then((count) => {
        console.log(`syncAllMedia[${jobId}]: finished ${groupId} (${count} new files)`);
      }).catch((err) => {
        // Don't let one bad channel kill the whole sync.
        console.error(`syncAllMedia[${jobId}]: failed ${groupId}:`, err.message);
      });
      jobIds.push(jobId);
    }
    res.json({
      success: true,
      message: `Sync started for ${jobIds.length} channel(s) of ${channelish.length} total`,
      jobIds,
      total: channelish.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSession = (req, res) => {
  try {
    const state = telegramService.getSessionState();
    res.json({ session: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reconnectNow = async (req, res) => {
  try {
    const result = await telegramService.reconnectNow();
    if (!result.ok && result.reason === 'revoked') {
      return res.status(409).json({
        ok: false,
        reason: 'revoked',
        error: 'Session is revoked. Re-authenticate via Settings.',
        code: 'SESSION_EXPIRED',
      });
    }
    res.json({ ok: true, session: telegramService.getSessionState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
