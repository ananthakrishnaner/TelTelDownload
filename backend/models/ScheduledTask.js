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
  // runAt is the FIRST fire time, stored in UTC. For recurring
  // tasks, the next run is computed by adding the recurrence
  // interval (daily/weekly/monthly) after each fire.
  runAt: { type: Date, required: true },
  // 'none' (one-shot — task auto-disables after first fire),
  // 'daily', 'weekly', 'monthly'. The interval is added to runAt
  // to compute the next run.
  recurrence: {
    type: String,
    enum: ['none', 'daily', 'weekly', 'monthly'],
    default: 'none',
  },
  // IANA timezone string (e.g. "Asia/Dubai") — kept for display
  // and so the UI can render "next run" in the user's local time.
  timezone: { type: String, default: 'UTC' },
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
