// ScoreRing.jsx — small reusable circular progress ring for similarity scores.
// Animates the stroke-dashoffset from 100% to (1 - score) * 100% as the ring
// scrolls into view (framer-motion useInView, once: true).
//
// Color bands match the project tokens in index.css:
//   score >= 0.9 -> success  (green)
//   score >= 0.7 -> warning  (amber)
//   score <  0.7 -> surface-3 (slate)
//
// Used by LookupResultCard.jsx (one per result) and LookupLoadingComposition.jsx
// (the in-flight progress ring during a search).

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

export function ScoreRing({ score = 0, size = 56, stroke = 4, className = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const offset = C * Math.max(0, Math.min(1, 1 - score));
  const color = score >= 0.9 ? 'var(--color-success)'
              : score >= 0.7 ? 'var(--color-warning)'
              : 'var(--color-surface-3)';
  return (
    <div ref={ref} className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: inView ? offset : C }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div
        className="absolute inset-0 grid place-items-center font-mono font-bold text-white"
        style={{ fontSize: Math.max(10, size * 0.28) }}
      >
        {Math.round(score * 100)}
      </div>
    </div>
  );
}
