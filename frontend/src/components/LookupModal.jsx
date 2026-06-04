// LookupModal.jsx — the 3-state image-search modal.
//
//   idle      — drag-drop or pick a probe image
//   searching — 5-layer animated loading composition (LookupLoadingComposition)
//   results   — masonry of LookupResultCard (CSS columns, varied aspect ratios)
//
// Architecture: the outer `LookupModal` is a thin shell that mounts/unmounts
// a keyed inner `<LookupModalBody />`. On open→close→open the inner body
// remounts, so we never have to reset state inside a useEffect (the React
// 19 / eslint-plugin-react-hooks v6 `react-hooks/set-state-in-effect` rule
// forbids that). ESC and overlay-click are the only effects the shell owns.

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FiCamera, FiRefreshCw, FiX, FiSearch, FiAlertTriangle } from 'react-icons/fi';
import { api } from '../services/api';
import { LookupLoadingComposition } from './LookupLoadingComposition';
import { LookupResultCard } from './LookupResultCard';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const MAX_BYTES = 25 * 1024 * 1024;

export function LookupModal({ open, onClose, onPickMatch }) {
  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        >
          {/* Keying on `open` remounts the body on every open, so internal
              state (phase, probe, error) is reset cleanly without any
              setState-in-effect workarounds. */}
          <LookupModalBody key={open ? 'open' : 'closed'} onClose={onClose} onPickMatch={onPickMatch} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default LookupModal;

function LookupModalBody({ onClose, onPickMatch }) {
  const [phase, setPhase] = useState('idle'); // idle | searching | results
  const [probeFile, setProbeFile] = useState(null);
  const [probeUrl, setProbeUrl] = useState(null);
  const [drag, setDrag] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeStep, setActiveStep] = useState('uploading');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  // Stable ref to the current probe URL so we can revoke it on unmount.
  const probeUrlRef = useRef(null);

  // Revoke the probe object URL when the body unmounts (i.e. on close).
  // This is the only effect that needs to know about the URL lifetime.
  useEffect(() => {
    return () => {
      const url = probeUrlRef.current;
      if (url) URL.revokeObjectURL(url);
      probeUrlRef.current = null;
    };
  }, []);

  const onPickFile = useCallback((file) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type || 'unknown'}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`);
      return;
    }
    setError(null);
    if (probeUrlRef.current) URL.revokeObjectURL(probeUrlRef.current);
    const url = URL.createObjectURL(file);
    probeUrlRef.current = url;
    setProbeFile(file);
    setProbeUrl(url);
  }, []);

  const onInputChange = (e) => onPickFile(e.target.files?.[0]);

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    onPickFile(e.dataTransfer.files?.[0]);
  };

  const runSearch = useCallback(async () => {
    if (!probeFile) return;
    setPhase('searching');
    setActiveStep('uploading');
    setUploadProgress(0);
    setError(null);
    const onProgress = (p) => setUploadProgress(p);
    try {
      const r = await api.lookup(probeFile, onProgress);
      setActiveStep('hashing');
      // Tiny delay so the hashing step is visible even on fast networks.
      await new Promise((res) => setTimeout(res, 80));
      setActiveStep('ranking');
      setResult(r);
      setPhase('results');
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Search failed');
      setPhase('idle');
    }
  }, [probeFile]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.96 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className={[
        'relative w-full bg-[var(--color-surface-1)] rounded-3xl shadow-2xl ring-1 ring-amber-500/30 overflow-hidden',
        phase === 'results' ? 'max-w-[1280px] max-h-[calc(100vh-64px)]' : 'max-w-[640px]',
      ].join(' ')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <LookupHeader
        phase={phase}
        probeUrl={probeUrl}
        probeFileName={probeFile?.name}
        meta={result ? { matched: result.matches?.length, indexed: result.indexed_frames, ms: result.elapsed_ms } : null}
        onClose={onClose}
        onRerun={runSearch}
      />

      <div
        className="overflow-y-auto"
        style={{ maxHeight: phase === 'results' ? 'calc(100vh - 64px - 72px)' : 'auto' }}
      >
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <IdleView
              key="idle"
              drag={drag}
              setDrag={setDrag}
              probeUrl={probeUrl}
              error={error}
              onDrop={onDrop}
              onPickClick={() => fileInputRef.current?.click()}
              onClear={() => {
                if (probeUrlRef.current) URL.revokeObjectURL(probeUrlRef.current);
                probeUrlRef.current = null;
                setProbeFile(null);
                setProbeUrl(null);
                setError(null);
              }}
              onSearch={runSearch}
              fileInputRef={fileInputRef}
              onInputChange={onInputChange}
            />
          )}
          {phase === 'searching' && (
            <motion.div
              key="searching"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25 }}
              className="p-6"
            >
              <LookupLoadingComposition
                probeUrl={probeUrl}
                activeStep={activeStep}
                uploadProgress={uploadProgress}
              />
            </motion.div>
          )}
          {phase === 'results' && (
            <ResultsView
              key="results"
              result={result}
              onPickMatch={onPickMatch}
              onRetry={() => setPhase('idle')}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function LookupHeader({ phase, probeUrl, probeFileName, meta, onClose, onRerun }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-4 bg-[var(--color-surface-1)]/90 backdrop-blur-md border-b border-[var(--color-hairline)]">
      {probeUrl && (
        <img
          src={probeUrl}
          alt="probe"
          className="w-12 h-12 rounded-lg object-cover ring-1 ring-amber-500/40"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-display text-lg leading-tight truncate">
          {phase === 'results' ? `Matches for ${probeFileName || 'probe'}` : 'Find by photo'}
        </div>
        {phase === 'results' && meta && (
          <div className="text-[11px] font-mono text-slate-400 truncate">
            {meta.matched ?? 0} matches · searched {meta.indexed ?? 0} indexed frames · {meta.ms ?? 0} ms
          </div>
        )}
        {phase !== 'results' && (
          <div className="text-[11px] font-mono text-slate-400">
            Drop an image or click to browse
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {phase === 'results' && (
          <IconButton onClick={onRerun} title="Re-run search">
            <FiRefreshCw size={16} />
          </IconButton>
        )}
        <IconButton onClick={onClose} title="Close">
          <FiX size={16} />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({ children, ...rest }) {
  return (
    <button
      {...rest}
      className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-[var(--color-surface-2)] transition-colors duration-150"
    >
      {children}
    </button>
  );
}

function IdleView({ drag, setDrag, probeUrl, error, onDrop, onPickClick, onClear, onSearch, fileInputRef, onInputChange }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25 }}
      className="p-6"
    >
      <div className="text-sm text-slate-300 mb-4">
        Drop a still photo to find matching video frames already in your vault. The indexer
        computes a 64-bit perceptual hash and ranks matches by Hamming distance.
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={[
          'relative w-full rounded-xl border-2 border-dashed transition-colors duration-200',
          drag ? 'border-amber-500 bg-amber-500/5' : 'border-amber-500/30 bg-[var(--color-surface-2)]',
        ].join(' ')}
        style={{ minHeight: 240 }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onInputChange}
        />
        {probeUrl ? (
          <div className="p-4 flex items-center gap-4">
            <img src={probeUrl} alt="probe preview" className="w-24 h-24 object-cover rounded-lg ring-1 ring-amber-500/40" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">Probe loaded</div>
              <div className="text-[11px] font-mono text-slate-400">Ready to search</div>
            </div>
            <button
              onClick={onClear}
              className="px-3 py-1.5 text-xs rounded-md text-slate-300 hover:text-white ring-1 ring-[var(--color-hairline)] hover:ring-[var(--color-hairline-strong)]"
            >
              Clear
            </button>
          </div>
        ) : (
          <button
            onClick={onPickClick}
            className="absolute inset-0 grid place-items-center text-amber-300"
            type="button"
          >
            <div className="flex flex-col items-center gap-2">
              <FiCamera size={48} className="animate-[pulse-soft_2.4s_ease-in-out_infinite]" />
              <div className="text-sm font-medium">Click to browse, or drop an image here</div>
              <div className="text-[11px] font-mono text-slate-400">JPEG, PNG, WebP, GIF, BMP · up to 25 MB</div>
            </div>
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 text-sm text-[var(--color-danger)] flex items-center gap-2">
          <FiAlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        {probeUrl && (
          <button
            onClick={onSearch}
            className="px-4 py-2 rounded-md font-medium text-sm bg-[var(--color-route-media)]/20 text-[var(--color-route-media)] ring-1 ring-[var(--color-route-media)]/40 hover:bg-[var(--color-route-media)]/30"
          >
            Search
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ResultsView({ result, onPickMatch, onRetry }) {
  if (!result) return null;
  const matches = result.matches || [];
  if (matches.length === 0) {
    return (
      <div className="p-10 grid place-items-center text-center">
        <div className="w-32 h-32 rounded-full bg-[var(--color-surface-2)] ring-1 ring-[var(--color-hairline)] grid place-items-center text-slate-500">
          <FiSearch size={48} />
        </div>
        <div className="mt-4 font-display text-lg text-white">No matches above threshold</div>
        <div className="mt-1 text-sm text-slate-400 max-w-sm">
          Try a different angle, lighting, or a tighter crop of the face.
        </div>
        <button
          onClick={onRetry}
          className="mt-5 px-4 py-2 rounded-md font-medium text-sm bg-[var(--color-route-media)]/20 text-[var(--color-route-media)] ring-1 ring-[var(--color-route-media)]/40 hover:bg-[var(--color-route-media)]/30"
        >
          Search again
        </button>
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="p-5"
    >
      <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
        <AnimatePresence>
          {matches.map((m, idx) => (
            <LookupResultCard
              key={`${m.media_id}-${m.matched_frame_idx}-${idx}`}
              match={m}
              index={idx}
              onPickMatch={onPickMatch}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
