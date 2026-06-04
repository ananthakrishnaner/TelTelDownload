// LookupResultCard.jsx — one card in the results masonry.
// Anatomy (top-to-bottom):
//   1. Matched-frame thumbnail (intrinsic aspect ratio, object-cover)
//   2. ScoreRing (top-right, 56px, color-banded)
//   3. Match-strength pill (top-left, success/warning/slate)
//   4. Info panel (filename + meta + frame detail) with gradient fade-up
//   5. Action row (revealed on hover) with "Open in vault" and "Copy link"
//
// Click anywhere (not on action buttons) to invoke onPickMatch(match).

import { motion } from 'framer-motion';
import { FiArrowUpRight, FiLink2 } from 'react-icons/fi';
import { useState } from 'react';
import { ScoreRing } from './ScoreRing';

function humanSize(n) {
  if (!n && n !== 0) return null;
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

function fmtDuration(secs) {
  if (!secs || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function band(score) {
  if (score >= 0.9) return { label: 'Strong match', cls: 'bg-[var(--color-success)]/20 text-[var(--color-success)]' };
  if (score >= 0.7) return { label: 'Possible match', cls: 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]' };
  return { label: 'Low confidence', cls: 'bg-[var(--color-surface-3)]/80 text-slate-300' };
}

export function LookupResultCard({ match, index, onPickMatch, channelName, fileSize, durationSecs }) {
  const [hover, setHover] = useState(false);
  const b = band(match.score);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onPickMatch?.(match)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickMatch?.(match); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.45, delay: Math.min(index, 12) * 0.04, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ scale: 1.02, transition: { duration: 0.18 } }}
      className="group relative mb-4 break-inside-avoid cursor-pointer rounded-lg overflow-hidden bg-[var(--color-surface-2)] ring-1 ring-amber-500/20 hover:ring-2 hover:ring-amber-500/50 shadow-lg hover:shadow-2xl"
    >
      {/* Thumbnail */}
      <div className="relative w-full bg-[var(--color-surface-2)]">
        {match.thumb_url ? (
          <img
            src={match.thumb_url}
            alt={match.file_name || 'Matched frame'}
            loading="lazy"
            className="block w-full h-auto object-cover"
          />
        ) : (
          <div className="aspect-video grid place-items-center text-slate-500 text-xs font-mono">
            no preview
          </div>
        )}
        {/* Shimmer overlay (plays for 1.2s on first decode). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          style={{
            backgroundSize: '200% 100%',
            animation: hover ? 'none' : 'shimmer 2.4s linear infinite',
            opacity: 0.5,
          }}
        />
        {/* Score ring (top-right). */}
        <div className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur-md p-1.5 shadow-md">
          <ScoreRing score={match.score || 0} size={56} stroke={4} />
        </div>
        {/* Match-strength pill (top-left). */}
        <div className={`absolute top-3 left-3 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider font-semibold backdrop-blur-sm ${b.cls}`}>
          {b.label}
        </div>
        {/* Info panel — gradient fade-up from the bottom. */}
        <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-12 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          <div className="font-mono text-[13px] text-white truncate">
            {match.file_name || match.media_id}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-300 truncate">
            {[
              channelName || (match.channel_id ? String(match.channel_id) : null),
              humanSize(fileSize),
              fmtDuration(durationSecs),
            ].filter(Boolean).join(' · ')}
          </div>
          {Number.isFinite(match.matched_frame_idx) && (
            <div className="mt-0.5 font-mono text-[11px] text-amber-300">
              ▸ Frame {match.matched_frame_idx + 1} matched
              {Number.isFinite(durationSecs) && durationSecs > 0
                ? ` at ${fmtDuration(((match.matched_frame_idx || 0) + 0.5) * (durationSecs / 5))}`
                : ''}
            </div>
          )}
        </div>
        {/* Action row — revealed on hover. */}
        <div
          className={[
            'absolute inset-x-0 top-2 flex items-center justify-end gap-2 px-3 transition-opacity duration-200',
            hover ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onPickMatch?.(match); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-surface-1)]/90 backdrop-blur-md text-white text-[11px] font-medium ring-1 ring-white/10 hover:bg-[var(--color-surface-1)]"
          >
            <FiArrowUpRight size={12} /> Open in vault
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (!match.thumb_url) return;
              try { await navigator.clipboard?.writeText(match.thumb_url); } catch { /* clipboard blocked */ }
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-surface-1)]/90 backdrop-blur-md text-white text-[11px] font-medium ring-1 ring-white/10 hover:bg-[var(--color-surface-1)]"
          >
            <FiLink2 size={12} /> Copy link
          </button>
        </div>
      </div>
    </motion.div>
  );
}
