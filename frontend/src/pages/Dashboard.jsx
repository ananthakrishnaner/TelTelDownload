import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  FiSearch, FiDownload, FiClock, FiImage, FiRefreshCw, FiArrowRight,
} from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import StatStrip from '../components/StatStrip';
import Drawer from '../components/Drawer';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import ConfirmDrawer from '../components/ConfirmDrawer';
import SessionPill from '../components/SessionPill';

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at 3 AM', cron: '0 3 * * *' },
  { label: 'Weekly on Sunday', cron: '0 9 * * 0' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Late night';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [mediaStats, setMediaStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeJobs, setActiveJobs] = useState([]);
  const [progresses, setProgresses] = useState({});
  const [jobProgress, setJobProgress] = useState({});
  const socketRef = useRef(null);

  // Drawers
  const [scheduleDrawer, setScheduleDrawer] = useState({ open: false, group: null });
  const [pullDrawer, setPullDrawer] = useState({ open: false, groupId: null, targetGroupId: '' });
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, task: null });

  // Schedule form
  const [schedulePreset, setSchedulePreset] = useState(PRESETS[0].cron);
  const [scheduleCustom, setScheduleCustom] = useState('');
  const [scheduleTarget, setScheduleTarget] = useState('');

  async function fetchData() {
    try {
      setLoading(true);
      const [statsRes, jobsRes, groupsRes, tasksRes] = await Promise.all([
        api.get('/media/stats'),
        api.get('/telegram/active-jobs'),
        api.get('/telegram/groups'),
        api.get('/scheduler'),
      ]);
      setMediaStats(statsRes.data || {});
      setActiveJobs(jobsRes.data.jobs || []);
      setGroups(groupsRes.data.groups || []);
      setTasks(tasksRes.data.tasks || []);
    } catch (err) {
      console.error(err);
      // Telegram sign-in errors carry a code from the backend. Show an
      // actionable message instead of the raw 500.
      const code = err.response?.data?.code;
      if (code === 'NOT_SIGNED_IN' || code === 'SESSION_EXPIRED') {
        toast.error('Telegram not connected', {
          description: 'Open Settings to complete sign-in.',
          action: { label: 'Open Settings', onClick: () => navigate('/settings') },
        });
      } else {
        toast.error('Failed to load dashboard', { description: err.message });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    socketRef.current = io(window.location.origin);
    socketRef.current.on('progress', (data) => {
      setProgresses((prev) => ({ ...prev, [data.groupId]: data }));
    });
    socketRef.current.on('job_progress', (data) => {
      setJobProgress((prev) => ({ ...prev, [data.jobId]: data }));
      if (data.progress >= data.total && data.total > 0) {
        setTimeout(() => {
          setJobProgress((prev) => {
            const next = { ...prev };
            delete next[data.jobId];
            return next;
          });
        }, 3000);
      }
    });
    // job_done is the authoritative "this job is no longer live"
    // signal. The legacy 'job_progress >= total' heuristic misses
    // aborted jobs, so the previous version of this component left
    // stopped jobs hanging in the UI as if they were still running.
    socketRef.current.on('job_done', (data) => {
      if (!data) return;
      setJobProgress((prev) => {
        const next = { ...prev };
        delete next[data.jobId];
        return next;
      });
    });
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const abortJob = async (jobId) => {
    try {
      await api.post(`/telegram/abort-job/${jobId}`);
      toast.warning('Job aborted', { description: `Stopped job ${jobId.slice(0, 8)}` });
      fetchData();
    } catch (err) {
      toast.error('Abort failed', { description: err.message });
    }
  };

  const handleConfirmPull = async () => {
    try {
      await api.post('/telegram/download', {
        groupId: pullDrawer.groupId,
        targetGroupId: pullDrawer.targetGroupId || null,
      });
      toast.success('Pull started', { description: 'Files will appear in Media Vault as they download.' });
      setPullDrawer({ open: false, groupId: null, targetGroupId: '' });
    } catch (err) {
      toast.error('Pull failed', { description: err.message });
    }
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleDrawer.group) return;
    const finalCron = scheduleCustom.trim() || schedulePreset;
    try {
      await api.post('/scheduler', {
        name: `Auto-sync · ${scheduleDrawer.group.title}`,
        cronExpression: finalCron,
        targetChannels: [scheduleDrawer.group.id],
        isActive: true,
      });
      toast.success('Schedule created', { description: `Runs on "${finalCron}"` });
      setScheduleDrawer({ open: false, group: null });
      setScheduleCustom('');
      setSchedulePreset(PRESETS[0].cron);
      setScheduleTarget('');
      fetchData();
    } catch (err) {
      toast.error('Schedule failed', { description: err.message });
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteConfirm.task) return;
    try {
      await api.delete(`/scheduler/${deleteConfirm.task._id}`);
      toast.warning('Schedule deleted');
      setDeleteConfirm({ open: false, task: null });
      fetchData();
    } catch (err) {
      toast.error('Delete failed', { description: err.message });
    }
  };

  const filteredGroups = useMemo(
    () => groups.filter((g) => g.title?.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  const totalMedia = Object.values(mediaStats).reduce((a, b) => a + b, 0);
  const liveJobs = activeJobs.length;

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="Mission Control"
        title={greeting()}
        description="The current state of your Telegram media pipelines — channels, jobs, and schedules in one view."
        accent="dashboard"
        actions={
          <>
            <SessionPill size="sm" />
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-slate-400 hover:text-slate-100 transition-colors border border-[var(--color-hairline)] rounded-md"
            >
              <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </>
        }
      />

      {/* Stat strips */}
      <div className="flex flex-wrap border-y border-[var(--color-hairline)] mb-8">
        <StatStrip label="Channels" value={groups.length} accent />
        <StatStrip label="Media Indexed" value={totalMedia} delta={totalMedia > 0 ? { positive: true, value: '12%' } : null} />
        <StatStrip label="Schedules" value={tasks.length} />
        <StatStrip label="Active Jobs" value={liveJobs} delta={liveJobs > 0 ? { positive: false, value: 'live' } : null} />
      </div>

      {/* Live operations strip */}
      <section className="mb-10">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">Live Operations</p>
        {liveJobs === 0 ? (
          <div className="surface-1 rounded-lg px-5 py-4 flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <p className="text-sm text-slate-300">All systems idle</p>
            <p className="text-xs font-mono text-slate-500 ml-auto">last sync 4h ago</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeJobs.map((job) => {
              const jp = jobProgress[job.id] || job;
              const pct = jp.total > 0 ? Math.round((jp.progress / jp.total) * 100) : 0;
              const isUpload = job.type === 'bulk_upload';
              const accColor = isUpload ? 'text-emerald-400' : 'text-sky-400';
              const barColor = isUpload ? 'from-emerald-500 to-sky-500' : 'from-sky-500 to-indigo-500';
              return (
                <div key={job.id} className="surface-1 rounded-lg p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-[10px] font-mono uppercase tracking-widest ${accColor}`}>
                        {isUpload ? 'Uploading' : 'Downloading'}
                      </span>
                      <span className="text-xs font-mono text-slate-500 tnum">{job.id.slice(0, 8)}</span>
                    </div>
                    <p className="text-sm text-slate-200 mb-2.5">
                      <span className="font-mono text-slate-500 text-xs mr-2">grp:{job.groupId}</span>
                      <span className="text-slate-500 text-xs tnum">{jp.progress} / {jp.total} files</span>
                    </p>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-display text-2xl font-light text-slate-100 tnum leading-none">{pct}<span className="text-base text-slate-500">%</span></p>
                    <button
                      onClick={() => abortJob(job.id)}
                      className="mt-2 text-[10px] font-mono uppercase tracking-widest text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      [ stop ]
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Channels table */}
      <section>
        <div className="flex items-end justify-between mb-4 gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Channels</p>
            <h2 className="font-display text-2xl font-light text-slate-100 tracking-tight">Monitored sources</h2>
          </div>
          <div className="relative w-full md:w-72">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              placeholder="Search channels…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[var(--color-route-dashboard)]/50 transition-colors font-mono"
            />
          </div>
        </div>

        <div className="surface-1 rounded-lg overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_120px_140px_80px_180px_120px] gap-4 px-5 py-3 border-b border-[var(--color-hairline)] text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <div>Channel</div>
            <div>Type</div>
            <div>ID</div>
            <div className="text-right">Indexed</div>
            <div>Last Sync</div>
            <div className="text-right">Actions</div>
          </div>

          {loading && groups.length === 0 ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState
              title="No channels"
              description={search ? 'No channels match your search.' : 'Authenticate with Telegram from Settings to load your channels.'}
            />
          ) : (
            <ul className="divide-y divide-[var(--color-hairline)]">
              {filteredGroups.map((group) => {
                const indexed = mediaStats[group.id] || 0;
                const progress = progresses[group.id];
                const isWorking = !!progress;
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/channels/${group.id}`)}
                      className="w-full text-left grid grid-cols-1 md:grid-cols-[1fr_120px_140px_80px_180px_120px] gap-3 md:gap-4 px-5 py-3.5 items-center hover:bg-white/[0.02] transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-slate-700 to-slate-800 ring-1 ring-white/5 flex items-center justify-center text-xs font-semibold text-slate-200 shrink-0">
                          {group.title?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100 truncate group-hover:text-[var(--color-route-dashboard)] transition-colors">
                            {group.title}
                          </p>
                          {isWorking && (
                            <p className="text-[10px] font-mono text-[var(--color-route-dashboard)] mt-0.5 animate-pulse">
                              {progress.type === 'upload' ? '↑ uploading' : '↓ downloading'} · {progress.fileName?.slice(0, 30)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-slate-400">{group.isChannel ? 'Channel' : 'Group'}</div>
                      <div className="text-xs font-mono text-slate-500 truncate">{group.id}</div>
                      <div className="text-xs font-mono text-slate-300 tnum text-right">{indexed.toLocaleString()}</div>
                      <div className="text-xs font-mono text-slate-500 tnum">—</div>
                      <div className="flex justify-end items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/channels/${group.id}`)}
                          className="p-1.5 text-slate-400 hover:text-slate-100 rounded transition-colors"
                          title="Browse"
                        >
                          <FiImage size={14} />
                        </button>
                        <button
                          onClick={() => setPullDrawer({ open: true, groupId: group.id, targetGroupId: '' })}
                          className="p-1.5 text-slate-400 hover:text-sky-400 rounded transition-colors"
                          title="Pull"
                        >
                          <FiDownload size={14} />
                        </button>
                        <button
                          onClick={() => setScheduleDrawer({ open: true, group })}
                          className="p-1.5 text-slate-400 hover:text-[var(--color-route-settings)] rounded transition-colors"
                          title="Schedule"
                        >
                          <FiClock size={14} />
                        </button>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Schedules list (compact, below) */}
      {tasks.length > 0 && (
        <section className="mt-10">
          <div className="flex items-end justify-between mb-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Schedules</p>
              <h2 className="font-display text-2xl font-light text-slate-100 tracking-tight">Recurring pulls</h2>
            </div>
          </div>
          <ul className="surface-1 rounded-lg divide-y divide-[var(--color-hairline)]">
            {tasks.map((task) => (
              <li key={task._id} className="px-5 py-3 flex items-center gap-4">
                <FiClock className="text-[var(--color-route-jobs)] shrink-0" size={14} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{task.name}</p>
                  <p className="text-[10px] font-mono text-slate-500 tnum mt-0.5">
                    cron: {task.cronExpression}
                  </p>
                </div>
                <button
                  onClick={() => setDeleteConfirm({ open: true, task })}
                  className="text-[10px] font-mono uppercase tracking-widest text-slate-500 hover:text-rose-400 transition-colors"
                >
                  [ delete ]
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Schedule Drawer */}
      <Drawer
        open={scheduleDrawer.open}
        onClose={() => setScheduleDrawer({ open: false, group: null })}
        title={scheduleDrawer.group ? `Schedule · ${scheduleDrawer.group.title}` : 'Schedule'}
        subtitle="Set up a recurring pull for this channel."
        width="md"
        footer={
          <>
            <button
              onClick={() => setScheduleDrawer({ open: false, group: null })}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSchedule}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-[var(--color-route-settings)]/15 text-[var(--color-route-settings)] ring-1 ring-[var(--color-route-settings)]/30 hover:bg-[var(--color-route-settings)]/25 transition-colors"
            >
              Save Schedule
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Preset</label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  onClick={() => { setSchedulePreset(p.cron); setScheduleCustom(''); }}
                  className={`text-left px-3 py-2 text-xs rounded-md border transition-colors ${
                    schedulePreset === p.cron && !scheduleCustom
                      ? 'border-[var(--color-route-settings)]/40 bg-[var(--color-route-settings)]/10 text-slate-100'
                      : 'border-[var(--color-hairline)] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="font-mono text-[10px] text-slate-500 mt-0.5">{p.cron}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Custom cron</label>
            <input
              type="text"
              value={scheduleCustom}
              onChange={(e) => setScheduleCustom(e.target.value)}
              placeholder="*/15 * * * *"
              className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-100 font-mono focus:outline-none focus:border-[var(--color-route-settings)]/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Forward to (optional)</label>
            <select
              value={scheduleTarget}
              onChange={(e) => setScheduleTarget(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200 focus:outline-none focus:border-[var(--color-route-settings)]/50 transition-colors"
            >
              <option value="">No forward — local only</option>
              {groups.filter((g) => g.id !== scheduleDrawer.group?.id).map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </div>
        </div>
      </Drawer>

      {/* Pull Drawer */}
      <Drawer
        open={pullDrawer.open}
        onClose={() => setPullDrawer({ open: false, groupId: null, targetGroupId: '' })}
        title="Pull entire channel"
        subtitle="Download all photos and videos (up to 10,000 messages)."
        width="md"
        footer={
          <>
            <button
              onClick={() => setPullDrawer({ open: false, groupId: null, targetGroupId: '' })}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmPull}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30 hover:bg-sky-500/25 transition-colors flex items-center gap-2"
            >
              Start Pull <FiArrowRight size={12} />
            </button>
          </>
        }
      >
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">
            Auto-forward to (optional)
          </label>
          <select
            value={pullDrawer.targetGroupId}
            onChange={(e) => setPullDrawer({ ...pullDrawer, targetGroupId: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200 focus:outline-none focus:border-sky-500/50 transition-colors"
          >
            <option value="">No forward — local only</option>
            {groups.filter((g) => g.id !== pullDrawer.groupId).map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            Files will be uploaded then deleted from local disk. The Media record is kept as a tombstone.
          </p>
        </div>
      </Drawer>

      <ConfirmDrawer
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, task: null })}
        onConfirm={handleDeleteTask}
        title="Delete schedule"
        description={`This will stop the recurring pull for "${deleteConfirm.task?.name}". This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}
