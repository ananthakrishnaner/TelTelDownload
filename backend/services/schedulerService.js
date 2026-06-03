const cron = require('node-cron');
const ScheduledTask = require('../models/ScheduledTask');
const telegramService = require('./telegramService');

const jobs = {};

async function runTask(task) {
  console.log(`Running scheduled task: ${task.name}`);
  if (task.targetChannels && task.targetChannels.length > 0) {
    for (const channelId of task.targetChannels) {
      console.log(`Starting scheduled download for channel: ${channelId}`);
      await telegramService.downloadMediaForGroup(channelId);
    }
  }
  task.lastRunAt = new Date();
  await task.save();
}

async function scheduleJob(task) {
  if (jobs[task._id]) {
    jobs[task._id].stop();
  }
  
  if (task.isActive) {
    jobs[task._id] = cron.schedule(task.cronExpression, () => {
      runTask(task).catch(err => console.error(`Task ${task.name} failed:`, err));
    });
    console.log(`Scheduled job ${task.name} with cron ${task.cronExpression}`);
  }
}

async function initializeScheduler() {
  const tasks = await ScheduledTask.find({ isActive: true });
  for (const task of tasks) {
    scheduleJob(task);
  }
  console.log(`Initialized ${tasks.length} scheduled tasks.`);
}

module.exports = {
  initializeScheduler,
  scheduleJob,
  jobs
};
