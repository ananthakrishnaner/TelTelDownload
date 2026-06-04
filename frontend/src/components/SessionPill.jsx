// SessionPill.jsx
// A compact, color-coded indicator of the current Telegram session state.
//
//   connected    — green, "Telegram · live", small heart
//   connecting   — amber, animated pulse, "Connecting…"
//   lost         — red, "Connection lost — retrying", Retry button
//   revoked      — red, "Session revoked", "Open Settings" link
//   disconnected — gray, "Offline", "Retry" button
//
// Click opens a tiny popover with the underlying details.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FiRefreshCw, FiSettings, FiActivity } from 'react-icons/fi';
import { useSessionStatus } from '../hooks/useSessionStatus';

const VARIANT = {
  connected: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    border: 'border-emerald-400/30',
    label: 'Telegram · live',
  },
  connecting: {
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    border: 'border-amber-400/30',
    label: 'Connecting…',
  },
  lost: {
    dot: 'bg-rose-500',
    text: 'text-rose-300',
    border: 'border-rose-500/30',
    label: 'Reconnecting…',
  },
  revoked: {
    dot: 'bg-rose-600',
    text: 'text-rose-300',
    border: 'border-rose-600/40',
    label: 'Session expired',
  },
  disconnected: {
    dot: 'bg-slate-500',
    text: 'text-slate-300',
    border: 'border-white/10',
    label: 'Offline',
  },
};

export default function SessionPill({ size = 'md' }) {
  const session = useSessionStatus();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const v = VARIANT[session.state] || VARIANT.disconnected;
  const isBusy = session.state === 'connecting' || session.state === 'lost';

  const padding = size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs';
  const handleClick = () => setOpen((o) => !o);

  const onReconnect = async (e) => {
    e.stopPropagation();
    setOpen(false);
    await session.reconnect();
  };

  const onOpenSettings = (e) => {
    e.stopPropagation();
    setOpen(false);
    navigate('/settings');
  };

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className={`flex items-center gap-1.5 ${padding} rounded-full border ${v.border} bg-white/[0.03] hover:bg-white/[0.05] transition-colors`}
        aria-label={`Telegram session ${v.label}`}
      >
        <span className="relative inline-flex">
          <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
          {isBusy && (
            <motion.span
              className={`absolute inset-0 rounded-full ${v.dot} opacity-60`}
              animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
        </span>
        <span className={`font-mono ${v.text} tracking-wide`}>{v.label}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full mt-2 z-50 w-72 surface-1 rounded-lg ring-1 ring-[var(--color-hairline)] p-4 shadow-2xl"
          >
            <div className="flex items-center gap-2 mb-3">
              <FiActivity className="text-slate-500" size={14} />
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Telegram session</p>
            </div>
            <p className="text-sm text-slate-200 mb-2">
              <span className={`font-mono ${v.text}`}>{v.label}</span>
            </p>
            {session.lastError && session.state !== 'connected' && (
              <p className="text-xs text-slate-400 mb-3 break-words">{session.lastError}</p>
            )}
            {session.lastConnectedAt && session.state === 'connected' && (
              <p className="text-[10px] font-mono text-slate-500 mb-3 tnum">
                connected {timeAgo(session.lastConnectedAt)}
              </p>
            )}
            {session.isReconnecting && (
              <p className="text-[10px] font-mono text-slate-500 mb-3 tnum">
                attempt {session.reconnectAttempts || 0}
              </p>
            )}

            <div className="flex gap-2 mt-3">
              {session.state === 'revoked' ? (
                <button
                  onClick={onOpenSettings}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-300 rounded-md hover:bg-rose-500/20 transition-colors"
                >
                  <FiSettings size={12} /> Open Settings
                </button>
              ) : (
                <button
                  onClick={onReconnect}
                  disabled={isBusy}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono bg-white/5 ring-1 ring-[var(--color-hairline)] text-slate-200 rounded-md hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <FiRefreshCw size={12} className={isBusy ? 'animate-spin' : ''} />
                  {isBusy ? 'Reconnecting…' : 'Reconnect now'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
