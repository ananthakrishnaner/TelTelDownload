const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Setting = require('../models/Setting');
const Media = require('../models/Media');
const path = require('path');
const fs = require('fs');
const socket = require('../socket');
const { v4: uuidv4 } = require('uuid');

let client = null;
const activeJobs = new Map();

exports.getActiveJobs = () => {
  return Array.from(activeJobs.values()).map(job => ({
    id: job.id,
    type: job.type,
    groupId: job.groupId,
    status: job.status,
    progress: job.progress,
    total: job.total,
    startedAt: job.startedAt
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

async function getCredentials() {
  const apiIdSetting = await Setting.findOne({ key: 'apiId' });
  const apiHashSetting = await Setting.findOne({ key: 'apiHash' });
  const sessionSetting = await Setting.findOne({ key: 'sessionString' });

  return {
    apiId: apiIdSetting ? parseInt(apiIdSetting.value) : null,
    apiHash: apiHashSetting ? apiHashSetting.value : null,
    sessionString: sessionSetting ? sessionSetting.value : ''
  };
}

async function initClient() {
  const { apiId, apiHash, sessionString } = await getCredentials();
  if (!apiId || !apiHash) return false;

  const stringSession = new StringSession(sessionString);
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  return true;
}

async function sendCode(phoneNumber) {
  if (!client) await initClient();
  const result = await client.sendCode(
    {
      apiId: client.apiId,
      apiHash: client.apiHash
    },
    phoneNumber
  );
  return result.phoneCodeHash;
}

async function signIn(phoneNumber, phoneCodeHash, phoneCode, password) {
  if (!client) await initClient();
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber,
      phoneCodeHash,
      phoneCode,
    }));
  } catch (err) {
    if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
      if (!password) throw new Error('2FA_REQUIRED');
      await client.invoke(new Api.auth.CheckPassword({
        password: await client.computeAuthPassword(password)
      }));
    } else {
      throw err;
    }
  }
  
  const sessionString = client.session.save();
  await Setting.findOneAndUpdate(
    { key: 'sessionString' },
    { value: sessionString },
    { upsert: true }
  );
  return true;
}

async function getGroups() {
  if (!client) await initClient();
  const dialogs = await client.getDialogs({});
  return dialogs
    .filter(d => d.isGroup || d.isChannel)
    .map(d => ({
      id: d.id.toString(),
      title: d.title,
      isChannel: d.isChannel
    }));
}

async function downloadMediaForGroup(groupId, targetGroupId = null) {
  if (!client) await initClient();
  const io = socket.getIO();
  const jobId = uuidv4();
  const abortController = new AbortController();
  
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const entity = await client.getEntity(groupId);
  const messages = await client.getMessages(entity, { limit: 100, filter: new Api.InputMessagesFilterPhotoVideo() });
  const validMessages = messages.filter(m => m.media);

  activeJobs.set(jobId, {
    id: jobId,
    type: 'group_pull',
    groupId,
    status: 'running',
    progress: 0,
    total: validMessages.length,
    startedAt: Date.now(),
    abortController
  });

  let downloadedCount = 0;
  for (const message of validMessages) {
    if (abortController.signal.aborted) break;

    const msgId = message.id;
    let ext = '.bin';
    if (message.media.photo) ext = '.jpg';
    else if (message.media.document) {
      const attr = message.media.document.attributes.find(a => a.className === 'DocumentAttributeFilename');
      if (attr) ext = path.extname(attr.fileName) || '.mp4';
      else ext = '.mp4';
    }
    const fileName = `${groupId}_${msgId}${ext}`;
    const filePath = path.join(downloadDir, fileName);

    let existing = await Media.findOne({ telegramMessageId: msgId, channelId: groupId });
    if (existing && fs.existsSync(existing.localPath)) {
      if (!targetGroupId || existing.status === 'uploaded_to_group') {
        downloadedCount++;
        activeJobs.get(jobId).progress = downloadedCount;
        io.emit('job_progress', { jobId, groupId, progress: downloadedCount, total: validMessages.length });
        continue;
      }
    }

    try {
      if (!existing || !fs.existsSync(filePath)) {
        io.emit('progress', { type: 'download', groupId, msgId, fileName, progress: 0 });
        const buffer = await client.downloadMedia(message, {
          workers: 1,
          progressCallback: (downloaded, total) => {
            const percentage = Math.round((Number(downloaded) / Number(total)) * 100);
            io.emit('progress', { type: 'download', groupId, msgId, fileName, progress: percentage });
          }
        });
        if (buffer) {
          fs.writeFileSync(filePath, buffer);
          if (!existing) {
            existing = await Media.create({ telegramMessageId: msgId, channelId: groupId, localPath: filePath, fileName, caption: message.message || '', status: 'downloaded' });
          } else {
            existing.status = 'downloaded';
            await existing.save();
          }
        }
      }

      if (abortController.signal.aborted) break;

      if (targetGroupId && existing && fs.existsSync(filePath)) {
        io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId, fileName, progress: 0 });
        const targetEntity = await client.getEntity(targetGroupId);
        await client.sendFile(targetEntity, {
          file: filePath,
          caption: existing.caption || '',
          progressCallback: (uploaded, total) => {
            const percentage = Math.round((Number(uploaded) / Number(total)) * 100);
            io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId, fileName, progress: percentage });
          }
        });
        existing.status = 'uploaded_to_group';
        existing.uploadedAt = Date.now();
        await existing.save();
        io.emit('progress', { type: 'upload_complete', groupId: targetGroupId, msgId, fileName });
        
        // Deletion Policy: Delete local file after successful forward
        try {
          fs.unlinkSync(filePath);
          existing.status = 'deleted_locally';
          await existing.save();
        } catch (e) {
          console.error('Failed to delete file after upload:', e);
        }
      }

      io.emit('progress', { type: 'download_complete', groupId, msgId, fileName });
      downloadedCount++;
      activeJobs.get(jobId).progress = downloadedCount;
      io.emit('job_progress', { jobId, groupId, progress: downloadedCount, total: validMessages.length });

    } catch (err) {
      console.error(`Failed media for msg ${msgId}:`, err);
      if (existing) {
        existing.status = 'failed';
        await existing.save();
      }
    }
  }
  
  if (activeJobs.has(jobId)) {
    const job = activeJobs.get(jobId);
    job.status = job.status === 'aborted' ? 'aborted' : 'completed';
    setTimeout(() => activeJobs.delete(jobId), 10000); // Keep around for 10s so frontend sees completion
  }
  return downloadedCount;
}

async function getRecentMedia(groupId) {
  if (!client) await initClient();
  const entity = await client.getEntity(groupId);
  const messages = await client.getMessages(entity, { limit: 50, filter: new Api.InputMessagesFilterPhotoVideo() });
  
  return messages.filter(m => m.media).map(m => {
    let ext = '.bin';
    if (m.media.photo) ext = '.jpg';
    else if (m.media.document) {
      const attr = m.media.document.attributes.find(a => a.className === 'DocumentAttributeFilename');
      if (attr) ext = path.extname(attr.fileName) || '.mp4';
      else ext = '.mp4';
    }
    return {
      id: m.id,
      caption: m.message || '',
      type: m.media.photo ? 'photo' : 'video',
      estimatedExt: ext
    };
  });
}

async function downloadSpecificMedia(groupId, messageIds, targetGroupId = null) {
  if (!client) await initClient();
  const io = socket.getIO();
  const jobId = uuidv4();
  const abortController = new AbortController();
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const entity = await client.getEntity(groupId);
  const messages = await client.getMessages(entity, { ids: messageIds });

  activeJobs.set(jobId, {
    id: jobId,
    type: 'specific_pull',
    groupId,
    status: 'running',
    progress: 0,
    total: messages.length,
    startedAt: Date.now(),
    abortController
  });

  let downloadedCount = 0;
  for (const message of messages) {
    if (abortController.signal.aborted) break;
    if (!message || !message.media) continue;

    const msgId = message.id;
    let ext = '.bin';
    if (message.media.photo) ext = '.jpg';
    else if (message.media.document) {
      const attr = message.media.document.attributes.find(a => a.className === 'DocumentAttributeFilename');
      if (attr) ext = path.extname(attr.fileName) || '.mp4';
      else ext = '.mp4';
    }
    const fileName = `${groupId}_${msgId}${ext}`;
    const filePath = path.join(downloadDir, fileName);

    let existing = await Media.findOne({ telegramMessageId: msgId, channelId: groupId });
    if (existing && fs.existsSync(existing.localPath)) {
      if (!targetGroupId || existing.status === 'uploaded_to_group') {
        downloadedCount++;
        activeJobs.get(jobId).progress = downloadedCount;
        io.emit('job_progress', { jobId, groupId, progress: downloadedCount, total: messages.length });
        continue;
      }
    }

    try {
      if (!existing || !fs.existsSync(filePath)) {
        io.emit('progress', { type: 'download', groupId, msgId, fileName, progress: 0 });
        const buffer = await client.downloadMedia(message, {
          workers: 1,
          progressCallback: (downloaded, total) => {
            const percentage = Math.round((Number(downloaded) / Number(total)) * 100);
            io.emit('progress', { type: 'download', groupId, msgId, fileName, progress: percentage });
          }
        });
        if (buffer) {
          fs.writeFileSync(filePath, buffer);
          if (!existing) {
            existing = await Media.create({ telegramMessageId: msgId, channelId: groupId, localPath: filePath, fileName, caption: message.message || '', status: 'downloaded' });
          } else {
            existing.status = 'downloaded';
            await existing.save();
          }
        }
      }

      if (abortController.signal.aborted) break;

      if (targetGroupId && existing && fs.existsSync(filePath)) {
        io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId, fileName, progress: 0 });
        const targetEntity = await client.getEntity(targetGroupId);
        await client.sendFile(targetEntity, {
          file: filePath,
          caption: existing.caption || '',
          progressCallback: (uploaded, total) => {
            const percentage = Math.round((Number(uploaded) / Number(total)) * 100);
            io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId, fileName, progress: percentage });
          }
        });
        existing.status = 'uploaded_to_group';
        existing.uploadedAt = Date.now();
        await existing.save();
        io.emit('progress', { type: 'upload_complete', groupId: targetGroupId, msgId, fileName });
        
        try {
          fs.unlinkSync(filePath);
          existing.status = 'deleted_locally';
          await existing.save();
        } catch (e) { console.error('Failed to delete file after upload:', e); }
      }
      io.emit('progress', { type: 'download_complete', groupId, msgId, fileName });
      downloadedCount++;
      activeJobs.get(jobId).progress = downloadedCount;
      io.emit('job_progress', { jobId, groupId, progress: downloadedCount, total: messages.length });
    } catch (err) {
      console.error(`Failed specific media ${msgId}:`, err);
    }
  }
  
  if (activeJobs.has(jobId)) {
    const job = activeJobs.get(jobId);
    job.status = job.status === 'aborted' ? 'aborted' : 'completed';
    setTimeout(() => activeJobs.delete(jobId), 10000);
  }
  return downloadedCount;
}

async function forwardLocalMedia(mediaId, targetGroupId) {
  if (!client) await initClient();
  const io = socket.getIO();
  const media = await Media.findById(mediaId);
  if (!media || !fs.existsSync(media.localPath)) throw new Error('File not found locally');

  io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, progress: 0 });
  const targetEntity = await client.getEntity(targetGroupId);
  await client.sendFile(targetEntity, {
    file: media.localPath,
    caption: media.caption || '',
    progressCallback: (uploaded, total) => {
      const percentage = Math.round((Number(uploaded) / Number(total)) * 100);
      io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, progress: percentage });
    }
  });

  media.status = 'uploaded_to_group';
  media.uploadedAt = Date.now();
  await media.save();
  io.emit('progress', { type: 'upload_complete', groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName });
  
  try {
    fs.unlinkSync(media.localPath);
    media.status = 'deleted_locally';
    await media.save();
  } catch (e) { console.error('Failed to delete file after forward:', e); }

  return true;
}

async function bulkForwardLocalMedia(mediaIds, targetGroupId) {
  if (!client) await initClient();
  const io = socket.getIO();
  const jobId = uuidv4();
  const abortController = new AbortController();

  activeJobs.set(jobId, {
    id: jobId,
    type: 'bulk_upload',
    groupId: targetGroupId,
    status: 'running',
    progress: 0,
    total: mediaIds.length,
    startedAt: Date.now(),
    abortController
  });

  let uploadedCount = 0;
  for (const mediaId of mediaIds) {
    if (abortController.signal.aborted) break;

    try {
      const media = await Media.findById(mediaId);
      if (!media || !fs.existsSync(media.localPath)) {
        uploadedCount++;
        activeJobs.get(jobId).progress = uploadedCount;
        io.emit('job_progress', { jobId, groupId: targetGroupId, progress: uploadedCount, total: mediaIds.length });
        continue;
      }

      io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, progress: 0 });
      const targetEntity = await client.getEntity(targetGroupId);
      await client.sendFile(targetEntity, {
        file: media.localPath,
        caption: media.caption || '',
        progressCallback: (uploaded, total) => {
          const percentage = Math.round((Number(uploaded) / Number(total)) * 100);
          io.emit('progress', { type: 'upload', groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName, progress: percentage });
        }
      });

      media.status = 'uploaded_to_group';
      media.uploadedAt = Date.now();
      await media.save();
      io.emit('progress', { type: 'upload_complete', groupId: targetGroupId, msgId: media.telegramMessageId, fileName: media.fileName });
      
      try {
        fs.unlinkSync(media.localPath);
        media.status = 'deleted_locally';
        await media.save();
      } catch (e) { console.error('Failed to delete file after forward:', e); }

      uploadedCount++;
      activeJobs.get(jobId).progress = uploadedCount;
      io.emit('job_progress', { jobId, groupId: targetGroupId, progress: uploadedCount, total: mediaIds.length });
    } catch (err) {
      console.error(`Failed to forward media ${mediaId}:`, err);
    }
  }

  if (activeJobs.has(jobId)) {
    const job = activeJobs.get(jobId);
    job.status = job.status === 'aborted' ? 'aborted' : 'completed';
    setTimeout(() => activeJobs.delete(jobId), 10000);
  }
  return uploadedCount;
}

function getActiveJobs() {
  return Array.from(activeJobs.values()).map(job => ({
    id: job.id,
    type: job.type,
    groupId: job.groupId,
    status: job.status,
    progress: job.progress,
    total: job.total,
    startedAt: job.startedAt
  }));
}

function stopJob(jobId) {
  if (activeJobs.has(jobId)) {
    const job = activeJobs.get(jobId);
    if (job.abortController) {
      job.abortController.abort();
    }
    job.status = 'aborted';
    return true;
  }
  return false;
}

module.exports = {
  initClient,
  sendCode,
  signIn,
  getGroups,
  downloadMediaForGroup,
  getRecentMedia,
  downloadSpecificMedia,
  forwardLocalMedia,
  bulkForwardLocalMedia,
  getActiveJobs,
  stopJob
};
