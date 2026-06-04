const ScheduledTask = require('../models/ScheduledTask');
const schedulerService = require('../services/schedulerService');
const { CronExpressionParser } = require('cron-parser');

exports.getTasks = async (req, res) => {
  try {
    const tasks = await ScheduledTask.find();
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const { name, cronExpression, targetChannels, isActive } = req.body;
    const task = await ScheduledTask.create({ name, cronExpression, targetChannels, isActive });
    schedulerService.scheduleJob(task);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, cronExpression, targetChannels, isActive } = req.body;
    const task = await ScheduledTask.findByIdAndUpdate(id, { name, cronExpression, targetChannels, isActive }, { new: true });
    if (task) {
      schedulerService.scheduleJob(task);
    }
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    await ScheduledTask.findByIdAndDelete(id);
    if (schedulerService.jobs[id]) {
      schedulerService.jobs[id].stop();
      delete schedulerService.jobs[id];
    }
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTaskRuns = async (req, res) => {
  try {
    const { id } = req.params;
    const count = parseInt(req.query.count, 10) || 5;
    const task = await ScheduledTask.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Next-N runs preview, computed client-side from the cron expression.
    let nextRuns = [];
    if (task.cronExpression) {
      try {
        const it = CronExpressionParser.parse(task.cronExpression, { currentDate: task.lastRunAt || new Date() });
        for (let i = 0; i < count; i += 1) {
          nextRuns.push(it.next().toDate().toISOString());
        }
      } catch (e) { /* invalid cron; leave empty */ }
    }

    res.json({
      success: true,
      task: {
        id: task._id,
        name: task.name,
        cronExpression: task.cronExpression,
        isActive: task.isActive,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
        lastError: task.lastError,
        lastDurationMs: task.lastDurationMs,
        nextRunAt: task.nextRunAt,
        runHistory: task.runHistory,
      },
      nextRuns,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
