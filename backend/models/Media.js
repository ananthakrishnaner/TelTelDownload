const mongoose = require('mongoose');

const frameSchema = new mongoose.Schema({
  idx:       { type: Number, required: true },
  // 64-bit pHash, hex-encoded (16 chars). Pinned in the indexer's #[test].
  phash:     { type: String, required: true, match: /^[0-9a-f]{16}$/ },
  // Path relative to MEDIA_DIR (e.g. "thumbs/<id>/0.jpg").
  thumbPath: { type: String, required: true },
  duration:  { type: Number },
  width:     { type: Number },
  height:    { type: Number },
}, { _id: false });

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
  uploadedAt: { type: Date },

  // ---- pHash indexer fields (additive, see plan §Lookup) -------------
  frames:    { type: [frameSchema], default: [] },
  phashed:   { type: Boolean, default: false },
  indexedAt: { type: Date },
  duration:  { type: Number }, // top-level video duration (seconds)
});

mediaSchema.index({ channelId: 1, indexedAt: -1 });
mediaSchema.index({ phashed: 1, indexedAt: -1 }); // backfill query

module.exports = mongoose.model('Media', mediaSchema);
