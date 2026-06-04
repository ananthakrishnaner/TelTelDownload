// progressEmitter.js
// One canonical socket emit layer for everything progress-related.
//
// Why a layer at all?
//   - The Telegram progressCallback can fire dozens of times per file.
//     Emitting raw on every callback makes the UI janky and floods the
//     Socket.IO channel. We throttle the *per-byte* events to one per
//     100 ms per (jobId, msgId) tuple.
//   - Per-file completion events and job-level events are NEVER throttled.
//   - We compute a rolling throughput (items/sec, EMA) and ETA (ms) once
//     per job, so the UI can render real numbers without doing math.
//
// The emitter fans out under TWO event names for backward compatibility:
//   - new canonical: `job_progress_v2`   ← preferred
//   - legacy:        `progress`         ← per-file / per-byte
//   - legacy:        `job_progress`     ← per-file count
// The legacy shapes are preserved so existing frontend code (Dashboard's
// per-channel pulse, etc.) keeps working.
//
// Source of truth: the jobState map below is THE authoritative state
// for all running jobs. telegramService.getActiveJobs() and stopJob()
// both read/write through this module — there is no separate
// `activeJobs` map elsewhere.

const socket = require('../socket');
let logActivity = null;
try { logActivity = require('./logger'); } catch (_) { /* optional */ }

const PER_BYTE_THROTTLE_MS = 100;
const EMA_ALPHA = 0.4;
const ETA_PERSIST_MS = 10_000;     // keep finished jobs around for the UI

// Per-(jobId,msgId) last-emit timestamp for throttling per-byte callbacks.
const lastEmit = new Map();

// Per-job rolling state.
const jobState = new Map();
// jobState: {
//   type, groupId, taskId?, taskName?,
//   total, current, failed, skipped,
//   status,             // 'running' | 'aborted' | 'completed' | 'failed'
//   startedAt, lastTickAt, lastCurrent,
//   rateEma (items/sec), etaMs,
//   bytesTotal, bytesDone,
//   currentFile: { msgId, fileName, type, bytesPerSec, percent } | null,
//   currentFiles: [..in-flight],       // one entry per concurrent download
//   _abortController,                  // optional AbortController
//   _completionHistory: [..last 5],    // {at, name, ok}
// }

function nowMs() { return Date.now(); }

/**
 * Maintain the in-flight file list for a job. The list is keyed by
 * msgId so byteProgress callbacks for the same file update in place
 * (no flicker in the UI). When a file completes/skipped/fails, the
 * matching entry is removed.
 */
function _upsertInFlight(s, info) {
  if (!s) return;
  if (!Array.isArray(s.currentFiles)) s.currentFiles = [];
  if (!info) return;
  const idx = s.currentFiles.findIndex((f) => f.msgId === info.msgId);
  const entry = {
    msgId: info.msgId,
    fileName: info.fileName,
    type: info.type,
    bytesPerSec: info.bytesPerSec || 0,
    percent: typeof info.percent === 'number' ? info.percent : 0,
    current: info.current,
    total: info.total,
    startedAt: info.startedAt || nowMs(),
  };
  if (idx >= 0) s.currentFiles[idx] = { ...s.currentFiles[idx], ...entry };
  else s.currentFiles.push(entry);
  // Keep `currentFile` set to the most-recently-touched entry so the
  // existing single-file UI (Dashboard pulse, simple progress row)
  // still works.
  s.currentFile = entry;
}

function _removeInFlight(s, msgId) {
  if (!s || !Array.isArray(s.currentFiles)) return;
  s.currentFiles = s.currentFiles.filter((f) => f.msgId !== msgId);
  s.currentFile = s.currentFiles[s.currentFiles.length - 1] || null;
}

function getOrInit(jobId, seed) {
  let s = jobState.get(jobId);
  if (!s) {
    s = {
      type: seed.type || 'unknown',
      groupId: seed.groupId || null,
      taskId: seed.taskId || null,
      total: seed.total || 0,
      current: 0,
      failed: 0,
      skipped: 0,
      startedAt: nowMs(),
      lastTickAt: nowMs(),
      lastCurrent: 0,
      rateEma: 0,
      etaMs: null,
      bytesTotal: 0,
      bytesDone: 0,
    };
    jobState.set(jobId, s);
  }
  return s;
}

function emitV2(jobId) {
  const s = jobState.get(jobId);
  if (!s) return;
  const io = socket.getIO();
  const payload = {
    jobId,
    taskId: s.taskId,
    taskName: s.taskName,
    type: s.type,
    groupId: s.groupId,
    current: s.current,
    total: s.total,
    failed: s.failed,
    skipped: s.skipped,
    rate: s.rateEma,           // items/sec
    etaMs: s.etaMs,            // ms until done; null if unknown
    bytesPerSec: s._bps || 0,  // bytes/sec (for current file)
    currentFile: s.currentFile || null,
    currentFiles: Array.isArray(s.currentFiles) ? s.currentFiles : [],
    startedAt: s.startedAt,
  };
  io.emit('job_progress_v2', payload);
  // Legacy alias for the per-file count.
  io.emit('job_progress', { jobId, groupId: s.groupId, progress: s.current, total: s.total });
}

function recalcRate(jobId) {
  const s = jobState.get(jobId);
  if (!s) return;
  const now = nowMs();
  const dt = (now - s.lastTickAt) / 1000;
  if (dt <= 0) return;
  const dCurrent = s.current - s.lastCurrent;
  if (dCurrent > 0) {
    const instant = dCurrent / dt;
    s.rateEma = s.rateEma === 0 ? instant : s.rateEma * (1 - EMA_ALPHA) + instant * EMA_ALPHA;
  }
  s.lastTickAt = now;
  s.lastCurrent = s.current;
  if (s.rateEma > 0 && s.total > s.current) {
    s.etaMs = Math.ceil((s.total - s.current) / s.rateEma * 1000);
  } else {
    s.etaMs = null;
  }
}

// --- Public API ---------------------------------------------------------

/** Start a new job. Call once before any progress is reported.
 *  `abortController` is optional but required if you want stopJob to
 *  actually cancel the in-flight work.
 */
function startJob({ jobId, type, groupId, taskId, taskName, total, abortController }) {
  const s = getOrInit(jobId, { type, groupId, taskId, total });
  s.type = type;
  s.groupId = groupId;
  s.taskId = taskId;
  s.taskName = taskName;
  s.total = total;
  s.current = 0;
  s.failed = 0;
  s.skipped = 0;
  s.status = 'running';
  s.startedAt = nowMs();
  s.lastTickAt = nowMs();
  s.lastCurrent = 0;
  s.rateEma = 0;
  s.etaMs = null;
  s._abortController = abortController || null;
  s.currentFile = null;
  s.currentFiles = [];
  s._log = [];     // activity log for this job (capped)
  emitV2(jobId);
}

/** Record an activity-log entry for a job (visible in ActiveJobs UI). */
function log(jobId, level, message, extra = null) {
  const s = jobState.get(jobId);
  if (!s) return;
  if (!s._log) s._log = [];
  s._log.push({ at: nowMs(), level, message, ...(extra || {}) });
  if (s._log.length > 200) s._log.splice(0, s._log.length - 200);
  // Also echo to the global activity log on the server.
  if (logActivity) {
    try { logActivity(level === 'error' ? 'Error' : 'Info', { jobId, ...(extra || {}), msg: message }, level === 'error' ? 'error' : 'info'); } catch (_) {}
  }
  // Fan out a live log event so the UI can append without re-fetching.
  const io = socket.getIO();
  if (io) io.emit('job_log', { jobId, at: nowMs(), level, message, ...(extra || {}) });
}

/** Mark the file currently in flight for the job — for UI "current" column.
 *  When concurrency > 1 (e.g. 2 simultaneous downloads), the in-flight
 *  list carries every active file so the UI can show per-file
 *  progress rows side by side. Removal from the in-flight list is
 *  handled by the fileCompleted/fileSkipped/fileFailed handlers
 *  (keyed by msgId).
 */
function setCurrentFile(jobId, info) {
  const s = jobState.get(jobId);
  if (!s) return;
  if (!info) return;
  _upsertInFlight(s, info);
}

/** Track rolling per-file bytes/sec. */
function noteBytes(jobId, msgId, deltaBytes) {
  const s = jobState.get(jobId);
  if (!s) return;
  s._bps = s._bps || 0;
  s._bps = s._bps * 0.7 + (deltaBytes || 0) * 0.3;
}

/** A file completed (success path). */
function fileCompleted(jobId, { groupId, msgId, fileName } = {}) {
  const s = getOrInit(jobId, { groupId });
  s.current += 1;
  _removeInFlight(s, msgId);
  recalcRate(jobId);
  // Also fire the legacy per-file complete event so existing UI works.
  const io = socket.getIO();
  if (groupId && fileName) {
    io.emit('progress', { type: 'download_complete', groupId, msgId, fileName });
  }
  emitV2(jobId);
}

/** A file was skipped (e.g. already on disk / duplicate). */
function fileSkipped(jobId, { groupId, reason, msgId, fileName, telegramLink } = {}) {
  const s = getOrInit(jobId, { groupId });
  s.skipped += 1;
  s.current += 1;
  _removeInFlight(s, msgId);
  recalcRate(jobId);
  // Log every skip with a reason so the user can see why a file was
  // skipped (duplicate, already on disk, etc.).
  if (reason) {
    const link = telegramLink ? ` (${telegramLink})` : '';
    log(jobId, 'info', `${reason}${fileName ? ` · ${fileName}` : ''}${link}`, {
      msgId, fileName, reason, telegramLink, kind: 'skip',
    });
  }
  emitV2(jobId);
}

/** A file failed. */
function fileFailed(jobId, { groupId, msgId, fileName, error } = {}) {
  const s = getOrInit(jobId, { groupId });
  s.failed += 1;
  // Failed items still take time but don't advance current.
  _removeInFlight(s, msgId);
  recalcRate(jobId);
  if (error) {
    log(jobId, 'error', `${error.message || error}${fileName ? ` · ${fileName}` : ''}`, {
      msgId, fileName, kind: 'fail',
    });
  }
  emitV2(jobId);
}

/** Per-byte progress for a single file. Throttled. */
function byteProgress({ jobId, groupId, msgId, fileName, type, current, total }) {
  const io = socket.getIO();
  // Per-byte legacy event — no throttle on the legacy channel; the new
  // v2 event is the one we throttle, but the legacy event is small and
  // used only by the per-channel pulse animation, which tolerates flood.
  if (!total || total <= 0) return;
  const percentage = Math.round((Number(current) / Number(total)) * 100);
  io.emit('progress', { type, groupId, msgId, fileName, progress: percentage });

  // Throttle the in-flight update. We update the per-file entry on the
  // job state (so the next v2 emit carries the new percent) and emit
  // a v2 every PER_BYTE_THROTTLE_MS so concurrent downloads show
  // per-file progress in the UI without flooding the socket.
  const key = `${jobId || 'nojob'}:${msgId || 'nomsg'}`;
  const last = lastEmit.get(key) || 0;
  const now = nowMs();
  const s = jobState.get(jobId);
  if (s) {
    _upsertInFlight(s, { jobId, msgId, fileName, type, current, total, percent: percentage });
  }
  if (now - last < PER_BYTE_THROTTLE_MS) return;
  lastEmit.set(key, now);
  // Clear the key after a brief idle so the map doesn't grow forever.
  setTimeout(() => lastEmit.delete(key), PER_BYTE_THROTTLE_MS * 5);
  if (s) emitV2(jobId);
}

/** A file finished (legacy). */
function fileFinished({ groupId, msgId, fileName, type }) {
  const io = socket.getIO();
  io.emit('progress', { type, groupId, msgId, fileName });
}

/** Mark a job done. Emits a final v2 and a `job_done` event. */
function endJob(jobId, { status } = {}) {
  const s = jobState.get(jobId);
  if (!s) return;
  s.status = status || (s.failed > 0 ? 'partial' : 'completed');
  s.etaMs = 0;
  s.currentFile = null;
  s.currentFiles = [];
  emitV2(jobId);
  const io = socket.getIO();
  io.emit('job_done', {
    jobId,
    taskId: s.taskId,
    type: s.type,
    groupId: s.groupId,
    status: s.status,
    current: s.current,
    total: s.total,
    failed: s.failed,
    skipped: s.skipped,
  });
  // Keep the state around for 10 s so the UI can render the final frame
  // and re-fetch active-jobs reflects the completion.
  setTimeout(() => jobState.delete(jobId), ETA_PERSIST_MS);
}

/** Request cancellation of a running job. Aborts the AbortController
 *  (which the download loop must be polling) and marks the state.
 *  Returns true if the job existed and was running, false otherwise.
 */
function stopJob(jobId, { reason } = {}) {
  const s = jobState.get(jobId);
  if (!s) return { ok: false, reason: 'not_found' };
  if (s.status !== 'running') return { ok: false, reason: `already_${s.status}`, state: s };
  s.status = 'aborted';
  s.currentFile = null;
  s.currentFiles = [];
  if (s._abortController) {
    try { s._abortController.abort(); } catch (_) {}
  }
  log(jobId, 'warning', `Job aborted${reason ? ` · ${reason}` : ''}`);
  emitV2(jobId);
  return { ok: true, state: s };
}

function getRaw(jobId) {
  return jobState.get(jobId) || null;
}

function snapshotForIds(ids = null) {
  const arr = [];
  for (const [jobId, s] of jobState.entries()) {
    if (ids && !ids.includes(jobId)) continue;
    arr.push({
      id: jobId,
      type: s.type,
      groupId: s.groupId,
      taskId: s.taskId,
      status: s.status,
      progress: s.current,
      total: s.total,
      failed: s.failed,
      skipped: s.skipped,
      rate: s.rateEma,
      etaMs: s.etaMs,
      startedAt: s.startedAt,
      currentFile: s.currentFile,
      currentFiles: Array.isArray(s.currentFiles) ? s.currentFiles : [],
      recentLog: (s._log || []).slice(-10),
    });
  }
  return arr;
}

function getLog(jobId, { sinceMs = 0, limit = 200 } = {}) {
  const s = jobState.get(jobId);
  if (!s) return [];
  const log = s._log || [];
  return log.filter((e) => !sinceMs || e.at > sinceMs).slice(-limit);
}

module.exports = {
  startJob,
  fileCompleted,
  fileSkipped,
  fileFailed,
  byteProgress,
  fileFinished,
  fileFinished,
  setCurrentFile,
  noteBytes,
  endJob,
  stopJob,
  snapshotForIds,
  getRaw,
  getLog,
  log,
};
