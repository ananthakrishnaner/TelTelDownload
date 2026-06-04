const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');
const ScheduledTask = require('../models/ScheduledTask');
const telegramService = require('./telegramService');
const logActivity = require('../utils/logger');

const jobs = {};
const RUN_HISTORY_CAP = 50;

/** Compute the next run time of a cron expression. Returns null on parse error. */
function computeNextRunAt(cronExpression, fromDate = new Date()) {
  try {
    const it = CronExpressionParser.parse(cronExpression, { currentDate: fromDate });
    return it.next().toDate();
  } catch (e) {
    return null;
  }
}

async function runTask(task) {
  const startedAt = Date.now();
  console.log(`Running scheduled task: ${task.name}`);
  let itemsDownloaded = 0;
  let itemsFailed = 0;
  const channelStats = [];
  let hadError = false;
  let lastErrorMessage = null;

  if (task.targetChannels && task.targetChannels.length > 0) {
    for (const channelId of task.targetChannels) {
      const chStart = Date.now();
      try {
        await logActivity('Task Started', { taskId: task._id, channelId, name: task.name });
        const count = await telegramService.downloadMediaForGroup(channelId, null, { taskId: task._id.toString() });
        itemsDownloaded += count;
        channelStats.push({ id: channelId, downloaded: count, failed: 0 });
        await logActivity('Task Completed', { taskId: task._id, channelId, name: task.name, downloadedCount: count });
      } catch (err) {
        hadError = true;
        lastErrorMessage = err.message;
        itemsFailed += 1;
        channelStats.push({ id: channelId, downloaded: 0, failed: 1, error: err.message });
        await logActivity('Task Failed', { taskId: task._id, channelId, error: err.message }, 'error');
        console.error(`Scheduled error for ${channelId}:`, err);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const status = hadError ? 'partial' : 'success';

  // Compute next-run.
  const nextRunAt = computeNextRunAt(task.cronExpression);

  const entry = {
    at: new Date(),
    status,
    durationMs,
    itemsDownloaded,
    itemsFailed,
    channels: channelStats,
    error: lastErrorMessage,
  };

  // Reload the task (it may have been updated externally) and persist.
  const fresh = await ScheduledTask.findById(task._id);
  if (fresh) {
    fresh.lastRunAt = new Date();
    fresh.lastDurationMs = durationMs;
    fresh.lastStatus = status;
    fresh.lastError = lastErrorMessage;
    fresh.nextRunAt = nextRunAt;
    fresh.runHistory.unshift(entry);
    if (fresh.runHistory.length > RUN_HISTORY_CAP) {
      fresh.runHistory = fresh.runHistory.slice(0, RUN_HISTORY_CAP);
    }
    await fresh.save();
  }
  return entry;
}

async function scheduleJob(task) {
  if (jobs[task._id]) {
    jobs[task._id].stop();
    delete jobs[task._id];
  }

  if (task.isActive) {
    jobs[task._id] = cron.schedule(task.cronExpression, () => {
      runTask(task).catch(err => console.error(`Task ${task.name} failed:`, err));
    });
    console.log(`Scheduled job ${task.name} with cron ${task.cronExpression}`);
  }

  // Always (re)compute nextRunAt so the UI can preview it.
  try {
    const fresh = await ScheduledTask.findById(task._id);
    if (fresh) {
      const next = computeNextRunAt(task.cronExpression);
      if (next) {
        fresh.nextRunAt = next;
        await fresh.save();
      }
    }
  } catch (e) { /* ignore */ }
}

async function initializeScheduler() {
  const tasks = await ScheduledTask.find({ isActive: true });
  for (const task of tasks) {
    scheduleJob(task);
  }
  console.log(`Initialized ${tasks.length} scheduled tasks.`);
}

const stopTask = (taskId) => {
  if (jobs[taskId]) {
    jobs[taskId].stop();
    delete jobs[taskId];
  }
};

module.exports = {
  initializeScheduler,
  scheduleJob,
  stopTask,
  jobs,
  runTask,
  computeNextRunAt,
};
