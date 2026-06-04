import { AnimatePresence, motion } from 'framer-motion';
import { FiX, FiSend, FiTrash2 } from 'react-icons/fi';

export default function CommandBar({ open, count, onForward, onDelete, onClear, label = 'selected' }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="surface-1 rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/10 px-2 py-2 flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="font-mono font-semibold text-slate-100 tnum">{count}</span>
              <span className="text-slate-500">{label}</span>
            </div>
            <div className="w-px h-6 bg-white/10" />
            {onForward && (
              <button
                onClick={onForward}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-sky-400 hover:bg-sky-500/10 transition-colors"
              >
                <FiSend size={14} /> Forward
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <FiTrash2 size={14} /> Delete
              </button>
            )}
            <div className="w-px h-6 bg-white/10" />
            <button
              onClick={onClear}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
              aria-label="Clear selection"
            >
              <FiX size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
