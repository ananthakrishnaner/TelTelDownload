const mongoose = require('mongoose');

const runHistoryEntrySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  status: { type: String, enum: ['success', 'failed', 'aborted', 'partial'], default: 'success' },
  durationMs: { type: Number, default: 0 },
  itemsDownloaded: { type: Number, default: 0 },
  itemsFailed: { type: Number, default: 0 },
  channels: [{
    id: String,
    downloaded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  }],
  error: { type: String },
}, { _id: false });

const scheduledTaskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cronExpression: { type: String, required: true },
  targetChannels: [{ type: String }],
  isActive: { type: Boolean, default: true },
  lastRunAt: { type: Date },
  lastDurationMs: { type: Number, default: 0 },
  lastStatus: { type: String, enum: ['success', 'failed', 'aborted', 'partial', 'never'], default: 'never' },
  lastError: { type: String },
  nextRunAt: { type: Date },
  runHistory: { type: [runHistoryEntrySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ScheduledTask', scheduledTaskSchema);
