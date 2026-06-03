const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  level: { type: String, enum: ['info', 'warning', 'error'], default: 'info' },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
