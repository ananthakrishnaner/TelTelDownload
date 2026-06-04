import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { FiX, FiChevronLeft, FiChevronRight, FiSend, FiTrash2, FiRefreshCcw } from 'react-icons/fi';

export default function Lightbox({ items, index, onClose, onIndexChange, onForward, onDelete, onRetry }) {
  useEffect(() => {
    if (index === null || index === undefined) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items, onClose, onIndexChange]);

  const item = items[index];
  if (!item) return null;

  const isImage = item.fileName?.match(/\.(jpe?g|png|gif|webp)$/i);
  const isVideo = item.fileName?.match(/\.(mp4|webm|mov)$/i);
  const mediaUrl = `/media/${item.fileName}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-md flex"
        onClick={onClose}
      >
        {/* Media area */}
        <div className="flex-1 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
          {index > 0 && (
            <button
              onClick={() => onIndexChange(index - 1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              aria-label="Previous"
            >
              <FiChevronLeft size={20} />
            </button>
          )}
          {index < items.length - 1 && (
            <button
              onClick={() => onIndexChange(index + 1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              aria-label="Next"
            >
              <FiChevronRight size={20} />
            </button>
          )}
          {isImage ? (
            <img src={mediaUrl} alt={item.caption || ''} className="max-h-[85vh] max-w-[80vw] object-contain rounded-md" />
          ) : isVideo ? (
            <video src={mediaUrl} controls autoPlay className="max-h-[85vh] max-w-[80vw] rounded-md" />
          ) : (
            <div className="text-slate-400 text-sm font-mono">{item.fileName}</div>
          )}
        </div>

        {/* Metadata panel */}
        <aside
          className="w-80 max-w-[40vw] bg-[var(--color-surface-1)] border-l border-[var(--color-hairline)] p-6 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-6">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Media Detail</span>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200" aria-label="Close">
              <FiX size={18} />
            </button>
          </div>

          <div className="space-y-5 flex-1">
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
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                item.status === 'downloaded' ? 'text-sky-400' :
                item.status === 'uploaded_to_group' ? 'text-emerald-400' :
                item.status === 'failed' ? 'text-rose-400' : 'text-slate-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  item.status === 'downloaded' ? 'bg-sky-400' :
                  item.status === 'uploaded_to_group' ? 'bg-emerald-400' :
                  item.status === 'failed' ? 'bg-rose-400' : 'bg-slate-400'
                }`} />
                {item.status?.replace(/_/g, ' ')}
              </span>
            </div>
            {item.downloadedAt && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Downloaded</p>
                <p className="text-sm text-slate-300 tnum">{new Date(item.downloadedAt).toLocaleString()}</p>
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
        </aside>
      </motion.div>
    </AnimatePresence>
  );
}
