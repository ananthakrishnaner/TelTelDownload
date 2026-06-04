import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  FiActivity, FiRefreshCw, FiAlertTriangle, FiClock, FiCpu,
  FiLink, FiPause, FiXCircle, FiDownload, FiUpload,
  FiCheckCircle, FiZap, FiSlash,
} from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const SAMPLE_WINDOW = 30;   // throughput samples kept for the sparkline

function Sparkline({ data, width = 600, height = 40 }) {
  if (data.length < 2) {
    return (
      <div className="h-10 flex items-center text-xs text-slate-500 font-mono">
        awaiting telemetry…
      </div>
    );
  }
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="spark-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-route-jobs)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--color-route-jobs)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${height} ${points} ${width},${height}`} fill="url(#spark-grad)" />
      <polyline points={points} fill="none" stroke="var(--color-route-jobs)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function formatEta(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(n) {
  if (!n || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function relTime(ts) {
  if (!ts) return '—';
  const dt = Math.max(0, (Date.now() - ts) / 1000);
  if (dt < 60) return `${Math.round(dt)}s ago`;
  if (dt < 3600) return `${Math.round(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.round(dt / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

export default function ActiveJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [throughput, setThroughput] = useState([]);     // items/sec samples
  const [activityByJob, setActivityByJob] = useState({}); // jobId -> [log entries]
  const [completedJobs, setCompletedJobs] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());  // jobIds whose detail panel is open

  const socketRef = useRef(null);
  const seenJobIds = useRef(new Set());
  const lastTickRef = useRef({});  // jobId -> {progress, ts}

  // Fetch once and on demand
  const fetchJobs = useCallback(async () => {
    try {
      const res = await api.get('/telegram/active-jobs');
      const incoming = res.data.jobs || [];
      setJobs(incoming);
      incoming.forEach((j) => {
        if (!seenJobIds.current.has(j.id)) {
          seenJobIds.current.add(j.id);
          lastTickRef.current[j.id] = { progress: j.progress || 0, ts: Date.now() };
        }
      });
    } catch (err) {
      toast.error('Failed to load jobs', { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: pull jobs as soon as the component mounts, without
  // putting fetchJobs into a dep array (the lint rule wants to avoid
  // cascading renders from a setState in the effect body).
  useEffect(() => { fetchJobs(); /* eslint-disable-line react-hooks/set-state-in-effect */ }, []); // mount-only

  // Socket.IO wiring: job_progress_v2 is the canonical payload
  useEffect(() => {
    const sock = io(window.location.origin);
    socketRef.current = sock;

    sock.on('job_progress_v2', (p) => {
      if (!p) return;
      const now = Date.now();
      const last = lastTickRef.current[p.jobId] || { progress: 0, ts: now };
      const dtSec = Math.max(0.001, (now - last.ts) / 1000);
      const dProgress = Math.max(0, p.current - last.progress);
      const inst = dProgress / dtSec;
      lastTickRef.current[p.jobId] = { progress: p.current, ts: now };

      // Items/sec for the global sparkline.
      setThroughput((prev) => {
        const next = [...prev, Math.round(inst * 100) / 100];
        return next.slice(-SAMPLE_WINDOW);
      });

      // Merge into the per-job view. The server now sends real numbers.
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === p.jobId);
        const next = [...prev];
        const merged = {
          ...(idx >= 0 ? prev[idx] : {}),
          id: p.jobId,
          type: p.type || (idx >= 0 ? prev[idx].type : 'group_pull'),
          groupId: p.groupId,
          taskId: p.taskId,
          taskName: p.taskName || (idx >= 0 ? prev[idx].taskName : null),
          status: p.status || (idx >= 0 ? prev[idx].status : 'running'),
          progress: p.current,
          total: p.total,
          failed: p.failed,
          skipped: p.skipped,
          rate: p.rate,
          etaMs: p.etaMs,
          currentFile: p.currentFile,
          startedAt: p.startedAt,
        };
        if (idx >= 0) next[idx] = merged; else next.push(merged);
        return next;
      });
    });

    sock.on('job_log', (e) => {
      if (!e) return;
      setActivityByJob((prev) => {
        const arr = prev[e.jobId] ? [...prev[e.jobId]] : [];
        arr.push({ at: e.at, level: e.level, message: e.message, msgId: e.msgId, fileName: e.fileName, telegramLink: e.telegramLink, reason: e.reason });
        const capped = arr.slice(-50);
        return { ...prev, [e.jobId]: capped };
      });
    });

    sock.on('progress', (data) => {
      // Legacy per-file complete events. Mirror to the activity log.
      if (!data) return;
      if (data.type !== 'download_complete' && data.type !== 'upload_complete') return;
      const jobId = jobs.find((j) => j.groupId === data.groupId)?.id;
      if (!jobId) return;
      setActivityByJob((prev) => {
        const arr = prev[jobId] ? [...prev[jobId]] : [];
        arr.push({ at: Date.now(), level: 'info', message: `${data.type} · ${data.fileName || ''}` });
        return { ...prev, [jobId]: arr.slice(-50) };
      });
    });

    sock.on('job_done', (d) => {
      if (!d) return;
      const failed = d.failed || 0;
      const skipped = d.skipped || 0;
      const ok = (d.current || 0) - failed;
      const desc = `${ok.toLocaleString()} downloaded · ${failed} failed · ${skipped} skipped · ${d.total.toLocaleString()} total`;
      if (d.status === 'aborted') {
        toast.warning('Job stopped', { description: desc });
      } else if (failed > 0) {
        toast.warning(`Job finished with ${failed} failures`, { description: desc });
      } else {
        toast.success('Job complete', { description: desc });
      }
      setCompletedJobs((prev) => new Set(prev).add(d.jobId));
      setJobs((prev) => prev.filter((j) => j.id !== d.jobId));
    });

    return () => sock.disconnect();
    // jobs is referenced for legacy 'progress' groupId lookup only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completion sweep as a backup (handles case where the server drops
  // a job from the snapshot before the job_done event lands).
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await api.get('/telegram/active-jobs');
        const currentIds = new Set((res.data.jobs || []).map((j) => j.id));
        for (const jid of Array.from(seenJobIds.current)) {
          if (!currentIds.has(jid) && !completedJobs.has(jid)) {
            setCompletedJobs((prev) => new Set(prev).add(jid));
          }
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(id);
  }, [completedJobs]);

  const stopJob = async (id) => {
    try {
      await api.post(`/telegram/stop-job/${id}`);
      toast.warning('Stop requested', { description: id.slice(0, 8) });
    } catch (err) {
      toast.error('Stop failed', { description: err.message });
    }
  };

  // Kill All — stop every running job in one call. The backend
  // fires AbortController.abort() on each job, so the in-flight
  // download loops unwind on their own and emit job_done with
  // status: 'aborted', which we already listen for below.
  const killAll = async () => {
    if (jobs.length === 0) return;
    if (!window.confirm(`Kill all ${jobs.length} running job(s)? This cannot be undone.`)) return;
    try {
      const res = await api.post('/telegram/stop-all-jobs');
      const stopped = res.data?.jobIds?.length || 0;
      toast.warning(`Killed ${stopped} job(s)`);
    } catch (err) {
      toast.error('Kill All failed', { description: err.message });
    }
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const totals = useMemo(() => {
    return jobs.reduce(
      (acc, j) => ({
        queued: acc.queued + (j.total || 0),
        done: acc.done + (j.progress || 0),
        failed: acc.failed + (j.failed || 0),
        skipped: acc.skipped + (j.skipped || 0),
        rate: acc.rate + (j.rate || 0),
      }),
      { queued: 0, done: 0, failed: 0, skipped: 0, rate: 0 },
    );
  }, [jobs]);

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="Telemetry"
        title="Active Jobs"
        description="Real-time throughput, current files, and live activity log for every running transfer."
        accent="jobs"
        actions={
          <div className="flex items-center gap-2">
            {jobs.length > 0 && (
              <button
                onClick={killAll}
                className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 ring-1 ring-rose-500/30 rounded-md"
                title="Stop every running job"
              >
                <FiSlash size={12} />
                Kill All
              </button>
            )}
            <button
              onClick={fetchJobs}
              className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-slate-400 hover:text-slate-100 border border-[var(--color-hairline)] rounded-md"
            >
              <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {/* "Schedule started" banner — surfaces whenever one or more
       *  running jobs were kicked off by a scheduled task. The list
       *  inside deduplicates by taskId so a multi-channel schedule
       *  shows as a single "Schedule started · <name>" pill. */}
      {(() => {
        const scheduled = new Map();
        for (const j of jobs) {
          if (j.taskId) {
            if (!scheduled.has(j.taskId)) {
              scheduled.set(j.taskId, { taskId: j.taskId, taskName: j.taskName || 'Scheduled task', count: 0 });
            }
            scheduled.get(j.taskId).count += 1;
          }
        }
        if (scheduled.size === 0) return null;
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2 px-3 py-2 rounded-md bg-indigo-500/5 ring-1 ring-indigo-500/20">
            <FiCpu className="text-indigo-300" size={12} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-300">schedule started</span>
            {Array.from(scheduled.values()).map((s) => (
              <span key={s.taskId} className="text-[10px] font-mono text-indigo-200 bg-indigo-500/15 ring-1 ring-indigo-500/30 px-2 py-0.5 rounded">
                {s.taskName} <span className="text-indigo-400">·</span> {s.count} channel{s.count === 1 ? '' : 's'}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Throughput panel */}
      <section className="surface-1 rounded-lg p-5 mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Throughput · last {SAMPLE_WINDOW} samples (items/sec)
          </p>
          <p className="text-[10px] font-mono text-slate-500 tnum">
            {jobs.length} active · {totals.done.toLocaleString()} / {totals.queued.toLocaleString()} files
            {totals.failed > 0 && <span className="text-rose-400 ml-2">· {totals.failed} failed</span>}
            {totals.skipped > 0 && <span className="text-amber-400 ml-2">· {totals.skipped} skipped</span>}
          </p>
        </div>
        <Sparkline data={throughput} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4 pt-4 border-t border-[var(--color-hairline)]">
          <Stat icon={FiZap} label="Sum rate" value={totals.rate ? `${totals.rate.toFixed(2)}/s` : '—'} subtext={totals.rate ? `~ ${Math.round(totals.rate * 60)}/min` : ''} />
          <Stat icon={FiDownload} label="Done" value={totals.done.toLocaleString()} subtext={`of ${totals.queued.toLocaleString()}`} />
          <Stat icon={FiAlertTriangle} label="Failed" value={totals.failed.toLocaleString()} accent={totals.failed > 0 ? 'rose' : 'slate'} />
          <Stat icon={FiPause} label="Skipped" value={totals.skipped.toLocaleString()} accent={totals.skipped > 0 ? 'amber' : 'slate'} />
          <Stat icon={FiClock} label="ETA (sum)" value={formatEta(totals.rate > 0 ? ((totals.queued - totals.done) / totals.rate * 1000) : null)} />
        </div>
      </section>

      {/* Job cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={FiActivity}
          title="Telemetry nominal"
          description="No active jobs. Start a pull from a channel to see telemetry here."
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
            const isUpload = job.type === 'bulk_upload';
            const isOpen = expanded.has(job.id);
            const remaining = Math.max(0, (job.total || 0) - (job.progress || 0));
            const eta = job.etaMs != null ? job.etaMs : (job.rate > 0 ? (remaining / job.rate) * 1000 : null);
            const activity = activityByJob[job.id] || [];

            return (
              <div key={job.id} className="surface-1 rounded-lg p-5 relative overflow-hidden">
                {/* Top status row */}
                <div className="flex flex-col md:flex-row md:items-center gap-4 mb-3">
                  <div className="flex items-center gap-2 shrink-0">
                    {job.status === 'aborted' ? (
                      <FiXCircle className="text-rose-400" size={14} />
                    ) : isUpload ? (
                      <FiUpload className="text-emerald-400" size={14} />
                    ) : (
                      <FiDownload className="text-sky-400" size={14} />
                    )}
                    <span className={`text-[10px] font-mono uppercase tracking-widest ${
                      job.status === 'aborted' ? 'text-rose-400'
                        : isUpload ? 'text-emerald-400' : 'text-sky-400'
                    }`}>
                      {job.status === 'aborted' ? 'Aborted'
                        : isUpload ? 'Uploading' : 'Downloading'}
                    </span>
                    {job.status === 'running' && (
                      <span className="relative flex h-1.5 w-1.5 ml-1">
                        <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${isUpload ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isUpload ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-mono text-xs text-slate-500">grp:{job.groupId}</span>
                      <span className="text-xs text-slate-500 font-mono">job:{job.id.slice(0, 8)}</span>
                      {job.taskId && (
                        <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/10 ring-1 ring-indigo-500/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1" title="This job was started by a scheduled task">
                          <FiCpu size={9} /> schedule started
                          {job.taskName && (
                            <span className="text-indigo-200 ml-1">· {job.taskName}</span>
                          )}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                      started {new Date(job.startedAt).toLocaleTimeString()} ·
                      {' '}elapsed {relTime(job.startedAt)}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-display text-3xl font-light text-slate-100 tnum leading-none">
                      {pct}<span className="text-lg text-slate-500">%</span>
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full transition-all duration-500 ${
                      job.status === 'aborted'
                        ? 'bg-rose-500/60'
                        : isUpload
                          ? 'bg-gradient-to-r from-emerald-500 to-sky-500'
                          : 'bg-gradient-to-r from-sky-500 to-indigo-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[10px] font-mono text-slate-400 tnum">
                  <Mini label="Files"      value={`${job.progress.toLocaleString()} / ${job.total.toLocaleString()}`} />
                  <Mini label="ETA"        value={formatEta(eta)} />
                  <Mini label="Rate"       value={job.rate ? `${job.rate.toFixed(2)}/s` : '—'} sub={job.rate ? `~ ${Math.round(job.rate * 60)}/min` : ''} />
                  <Mini label="Failed"     value={job.failed || 0}           accent={(job.failed || 0) > 0 ? 'rose' : 'slate'} />
                  <Mini label="Skipped"    value={job.skipped || 0}          accent={(job.skipped || 0) > 0 ? 'amber' : 'slate'} />
                  <Mini label="Remaining"  value={remaining.toLocaleString()} />
                </div>

                {/* Current file */}
                {job.currentFile && job.status === 'running' && (
                  <div className="mt-3 px-3 py-2 rounded bg-white/[0.03] border border-[var(--color-hairline)] flex items-center gap-3">
                    <FiActivity className="text-sky-400 animate-pulse" size={12} />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">now</span>
                    <span className="text-xs font-mono text-slate-200 truncate flex-1 min-w-0">
                      {job.currentFile.fileName || `msg ${job.currentFile.msgId}`}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 tnum">
                      {formatBytes(job.currentFile.bytesPerSec)}/s
                    </span>
                  </div>
                )}

                {/* Action row */}
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleExpand(job.id)}
                      className="text-[10px] font-mono uppercase tracking-widest text-slate-400 hover:text-slate-100 transition-colors"
                    >
                      {isOpen ? '[ hide activity ]' : `[ show activity · ${activity.length} ]`}
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.status === 'running' && (
                      <button
                        onClick={() => stopJob(job.id)}
                        className="text-[10px] font-mono uppercase tracking-widest text-rose-400 hover:text-rose-300 transition-colors inline-flex items-center gap-1"
                      >
                        <FiXCircle size={11} /> stop
                      </button>
                    )}
                    {job.status === 'aborted' && (
                      <span className="text-[10px] font-mono uppercase tracking-widest text-rose-400 inline-flex items-center gap-1">
                        <FiPause size={11} /> aborted
                      </span>
                    )}
                  </div>
                </div>

                {/* Activity panel (expandable) */}
                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-hairline)]">
                    <ActivityLog entries={activity} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Past jobs (JobHistory) — last 50 finished/aborted jobs.
       * Pulled from GET /telegram/job-history on mount + every 30s. */}
      <PastJobs />
    </div>
  );
}

function PastJobs() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await api.get('/telegram/job-history');
      setHistory(res.data.history || []);
    } catch (err) {
      // soft-fail — the page still works without history
      console.error('Failed to load job history', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory(); /* eslint-disable-line react-hooks/set-state-in-effect */
    const id = setInterval(fetchHistory, 30_000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  if (loading && history.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">
          Past Jobs
        </h2>
        <Skeleton className="h-20 w-full" />
      </section>
    );
  }
  if (history.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">
          Past Jobs
        </h2>
        <p className="text-xs text-slate-500 font-mono">No completed jobs yet.</p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
          Past Jobs · {history.length} most recent
        </h2>
        <p className="text-[10px] font-mono text-slate-500">refreshes every 30s</p>
      </div>
      <div className="surface-1 rounded-lg overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-white/[0.02] text-slate-500 text-[10px] uppercase tracking-widest">
            <tr>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Group</th>
              <th className="text-right px-3 py-2">Progress</th>
              <th className="text-right px-3 py-2">Failed</th>
              <th className="text-right px-3 py-2">Skipped</th>
              <th className="text-right px-3 py-2">Started</th>
              <th className="text-right px-3 py-2">Duration</th>
              <th className="text-left px-3 py-2">Job ID</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.jobId} className="border-t border-[var(--color-hairline)] hover:bg-white/[0.02]">
                <td className="px-3 py-2">
                  <span className={statusColor(h.status)}>{statusLabel(h.status)}</span>
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {h.type === 'bulk_upload' ? 'Upload' : 'Download'}
                </td>
                <td className="px-3 py-2 text-slate-400">{h.groupId || '—'}</td>
                <td className="px-3 py-2 text-right text-slate-200 tnum">
                  {(h.progress || 0).toLocaleString()} / {(h.total || 0).toLocaleString()}
                </td>
                <td className={`px-3 py-2 text-right tnum ${(h.failed || 0) > 0 ? 'text-rose-300' : 'text-slate-500'}`}>
                  {h.failed || 0}
                </td>
                <td className={`px-3 py-2 text-right tnum ${(h.skipped || 0) > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                  {h.skipped || 0}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {h.startedAt ? new Date(h.startedAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400 tnum">
                  {h.startedAt && h.completedAt
                    ? formatDuration(h.completedAt - h.startedAt)
                    : '—'}
                </td>
                <td className="px-3 py-2 text-slate-500">{h.jobId?.slice(0, 8) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function statusLabel(s) {
  if (s === 'completed') return '✓ done';
  if (s === 'aborted')   return '■ stopped';
  if (s === 'partial')   return '! partial';
  return s || '—';
}
function statusColor(s) {
  if (s === 'completed') return 'text-emerald-300';
  if (s === 'aborted')   return 'text-rose-300';
  if (s === 'partial')   return 'text-amber-300';
  return 'text-slate-400';
}
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function ActivityLog({ entries }) {
  if (entries.length === 0) {
    return (
      <p className="text-[10px] font-mono text-slate-500 py-2">
        no activity yet — events appear here as the job runs
      </p>
    );
  }
  return (
    <div className="max-h-72 overflow-y-auto rounded bg-black/30 ring-1 ring-[var(--color-hairline)]">
      {entries.slice().reverse().map((e, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 px-3 py-1.5 text-[11px] font-mono border-b border-[var(--color-hairline)] last:border-b-0 ${
            e.level === 'error' ? 'text-rose-300' :
            e.level === 'warning' ? 'text-amber-300' :
            'text-slate-300'
          }`}
        >
          <span className="text-slate-500 shrink-0 w-16 tnum">{new Date(e.at).toLocaleTimeString()}</span>
          {e.level === 'error' ? <FiAlertTriangle size={11} className="shrink-0 mt-0.5" />
            : e.level === 'warning' ? <FiAlertTriangle size={11} className="shrink-0 mt-0.5" />
            : <FiCheckCircle size={11} className="shrink-0 mt-0.5 text-slate-500" />}
          <span className="flex-1 break-all min-w-0">{e.message}</span>
          {e.telegramLink && (
            <a
              href={e.telegramLink}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-sky-400 hover:text-sky-200 inline-flex items-center gap-1"
            >
              <FiLink size={10} /> open
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, label, value, subtext, accent = 'slate' }) {
  const color = {
    slate: 'text-slate-100',
    rose: 'text-rose-300',
    emerald: 'text-emerald-300',
    sky: 'text-sky-300',
    amber: 'text-amber-300',
  }[accent] || 'text-slate-100';
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 inline-flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </p>
      <p className={`text-2xl font-display font-light tnum mt-0.5 ${color}`}>{value}</p>
      {subtext && <p className="text-[10px] font-mono text-slate-500 mt-0.5">{subtext}</p>}
    </div>
  );
}

function Mini({ label, value, sub, accent = 'slate' }) {
  const color = {
    slate: 'text-slate-100',
    rose: 'text-rose-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
  }[accent];
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`text-sm font-mono tnum mt-0.5 ${color || 'text-slate-200'}`}>{value}</p>
      {sub && <p className="text-[9px] font-mono text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
