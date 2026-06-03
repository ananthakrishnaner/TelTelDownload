const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Setting = require('../models/Setting');
const Media = require('../models/Media');
const path = require('path');
const fs = require('fs');

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

async function downloadMediaForGroup(groupId) {
  if (!client) await initClient();
  
  // Create media directory
  const downloadDir = path.join(__dirname, '..', 'media_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const entity = await client.getEntity(groupId);
  // Fetch recent messages with media
  const messages = await client.getMessages(entity, { limit: 100, filter: new Api.InputMessagesFilterPhotoVideo() });

  let downloadedCount = 0;
  for (const message of messages) {
    if (!message.media) continue;

    const msgId = message.id;
    // Resumable logic: Check if we already downloaded this message's media
    const existing = await Media.findOne({ telegramMessageId: msgId, channelId: groupId });
    if (existing) {
      console.log(`Skipping already downloaded media: ${msgId}`);
      continue;
    }

    try {
      const buffer = await client.downloadMedia(message, { workers: 1 });
      if (buffer) {
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
        fs.writeFileSync(filePath, buffer);

        await Media.create({
          telegramMessageId: msgId,
          channelId: groupId,
          localPath: filePath,
          fileName,
          caption: message.message || '',
          status: 'downloaded'
        });
        downloadedCount++;
        console.log(`Downloaded ${fileName}`);
      }
    } catch (err) {
      console.error(`Failed to download media for msg ${msgId}:`, err);
    }
  }
  return downloadedCount;
}

module.exports = {
  initClient,
  sendCode,
  signIn,
  getGroups,
  downloadMediaForGroup
};
