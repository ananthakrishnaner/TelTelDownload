const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  telegramMessageId: { type: Number, required: true },
  channelId: { type: String, required: true },
  localPath: { type: String, required: true },
  fileName: { type: String },
  mimeType: { type: String },
  caption: { type: String },
  fileSize: { type: Number },
  status: { type: String, enum: ['downloaded', 'uploaded_to_group', 'failed'], default: 'downloaded' },
  downloadedAt: { type: Date, default: Date.now },
  uploadedAt: { type: Date }
});

module.exports = mongoose.model('Media', mediaSchema);
