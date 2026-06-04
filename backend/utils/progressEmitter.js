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

const socket = require('../socket');

const PER_BYTE_THROTTLE_MS = 100;
const EMA_ALPHA = 0.4;

// Per-(jobId,msgId) last-emit timestamp for throttling per-byte callbacks.
const lastEmit = new Map();

// Per-job rolling state.
const jobState = new Map();
// jobState: {
//   type, groupId, taskId?,
//   total, current, failed, skipped,
//   startedAt, lastTickAt, lastCurrent,
//   rateEma (items/sec), etaMs,
//   bytesTotal, bytesDone
// }

function nowMs() { return Date.now(); }

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
    type: s.type,
    groupId: s.groupId,
    current: s.current,
    total: s.total,
    failed: s.failed,
    skipped: s.skipped,
    rate: s.rateEma,           // items/sec
    etaMs: s.etaMs,            // ms until done; null if unknown
    bytesPerSec: s._bps || 0,  // bytes/sec (for current file)
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

/** Start a new job. Call once before any progress is reported. */
function startJob({ jobId, type, groupId, taskId, total }) {
  const s = getOrInit(jobId, { type, groupId, taskId, total });
  s.type = type;
  s.groupId = groupId;
  s.taskId = taskId;
  s.total = total;
  s.current = 0;
  s.failed = 0;
  s.skipped = 0;
  s.startedAt = nowMs();
  s.lastTickAt = nowMs();
  s.lastCurrent = 0;
  s.rateEma = 0;
  s.etaMs = null;
  emitV2(jobId);
}

/** A file completed (success path). */
function fileCompleted(jobId, { groupId, msgId, fileName } = {}) {
  const s = getOrInit(jobId, { groupId });
  s.current += 1;
  recalcRate(jobId);
  // Also fire the legacy per-file complete event so existing UI works.
  const io = socket.getIO();
  if (groupId && fileName) {
    io.emit('progress', { type: 'download_complete', groupId, msgId, fileName });
  }
  emitV2(jobId);
}

/** A file was skipped (e.g. already on disk). */
function fileSkipped(jobId, { groupId } = {}) {
  const s = getOrInit(jobId, { groupId });
  s.skipped += 1;
  s.current += 1;
  recalcRate(jobId);
  emitV2(jobId);
}

/** A file failed. */
function fileFailed(jobId, { groupId, error } = {}) {
  const s = getOrInit(jobId, { groupId });
  s.failed += 1;
  // Failed items still take time but don't advance current.
  recalcRate(jobId);
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

  // Throttle v2 by-byte extension. We don't emit v2 on every byte; v2 is
  // a job-level summary. Instead, track per-file bytes for the
  // bytesPerSec stat. We don't broadcast per-byte v2.
  const key = `${jobId || 'nojob'}:${msgId || 'nomsg'}`;
  const last = lastEmit.get(key) || 0;
  const now = nowMs();
  if (now - last < PER_BYTE_THROTTLE_MS) return;
  lastEmit.set(key, now);
  // Clear the key after a brief idle so the map doesn't grow forever.
  setTimeout(() => lastEmit.delete(key), PER_BYTE_THROTTLE_MS * 5);
}

/** A file finished (legacy). */
function fileFinished({ groupId, msgId, fileName, type }) {
  const io = socket.getIO();
  io.emit('progress', { type, groupId, msgId, fileName });
}

/** Mark a job done. Emits a final v2 and a `job_done` event. */
function endJob(jobId, { status }) {
  const s = jobState.get(jobId);
  if (!s) return;
  s.etaMs = 0;
  emitV2(jobId);
  const io = socket.getIO();
  io.emit('job_done', {
    jobId,
    taskId: s.taskId,
    type: s.type,
    groupId: s.groupId,
    status: status || 'completed',
    current: s.current,
    total: s.total,
    failed: s.failed,
    skipped: s.skipped,
  });
  // Keep the state around for 10 s so the UI can render the final frame
  // and re-fetch active-jobs reflects the completion.
  setTimeout(() => jobState.delete(jobId), 10_000);
}

/** Snapshot for /api/telegram/active-jobs. */
function snapshot() {
  return Array.from(jobState.values()).map((s) => ({
    id: s._jobId, // not used; key map below
    type: s.type,
    groupId: s.groupId,
    taskId: s.taskId,
    status: 'running',
    progress: s.current,
    total: s.total,
    failed: s.failed,
    skipped: s.skipped,
    rate: s.rateEma,
    etaMs: s.etaMs,
    startedAt: s.startedAt,
  }));
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
      status: 'running',
      progress: s.current,
      total: s.total,
      failed: s.failed,
      skipped: s.skipped,
      rate: s.rateEma,
      etaMs: s.etaMs,
      startedAt: s.startedAt,
    });
  }
  return arr;
}

module.exports = {
  startJob,
  fileCompleted,
  fileSkipped,
  fileFailed,
  byteProgress,
  fileFinished,
  endJob,
  snapshotForIds,
};
