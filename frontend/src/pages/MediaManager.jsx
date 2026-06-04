import { useState, useEffect, useMemo, useRef } from 'react';
import { FiImage, FiVideo, FiSearch, FiCheck, FiAlertTriangle, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Drawer from '../components/Drawer';
import Lightbox from '../components/Lightbox';
import CommandBar from '../components/CommandBar';

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'photo', label: 'Photos' },
  { id: 'video', label: 'Videos' },
];

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'uploaded_to_group', label: 'Forwarded' },
  { id: 'failed', label: 'Failed' },
];

function isPhoto(name = '') { return /\.(jpe?g|png|gif|webp)$/i.test(name); }
function isVideo(name = '') { return /\.(mp4|webm|mov)$/i.test(name); }

export default function MediaManager() {
  const [media, setMedia] = useState([]);
  const [selected, setSelected] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [forwardDrawer, setForwardDrawer] = useState({ open: false, target: '' });
  const [syncing, setSyncing] = useState(false);
  const [wipeStep, setWipeStep] = useState(0);  // 0=closed, 1/2/3=modal steps
  const [wiping, setWiping] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Auto-Sync Vault: kick off a group_pull against every joined channel.
  // The backend returns the list of started jobIds; we surface them in
  // ActiveJobs and let the user monitor/control there.
  const syncAll = async () => {
    if (syncing) return;
    try {
      setSyncing(true);
      const res = await api.post('/telegram/sync-all', {});
      const { total } = res.data || {};
      toast.success(`Sync started · ${total} channel${total === 1 ? '' : 's'}`, {
        description: 'Watch ActiveJobs for live progress',
      });
    } catch (err) {
      toast.error('Auto Sync failed', { description: err.message });
    } finally {
      // Even though the jobs run for a long time, the request itself
      // returns immediately. Free the button after a brief moment.
      setTimeout(() => setSyncing(false), 1500);
    }
  };

  // Wipe All — 3-step confirmation. step 0 = closed, 1 → 2 → 3.
  const openWipeAll = () => setWipeStep(1);
  const runWipe = async () => {
    if (wiping) return;
    try {
      setWiping(true);
      const res = await api.post('/media/wipe-all', { confirm: 'WIPE_ALL' });
      const { deleted } = res.data || {};
      toast.warning(`Wiped ${deleted.docs} item${deleted.docs === 1 ? '' : 's'}`, {
        description: `Files removed from disk: ${deleted.files} (${deleted.filesMissing} were already gone)`,
      });
      setWipeStep(0);
      setSelected([]);
      fetchMedia();
    } catch (err) {
      toast.error('Wipe failed', { description: err.message });
    } finally {
      setWiping(false);
    }
  };

  async function fetchGroups() {
    try {
      const res = await api.get('/telegram/groups');
      setGroups(res.data.groups || []);
      setForwardDrawer((d) => ({ ...d, target: d.target || res.data.groups?.[0]?.id || '' }));
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchMedia() {
    try {
      setLoading(true);
      // Pull a large page so most users see their whole library in one
      // shot. The backend caps at `limit`; for very large libraries
      // the user can hit "Load more" at the bottom of the grid.
      const res = await api.get('/media', { params: { page: 1, limit: 1000 } });
      const incoming = res.data.media || [];
      setMedia(incoming);
      setHasMore((res.data.total || 0) > incoming.length);
      setTotalCount(res.data.total || incoming.length);
    } catch (err) {
      toast.error('Failed to load media', { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  // Load the next page and append. Tracks the current page in a ref
  // so we don't need extra state for it.
  const pageRef = useRef(1);
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const next = pageRef.current + 1;
      const res = await api.get('/media', { params: { page: next, limit: 1000 } });
      const incoming = res.data.media || [];
      pageRef.current = next;
      setMedia((prev) => [...prev, ...incoming]);
      setHasMore(media.length + incoming.length < (res.data.total || 0));
    } catch (err) {
      toast.error('Load more failed', { description: err.message });
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchMedia();
    fetchGroups();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const handleDelete = async (item) => {
    try {
      await api.delete(`/media/${item._id}`);
      toast.warning('Deleted', { description: item.fileName });
      setMedia((prev) => prev.filter((m) => m._id !== item._id));
      setSelected((prev) => prev.filter((id) => id !== item._id));
    } catch (err) {
      toast.error('Delete failed', { description: err.message });
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.post('/media/bulk-delete', { mediaIds: selected });
      toast.warning(`Deleted ${selected.length} item${selected.length === 1 ? '' : 's'}`);
      setSelected([]);
      fetchMedia();
    } catch (err) {
      toast.error('Bulk delete failed', { description: err.message });
    }
  };

  const handleForward = async (item) => {
    if (!forwardDrawer.target) {
      toast.error('Pick a destination first');
      return;
    }
    try {
      await api.post(`/media/${item._id}/forward`, { targetGroupId: forwardDrawer.target });
      toast.success('Forwarded', { description: item.fileName });
      setForwardDrawer({ open: false, target: forwardDrawer.target });
    } catch (err) {
      toast.error('Forward failed', { description: err.message });
    }
  };

  const handleBulkForward = async () => {
    if (!forwardDrawer.target) {
      toast.error('Pick a destination first');
      return;
    }
    try {
      await api.post('/media/bulk-forward', { mediaIds: selected, targetGroupId: forwardDrawer.target });
      toast.success(`Forwarding ${selected.length} item${selected.length === 1 ? '' : 's'}`);
      setForwardDrawer({ open: false, target: forwardDrawer.target });
      setSelected([]);
    } catch (err) {
      toast.error('Bulk forward failed', { description: err.message });
    }
  };

  const handleRetry = async (item) => {
    try {
      await api.post(`/media/${item._id}/retry`);
      toast.info('Retry queued', { description: item.fileName });
      fetchMedia();
    } catch (err) {
      toast.error('Retry failed', { description: err.message });
    }
  };

  // Bulk-retry: only media that are actually in `failed` state get
  // requeued. Anything else is silently skipped, so the user can
  // select a wide range without worrying about double-downloading.
  const handleBulkRetry = async () => {
    const failedIds = media
      .filter((m) => selected.includes(m._id) && m.status === 'failed')
      .map((m) => m._id);
    if (failedIds.length === 0) {
      toast.info('Nothing to retry', { description: 'No failed items in your selection.' });
      return;
    }
    try {
      const res = await api.post('/media/bulk-retry', { mediaIds: failedIds });
      const queued = res.data?.queued ?? failedIds.length;
      const skipped = selected.length - failedIds.length;
      toast.success(`Re-queued ${queued} failed item${queued === 1 ? '' : 's'}`, {
        description: skipped > 0 ? `${skipped} non-failed item${skipped === 1 ? '' : 's'} skipped` : undefined,
      });
      fetchMedia();
    } catch (err) {
      toast.error('Bulk retry failed', { description: err.message });
    }
  };

  const filtered = useMemo(() => {
    return media.filter((m) => {
      if (typeFilter === 'photo' && !isPhoto(m.fileName)) return false;
      if (typeFilter === 'video' && !isVideo(m.fileName)) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (search && !m.fileName?.toLowerCase().includes(search.toLowerCase()) && !m.caption?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [media, typeFilter, statusFilter, search]);

  const toggleSelect = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const selectAll = () => setSelected((prev) => prev.length === filtered.length ? [] : filtered.map((m) => m._id));

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="Library"
        title="Media Vault"
        description={`${media.length} item${media.length === 1 ? '' : 's'} downloaded · stored locally at ./media_downloads`}
        accent="media"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={syncAll}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-slate-100 bg-sky-500/15 hover:bg-sky-500/25 ring-1 ring-sky-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
              title="Pull all new media from every joined channel/group"
            >
              <FiRefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Auto Sync Vault'}
            </button>
            <button
              onClick={openWipeAll}
              disabled={media.length === 0 || wiping}
              className="flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-widest text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 ring-1 ring-rose-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
              title="Delete every Media document and unlink every file on disk"
            >
              <FiTrash2 size={12} />
              Wipe All
            </button>
          </div>
        }
      />

      {wipeStep > 0 && (
        <WipeAllModal
          step={wipeStep}
          setStep={setWipeStep}
          total={media.length}
          close={() => setWipeStep(0)}
          runWipe={runWipe}
        />
      )}

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-5">
        <div className="flex items-center gap-1 surface-1 rounded-md p-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                typeFilter === f.id
                  ? 'bg-white/10 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 surface-1 rounded-md p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                statusFilter === f.id
                  ? 'bg-white/10 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename or caption…"
            className="w-full pl-9 pr-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[var(--color-route-media)]/50 font-mono"
          />
        </div>
        {filtered.length > 0 && (
          <button
            onClick={selectAll}
            className="text-[10px] font-mono uppercase tracking-widest text-slate-400 hover:text-slate-200 px-2"
          >
            {selected.length === filtered.length ? '[ deselect all ]' : '[ select all ]'}
          </button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FiImage}
          title="Nothing to show"
          description={media.length === 0
            ? 'No media in the vault yet. Pull from a channel to get started.'
            : 'No items match the current filters.'}
        />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((item, idx) => {
            const isSelected = selected.includes(item._id);
            const statusColor = {
              downloaded: 'bg-sky-500/15 text-sky-400 ring-sky-500/30',
              uploaded_to_group: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
              failed: 'bg-rose-500/15 text-rose-400 ring-rose-500/30',
            }[item.status] || 'bg-slate-500/15 text-slate-400 ring-slate-500/30';

            return (
              <div
                key={item._id}
                className={`group relative aspect-square rounded-lg overflow-hidden border bg-[var(--color-surface-1)] transition-colors ${
                  isSelected ? 'border-[var(--color-route-media)] ring-1 ring-[var(--color-route-media)]/40' : 'border-[var(--color-hairline)] hover:border-white/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className="absolute inset-0"
                  aria-label="Open"
                />
                {item.previewAvailable === false ? (
                  // File is gone from disk (cleaned up after a forward,
                  // or never landed in this volume). Show a clear
                  // placeholder instead of a broken <img>.
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-3 text-center bg-white/[0.02]">
                    <FiAlertTriangle size={22} className="mb-1.5 text-amber-400/80" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-amber-300/80">file missing</span>
                    <span className="text-[9px] font-mono break-all text-slate-500 mt-1 line-clamp-2">{item.fileName}</span>
                  </div>
                ) : isPhoto(item.fileName) ? (
                  <img
                    src={`/media/${item.fileName}`}
                    alt={item.caption || ''}
                    className="w-full h-full object-cover pointer-events-none"
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.dataset.broken = '1'; }}
                  />
                ) : isVideo(item.fileName) ? (
                  <video
                    src={`/media/${item.fileName}`}
                    className="w-full h-full object-cover pointer-events-none"
                    muted
                    loop
                    playsInline
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    onMouseOver={(e) => e.currentTarget.play()}
                    onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-4 text-center">
                    <FiVideo size={28} className="mb-2" />
                    <span className="text-[10px] font-mono break-all">{item.fileName}</span>
                  </div>
                )}

                {/* Status badge */}
                <span className={`absolute top-2 left-2 px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest rounded ring-1 ${statusColor}`}>
                  {item.status?.replace(/_/g, ' ')}
                </span>

                {/* Selection checkbox */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(item._id); }}
                  className={`absolute top-2 right-2 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-[var(--color-route-media)] border-[var(--color-route-media)] text-slate-900'
                      : 'bg-black/40 border-white/20 backdrop-blur-sm opacity-0 group-hover:opacity-100'
                  }`}
                  aria-label="Select"
                >
                  {isSelected && <FiCheck size={11} strokeWidth={3} />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination footer — shown when more rows exist on the server */}
      {hasMore && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <p className="text-[10px] font-mono text-slate-500 tnum">
            showing {media.length.toLocaleString()} of {totalCount.toLocaleString()}
          </p>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-widest text-slate-200 bg-white/5 hover:bg-white/10 ring-1 ring-[var(--color-hairline)] disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          items={filtered}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onForward={() => {
            const item = filtered[lightboxIndex];
            setLightboxIndex(null);
            setForwardDrawer({ open: true, target: forwardDrawer.target, single: item });
          }}
          onDelete={(item) => {
            setLightboxIndex(null);
            handleDelete(item);
          }}
          onRetry={handleRetry}
        />
      )}

      {/* Forward drawer */}
      <Drawer
        open={forwardDrawer.open}
        onClose={() => setForwardDrawer({ open: false, target: forwardDrawer.target, single: null })}
        title={forwardDrawer.single ? `Forward · ${forwardDrawer.single.fileName.slice(0, 32)}…` : `Forward ${selected.length} item${selected.length === 1 ? '' : 's'}`}
        subtitle="Pick a destination channel."
        width="md"
        footer={
          <>
            <button onClick={() => setForwardDrawer({ open: false, target: forwardDrawer.target, single: null })} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              onClick={() => forwardDrawer.single ? handleForward(forwardDrawer.single) : handleBulkForward()}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-[var(--color-route-media)]/15 text-[var(--color-route-media)] ring-1 ring-[var(--color-route-media)]/30 hover:bg-[var(--color-route-media)]/25"
            >
              Forward
            </button>
          </>
        }
      >
        <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Destination</label>
        <select
          value={forwardDrawer.target}
          onChange={(e) => setForwardDrawer({ ...forwardDrawer, target: e.target.value })}
          className="w-full px-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </Drawer>

      {/* Command bar */}
      <CommandBar
        open={selected.length > 0}
        count={selected.length}
        onForward={() => setForwardDrawer({ open: true, target: forwardDrawer.target, single: null })}
        onRetry={handleBulkRetry}
        onDelete={handleBulkDelete}
        onClear={() => setSelected([])}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WipeAllModal
// 3-step confirmation. Step 1: read the warning. Step 2: type the
// literal string "WIPE" into a text input to prove the operator
// understands. Step 3: press the final red button.
// ---------------------------------------------------------------------------
function WipeAllModal({ step, setStep, total, close, runWipe }) {
  const [typed, setTyped] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="surface-1 rounded-lg w-full max-w-lg p-6 ring-1 ring-rose-500/30 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <FiAlertTriangle className="text-rose-400" size={18} />
          <h2 className="text-lg font-display text-slate-100">Wipe All Media</h2>
        </div>

        <ol className="flex items-stretch w-full mb-5">
          {['Read', 'Confirm', 'Wipe'].map((label, i) => (
            <li key={label} className="flex-1 flex items-stretch min-w-0">
              <div className="flex flex-col items-center text-center px-2 flex-1">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-mono font-semibold transition-all duration-300 border ${
                    i < step
                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                      : i === step
                      ? 'bg-rose-500/10 border-rose-500 text-rose-300 shadow-[0_0_0_4px_rgba(244,63,94,0.10)]'
                      : 'bg-transparent border-white/10 text-slate-500'
                  }`}
                >
                  {i < step ? '✓' : String(i + 1).padStart(2, '0')}
                </div>
                <p className={`mt-2 text-[10px] font-mono uppercase tracking-widest ${i <= step ? 'text-rose-300' : 'text-slate-500'}`}>
                  {label}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {step === 1 && (
          <>
            <p className="text-sm text-slate-300 mb-4">
              This will <span className="text-rose-300 font-semibold">permanently delete</span> every Media document and unlink every downloaded file on disk.
            </p>
            <ul className="text-xs text-slate-400 space-y-1 mb-5 list-disc list-inside">
              <li><span className="font-mono text-rose-300">{total.toLocaleString()}</span> Media documents will be dropped from Mongo</li>
              <li>All files in <span className="font-mono text-slate-300">./media_downloads</span> will be unlinked</li>
              <li>This action cannot be undone. Re-downloading everything will take a long time.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={close} className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-slate-100">Cancel</button>
              <button onClick={() => setStep(2)} className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 ring-1 ring-rose-500/30 rounded-md">Continue</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-slate-300 mb-3">
              Type <span className="font-mono text-rose-300 bg-rose-500/10 px-1.5 py-0.5 rounded">WIPE</span> to confirm.
            </p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              placeholder="Type WIPE"
              className="w-full px-3 py-2 mb-5 bg-black/30 border border-[var(--color-hairline)] rounded font-mono text-slate-200 focus:border-rose-500/50 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={close} className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-slate-100">Cancel</button>
              <button
                onClick={() => setStep(3)}
                disabled={typed !== 'WIPE'}
                className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 ring-1 ring-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-md"
              >
                I understand · continue
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-slate-300 mb-5">
              Final step. Press the button below to wipe <span className="font-mono text-rose-300">{total.toLocaleString()}</span> item{total === 1 ? '' : 's'} and unlink their files.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={close} className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-slate-100">Cancel</button>
              <button
                onClick={runWipe}
                className="px-4 py-2 text-xs font-mono uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-500 ring-1 ring-rose-400 rounded-md shadow-[0_0_24px_rgba(244,63,94,0.4)]"
              >
                WIPE EVERYTHING
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
