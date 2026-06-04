import Drawer from './Drawer';
import { FiAlertTriangle } from 'react-icons/fi';

export default function ConfirmDrawer({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', destructive = false, loading = false }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors disabled:opacity-50 ${
              destructive
                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 ring-1 ring-rose-500/30'
                : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 ring-1 ring-sky-500/30'
            }`}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-4">
        {destructive && (
          <div className="shrink-0 w-10 h-10 rounded-full bg-rose-500/10 ring-1 ring-rose-500/30 flex items-center justify-center text-rose-400">
            <FiAlertTriangle size={18} />
          </div>
        )}
        <p className="text-sm text-slate-300 leading-relaxed">{description}</p>
      </div>
    </Drawer>
  );
}
