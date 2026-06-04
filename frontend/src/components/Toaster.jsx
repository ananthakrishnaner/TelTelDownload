import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore } from '../hooks/useToast';
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiInfo, FiX } from 'react-icons/fi';

const variants = {
  success: { icon: FiCheckCircle, color: 'text-emerald-400', ring: 'ring-emerald-400/30' },
  warning: { icon: FiAlertTriangle, color: 'text-amber-400', ring: 'ring-amber-400/30' },
  error:   { icon: FiXCircle,     color: 'text-rose-400',   ring: 'ring-rose-400/30' },
  info:    { icon: FiInfo,        color: 'text-sky-400',    ring: 'ring-sky-400/30' },
};

export default function Toaster() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const v = variants[t.variant] || variants.info;
          const Icon = v.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`pointer-events-auto min-w-[300px] max-w-sm surface-1 rounded-lg shadow-2xl shadow-black/40 ring-1 ${v.ring} overflow-hidden`}
            >
              <div className="flex items-start gap-3 p-3.5">
                <Icon className={`${v.color} shrink-0 mt-0.5`} size={18} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{t.title}</p>
                  {t.description && (
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t.description}</p>
                  )}
                  {t.action && (
                    <button
                      onClick={() => {
                        t.action.onClick();
                        dismiss(t.id);
                      }}
                      className="mt-2 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      {t.action.label} →
                    </button>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                  aria-label="Dismiss"
                >
                  <FiX size={14} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
