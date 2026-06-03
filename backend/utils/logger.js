const ActivityLog = require('../models/ActivityLog');

const logActivity = async (action, details = {}, level = 'info') => {
  try {
    console.log(`[${level.toUpperCase()}] ${action}:`, details);
    await ActivityLog.create({
      action,
      details,
      level
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
};

module.exports = logActivity;
