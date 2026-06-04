import { useState, useEffect, useMemo } from 'react';
import {
  FiPlus, FiTrash2, FiPlay, FiClock, FiEdit2, FiX,
  FiCalendar, FiGlobe, FiAlertTriangle, FiSearch,
} from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';

// Common IANA timezones. Not exhaustive — we only show a curated
// list of cities so the dropdown is small and predictable.
const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
];

const RECURRENCE_OPTIONS = [
  { id: 'none',   label: 'One time' },
  { id: 'daily',  label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'monthly',label: 'Every month' },
];

/** Convert a `YYYY-MM-DDTHH:mm` local datetime + IANA timezone to a
 *  UTC ISO string the backend can store directly in `runAt`.
 *
 *  The conversion is two-step:
 *    1) Treat the input as already-in-timezone, so a user picking
 *       "2026-06-04 14:30 Asia/Dubai" means "wall clock 14:30 in
 *       Dubai" — NOT "UTC 14:30 converted to Dubai".
 *    2) Compute the equivalent UTC instant via Intl.
 *
 *  Without this, the user's selection gets silently re-interpreted
 *  in the browser's local timezone, which causes off-by-hours
 *  surprises ("why is my 8pm sync firing at 11pm?").
 */
function localToUtcIso(localDateTime, timeZone) {
  if (!localDateTime) return null;
  // Parse "YYYY-MM-DDTHH:mm" as if it were UTC, then ask the runtime
  // for the offset of the chosen timezone at that instant, then
  // adjust.
  const [datePart, timePart] = localDateTime.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);

  // Find the UTC instant whose wall-clock representation in `timeZone`
  // matches (y, mo, d, h, mi). We do a fixed-offset binary search
  // using Intl.DateTimeFormat.
  const getWallClock = (utcMs) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    // Intl can return hour: 24 for midnight in some environments.
    let hh = get('hour');
    if (hh === 24) hh = 0;
    return { y: get('year'), m: get('month'), d: get('day'), hh, mm: get('minute') };
  };
  // Initial guess: treat the wall clock as UTC.
  let utcMs = Date.UTC(y, mo - 1, d, h, mi);
  // Refine: how far off is the wall clock in the target timezone?
  for (let i = 0; i < 4; i += 1) {
    const wc = getWallClock(utcMs);
    const wcMs = Date.UTC(wc.y, wc.m - 1, wc.d, wc.hh, wc.mm);
    const drift = utcMs - wcMs;
    if (drift === 0) break;
    utcMs += drift;
  }
  return new Date(utcMs).toISOString();
}

/** Render an ISO UTC instant in the user's chosen timezone as a
 *  friendly "DD MMM YYYY HH:mm TZ" string. */
function formatInZone(iso, timeZone) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export default function Scheduler() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState({ open: false, task: null });
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  async function fetchTasks() {
    try {
      setLoading(true);
      const res = await api.get('/scheduler');
      setTasks(res.data.tasks || []);
    } catch (err) {
      toast.error('Failed to load schedules', { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function fetchGroups() {
    try {
      const res = await api.get('/telegram/groups');
      setGroups((res.data.groups || []).filter((g) => g.isGroup || g.isChannel));
    } catch { /* intentionally ignored */ }
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchTasks();
    fetchGroups();
    /* eslint-enable react-hooks/set-state-in-effect */
    const id = setInterval(fetchTasks, 15_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.targetChannels || []).some((c) => c.toLowerCase().includes(q))
    );
  }, [tasks, search]);

  const save = async (payload) => {
    try {
      if (payload._id) {
        await api.put(`/scheduler/${payload._id}`, payload);
        toast.success('Schedule updated');
      } else {
        await api.post('/scheduler', payload);
        toast.success('Schedule created');
      }
      setDrawer({ open: false, task: null });
      fetchTasks();
    } catch (err) {
      toast.error('Save failed', { description: err.response?.data?.error || err.message });
    }
  };

  const remove = async (task) => {
    try {
      await api.delete(`/scheduler/${task._id}`);
      toast.warning(`Deleted schedule · ${task.name}`);
      setDeleteConfirm(null);
      fetchTasks();
    } catch (err) {
      toast.error('Delete failed', { description: err.message });
    }
  };

  const runNow = async (task) => {
    try {
      await api.post(`/scheduler/${task._id}/run-now`);
      toast.success(`Started · ${task.name}`, { description: 'Watch ActiveJobs for live progress' });
    } catch (err) {
      toast.error('Run-now failed', { description: err.message });
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="Automation"
        title="Scheduler"
        description="Schedule downloads by date, time, and timezone. No cron knowledge needed."
        accent="scheduler"
        actions={
          <button
            onClick={() => setDrawer({ open: true, task: null })}
            className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-slate-100 bg-sky-500/15 hover:bg-sky-500/25 ring-1 ring-sky-500/30 rounded-md"
          >
            <FiPlus size={12} />
            New schedule
          </button>
        }
      />

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or channel…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-black/30 border border-[var(--color-hairline)] rounded font-mono text-slate-200 focus:border-sky-500/50 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FiClock}
          title={search ? 'No schedules match.' : 'No schedules yet.'}
          subtitle={search ? 'Adjust your search.' : 'Click "New schedule" to add one.'}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <ScheduleRow
              key={t._id}
              task={t}
              channels={groups}
              onEdit={() => setDrawer({ open: true, task: t })}
              onDelete={() => setDeleteConfirm(t)}
              onRunNow={() => runNow(t)}
            />
          ))}
        </div>
      )}

      {drawer.open && (
        <ScheduleDrawer
          task={drawer.task}
          channels={groups}
          close={() => setDrawer({ open: false, task: null })}
          save={save}
        />
      )}

      {deleteConfirm && (
        <ConfirmDelete
          task={deleteConfirm}
          close={() => setDeleteConfirm(null)}
          confirm={() => remove(deleteConfirm)}
        />
      )}
    </div>
  );
}

function ScheduleRow({ task, channels, onEdit, onDelete, onRunNow }) {
  const channelTitles = (task.targetChannels || [])
    .map((id) => channels.find((g) => String(g.id) === String(id))?.title || id);
  const statusColor = task.lastStatus === 'success' ? 'text-emerald-300'
    : task.lastStatus === 'failed' ? 'text-rose-300'
    : task.lastStatus === 'partial' ? 'text-amber-300'
    : 'text-slate-500';

  return (
    <div className="surface-1 rounded-lg p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <p className="text-sm text-slate-100 font-medium truncate">{task.name}</p>
          <span className={`text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${
            task.isActive
              ? 'text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/20'
              : 'text-slate-500 bg-white/5 ring-1 ring-white/10'
          }`}>
            {task.isActive ? 'active' : 'disabled'}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-300 bg-indigo-500/10 ring-1 ring-indigo-500/20 px-1.5 py-0.5 rounded">
            {task.recurrence === 'none' ? 'one-time' : task.recurrence}
          </span>
        </div>
        <p className="text-xs font-mono text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-1">
            <FiCalendar size={10} className="text-slate-500" />
            {formatInZone(task.runAt, task.timezone)}
          </span>
          <span className="flex items-center gap-1">
            <FiGlobe size={10} className="text-slate-500" />
            {task.timezone || 'UTC'}
          </span>
          <span className="text-slate-500">
            {channelTitles.length} channel{channelTitles.length === 1 ? '' : 's'}: {channelTitles.slice(0, 2).join(', ')}{channelTitles.length > 2 ? ` +${channelTitles.length - 2}` : ''}
          </span>
        </p>
        {task.lastRunAt && (
          <p className="text-[10px] font-mono text-slate-500 mt-1">
            last run: <span className={statusColor}>{task.lastStatus}</span>
            {' · '}
            {formatInZone(task.lastRunAt, task.timezone)}
            {task.lastDurationMs > 0 && ` · ${Math.round(task.lastDurationMs / 1000)}s`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onRunNow}
          title="Run this schedule immediately"
          className="p-2 rounded text-sky-300 hover:bg-sky-500/10 transition-colors"
        >
          <FiPlay size={14} />
        </button>
        <button
          onClick={onEdit}
          title="Edit"
          className="p-2 rounded text-slate-400 hover:bg-white/5 hover:text-slate-100 transition-colors"
        >
          <FiEdit2 size={14} />
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="p-2 rounded text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <FiTrash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/** Pure helper: produce a "YYYY-MM-DDTHH:mm" string in the given
 *  timezone. For an existing task we read the stored UTC instant
 *  back; for a new task we default to 1 hour from "now".
 *
 *  We accept `nowMs` as a parameter so the caller can pre-compute
 *  Date.now() once (in a useState initializer) and pass it in,
 *  keeping the function pure.
 */
function defaultLocalDateTime(task, nowMs) {
  if (task?.runAt) {
    try {
      const z = task.timezone || 'UTC';
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: z, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date(task.runAt));
      const get = (t) => parts.find((p) => p.type === t)?.value;
      return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    } catch { /* fall through */ }
  }
  const d = new Date(nowMs + 60 * 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function ScheduleDrawer({ task, channels, close, save }) {
  // Default form values: a new task is set to "1 hour from now, one-time".
  const [name, setName] = useState(task?.name || '');
  // Pre-compute the default datetime once at mount, not on every
  // render (Date.now is impure).
  const [localDateTime, setLocalDateTime] = useState(() =>
    defaultLocalDateTime(task, Date.now()));
  const [timezone, setTimezone] = useState(task?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [recurrence, setRecurrence] = useState(task?.recurrence || 'none');
  const [isActive, setIsActive] = useState(task ? !!task.isActive : true);
  const [selectedChannels, setSelectedChannels] = useState(new Set(task?.targetChannels || []));

  // User's local zone for the helper text.
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const submit = () => {
    if (!name.trim()) return toast.error('Name is required');
    if (!localDateTime) return toast.error('Pick a date and time');
    if (selectedChannels.size === 0) return toast.error('Pick at least one channel');
    const runAtIso = localToUtcIso(localDateTime, timezone);
    if (!runAtIso) return toast.error('Invalid date/time');
    save({
      _id: task?._id,
      name: name.trim(),
      runAt: runAtIso,
      recurrence,
      timezone,
      targetChannels: Array.from(selectedChannels),
      isActive,
    });
  };

  const toggleChannel = (id) =>
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="surface-1 rounded-lg w-full max-w-xl p-6 ring-1 ring-sky-500/30 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <FiClock className="text-sky-400" size={18} />
            <h2 className="text-lg font-display text-slate-100">
              {task ? 'Edit schedule' : 'New schedule'}
            </h2>
          </div>
          <button onClick={close} className="p-1.5 text-slate-500 hover:text-slate-200">
            <FiX size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nightly backup, Weekly channel pull…"
              className="w-full px-3 py-2 text-sm bg-black/30 border border-[var(--color-hairline)] rounded font-mono text-slate-200 focus:border-sky-500/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Date &amp; time</label>
              <input
                type="datetime-local"
                value={localDateTime}
                onChange={(e) => setLocalDateTime(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-black/30 border border-[var(--color-hairline)] rounded font-mono text-slate-200 focus:border-sky-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-black/30 border border-[var(--color-hairline)] rounded font-mono text-slate-200 focus:border-sky-500/50 focus:outline-none"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              {timezone !== browserZone && (
                <p className="mt-1 text-[10px] font-mono text-amber-300/80">
                  your browser is in {browserZone}; this will fire at the chosen wall time in {timezone}.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Recurrence</label>
            <div className="grid grid-cols-4 gap-1 surface-1 rounded p-1">
              {RECURRENCE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setRecurrence(o.id)}
                  className={`px-2 py-1.5 text-xs rounded transition-colors ${
                    recurrence === o.id
                      ? 'bg-white/10 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">
              Channels ({selectedChannels.size} of {channels.length})
            </label>
            <div className="surface-2 rounded-md p-2 max-h-48 overflow-y-auto">
              {channels.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-3">No channels available. Sign in to Telegram first.</p>
              )}
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedChannels.has(String(c.id))}
                    onChange={() => toggleChannel(String(c.id))}
                    className="accent-sky-500"
                  />
                  <span className="text-sm text-slate-200 truncate">{c.title}</span>
                  <span className="text-[10px] font-mono text-slate-500 ml-auto">{c.id}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-sky-500" />
            <span className="text-sm text-slate-300">Active (paused schedules will not fire)</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={close} className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-slate-100">
            Cancel
          </button>
          <button
            onClick={submit}
            className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-white bg-sky-600 hover:bg-sky-500 ring-1 ring-sky-400 rounded-md"
          >
            {task ? 'Save changes' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({ task, close, confirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="surface-1 rounded-lg w-full max-w-md p-6 ring-1 ring-rose-500/30 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <FiAlertTriangle className="text-rose-400" size={18} />
          <h2 className="text-lg font-display text-slate-100">Delete schedule</h2>
        </div>
        <p className="text-sm text-slate-300 mb-5">
          Permanently delete <span className="font-mono text-rose-300">{task.name}</span>?
          Any in-flight run will be allowed to finish, but no new runs will be scheduled.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={close} className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-slate-100">
            Cancel
          </button>
          <button
            onClick={confirm}
            className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-500 ring-1 ring-rose-400 rounded-md"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
