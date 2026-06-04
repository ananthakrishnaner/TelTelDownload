const mongoose = require('mongoose');

const jobHistorySchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  groupId: { type: String },
  status: { type: String, required: true },
  progress: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  error: { type: String }
});

module.exports = mongoose.model('JobHistory', jobHistorySchema);
