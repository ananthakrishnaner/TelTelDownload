const ScheduledTask = require('../models/ScheduledTask');
const schedulerService = require('../services/schedulerService');

/** Validate a scheduled-task create/update body. */
function validateBody(body) {
  const { name, runAt, recurrence, timezone, targetChannels, isActive } = body || {};
  const errors = [];
  if (!name || typeof name !== 'string') errors.push('name is required');
  if (!runAt) errors.push('runAt is required (ISO 8601 datetime in UTC)');
  else {
    const t = new Date(runAt);
    if (Number.isNaN(t.getTime())) errors.push('runAt must be a valid ISO 8601 datetime');
  }
  if (recurrence && !['none', 'daily', 'weekly', 'monthly'].includes(recurrence)) {
    errors.push("recurrence must be one of 'none' | 'daily' | 'weekly' | 'monthly'");
  }
  if (targetChannels && !Array.isArray(targetChannels)) {
    errors.push('targetChannels must be an array of channelId strings');
  }
  return { errors, fields: { name, runAt, recurrence, timezone, targetChannels, isActive } };
}

exports.getTasks = async (req, res) => {
  try {
    const tasks = await ScheduledTask.find().sort({ nextRunAt: 1, createdAt: -1 });
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const { errors, fields } = validateBody(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const task = await ScheduledTask.create({
      name: fields.name,
      runAt: new Date(fields.runAt),
      recurrence: fields.recurrence || 'none',
      timezone: fields.timezone || 'UTC',
      targetChannels: fields.targetChannels || [],
      isActive: fields.isActive !== false,
      nextRunAt: new Date(fields.runAt),
    });
    schedulerService.scheduleJob(task);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { errors, fields } = validateBody(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const task = await ScheduledTask.findByIdAndUpdate(
      id,
      {
        name: fields.name,
        runAt: new Date(fields.runAt),
        recurrence: fields.recurrence || 'none',
        timezone: fields.timezone || 'UTC',
        targetChannels: fields.targetChannels || [],
        isActive: fields.isActive !== false,
        nextRunAt: new Date(fields.runAt),
      },
      { new: true },
    );
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
    // The new service uses { timer } (not cron jobs) — call stopTask
    // to clear any in-memory timer. (Older code called .stop() which
    // doesn't exist on a plain timer object.)
    schedulerService.stopTask(id);
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTaskRuns = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await ScheduledTask.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // For recurring tasks, project the next 5 runs from the stored
    // runAt + recurrence so the UI can preview "coming up".
    const nextRuns = [];
    if (task.recurrence && task.recurrence !== 'none') {
      let cursor = new Date(task.runAt);
      const step = (d) => {
        switch (task.recurrence) {
          case 'daily':   return new Date(d.getTime() + 24 * 3600_000);
          case 'weekly':  return new Date(d.getTime() + 7 * 24 * 3600_000);
          case 'monthly': {
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth();
            const day = d.getUTCDate();
            const targetYear = m === 11 ? y + 1 : y;
            const targetMonth = (m + 1) % 12;
            const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
            return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, daysInTarget), d.getUTCHours(), d.getUTCMinutes()));
          }
          default: return d;
        }
      };
      // Walk forward; cap at 5 future entries.
      for (let i = 0; i < 5; i += 1) {
        cursor = step(cursor);
        if (cursor.getTime() <= Date.now()) continue;
        nextRuns.push(cursor.toISOString());
      }
    }

    res.json({
      success: true,
      task: {
        id: task._id,
        name: task.name,
        runAt: task.runAt,
        recurrence: task.recurrence,
        timezone: task.timezone,
        targetChannels: task.targetChannels,
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

/** Manual "Run now" — schedules an immediate runTask and returns.
 *  Used by the UI's "Run now" button on a scheduled-task row.
 */
exports.runNow = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await ScheduledTask.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    schedulerService.runTask(task)
      .then(() => console.log(`[scheduler] Manual run of ${task.name} finished`))
      .catch((err) => console.error(`[scheduler] Manual run of ${task.name} failed:`, err));
    res.json({ success: true, message: `Task "${task.name}" started` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
