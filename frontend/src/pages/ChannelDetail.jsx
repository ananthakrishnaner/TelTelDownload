import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FiArrowLeft, FiDownload, FiImage, FiCheck, FiPlay } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import Drawer from '../components/Drawer';
import EmptyState from '../components/EmptyState';
import Lightbox from '../components/Lightbox';

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at 3 AM', cron: '0 3 * * *' },
  { label: 'Weekly on Sunday', cron: '0 9 * * 0' },
];

const TABS = [
  { id: 'media', label: 'Media' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'history', label: 'History' },
];

const isImage = (m) => m.fileName?.match(/\.(jpe?g|png|gif|webp|avif)$/i);
const isVideo = (m) => m.fileName?.match(/\.(mp4|webm|mov|m4v)$/i);

export default function ChannelDetail() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [allGroups, setAllGroups] = useState([]);
  const [recentMedia, setRecentMedia] = useState([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [tab, setTab] = useState('media');
  const [selectedIds, setSelectedIds] = useState([]);
  const [pullDrawer, setPullDrawer] = useState(false);
  const [pullTarget, setPullTarget] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);

  // History tab
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [channelTask, setChannelTask] = useState(null);

  // Inline schedule editor
  const [schedulePreset, setSchedulePreset] = useState(PRESETS[0].cron);
  const [scheduleCustom, setScheduleCustom] = useState('');
  const [scheduleTarget, setScheduleTarget] = useState('');

  async function loadGroup() {
    try {
      const [groupsRes, tasksRes] = await Promise.all([
        api.get('/telegram/groups'),
        api.get('/scheduler'),
      ]);
      const gs = groupsRes.data.groups || [];
      setAllGroups(gs);
      const g = gs.find((x) => String(x.id) === String(id));
      setGroup(g || { id, title: `Channel ${id}`, isChannel: true });
      // Find a task that targets this channel so the History tab can
      // show its run history.
      const task = (tasksRes.data.tasks || []).find((t) =>
        (t.targetChannels || []).map(String).includes(String(id))
      ) || null;
      setChannelTask(task);
    } catch (err) {
      toast.error('Failed to load channel', { description: err.message });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadMedia() {
    setLoadingMedia(true);
    try {
      const res = await api.get(`/telegram/group-media/${id}`);
      setRecentMedia(res.data.media || []);
    } catch (err) {
      toast.error('Failed to load media', { description: err.message });
    } finally {
      setLoadingMedia(false);
    }
  }

  useEffect(() => {
    if (tab !== 'media') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id]);

  async function loadHistory() {
    if (!channelTask) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await api.get(`/scheduler/${channelTask._id}/runs?count=20`);
      setHistory(res.data.task?.runHistory || []);
    } catch (err) {
      toast.error('Failed to load history', { description: err.message });
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== 'history') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, channelTask]);

  const toggleSelect = (mid, e) => {
    e?.stopPropagation();
    setSelectedIds((prev) => prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]);
  };

  const selectAll = () => {
    if (selectedIds.length === recentMedia.length) setSelectedIds([]);
    else setSelectedIds(recentMedia.map((m) => m.id));
  };

  const handlePull = async () => {
    try {
      await api.post('/telegram/download', { groupId: id, targetGroupId: pullTarget || null });
      toast.success('Pull started', { description: 'Files will appear in Media Vault as they download.' });
      setPullDrawer(false);
      setPullTarget('');
    } catch (err) {
      toast.error('Pull failed', { description: err.message });
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.length === 0) return;
    try {
      await api.post('/telegram/download-specific', {
        groupId: id,
        messageIds: selectedIds,
        targetGroupId: scheduleTarget || null,
      });
      toast.success(`Pulling ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`, {
        description: 'Watch Live Operations for progress.',
      });
      setSelectedIds([]);
    } catch (err) {
      toast.error('Failed to start', { description: err.message });
    }
  };

  const handleInlineSchedule = async () => {
    const finalCron = scheduleCustom.trim() || schedulePreset;
    try {
      await api.post('/scheduler', {
        name: `Auto-sync · ${group?.title || id}`,
        cronExpression: finalCron,
        targetChannels: [id],
        isActive: true,
      });
      toast.success('Schedule created', { description: `Runs on "${finalCron}"` });
      setScheduleCustom('');
      loadGroup();
    } catch (err) {
      toast.error('Schedule failed', { description: err.message });
    }
  };

  const handleRetry = async (item) => {
    try {
      await api.post(`/media/${item._id || item.id}/retry`);
      toast.info('Retry queued', { description: item.fileName });
    } catch (err) {
      toast.error('Retry failed', { description: err.message });
    }
  };

  const handleForward = async () => {
    // ChannelDetail doesn't have a target group context for forwarding;
    // the user should open Media Vault for that. Provide a helpful toast.
    toast.info('Open in Media Vault', { description: 'Use the Forward button there to choose a target channel.' });
  };

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-slate-500 hover:text-slate-200 transition-colors mb-4"
      >
        <FiArrowLeft size={12} /> Back to dashboard
      </Link>

      <PageHeader
        eyebrow="Channel"
        title={group?.title || `Channel ${id}`}
        description={group ? `Type: ${group.isChannel ? 'Channel' : 'Group'} · ID: ${group.id}` : 'Loading…'}
        accent="dashboard"
        actions={
          <>
            <button
              onClick={() => setPullDrawer(true)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-slate-100 border border-[var(--color-hairline)] rounded-md hover:border-sky-400/50 transition-colors"
            >
              <FiDownload size={12} /> Pull all
            </button>
            {tab === 'media' && selectedIds.length > 0 && (
              <button
                onClick={handleDownloadSelected}
                className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-sky-400 bg-sky-500/10 ring-1 ring-sky-500/30 rounded-md hover:bg-sky-500/20 transition-colors"
              >
                Fetch {selectedIds.length}
              </button>
            )}
          </>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--color-hairline)] mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-4 py-2.5 text-xs font-mono uppercase tracking-widest transition-colors ${
              tab === t.id ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute left-0 right-0 -bottom-px h-px bg-[var(--color-route-dashboard)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'media' && (
        <div>
          {loadingMedia ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square w-full" />
              ))}
            </div>
          ) : recentMedia.length === 0 ? (
            <EmptyState
              icon={FiImage}
              title="No media found"
              description="This channel has no recent photos or videos, or it hasn't been scanned yet."
            />
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                  {recentMedia.length} item{recentMedia.length === 1 ? '' : 's'}
                </p>
                <button
                  onClick={selectAll}
                  className="text-[10px] font-mono uppercase tracking-widest text-slate-400 hover:text-slate-200"
                >
                  {selectedIds.length === recentMedia.length ? '[ deselect all ]' : '[ select all ]'}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {recentMedia.map((m, i) => {
                  const isSelected = selectedIds.includes(m.id);
                  const mediaUrl = `/media/${m.fileName}`;
                  return (
                    <div
                      key={m.id}
                      className={`relative aspect-square rounded-lg overflow-hidden border transition-colors group cursor-zoom-in ${
                        isSelected
                          ? 'border-[var(--color-route-dashboard)] ring-1 ring-[var(--color-route-dashboard)]/40'
                          : 'border-[var(--color-hairline)] hover:border-white/20'
                      }`}
                      onClick={() => setLightboxIndex(i)}
                    >
                      {m.fileName ? (
                        <>
                          {isImage(m) ? (
                            <img
                              src={mediaUrl}
                              alt={m.caption || ''}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
                              <FiPlay className="text-slate-500 group-hover:text-sky-300 transition-colors" size={28} />
                            </div>
                          )}
                          {isVideo(m) && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 text-[9px] font-mono text-slate-200 rounded">
                              VIDEO
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center p-3 text-center">
                          <FiImage className="text-slate-600 mb-2" size={20} />
                          <span className="text-[10px] text-slate-500 line-clamp-2 font-mono">
                            {m.caption || `msg ${m.id}`}
                          </span>
                        </div>
                      )}
                      <div className="absolute top-2 right-2 text-[9px] font-mono text-slate-500 tnum">
                        #{m.id}
                      </div>
                      {/* Status pill */}
                      {m.status && (
                        <div className="absolute bottom-2 left-2 text-[9px] font-mono uppercase tracking-widest">
                          <span className={`px-1.5 py-0.5 rounded ${
                            m.status === 'downloaded' ? 'bg-sky-500/30 text-sky-200' :
                            m.status === 'uploaded_to_group' ? 'bg-emerald-500/30 text-emerald-200' :
                            m.status === 'failed' ? 'bg-rose-500/30 text-rose-200' :
                            'bg-slate-500/30 text-slate-300'
                          }`}>
                            {m.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      )}
                      {/* Select checkbox (separate from open) */}
                      <button
                        type="button"
                        onClick={(e) => toggleSelect(m.id, e)}
                        className="absolute bottom-2 right-2 w-5 h-5 rounded border border-white/30 bg-black/30 flex items-center justify-center hover:bg-black/60 transition-colors"
                        aria-label={isSelected ? 'Deselect' : 'Select'}
                      >
                        {isSelected && <FiCheck size={11} strokeWidth={3} className="text-white" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <div className="max-w-xl surface-1 rounded-lg p-6">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-4">Recurring pull</p>
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
                className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-100 font-mono focus:outline-none focus:border-[var(--color-route-settings)]/50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Forward to (optional)</label>
              <select
                value={scheduleTarget}
                onChange={(e) => setScheduleTarget(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200"
              >
                <option value="">No forward — local only</option>
                {allGroups.filter((g) => g.id !== id).map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleInlineSchedule}
              className="w-full py-2.5 bg-[var(--color-route-settings)]/15 text-[var(--color-route-settings)] ring-1 ring-[var(--color-route-settings)]/30 rounded-md text-sm font-semibold hover:bg-[var(--color-route-settings)]/25 transition-colors"
            >
              Create Schedule
            </button>
            {channelTask && (
              <div className="pt-4 border-t border-[var(--color-hairline)]">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Active schedule</p>
                <div className="text-xs text-slate-300 font-mono">
                  <p>{channelTask.name}</p>
                  <p className="text-slate-500 mt-0.5">{channelTask.cronExpression}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div>
          {!channelTask ? (
            <EmptyState
              title="No scheduled runs"
              description="Create a schedule in the Schedule tab to see run history here."
            />
          ) : historyLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="This schedule has not run yet. The next run will appear here when it completes."
            />
          ) : (
            <div className="surface-1 rounded-lg overflow-hidden">
              <div className="grid grid-cols-12 px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-slate-500 border-b border-[var(--color-hairline)]">
                <div className="col-span-4">When</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2 text-right">Downloaded</div>
                <div className="col-span-2 text-right">Failed</div>
                <div className="col-span-2 text-right">Duration</div>
              </div>
              {history.map((h, i) => (
                <div key={i} className="grid grid-cols-12 px-4 py-3 text-sm border-b border-[var(--color-hairline)] last:border-b-0">
                  <div className="col-span-4 text-slate-300 font-mono text-xs tnum">
                    {new Date(h.at).toLocaleString()}
                  </div>
                  <div className="col-span-2">
                    <span className={`text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${
                      h.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                      h.status === 'partial' ? 'bg-amber-500/20 text-amber-300' :
                      h.status === 'failed' ? 'bg-rose-500/20 text-rose-300' :
                      'bg-slate-500/20 text-slate-300'
                    }`}>
                      {h.status}
                    </span>
                  </div>
                  <div className="col-span-2 text-right text-slate-300 tnum font-mono text-xs">
                    {h.itemsDownloaded || 0}
                  </div>
                  <div className="col-span-2 text-right text-slate-300 tnum font-mono text-xs">
                    {h.itemsFailed || 0}
                  </div>
                  <div className="col-span-2 text-right text-slate-400 tnum font-mono text-xs">
                    {formatDuration(h.durationMs)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Lightbox
        items={recentMedia}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
        onForward={handleForward}
        onRetry={handleRetry}
      />

      <Drawer
        open={pullDrawer}
        onClose={() => setPullDrawer(false)}
        title="Pull entire channel"
        subtitle="Download all photos and videos (up to 10,000 messages)."
        width="md"
        footer={
          <>
            <button onClick={() => setPullDrawer(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              onClick={handlePull}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30 hover:bg-sky-500/25"
            >
              Start Pull
            </button>
          </>
        }
      >
        <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Forward to (optional)</label>
        <select
          value={pullTarget}
          onChange={(e) => setPullTarget(e.target.value)}
          className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200"
        >
          <option value="">No forward — local only</option>
          {allGroups.filter((g) => g.id !== id).map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </Drawer>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
