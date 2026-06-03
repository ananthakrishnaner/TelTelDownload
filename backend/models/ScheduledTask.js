const mongoose = require('mongoose');

const scheduledTaskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cronExpression: { type: String, required: true },
  targetChannels: [{ type: String }],
  isActive: { type: Boolean, default: true },
  lastRunAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScheduledTask', scheduledTaskSchema);
