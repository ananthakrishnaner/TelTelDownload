const ScheduledTask = require('../models/ScheduledTask');
const telegramService = require('./telegramService');
const logActivity = require('../utils/logger');

// In-memory map of taskId -> { timer, scheduledFor }. We use setTimeout
// instead of node-cron so the user-supplied schedule is a literal
// "run at this date/time" rather than a cron expression.
const jobs = {};
const RUN_HISTORY_CAP = 50;

/** Compute the next run time for a task.
 *  - recurrence 'none'  -> null (task should auto-disable after firing)
 *  - recurrence 'daily'  -> runAt + 1 day
 *  - recurrence 'weekly' -> runAt + 7 days
 *  - recurrence 'monthly'-> runAt + 1 month (handles month-end edge cases)
 *  Always returns a Date strictly in the future, otherwise null.
 */
function computeNextRunAt(task, fromDate = new Date()) {
  if (task.recurrence === 'none' || !task.recurrence) return null;
  const base = new Date(task.runAt);
  let next;
  switch (task.recurrence) {
    case 'daily':   next = new Date(base.getTime() + 24 * 3600_000); break;
    case 'weekly':  next = new Date(base.getTime() + 7 * 24 * 3600_000); break;
    case 'monthly': {
      // Move the day-of-month forward by 1, clamping to the new month's
      // last day so a Jan 31 run doesn't become Feb 31 (which is invalid).
      const y = base.getUTCFullYear();
      const m = base.getUTCMonth();
      const d = base.getUTCDate();
      const targetYear = m === 11 ? y + 1 : y;
      const targetMonth = (m + 1) % 12;
      const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const day = Math.min(d, daysInTarget);
      next = new Date(Date.UTC(targetYear, targetMonth, day, base.getUTCHours(), base.getUTCMinutes()));
      break;
    }
    default: return null;
  }
  return next > fromDate ? next : null;
}

async function runTask(task) {
  const startedAt = Date.now();
  console.log(`[scheduler] Running task: ${task.name}`);
  let itemsDownloaded = 0;
  let itemsFailed = 0;
  const channelStats = [];
  let hadError = false;
  let lastErrorMessage = null;

  if (task.targetChannels && task.targetChannels.length > 0) {
    for (const channelId of task.targetChannels) {
      try {
        await logActivity('Task Started', { taskId: task._id, channelId, name: task.name });
        // Thread the task name + id into the job so ActiveJobs can
        // display "schedule started · <name>" instead of just an
        // opaque jobId.
        const count = await telegramService.downloadMediaForGroup(
          channelId,
          null,
          {
            taskId: task._id.toString(),
            taskName: task.name,
          },
        );
        itemsDownloaded += count;
        channelStats.push({ id: channelId, downloaded: count, failed: 0 });
        await logActivity('Task Completed', { taskId: task._id, channelId, name: task.name, downloadedCount: count });
      } catch (err) {
        hadError = true;
        lastErrorMessage = err.message;
        itemsFailed += 1;
        channelStats.push({ id: channelId, downloaded: 0, failed: 1, error: err.message });
        await logActivity('Task Failed', { taskId: task._id, channelId, error: err.message }, 'error');
        console.error(`[scheduler] Error in ${task.name} for ${channelId}:`, err);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const status = hadError ? 'partial' : 'success';

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
    fresh.runHistory.unshift(entry);
    if (fresh.runHistory.length > RUN_HISTORY_CAP) {
      fresh.runHistory = fresh.runHistory.slice(0, RUN_HISTORY_CAP);
    }

    // Decide what to do next:
    //   - one-shot tasks auto-disable so they don't fire again
    //   - recurring tasks get their runAt bumped forward and the
    //     timer is re-armed
    if (fresh.recurrence === 'none') {
      fresh.isActive = false;
      fresh.nextRunAt = null;
    } else {
      const next = computeNextRunAt(fresh);
      if (next) {
        fresh.runAt = next;
        fresh.nextRunAt = next;
      } else {
        // Recurrence can no longer produce a future date — disable.
        fresh.isActive = false;
        fresh.nextRunAt = null;
      }
    }
    await fresh.save();

    // Re-arm (or stop) the in-memory timer based on the new state.
    if (fresh.isActive) {
      armTimer(fresh);
    } else {
      cancelTimer(task._id);
    }
  }
  return entry;
}

/** Arm a setTimeout that fires runTask(task) at the scheduled time.
 *  Cancellable via cancelTimer(taskId). The timer reference is
 *  stored in jobs[taskId] = { timer, scheduledFor }.
 */
function armTimer(task) {
  cancelTimer(task._id);
  const ms = task.runAt.getTime() - Date.now();
  if (ms <= 0) {
    // Past-due tasks fire immediately. (e.g. server was down at the
    // scheduled time, or the user set a one-shot for a few minutes
    // ago.) We still record it as a run.
    runTask(task).catch((e) => console.error(`[scheduler] Past-due run failed for ${task.name}:`, e));
    return;
  }
  const timer = setTimeout(() => {
    runTask(task).catch((e) => console.error(`[scheduler] Scheduled run failed for ${task.name}:`, e));
  }, ms);
  // Don't keep the event loop alive just for the timer.
  if (timer && typeof timer.unref === 'function') timer.unref();
  jobs[task._id] = { timer, scheduledFor: task.runAt };
  console.log(`[scheduler] Armed ${task.name} for ${task.runAt.toISOString()} (in ${Math.round(ms / 1000)}s)`);
}

function cancelTimer(taskId) {
  if (jobs[taskId]) {
    clearTimeout(jobs[taskId].timer);
    delete jobs[taskId];
  }
}

async function scheduleJob(task) {
  cancelTimer(task._id);
  if (task.isActive && task.runAt) {
    armTimer(task);
  }
  // Update nextRunAt so the UI can show it.
  try {
    const fresh = await ScheduledTask.findById(task._id);
    if (fresh) {
      fresh.nextRunAt = fresh.isActive ? fresh.runAt : null;
      await fresh.save();
    }
  } catch (e) { /* ignore */ }
}

async function initializeScheduler() {
  const tasks = await ScheduledTask.find({ isActive: true });
  for (const task of tasks) {
    scheduleJob(task);
  }
  console.log(`[scheduler] Initialized ${tasks.length} active tasks.`);
}

const stopTask = (taskId) => {
  cancelTimer(taskId);
};

module.exports = {
  initializeScheduler,
  scheduleJob,
  stopTask,
  jobs,
  runTask,
  computeNextRunAt,
};
