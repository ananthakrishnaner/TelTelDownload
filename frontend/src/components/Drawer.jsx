import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { FiX } from 'react-icons/fi';

export default function Drawer({ open, onClose, title, subtitle, children, footer, width = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed top-0 right-0 z-[91] h-full w-full ${widths[width]} bg-[var(--color-surface-1)] border-l border-[var(--color-hairline)] shadow-2xl shadow-black/60 flex flex-col`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <header className="flex items-start justify-between px-6 py-5 border-b border-[var(--color-hairline)]">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-100 tracking-tight">{title}</h2>
                {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-200 transition-colors p-1 -m-1"
                aria-label="Close"
              >
                <FiX size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

            {footer && (
              <footer className="px-6 py-4 border-t border-[var(--color-hairline)] flex items-center justify-end gap-2 bg-[var(--color-surface-1)]">
                {footer}
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
