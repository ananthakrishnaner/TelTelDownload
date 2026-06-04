// LookupStepper.jsx — the 3-step narrative shown in the Searching state.
// "Uploading image" -> "Hashing & matching" -> "Ranking results".
// The active step is highlighted in pink; completed steps get a green
// checkmark; pending steps are slate. Transitions use AnimatePresence.

import { motion, AnimatePresence } from 'framer-motion';
import { FiUpload, FiCpu, FiCheck, FiLoader } from 'react-icons/fi';

const STEPS = [
  { id: 'uploading', label: 'Uploading image', icon: FiUpload },
  { id: 'hashing',   label: 'Hashing & matching', icon: FiCpu },
  { id: 'ranking',   label: 'Ranking results', icon: FiCheck },
];

export function LookupStepper({ activeStep }) {
  return (
    <ol className="flex flex-col gap-3">
      {STEPS.map((s, idx) => {
        const isActive = s.id === activeStep;
        const isDone = STEPS.findIndex((x) => x.id === activeStep) > idx;
        const Icon = isActive && s.id === 'uploading' ? FiLoader : s.icon;
        return (
          <li key={s.id} className="flex items-center gap-3">
            <div
              className={[
                'relative w-9 h-9 rounded-full grid place-items-center transition-colors duration-200',
                isDone
                  ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
                  : isActive
                    ? 'bg-[var(--color-route-media)]/20 text-[var(--color-route-media)]'
                    : 'bg-[var(--color-surface-3)] text-slate-400',
              ].join(' ')}
            >
              {/* Rotating ring around the active hashing step. */}
              {isActive && s.id === 'hashing' && (
                <svg
                  className="absolute inset-0 -m-1 animate-[spin_1.2s_linear_infinite]"
                  viewBox="0 0 44 44"
                >
                  <circle
                    cx="22" cy="22" r="20"
                    fill="none"
                    stroke="var(--color-route-media)"
                    strokeOpacity="0.7"
                    strokeWidth="2"
                    strokeDasharray="20 8"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <AnimatePresence mode="popLayout">
                {isDone ? (
                  <motion.span
                    key="check"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                    className="inline-flex"
                  >
                    <FiCheck size={16} />
                  </motion.span>
                ) : (
                  <motion.span
                    key="icon"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className={`inline-flex ${isActive ? 'animate-[pulse-soft_2.4s_ease-in-out_infinite]' : ''}`}
                  >
                    <Icon size={16} className={isActive && s.id === 'uploading' ? 'animate-spin' : ''} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span
              className={[
                'text-sm transition-colors duration-200',
                isActive ? 'text-white' : isDone ? 'text-[var(--color-success)]' : 'text-slate-400',
              ].join(' ')}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
