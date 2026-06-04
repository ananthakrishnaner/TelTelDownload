import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FiArrowLeft, FiDownload, FiImage, FiCheck } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import Drawer from '../components/Drawer';
import EmptyState from '../components/EmptyState';

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
  // Inline schedule editor
  const [schedulePreset, setSchedulePreset] = useState(PRESETS[0].cron);
  const [scheduleCustom, setScheduleCustom] = useState('');
  const [scheduleTarget, setScheduleTarget] = useState('');

  async function loadGroup() {
    try {
      const groupsRes = await api.get('/telegram/groups');
      const gs = groupsRes.data.groups || [];
      setAllGroups(gs);
      const g = gs.find((x) => String(x.id) === String(id));
      setGroup(g || { id, title: `Channel ${id}`, isChannel: true });
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

  const toggleSelect = (mid) => {
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
    } catch (err) {
      toast.error('Schedule failed', { description: err.message });
    }
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
                {recentMedia.map((m) => {
                  const isSelected = selectedIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleSelect(m.id)}
                      className={`relative aspect-square rounded-lg overflow-hidden border transition-colors ${
                        isSelected
                          ? 'border-[var(--color-route-dashboard)] ring-1 ring-[var(--color-route-dashboard)]/40'
                          : 'border-[var(--color-hairline)] hover:border-white/20'
                      }`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center p-3 text-center">
                        <FiImage className="text-slate-600 mb-2" size={20} />
                        <span className="text-[10px] text-slate-500 line-clamp-2 font-mono">
                          {m.caption || `msg ${m.id}`}
                        </span>
                      </div>
                      <div className="absolute top-2 left-2 text-[9px] font-mono text-slate-500 tnum">
                        #{m.id}
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--color-route-dashboard)] text-slate-900 flex items-center justify-center">
                          <FiCheck size={11} strokeWidth={3} />
                        </div>
                      )}
                    </button>
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
          </div>
        </div>
      )}

      {tab === 'history' && (
        <EmptyState
          title="No history yet"
          description="Job history for this channel will appear here as pulls complete."
        />
      )}

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
