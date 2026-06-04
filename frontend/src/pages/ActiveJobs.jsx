import { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import { FiActivity, FiRefreshCw, FiAlertTriangle } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const EMA_ALPHA = 0.3;     // smoothing for throughput EMA (0..1, higher = more reactive)
const SAMPLE_WINDOW = 30;  // throughput samples kept for the sparkline

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

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function ActiveJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [throughput, setThroughput] = useState([]); // last N samples (files/sec EMA)
  const [failedByJob, setFailedByJob] = useState({}); // jobId -> {count, names}
  const [completedJobs, setCompletedJobs] = useState(new Set());

  const socketRef = useRef(null);
  const [ema, setEma] = useState(0);         // current throughput EMA (files/sec)
  const lastTickRef = useRef({});            // jobId -> {progress, ts}
  const seenJobIds = useRef(new Set());

  async function fetchJobs() {
    try {
      setLoading(true);
      const res = await api.get('/telegram/active-jobs');
      const incoming = res.data.jobs || [];
      setJobs(incoming);

      // First-time seen → seed.
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
  }

  // Periodic "completion toast" sweep: detect jobs that disappeared.
  useEffect(() => {
    const id = setInterval(() => {
      // detect job completion by checking if a previously-seen job
      // is no longer in `jobs`. To know which jobs are now missing,
      // we compare current server response to last seen.
      api.get('/telegram/active-jobs')
        .then((res) => {
          const currentIds = new Set((res.data.jobs || []).map((j) => j.id));
          // For each job that was in `seenJobIds` but isn't in current,
          // emit a completion toast — once.
          for (const jid of Array.from(seenJobIds.current)) {
            if (!currentIds.has(jid) && !completedJobs.has(jid)) {
              const completed = new Set(completedJobs);
              completed.add(jid);
              setCompletedJobs(completed);
              const j = jobs.find((x) => x.id === jid);
              const failed = failedByJob[jid]?.count || 0;
              const ok = j ? (j.progress - failed) : 0;
              const desc = j
                ? `${ok.toLocaleString()} downloaded · ${failed} failed · ${j.total.toLocaleString()} total`
                : '';
              if (failed > 0) {
                toast.warning(`Job finished with ${failed} failures`, { description: desc });
              } else {
                toast.success('Job complete', { description: desc });
              }
            }
          }
        })
        .catch(() => { /* ignore */ });
    }, 3000);
    return () => clearInterval(id);
  }, [jobs, completedJobs, failedByJob]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs();
    socketRef.current = io(window.location.origin);

    socketRef.current.on('job_progress', (data) => {
      if (!data) return;
      const { jobId, progress, total, failed, failedName, paused, done } = data;
      const now = Date.now();
      const last = lastTickRef.current[jobId] || { progress, ts: now };
      const dtSec = Math.max(0.001, (now - last.ts) / 1000);
      const dProgress = Math.max(0, progress - last.progress);
      // Instantaneous files/sec for this tick.
      const inst = dProgress / dtSec;
      // Update EMA (files/sec) via state so renders see the latest value.
      setEma((prevEma) => (prevEma === 0 ? inst : (EMA_ALPHA * inst + (1 - EMA_ALPHA) * prevEma)));

      // Sample for sparkline (rounded to 2 decimals).
      setThroughput((prev) => {
        const next = [...prev, Math.round(inst * 100) / 100];
        return next.slice(-SAMPLE_WINDOW);
      });

      lastTickRef.current[jobId] = { progress, ts: now };
      setJobs((prev) => prev.map((j) => j.id === jobId
        ? { ...j, progress, total: total ?? j.total, paused: paused ?? j.paused, done: done ?? j.done }
        : j));

      if (failed) {
        setFailedByJob((prev) => {
          const cur = prev[jobId] || { count: 0, names: [] };
          return {
            ...prev,
            [jobId]: {
              count: cur.count + (failed || 0),
              names: failedName ? [...cur.names, failedName].slice(-5) : cur.names,
            },
          };
        });
      }
    });

    socketRef.current.on('progress', (data) => {
      // Bulk progress events from progressEmitter.
      if (!data) return;
      if (typeof data.progress !== 'number') return;
      setThroughput((prev) => {
        const next = [...prev, data.progress];
        return next.slice(-SAMPLE_WINDOW);
      });
    });

    return () => socketRef.current?.disconnect();
  }, []);

  const stopJob = async (id) => {
    try {
      await api.post(`/telegram/stop-job/${id}`);
      toast.warning('Job stopped', { description: id.slice(0, 8) });
      fetchJobs();
    } catch (err) {
      toast.error('Stop failed', { description: err.message });
    }
  };

  // Real ETA = remaining / EMA(files/sec).
  const computed = useMemo(() => {
    return jobs.map((j) => {
      const remaining = Math.max(0, (j.total || 0) - (j.progress || 0));
      const rate = Math.max(0.001, ema);
      const etaSec = remaining / rate;
      return {
        id: j.id,
        eta: j.progress === 0 ? '—' : formatEta(etaSec),
        etaSec,
        remaining,
        ratePerSec: rate,
        ratePerMin: rate * 60,
      };
    });
  }, [jobs, ema]);

  const totalQueued = jobs.reduce((a, j) => a + (j.total || 0), 0);
  const totalDone = jobs.reduce((a, j) => a + (j.progress || 0), 0);
  const totalFailed = Object.values(failedByJob).reduce((a, x) => a + x.count, 0);

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="Telemetry"
        title="Active Jobs"
        description="Real-time throughput and control for all running transfers."
        accent="jobs"
        actions={
          <button
            onClick={fetchJobs}
            className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-slate-400 hover:text-slate-100 border border-[var(--color-hairline)] rounded-md"
          >
            <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {/* Throughput panel */}
      <section className="surface-1 rounded-lg p-5 mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Throughput · last {SAMPLE_WINDOW} samples
          </p>
          <p className="text-[10px] font-mono text-slate-500 tnum">
            {jobs.length} active · {totalDone.toLocaleString()} / {totalQueued.toLocaleString()} files
            {totalFailed > 0 && <span className="text-rose-400 ml-2">· {totalFailed} failed</span>}
          </p>
        </div>
        <Sparkline data={throughput} />
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[var(--color-hairline)]">
          <Stat label="EMA rate" value={ema ? `${ema.toFixed(2)}/s` : '—'} subtext={ema ? `~ ${formatEta(60 / Math.max(0.001, ema))} for 60 files` : ''} />
          <Stat label="Per minute" value={ema ? `~ ${Math.round(ema * 60).toLocaleString()}` : '—'} subtext="smoothed" />
          <Stat label="Total failed" value={totalFailed.toLocaleString()} subtext="across all jobs" accent={totalFailed > 0 ? 'rose' : 'slate'} />
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
            const meta = computed.find((c) => c.id === job.id) || {};
            const failed = failedByJob[job.id] || { count: 0, names: [] };
            return (
              <div key={job.id} className="surface-1 rounded-lg p-5 relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center gap-4 mb-3">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="relative flex h-2 w-2">
                      <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${isUpload ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                      <span className={`relative inline-flex h-2 w-2 rounded-full ${isUpload ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                    </span>
                    <span className={`text-[10px] font-mono uppercase tracking-widest ${isUpload ? 'text-emerald-400' : 'text-sky-400'}`}>
                      {isUpload ? 'Uploading' : 'Downloading'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">
                      <span className="font-mono text-xs text-slate-500 mr-2">grp:{job.groupId}</span>
                      <span className="text-xs text-slate-500 font-mono">job:{job.id.slice(0, 8)}</span>
                    </p>
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {meta.ratePerSec ? `${meta.ratePerSec.toFixed(2)}/s` : '—'} · {meta.ratePerMin ? `~${Math.round(meta.ratePerMin)}/min` : '—'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-display text-3xl font-light text-slate-100 tnum leading-none">
                      {pct}<span className="text-lg text-slate-500">%</span>
                    </p>
                  </div>
                </div>

                <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full transition-all duration-500 bg-gradient-to-r ${isUpload ? 'from-emerald-500 to-sky-500' : 'from-sky-500 to-indigo-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500 tnum">
                  <span>{job.progress.toLocaleString()} / {job.total.toLocaleString()} files</span>
                  <span>eta: {meta.eta || '—'}</span>
                  <span>started {new Date(job.startedAt).toLocaleTimeString()}</span>
                  <button
                    onClick={() => stopJob(job.id)}
                    className="text-rose-400 hover:text-rose-300 transition-colors uppercase tracking-widest"
                  >
                    [ stop ]
                  </button>
                </div>

                {/* Failed chips */}
                {failed.count > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-hairline)] flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-rose-400">
                      <FiAlertTriangle size={10} /> {failed.count} failed
                    </span>
                    {failed.names.map((n, i) => (
                      <span key={i} className="text-[10px] font-mono text-rose-300/80 bg-rose-500/10 ring-1 ring-rose-500/20 px-1.5 py-0.5 rounded">
                        {n}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, subtext, accent = 'slate' }) {
  const color = {
    slate: 'text-slate-100',
    rose: 'text-rose-300',
    emerald: 'text-emerald-300',
    sky: 'text-sky-300',
  }[accent] || 'text-slate-100';
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`text-2xl font-display font-light tnum mt-0.5 ${color}`}>{value}</p>
      {subtext && <p className="text-[10px] font-mono text-slate-500 mt-0.5">{subtext}</p>}
    </div>
  );
}
