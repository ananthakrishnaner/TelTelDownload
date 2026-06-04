import { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import { FiActivity, FiRefreshCw } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

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

export default function ActiveJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [throughput, setThroughput] = useState([]); // last N samples
  const socketRef = useRef(null);
  const sampleBufRef = useRef([]);

  async function fetchJobs() {
    try {
      setLoading(true);
      const res = await api.get('/telegram/active-jobs');
      setJobs(res.data.jobs || []);
    } catch (err) {
      toast.error('Failed to load jobs', { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs();
    socketRef.current = io(window.location.origin);
    socketRef.current.on('job_progress', (data) => {
      setJobs((prev) => prev.map((j) => j.id === data.jobId ? { ...j, progress: data.progress, total: data.total } : j));

      // Sample throughput (sum of progress deltas)
      sampleBufRef.current.push(data.progress);
      if (sampleBufRef.current.length > 30) sampleBufRef.current.shift();
      setThroughput([...sampleBufRef.current]);
    });
    socketRef.current.on('progress', (data) => {
      sampleBufRef.current.push(data.progress || 0);
      if (sampleBufRef.current.length > 30) sampleBufRef.current.shift();
      setThroughput([...sampleBufRef.current]);
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

  const eta = useMemo(() => {
    return jobs.map((j) => {
      if (!j.total || j.progress === 0) return { id: j.id, eta: '—' };
      const remaining = j.total - j.progress;
      return { id: j.id, eta: `${remaining} left` };
    });
  }, [jobs]);

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
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Throughput · last 30 samples</p>
          <p className="text-[10px] font-mono text-slate-500 tnum">
            {jobs.length} active · {jobs.reduce((a, j) => a + (j.total || 0), 0).toLocaleString()} files queued
          </p>
        </div>
        <Sparkline data={throughput} />
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
            const etaStr = eta.find((e) => e.id === job.id)?.eta || '—';
            return (
              <div key={job.id} className="surface-1 rounded-lg p-5 relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center gap-4 mb-3">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
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

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 tnum">
                  <span>{job.progress.toLocaleString()} / {job.total.toLocaleString()} files</span>
                  <span>eta: {etaStr}</span>
                  <span>started {new Date(job.startedAt).toLocaleTimeString()}</span>
                  <button
                    onClick={() => stopJob(job.id)}
                    className="text-rose-400 hover:text-rose-300 transition-colors uppercase tracking-widest"
                  >
                    [ stop ]
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
