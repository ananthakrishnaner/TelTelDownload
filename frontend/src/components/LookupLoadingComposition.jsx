// LookupLoadingComposition.jsx — the showpiece animation shown while the
// indexer is working (see plan §Frontend UI). Five motion layers, all
// driven by framer-motion + the project's existing CSS keyframes.
//
//   Layer 1: ambient conic-gradient sweep (slow radar feel)
//   Layer 2: 3 rotating rings around the probe thumbnail (gyroscope feel)
//   Layer 3: horizontal scan line crossing the probe + panel
//   Layer 4: 3-step narrative (LookupStepper) + upload progress bar
//   Layer 5: 6 streaming skeleton cards below (ripple in, replaced on response)
//
// All motion is gated on `prefers-reduced-motion: reduce`.

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { LookupStepper } from './LookupStepper';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);
  return reduced;
}

const SKELETON_SHAPES = [
  { ar: '16/9' },
  { ar: '9/16' },
  { ar: '1/1' },
  { ar: '4/5' },
  { ar: '3/2' },
  { ar: '16/9' },
];

export function LookupLoadingComposition({ probeUrl, activeStep, uploadProgress = 0 }) {
  const reduced = useReducedMotion();

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      {/* Layer 1 — ambient conic-gradient sweep. */}
      {!reduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-12 opacity-60"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0%, rgba(244,114,182,0.12) 25%, transparent 50%, rgba(96,165,250,0.10) 75%, transparent 100%)',
            animation: 'spin 8s linear infinite',
            filter: 'blur(8px)',
          }}
        />
      )}

      <div className="relative flex flex-col md:flex-row gap-6 p-6 rounded-2xl bg-[var(--color-surface-1)] ring-1 ring-amber-500/30 shadow-2xl">
        {/* Probe + halo (Layer 2) */}
        <div className="relative shrink-0 mx-auto md:mx-0" style={{ width: 280, height: 280 }}>
          {/* Rotating hex ring (outer). */}
          {!reduced && (
            <svg
              viewBox="0 0 320 320"
              className="absolute inset-0"
              style={{ animation: 'spin 6s linear infinite' }}
            >
              <polygon
                points="160,20 290,80 290,240 160,300 30,240 30,80"
                fill="none"
                stroke="var(--color-route-media)"
                strokeWidth="1.5"
                strokeDasharray="80 40"
                strokeLinecap="round"
              />
            </svg>
          )}
          {/* Counter-rotating dotted ring. */}
          {!reduced && (
            <svg
              viewBox="0 0 320 320"
              className="absolute inset-0"
              style={{ animation: 'spin 9s linear infinite reverse' }}
            >
              {Array.from({ length: 24 }).map((_, i) => {
                const a = (i / 24) * Math.PI * 2;
                const cx = 160 + Math.cos(a) * 110;
                const cy = 160 + Math.sin(a) * 110;
                return <circle key={i} cx={cx} cy={cy} r="2" fill="var(--color-route-media)" />;
              })}
            </svg>
          )}
          {/* Faster dashed inner ring. */}
          {!reduced && (
            <svg
              viewBox="0 0 320 320"
              className="absolute inset-0"
              style={{ animation: 'spin 4s linear infinite' }}
            >
              <circle
                cx="160" cy="160" r="60"
                fill="none"
                stroke="var(--color-route-media)"
                strokeWidth="1.5"
                strokeDasharray="12 6"
                strokeOpacity="0.6"
              />
            </svg>
          )}
          {/* The probe image (clipped to a square). */}
          <div className="absolute inset-10 rounded-lg overflow-hidden ring-1 ring-amber-500/40 shadow-lg">
            {probeUrl ? (
              <img src={probeUrl} alt="Probe" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-[var(--color-surface-2)]" />
            )}
            {/* Layer 3 — scanning sweep across the probe. */}
            {!reduced && (
              <div
                aria-hidden
                className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400 to-transparent"
                style={{
                  animation: 'scanY 2.4s linear infinite',
                  boxShadow: '0 0 24px rgba(244,114,182,0.5)',
                }}
              />
            )}
          </div>
        </div>

        {/* Right column — stepper + progress. */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
              Searching
            </div>
            <LookupStepper activeStep={activeStep} uploadProgress={uploadProgress} />
          </div>

          {/* Upload progress bar (only during uploading). */}
          {activeStep === 'uploading' && (
            <div>
              <div className="h-1 w-full rounded-full bg-amber-500/20 overflow-hidden">
                <motion.div
                  className="h-full bg-amber-500"
                  initial={{ width: '0%' }}
                  animate={{ width: `${Math.max(2, Math.min(100, uploadProgress))}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-400">
                {Math.round(uploadProgress)}% uploaded
              </div>
            </div>
          )}

          {/* Shimmer "thinking" text once the upload is done. */}
          {activeStep !== 'uploading' && (
            <div
              className="text-sm font-medium bg-gradient-to-r from-slate-400 via-white to-slate-400 bg-clip-text text-transparent"
              style={{
                backgroundSize: '200% 100%',
                animation: 'shimmerText 2s linear infinite',
              }}
            >
              Hashing & matching against your indexed vault…
            </div>
          )}
        </div>
      </div>

      {/* Layer 5 — 6 streaming skeleton cards below, ripple in once upload done. */}
      {activeStep !== 'uploading' && (
        <div className="mt-6 columns-1 sm:columns-2 lg:columns-3 gap-4 [content-visibility:auto]">
          {SKELETON_SHAPES.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="mb-4 break-inside-avoid rounded-lg bg-[var(--color-surface-2)] ring-1 ring-[var(--color-hairline)] overflow-hidden"
            >
              <div
                className="w-full"
                style={{
                  aspectRatio: s.ar,
                  background: 'linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface-3) 50%, var(--color-surface-2) 100%)',
                  backgroundSize: '200% 100%',
                  animation: reduced ? 'none' : 'shimmer 2.4s linear infinite',
                }}
              />
              <div className="p-3 space-y-1.5">
                <div className="h-2.5 rounded w-3/4" style={{ background: 'var(--color-surface-3)' }} />
                <div className="h-2 rounded w-1/2" style={{ background: 'var(--color-surface-3)' }} />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Inline keyframes for the one-off animations we use. */}
      <style>{`
        @keyframes scanY {
          0%   { top: 0%; }
          50%  { top: calc(100% - 2px); }
          100% { top: 0%; }
        }
        @keyframes shimmerText {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-[spin_8s_linear_infinite] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
