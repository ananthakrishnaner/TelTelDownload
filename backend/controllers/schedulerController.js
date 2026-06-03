const ScheduledTask = require('../models/ScheduledTask');
const schedulerService = require('../services/schedulerService');

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
