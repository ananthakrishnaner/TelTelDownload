const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Setting = require('../models/Setting');
const Media = require('../models/Media');
const path = require('path');
const fs = require('fs');
const socket = require('../socket');

let client = null;

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
  
  // Create media directory
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const entity = await client.getEntity(groupId);
  const messages = await client.getMessages(entity, { limit: 100, filter: new Api.InputMessagesFilterPhotoVideo() });

  let downloadedCount = 0;
  for (const message of messages) {
    if (!message.media) continue;

    const msgId = message.id;
    
    // Find extension
    let ext = '.bin';
    if (message.media.photo) ext = '.jpg';
    else if (message.media.document) {
      const attr = message.media.document.attributes.find(a => a.className === 'DocumentAttributeFilename');
      if (attr) ext = path.extname(attr.fileName) || '.mp4';
      else ext = '.mp4';
    }
    const fileName = `${groupId}_${msgId}${ext}`;
    const filePath = path.join(downloadDir, fileName);

    // Robust Duplicate Check (DB and Disk)
    let existing = await Media.findOne({ telegramMessageId: msgId, channelId: groupId });
    if (existing && fs.existsSync(existing.localPath)) {
      if (!targetGroupId || existing.status === 'uploaded_to_group') {
        continue; // Skip if completely done
      }
    }

    try {
      if (!existing || !fs.existsSync(filePath)) {
        // Step 1: Download Media
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
            existing = await Media.create({
              telegramMessageId: msgId,
              channelId: groupId,
              localPath: filePath,
              fileName,
              caption: message.message || '',
              status: 'downloaded'
            });
          } else {
            existing.status = 'downloaded';
            await existing.save();
          }
          downloadedCount++;
        }
      }

      // Step 2: Auto-Upload if target group is specified
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
      }

      io.emit('progress', { type: 'download_complete', groupId, msgId, fileName });
    } catch (err) {
      console.error(`Failed media for msg ${msgId}:`, err);
      if (existing) {
        existing.status = 'failed';
        await existing.save();
      }
    }
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
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const entity = await client.getEntity(groupId);
  // We have to get messages one by one or get a batch if API supports it
  // GramJS client.getMessages supports an array of ids!
  const messages = await client.getMessages(entity, { ids: messageIds });

  let downloadedCount = 0;
  for (const message of messages) {
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
      if (!targetGroupId || existing.status === 'uploaded_to_group') continue;
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
          downloadedCount++;
        }
      }

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
      }
      io.emit('progress', { type: 'download_complete', groupId, msgId, fileName });
    } catch (err) {
      console.error(`Failed specific media ${msgId}:`, err);
    }
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
  return true;
}

module.exports = {
  initClient,
  sendCode,
  signIn,
  getGroups,
  downloadMediaForGroup,
  getRecentMedia,
  downloadSpecificMedia,
  forwardLocalMedia
};
