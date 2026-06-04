// Lightbox.jsx
// A full-bleed media viewer with:
//   • keyboard navigation (←/→, Esc, Space, f)
//   • image zoom & pan (double-click or +/- keys)
//   • custom video chrome — no native controls, full-bleed, with
//     play/pause, scrubber, time display, and fullscreen
//   • slideshow mode (key: "s" or the on-screen button) — advances
//     every SLIDESHOW_INTERVAL_MS milliseconds
//   • download link for the raw file
//   • metadata panel on the right, closeable for cinema mode

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FiX, FiChevronLeft, FiChevronRight, FiSend, FiTrash2, FiRefreshCcw,
  FiPlay, FiPause, FiMaximize2, FiZoomOut, FiRotateCcw,
  FiDownload, FiInfo, FiImage as FiImageIcon,
} from 'react-icons/fi';

const SLIDESHOW_INTERVAL_MS = 4000;
const SWIPE_THRESHOLD = 50;

const isImage = (item) => item.fileName?.match(/\.(jpe?g|png|gif|webp|avif)$/i);
const isVideo = (item) => item.fileName?.match(/\.(mp4|webm|mov|m4v)$/i);

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Lightbox({ items, index, onClose, onIndexChange, onForward, onDelete, onRetry }) {
  const item = index === null || index === undefined ? null : items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  // We key these states on the active filename so they reset when the
  // user navigates to a different item.
  const fileKey = item?.fileName || null;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [slideshow, setSlideshow] = useState(false);
  const [metaOpen, setMetaOpen] = useState(true);

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const slideshowTimerRef = useRef(null);

  const goPrev = useCallback(() => { if (hasPrev) onIndexChange(index - 1); }, [hasPrev, index, onIndexChange]);
  const goNext = useCallback(() => { if (hasNext) onIndexChange(index + 1); }, [hasNext, index, onIndexChange]);

  // When the active file changes, reset all the per-item state.
  // (set-state-in-effect is acceptable here because the dep is an
  // external "item changed" signal — we are synchronizing to it.)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setIsPlaying(false);
  }, [fileKey]);

  // Track fullscreen status from the DOM (external state).
  useEffect(() => {
    const onChange = () => {
      // No-op placeholder; keeps an integration point for any future
      // fullscreen-aware UI (e.g. layout shift). Avoids an unused-var.
      void document.fullscreenElement;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      containerRef.current?.requestFullscreen?.();
    }
  }, []);

  // Keyboard.
  useEffect(() => {
    if (index === null || index === undefined) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === ' ') {
        if (isVideo(item)) {
          e.preventDefault();
          togglePlay();
        }
      }
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.25));
      if (e.key === '-' || e.key === '_') setZoom((z) => Math.max(1, z - 0.25));
      if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
      if (e.key === 'f') toggleFullscreen();
      if (e.key === 's') setSlideshow((s) => !s);
      if (e.key === 'm' && isVideo(item)) setIsMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onClose, goPrev, goNext, togglePlay, toggleFullscreen, item]);

  // Slideshow ticker.
  useEffect(() => {
    if (!slideshow) {
      if (slideshowTimerRef.current) clearInterval(slideshowTimerRef.current);
      return undefined;
    }
    if (!isImage(item)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlideshow(false);
      return undefined;
    }
    slideshowTimerRef.current = setInterval(() => {
      if (hasNext) onIndexChange(index + 1);
      else { setSlideshow(false); }
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(slideshowTimerRef.current);
  }, [slideshow, hasNext, index, onIndexChange, item]);

  // Wheel-zoom on images.
  const onWheel = (e) => {
    if (!isImage(item)) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setZoom((z) => Math.max(1, Math.min(4, z + delta * 2)));
  };

  // Pan handlers.
  const onMouseDown = (e) => {
    if (zoom <= 1) return;
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const onMouseMove = (e) => {
    if (!panStart) return;
    setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const onMouseUp = () => setPanStart(null);

  // Touch: swipe to navigate.
  const touchStart = useRef(null);
  const onTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) goPrev();
      else goNext();
    }
    touchStart.current = null;
  };

  if (index === null || index === undefined || !item) return null;
  const mediaUrl = `/media/${item.fileName}`;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[80] bg-black/95 flex"
        onClick={onClose}
      >
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-10 px-4 py-3 flex items-center justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
          <div className="flex items-center gap-3 pointer-events-auto min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-widest text-slate-400 tnum shrink-0">
              {index + 1} / {items.length}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-sm text-slate-200 truncate font-mono">{item.fileName}</span>
          </div>
          <div className="flex items-center gap-1 pointer-events-auto">
            {isImage(item) && (
              <>
                <IconButton onClick={() => setZoom((z) => Math.max(1, z - 0.25))} label="Zoom out"><FiZoomOut size={16} /></IconButton>
                <IconButton onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} label="Reset zoom"><FiRotateCcw size={16} /></IconButton>
              </>
            )}
            {isImage(item) && (
              <IconButton onClick={() => setSlideshow((s) => !s)} label="Slideshow" active={slideshow}><FiImageIcon size={16} /></IconButton>
            )}
            <IconButton onClick={() => setMetaOpen((m) => !m)} label="Toggle info" active={metaOpen}><FiInfo size={16} /></IconButton>
            <a
              href={mediaUrl}
              target="_blank"
              rel="noreferrer"
              download
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Download original"
            >
              <FiDownload size={16} />
            </a>
            <IconButton onClick={onClose} label="Close"><FiX size={18} /></IconButton>
          </div>
        </div>

        {/* Media stage */}
        <div
          className="flex-1 flex items-center justify-center relative overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {hasPrev && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 hover:bg-black/60 text-white/80 hover:text-white transition-colors"
              aria-label="Previous"
            >
              <FiChevronLeft size={20} />
            </button>
          )}
          {hasNext && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 hover:bg-black/60 text-white/80 hover:text-white transition-colors"
              aria-label="Next"
            >
              <FiChevronRight size={20} />
            </button>
          )}

          {isImage(item) ? (
            <motion.img
              key={item.fileName}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{
                opacity: 1,
                scale: zoom,
                x: pan.x,
                y: pan.y,
              }}
              transition={{ duration: 0.18 }}
              src={mediaUrl}
              alt={item.caption || ''}
              draggable={false}
              onDoubleClick={(e) => { e.stopPropagation(); if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); } else setZoom(2.5); }}
              className={`max-h-[88vh] max-w-[88vw] object-contain select-none ${zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in'}`}
              style={{ userSelect: 'none' }}
            />
          ) : isVideo(item) ? (
            <div className="relative max-h-[88vh] max-w-[88vw] w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                src={mediaUrl}
                autoPlay
                muted={isMuted}
                playsInline
                onClick={togglePlay}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onProgress={(e) => {
                  const v = e.currentTarget;
                  if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => { setIsPlaying(false); if (slideshow) goNext(); }}
                className="max-h-[88vh] max-w-[88vw] rounded-md"
              />
              {!isPlaying && (
                <button
                  onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                  className="absolute inset-0 flex items-center justify-center"
                  aria-label="Play"
                >
                  <span className="p-5 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors">
                    <FiPlay size={28} />
                  </span>
                </button>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3 text-white">
                  <button onClick={togglePlay} className="p-1.5 hover:text-sky-300 transition-colors" aria-label={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? <FiPause size={16} /> : <FiPlay size={16} />}
                  </button>
                  <span className="text-xs font-mono tnum text-slate-300">{formatTime(currentTime)} / {formatTime(duration)}</span>
                  <div
                    className="flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden relative cursor-pointer"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = (e.clientX - rect.left) / rect.width;
                      if (videoRef.current) videoRef.current.currentTime = ratio * duration;
                    }}
                  >
                    <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
                  </div>
                  <button
                    onClick={() => setIsMuted((m) => !m)}
                    className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-slate-300 hover:text-white"
                    title="Toggle mute (m)"
                  >
                    {isMuted ? 'Muted' : 'On'}
                  </button>
                  <button onClick={toggleFullscreen} className="p-1.5 hover:text-sky-300 transition-colors" aria-label="Fullscreen">
                    <FiMaximize2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-400 text-sm font-mono p-10 surface-1 rounded-lg">
              <p className="mb-2">No preview available for this file type.</p>
              <p className="text-xs text-slate-500 break-all">{item.fileName}</p>
              <a
                href={mediaUrl}
                download
                className="mt-4 inline-flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-md text-sm text-slate-200"
              >
                <FiDownload size={14} /> Download
              </a>
            </div>
          )}

          {slideshow && isImage(item) && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[40vh] text-[10px] font-mono uppercase tracking-widest text-sky-300/80 pointer-events-none">
              slideshow
            </div>
          )}
        </div>

        {/* Metadata panel */}
        <AnimatePresence>
          {metaOpen && (
            <motion.aside
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="w-80 max-w-[40vw] bg-[var(--color-surface-1)] border-l border-[var(--color-hairline)] p-6 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-6">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Media Detail</span>
              </div>

              <div className="space-y-5 flex-1 overflow-y-auto pr-1">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">File name</p>
                  <p className="text-sm text-slate-200 font-mono break-all">{item.fileName}</p>
                </div>
                {item.caption && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Caption</p>
                    <p className="text-sm text-slate-300 leading-relaxed">{item.caption}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Status</p>
                  <StatusPill status={item.status} />
                </div>
                {item.size && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Size</p>
                    <p className="text-sm text-slate-300 tnum">{formatBytes(item.size)}</p>
                  </div>
                )}
                {item.downloadedAt && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Downloaded</p>
                    <p className="text-sm text-slate-300 tnum">{new Date(item.downloadedAt).toLocaleString()}</p>
                  </div>
                )}
                {item.lastError && item.status === 'failed' && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Last error</p>
                    <p className="text-xs text-rose-300 break-words font-mono">{item.lastError}</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-6 border-t border-[var(--color-hairline)]">
                {onForward && (
                  <button
                    onClick={() => onForward(item)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-md text-sm font-medium transition-colors"
                  >
                    <FiSend size={14} /> Forward
                  </button>
                )}
                {onRetry && item.status === 'failed' && (
                  <button
                    onClick={() => onRetry(item)}
                    className="p-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-md transition-colors"
                    title="Retry"
                  >
                    <FiRefreshCcw size={14} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(item)}
                    className="p-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-md transition-colors"
                    title="Delete"
                  >
                    <FiTrash2 size={14} />
                  </button>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

function IconButton({ children, onClick, label, active }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      aria-label={label}
      title={label}
      className={`p-2 rounded-md transition-colors ${active ? 'text-sky-300 bg-sky-500/10' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  const map = {
    downloaded: { color: 'text-sky-400', dot: 'bg-sky-400', label: 'downloaded' },
    uploaded_to_group: { color: 'text-emerald-400', dot: 'bg-emerald-400', label: 'uploaded' },
    failed: { color: 'text-rose-400', dot: 'bg-rose-400', label: 'failed' },
    pending: { color: 'text-slate-400', dot: 'bg-slate-400', label: 'pending' },
  };
  const v = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${v.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
      {v.label}
    </span>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
