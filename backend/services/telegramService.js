// telegramService.js
// Telegram-bound business logic. The GramJS client and the connection
// state machine live in `sessionManager.js`; the canonical in-memory
// job state lives in `progressEmitter.js`. This file asks for a
// client via `sessionManager.getClient()` and for job state via
// `progressEmitter.startJob/...` — it does NOT keep its own map.

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
const { createLimiter } = require('../utils/concurrency');

// Outer-loop concurrency: how many messages we download in parallel.
// Telegram's rate limits on `messages.getMedia` and the part-fetch
// endpoints comfortably allow 3 concurrent in-flight file downloads
// per account. 5 is a good "feels fast without getting banned"
// number; 1 is the historical default and the reason downloads
// crawled. Override per-job via the env var GROUP_PULL_CONCURRENCY.
const GROUP_PULL_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.GROUP_PULL_CONCURRENCY || '5', 10) || 5,
);
const logActivity = require('../utils/logger');

// Build a t.me/c/<group>/<msg> deep-link for any (groupId, msgId).
// Works for supergroups (id starts with -100) and channels.
function telegramLinkFor(groupId, msgId) {
  if (groupId == null || msgId == null) return null;
  const s = String(groupId);
  if (s.startsWith('-100')) {
    const bare = s.slice(4);
    return `https://t.me/c/${bare}/${msgId}`;
  }
  if (s.startsWith('-')) {
    // basic chat / unknown
    return null;
  }
  return null;
}

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

exports.getActiveJobs = () => progressEmitter.snapshotForIds();

exports.stopJob = (jobId) => {
  const res = progressEmitter.stopJob(jobId, { reason: 'user_request' });
  return !!res.ok;
};

/**
 * Kill every currently running job. Returns the list of jobIds that
 * had a stop signal fired on them. Used by the "Kill All" button in
 * the ActiveJobs page.
 */
exports.stopAllJobs = () => {
  const snapshot = progressEmitter.snapshotForIds();
  const stopped = [];
  for (const job of snapshot) {
    const r = progressEmitter.stopJob(job.id, { reason: 'kill_all' });
    if (r.ok) stopped.push(job.id);
  }
  return stopped;
};

exports.getJobLog = (jobId, opts) => progressEmitter.getLog(jobId, opts);

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
  const link = telegramLinkFor(groupId, msgId);

  if (existing && fs.existsSync(existing.localPath) && (!targetGroupId || existing.status === 'uploaded_to_group')) {
    // Distinguish "already on disk" from "already uploaded to target".
    const reason = (targetGroupId && existing.status === 'uploaded_to_group')
      ? 'Duplicate video detected · already uploaded to target group'
      : 'Duplicate video detected · already on disk';
    progressEmitter.fileSkipped(jobId, {
      groupId, msgId, fileName, reason, telegramLink: link,
    });
    return { skipped: true };
  }

  try {
    if (!existing || !fs.existsSync(filePath)) {
      progressEmitter.byteProgress({ jobId, groupId, msgId, fileName, type: 'download', current: 0, total: 1 });
      // `workers` is the per-message multipart fetch parallelism in
      // gramme.js — it spawns N parallel HTTP requests to download
      // different chunks of the same file. 4 is a safe default that
      // gives ~3-4× single-file throughput on most Telegram CDNs
      // without tripping rate limits. (The outer loop's concurrency
      // is controlled by the groupPullLimit in the caller.)
      const buffer = await retryWithBackoff(
        () => client.downloadMedia(message, {
          workers: 4,
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

async function downloadMediaForGroup(groupId, targetGroupId = null, { taskId = null, taskName = null, jobId: providedJobId = null } = {}) {
  const client = await requireClient();
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const jobId = providedJobId || uuidv4();
  const abortController = new AbortController();

  const entity = await retryWithBackoff(() => client.getEntity(groupId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { limit: 10000, filter: new Api.InputMessagesFilterPhotoVideo() }));
  const validMessages = messages.filter((m) => m.media);

  progressEmitter.startJob({
    jobId, type: 'group_pull', groupId, taskId, taskName,
    total: validMessages.length, abortController,
  });
  progressEmitter.log(jobId, 'info', `Starting group pull: ${validMessages.length} candidates in ${groupId}`);

  // Concurrent outer loop. Instead of awaiting each message in turn
  // (1 file at a time), we hand them to a small worker pool of
  // size GROUP_PULL_CONCURRENCY. Combined with `workers: 4` on
  // downloadMedia (the per-message multipart fetch parallelism),
  // this turns a 1-file-at-a-time crawl into a 5×4=20-way parallel
  // download — well under Telegram's per-account rate limits.
  //
  // We collect every result and tally the downloaded count at the
  // end so the progress emitter is still driven by fileCompleted /
  // fileSkipped / fileFailed inside downloadAndMaybeUpload.
  progressEmitter.log(jobId, 'info',
    `Concurrency: ${GROUP_PULL_CONCURRENCY} message(s) in parallel × 4 part-workers each`);

  const limit = createLimiter(GROUP_PULL_CONCURRENCY, abortController.signal);
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const tasks = validMessages.map((message) => limit(async ({ signal }) => {
    if (signal.aborted) return { skipped: true };
    try {
      const result = await downloadAndMaybeUpload({
        client, jobId, groupId, message, targetGroupId,
        downloadDir, abortSignal: signal,
        onRetry: ({ attempt, waitMs, reason }) => {
          logActivity('Retry', { jobId, msgId: message.id, attempt, waitMs, reason }, 'warning');
          progressEmitter.log(jobId, 'warning',
            `Retry ${attempt} for msg ${message.id} in ${waitMs}ms (${reason})`);
        },
      });
      if (result.skipped) skippedCount += 1;
      else if (result.error) failedCount += 1;
      else downloadedCount += 1;
      return result;
    } catch (err) {
      // Per-message failures shouldn't kill the whole batch.
      failedCount += 1;
      progressEmitter.fileFailed(jobId, {
        groupId, msgId: message.id, fileName: null, reason: err.message,
      });
      progressEmitter.log(jobId, 'error', `Failed msg ${message.id}: ${err.message}`);
      logActivity('Download failed', { jobId, msgId: message.id, reason: err.message }, 'error');
      return { error: err };
    }
  }));

  // Wait for everything to settle. limit.drain resolves once every
  // queued + in-flight task is finished (or aborted).
  await Promise.all(tasks);

  progressEmitter.log(jobId, 'info',
    `Group pull finished: ${downloadedCount} new, ${skippedCount} skipped, ${failedCount} failed`);
  // Stash the final counts on the job so finishJob can read them
  // even after the worker has cleared references.
  const job = progressEmitter.getRaw(jobId);
  if (job) {
    job.failed = (job.failed || 0) + failedCount;
    job.skipped = (job.skipped || 0) + skippedCount;
  }

  await finishJob(jobId, { type: 'group_pull', groupId, total: validMessages.length });
  return downloadedCount;
}

async function downloadSpecificMedia(groupId, messageIds, targetGroupId = null, { taskId = null, taskName = null, jobId: providedJobId = null } = {}) {
  const client = await requireClient();
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const jobId = providedJobId || uuidv4();
  const abortController = new AbortController();
  const entity = await retryWithBackoff(() => client.getEntity(groupId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { ids: messageIds }));

  progressEmitter.startJob({
    jobId, type: 'specific_pull', groupId, taskId, taskName,
    total: messages.length, abortController,
  });
  progressEmitter.log(jobId, 'info', `Selective pull: ${messages.length} ids from ${groupId}`);

  // Concurrent outer loop (see downloadMediaForGroup for rationale).
  const limit = createLimiter(GROUP_PULL_CONCURRENCY, abortController.signal);
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const tasks = messages
    .filter((m) => m && m.media)
    .map((message) => limit(async ({ signal }) => {
      if (signal.aborted) return { skipped: true };
      try {
        const result = await downloadAndMaybeUpload({
          client, jobId, groupId, message, targetGroupId,
          downloadDir, abortSignal: signal,
        });
        if (result.skipped) skippedCount += 1;
        else if (result.error) failedCount += 1;
        else downloadedCount += 1;
        return result;
      } catch (err) {
        failedCount += 1;
        progressEmitter.fileFailed(jobId, {
          groupId, msgId: message.id, fileName: null, reason: err.message,
        });
        progressEmitter.log(jobId, 'error', `Failed msg ${message.id}: ${err.message}`);
        return { error: err };
      }
    }));
  await Promise.all(tasks);

  const job = progressEmitter.getRaw(jobId);
  if (job) {
    job.failed = (job.failed || 0) + failedCount;
    job.skipped = (job.skipped || 0) + skippedCount;
  }

  await finishJob(jobId, { type: 'specific_pull', groupId, total: messages.length });
  return downloadedCount;
}

async function getRecentMedia(groupId) {
  const client = await requireClient();
  const entity = await retryWithBackoff(() => client.getEntity(groupId));
  const messages = await retryWithBackoff(() => client.getMessages(entity, { limit: 1000, filter: new Api.InputMessagesFilterPhotoVideo() }));
  const mediaMessages = messages.filter((m) => m.media);

  // Cross-reference with the local Media collection so the UI can
  // preview already-downloaded items immediately (no extra Telegram
  // round-trip). Items not yet on disk still come back — they just
  // have fileName=null and the UI renders a "download" state.
  const messageIds = mediaMessages.map((m) => m.id);
  const localMedia = await Media.find({
    channelId: String(groupId),
    telegramMessageId: { $in: messageIds },
  }).select('telegramMessageId fileName status localPath mimeType fileSize').lean();
  const byMessageId = new Map(localMedia.map((m) => [m.telegramMessageId, m]));

  return mediaMessages.map((m) => {
    const local = byMessageId.get(m.id);
    return {
      id: m.id,
      caption: m.message || '',
      type: m.media.photo ? 'photo' : 'video',
      estimatedExt: extForMessage(m),
      // Surface local download state (or null if not yet on disk).
      fileName: local?.fileName || null,
      localPath: local?.localPath || null,
      status: local?.status || 'remote',
      mimeType: local?.mimeType || null,
      fileSize: local?.fileSize || null,
    };
  });
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

  progressEmitter.startJob({
    jobId, type: 'bulk_upload', groupId: targetGroupId,
    total: mediaIds.length, abortController,
  });
  progressEmitter.log(jobId, 'info', `Bulk upload: ${mediaIds.length} media to ${targetGroupId}`);

  let uploadedCount = 0;
  for (const mediaId of mediaIds) {
    if (abortController.signal.aborted) break;
    try {
      const media = await Media.findById(mediaId);
      if (!media || !fs.existsSync(media.localPath)) {
        const reason = !media
          ? 'Duplicate detection · media not in vault'
          : 'Duplicate detection · file missing on disk';
        progressEmitter.fileSkipped(jobId, {
          groupId: targetGroupId,
          msgId: media?.telegramMessageId,
          fileName: media?.fileName,
          reason,
          telegramLink: media ? telegramLinkFor(media.channelId, media.telegramMessageId) : null,
        });
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
  progressEmitter.startJob({
    jobId, type: 'single_retry', groupId: media.channelId,
    total: 1, abortController,
  });
  progressEmitter.log(jobId, 'info', `Single retry: media ${mediaId} (${media.fileName || 'unknown'})`);

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
  const job = progressEmitter.getRaw(jobId);
  if (!job) return;
  // Preserve any 'aborted' set by stopJob, otherwise mark completed
  // (or 'partial' if some files failed — see endJob for the same logic).
  const finalStatus = job.status === 'aborted'
    ? 'aborted'
    : (job.failed > 0 ? 'partial' : 'completed');
  try {
    await JobHistory.create({
      jobId,
      type,
      groupId,
      taskId: job.taskId,
      status: finalStatus,
      progress: job.current,
      total,
      failed: job.failed,
      skipped: job.skipped,
      startedAt: job.startedAt,
      completedAt: Date.now(),
    });
  } catch (e) { console.error('Failed to save JobHistory:', e); }
  progressEmitter.log(jobId, 'info',
    `Job ${finalStatus}: ${job.current}/${total} processed, ${job.failed} failed, ${job.skipped} skipped`);
  progressEmitter.endJob(jobId, { status: finalStatus });
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
