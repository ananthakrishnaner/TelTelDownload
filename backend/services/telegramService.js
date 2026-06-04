// telegramService.js
// Telegram-bound business logic. Owns the `activeJobs` in-memory map and
// the public download / forward / sign-in surface.
//
// The GramJS client and the connection state machine live in
// `sessionManager.js`. This file asks for a client via
// `sessionManager.getClient()` and never holds one itself.

const { Api } = require('telegram');
const Setting = require('../models/Setting');
const Media = require('../models/Media');
const JobHistory = require('../models/JobHistory');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const sessionManager = require('./sessionManager');
const progressEmitter = require('../utils/progressEmitter');
const { retryWithBackoff } = require('../utils/retry');
const logActivity = require('../utils/logger');

const activeJobs = new Map();

// --- Client helpers -----------------------------------------------------

async function requireClient() {
  let client = sessionManager.getClient();
  if (!client) {
    const ok = await sessionManager.connect();
    if (!ok) {
      const s = sessionManager.getState();
      if (s.state === sessionManager.STATES.REVOKED) {
        const e = new Error('Telegram session expired or revoked. Please sign in again in Settings.');
        e.code = 'SESSION_EXPIRED';
        throw e;
      }
      const e = new Error('Telegram client not initialized. Complete API credentials and sign-in in Settings.');
      e.code = 'NOT_SIGNED_IN';
      throw e;
    }
    client = sessionManager.getClient();
  }
  return client;
}

// --- Public surface ----------------------------------------------------

exports.getActiveJobs = () => {
  return Array.from(activeJobs.values()).map((job) => ({
    id: job.id,
    type: job.type,
    groupId: job.groupId,
    taskId: job.taskId,
    status: job.status,
    progress: job.progress,
    total: job.total,
    failed: job.failed || 0,
    skipped: job.skipped || 0,
    rate: job.rate || 0,
    etaMs: job.etaMs,
    startedAt: job.startedAt,
  }));
};

exports.stopJob = (jobId) => {
  const job = activeJobs.get(jobId);
  if (job) {
    job.abortController.abort();
    job.status = 'aborted';
    return true;
  }
  return false;
};

exports.getSessionState = () => sessionManager.getState();

exports.reconnectNow = () => sessionManager.reconnectNow();

// --- Auth flow ---------------------------------------------------------

async function sendCode(phoneNumber) {
  const client = await requireClient();
  const result = await client.sendCode(
    { apiId: client.apiId, apiHash: client.apiHash },
    phoneNumber,
  );
  return result.phoneCodeHash;
}

async function signIn(phoneNumber, phoneCodeHash, phoneCode, password) {
  const client = await requireClient();
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber,
      phoneCodeHash,
      phoneCode,
    }));
  } catch (err) {
    if (err.message && err.message.includes('SESSION_PASSWORD_NEEDED')) {
      if (!password) throw new Error('2FA_REQUIRED');
      await client.invoke(new Api.auth.CheckPassword({
        password: await client.computeAuthPassword(password),
      }));
    } else {
      throw err;
    }
  }
  const sessionString = client.session.save();
  await Setting.findOneAndUpdate(
    { key: 'sessionString' },
    { value: sessionString },
    { upsert: true },
  );
  // Mark session as healthy.
  sessionManager.connect();
  return true;
}

async function getGroups() {
  const client = await requireClient();
  let dialogs;
  try {
    dialogs = await client.getDialogs({});
  } catch (e) {
    if (e.message && (e.message.includes('AUTH_KEY_UNREGISTERED') || e.message.includes('SESSION_REVOKED'))) {
      sessionManager.reportRevoked(e);
      const err = new Error('Telegram session expired or revoked. Please sign in again in Settings.');
      err.code = 'SESSION_EXPIRED';
      throw err;
    }
    sessionManager.reportLost(e);
    throw e;
  }
  return dialogs
    .filter((d) => d.isGroup || d.isChannel)
    .map((d) => ({
      id: d.id.toString(),
      title: d.title,
      isChannel: d.isChannel,
    }));
}

// --- Media operations --------------------------------------------------

function extForMessage(message) {
  if (!message.media) return '.bin';
  if (message.media.photo) return '.jpg';
  if (message.media.document) {
    const attr = message.media.document.attributes.find((a) => a.className === 'DocumentAttributeFilename');
    if (attr) return path.extname(attr.fileName) || '.mp4';
    return '.mp4';
  }
  return '.bin';
}

/**
 * Per-message download + (optional) upload, wrapped with retry/backoff
 * and rich progress reporting. The unit of retry is "download this file
 * from Telegram and (optionally) upload to target".
 */
async function downloadAndMaybeUpload({ client, jobId, groupId, message, targetGroupId, downloadDir, abortSignal, onRetry }) {
  const msgId = message.id;
  const ext = extForMessage(message);
  const fileName = `${groupId}_${msgId}${ext}`;
  const filePath = path.join(downloadDir, fileName);

  let existing = await Media.findOne({ telegramMessageId: msgId, channelId: groupId });

  if (existing && fs.existsSync(existing.localPath) && (!targetGroupId || existing.status === 'uploaded_to_group')) {
    progressEmitter.fileSkipped(jobId, { groupId });
    return { skipped: true };
  }

  try {
    if (!existing || !fs.existsSync(filePath)) {
      progressEmitter.byteProgress({ jobId, groupId, msgId, fileName, type: 'download', current: 0, total: 1 });
      const buffer = await retryWithBackoff(
        () => client.downloadMedia(message, {
          workers: 1,
          progressCallback: (downloaded, total) => {
            progressEmitter.byteProgress({ jobId, groupId, msgId, fileName, type: 'download', current: downloaded, total });
          },
        }),
        { onRetry },
      );
      if (buffer) {
        fs.writeFileSync(filePath, buffer);
        if (!existing) {
          existing = await Media.create({
            telegramMessageId: msgId,
            channelId: groupId,
            localPath: filePath,
            fileName,
            caption: message.message || '',
            status: 'downloaded',
          });
        } else {
          existing.status = 'downloaded';
          await existing.save();
        }
      }
    }

    if (abortSignal && abortSignal.aborted) return { skipped: true };

    if (targetGroupId && existing && fs.existsSync(filePath)) {
      progressEmitter.byteProgress({ jobId, groupId: targetGroupId, msgId, fileName, type: 'upload', current: 0, total: 1 });
      const targetEntity = await retryWithBackoff(() => client.getEntity(targetGroupId), { onRetry });
      await retryWithBackoff(
        () => client.sendFile(targetEntity, {
          file: filePath,
          caption: existing.caption || '',
          progressCallback: (uploaded, total) => {
            progressEmitter.byteProgress({ jobId, groupId: targetGroupId, msgId, fileName, type: 'upload', current: uploaded, total });
          },
        }),
        { onRetry },
      );
      existing.status = 'uploaded_to_group';
      existing.uploadedAt = Date.now();
      await existing.save();
      progressEmitter.fileFinished({ groupId: targetGroupId, msgId, fileName, type: 'upload_complete' });
      try {
        fs.unlinkSync(filePath);
        existing.status = 'deleted_locally';
        await existing.save();
      } catch (e) { console.error('Failed to delete file after upload:', e); }
    }

    progressEmitter.fileFinished({ groupId, msgId, fileName, type: 'download_complete' });
    progressEmitter.fileCompleted(jobId, { groupId, msgId, fileName });
    return { skipped: false, media: existing };
  } catch (err) {
    if (err.code === 'SESSION_EXPIRED') {
      sessionManager.reportRevoked(err);
      throw err;
    }
    console.error(`Failed media for msg ${msgId}:`, err);
    if (existing) {
      try {
        existing.status = 'failed';
        existing.lastError = err.message;
        await existing.save();
      } catch (e) { /* ignore */ }
    }
    progressEmitter.fileFailed(jobId, { groupId, error: err });
    return { skipped: false, error: err };
  }
}

async function downloadMediaForGroup(groupId, targetGroupId = null, { taskId = null, jobId: providedJobId = null } = {}) {
  const client = await requireClient();
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const jobId = providedJobId || uuidv4();
  const abortController = new AbortController();

  const entity = await retryWithBackoff(() => client.getEntity(groupId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { limit: 10000, filter: new Api.InputMessagesFilterPhotoVideo() }));
  const validMessages = messages.filter((m) => m.media);

  activeJobs.set(jobId, {
    id: jobId,
    type: 'group_pull',
    groupId,
    taskId,
    status: 'running',
    progress: 0,
    total: validMessages.length,
    failed: 0,
    skipped: 0,
    rate: 0,
    etaMs: null,
    startedAt: Date.now(),
    abortController,
  });

  progressEmitter.startJob({ jobId, type: 'group_pull', groupId, taskId, total: validMessages.length });

  let downloadedCount = 0;
  for (const message of validMessages) {
    if (abortController.signal.aborted) break;
    const result = await downloadAndMaybeUpload({
      client, jobId, groupId, message, targetGroupId,
      downloadDir, abortSignal: abortController.signal,
      onRetry: ({ attempt, waitMs, reason }) => {
        const j = activeJobs.get(jobId);
        if (j) {
          j.rate = 0;
          j.etaMs = null;
        }
        logActivity('Retry', { jobId, msgId: message.id, attempt, waitMs, reason }, 'warning');
      },
    });
    if (!result.skipped) downloadedCount += 1;
  }

  await finishJob(jobId, { type: 'group_pull', groupId, total: validMessages.length });
  return downloadedCount;
}

async function downloadSpecificMedia(groupId, messageIds, targetGroupId = null, { taskId = null, jobId: providedJobId = null } = {}) {
  const client = await requireClient();
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const jobId = providedJobId || uuidv4();
  const abortController = new AbortController();
  const entity = await retryWithBackoff(() => client.getEntity(groupId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { ids: messageIds }));

  activeJobs.set(jobId, {
    id: jobId,
    type: 'specific_pull',
    groupId,
    taskId,
    status: 'running',
    progress: 0,
    total: messages.length,
    failed: 0,
    skipped: 0,
    rate: 0,
    etaMs: null,
    startedAt: Date.now(),
    abortController,
  });

  progressEmitter.startJob({ jobId, type: 'specific_pull', groupId, taskId, total: messages.length });

  let downloadedCount = 0;
  for (const message of messages) {
    if (abortController.signal.aborted) break;
    if (!message || !message.media) continue;
    const result = await downloadAndMaybeUpload({
      client, jobId, groupId, message, targetGroupId,
      downloadDir, abortSignal: abortController.signal,
    });
    if (!result.skipped) downloadedCount += 1;
  }

  await finishJob(jobId, { type: 'specific_pull', groupId, total: messages.length });
  return downloadedCount;
}

async function getRecentMedia(groupId) {
  const client = await requireClient();
  const entity = await retryWithBackoff(() => client.getEntity(groupId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { limit: 1000, filter: new Api.InputMessagesFilterPhotoVideo() }));
  return messages.filter((m) => m.media).map((m) => ({
    id: m.id,
    caption: m.message || '',
    type: m.media.photo ? 'photo' : 'video',
    estimatedExt: extForMessage(m),
  }));
}

async function forwardLocalMedia(mediaId, targetGroupId) {
  const client = await requireClient();
  const media = await Media.findById(mediaId);
  if (!media || !fs.existsSync(media.localPath)) throw new Error('File not found locally');

  progressEmitter.byteProgress({ groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, type: 'upload', current: 0, total: 1 });
  const targetEntity = await retryWithBackoff(() => client.getEntity(targetGroupId));
  await retryWithBackoff(
    () => client.sendFile(targetEntity, {
      file: media.localPath,
      caption: media.caption || '',
      progressCallback: (uploaded, total) => {
        progressEmitter.byteProgress({ groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, type: 'upload', current: uploaded, total });
      },
    }),
  );

  media.status = 'uploaded_to_group';
  media.uploadedAt = Date.now();
  await media.save();
  progressEmitter.fileFinished({ groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, type: 'upload_complete' });
  try {
    fs.unlinkSync(media.localPath);
    media.status = 'deleted_locally';
    await media.save();
  } catch (e) { console.error('Failed to delete file after forward:', e); }
  return true;
}

async function bulkForwardLocalMedia(mediaIds, targetGroupId) {
  const client = await requireClient();
  const jobId = uuidv4();
  const abortController = new AbortController();

  activeJobs.set(jobId, {
    id: jobId,
    type: 'bulk_upload',
    groupId: targetGroupId,
    status: 'running',
    progress: 0,
    total: mediaIds.length,
    failed: 0,
    skipped: 0,
    rate: 0,
    etaMs: null,
    startedAt: Date.now(),
    abortController,
  });

  progressEmitter.startJob({ jobId, type: 'bulk_upload', groupId: targetGroupId, total: mediaIds.length });

  let uploadedCount = 0;
  for (const mediaId of mediaIds) {
    if (abortController.signal.aborted) break;
    try {
      const media = await Media.findById(mediaId);
      if (!media || !fs.existsSync(media.localPath)) {
        progressEmitter.fileSkipped(jobId, { groupId: targetGroupId });
        uploadedCount += 1;
        continue;
      }
      progressEmitter.byteProgress({ groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, type: 'upload', current: 0, total: 1 });
      const targetEntity = await retryWithBackoff(() => client.getEntity(targetGroupId));
      await retryWithBackoff(
        () => client.sendFile(targetEntity, {
          file: media.localPath,
          caption: media.caption || '',
          progressCallback: (uploaded, total) => {
            progressEmitter.byteProgress({ groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, type: 'upload', current: uploaded, total });
          },
        }),
      );
      media.status = 'uploaded_to_group';
      media.uploadedAt = Date.now();
      await media.save();
      progressEmitter.fileFinished({ groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, type: 'upload_complete' });
      try {
        fs.unlinkSync(media.localPath);
        media.status = 'deleted_locally';
        await media.save();
      } catch (e) { console.error('Failed to delete file after forward:', e); }
      progressEmitter.fileCompleted(jobId, { groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName });
      uploadedCount += 1;
    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') {
        sessionManager.reportRevoked(err);
        throw err;
      }
      console.error(`Failed to forward media ${mediaId}:`, err);
      progressEmitter.fileFailed(jobId, { groupId: targetGroupId, error: err });
    }
  }

  await finishJob(jobId, { type: 'bulk_upload', groupId: targetGroupId, total: mediaIds.length });
  return uploadedCount;
}

/**
 * Retry a single media item by id. Re-downloads from Telegram and (if a
 * targetGroupId is provided) re-uploads. Updates the Media row.
 */
async function retryMediaItem(mediaId, targetGroupId = null) {
  const media = await Media.findById(mediaId);
  if (!media) throw new Error('Media not found');
  const client = await requireClient();
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const jobId = uuidv4();
  const abortController = new AbortController();
  activeJobs.set(jobId, {
    id: jobId,
    type: 'single_retry',
    groupId: media.channelId,
    status: 'running',
    progress: 0,
    total: 1,
    failed: 0,
    skipped: 0,
    rate: 0,
    etaMs: null,
    startedAt: Date.now(),
    abortController,
  });
  progressEmitter.startJob({ jobId, type: 'single_retry', groupId: media.channelId, total: 1 });

  // Fetch the message from the channel so we can re-download it.
  const entity = await retryWithBackoff(() => client.getEntity(media.channelId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { ids: [media.telegramMessageId] }));
  const message = messages && messages[0];
  if (!message) throw new Error('Source message not found on Telegram');

  const result = await downloadAndMaybeUpload({
    client, jobId, groupId: media.channelId, message, targetGroupId,
    downloadDir, abortSignal: abortController.signal,
  });
  await finishJob(jobId, { type: 'single_retry', groupId: media.channelId, total: 1 });
  if (result.error) throw result.error;
  return { ok: true, media: result.media || media };
}

async function finishJob(jobId, { type, groupId, total }) {
  const job = activeJobs.get(jobId);
  if (!job) return;
  job.status = job.status === 'aborted' ? 'aborted' : 'completed';
  try {
    await JobHistory.create({
      jobId: job.id,
      type,
      groupId,
      taskId: job.taskId,
      status: job.status,
      progress: job.progress,
      total,
      failed: job.failed,
      skipped: job.skipped,
      startedAt: job.startedAt,
      completedAt: Date.now(),
    });
  } catch (e) { console.error('Failed to save JobHistory:', e); }
  progressEmitter.endJob(jobId, { status: job.status });
  setTimeout(() => activeJobs.delete(jobId), 10_000);
}

// Replace the entire module.exports object in one shot with the public API.
// The functions above are declared as `async function name(...)` or as
// `exports.X = function ...` — both are reachable on `module.exports`
// because the two are the same object before reassignment.
module.exports = {
  sendCode,
  signIn,
  getGroups,
  downloadMediaForGroup,
  getRecentMedia,
  downloadSpecificMedia,
  forwardLocalMedia,
  bulkForwardLocalMedia,
  retryMediaItem,
  getActiveJobs: exports.getActiveJobs,
  stopJob: exports.stopJob,
  getSessionState: exports.getSessionState,
  reconnectNow: exports.reconnectNow,
};
