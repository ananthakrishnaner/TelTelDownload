import { useState, useEffect, useMemo } from 'react';
import { FiInfo, FiAlertTriangle, FiXCircle, FiSearch } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const LEVELS = [
  { id: 'all', label: 'All' },
  { id: 'info', label: 'Info' },
  { id: 'warning', label: 'Warning' },
  { id: 'error', label: 'Error' },
];

const levelStyle = {
  info: { icon: FiInfo, color: 'text-sky-400', ring: 'ring-sky-400/30', dot: 'bg-sky-400' },
  warning: { icon: FiAlertTriangle, color: 'text-amber-400', ring: 'ring-amber-400/30', dot: 'bg-amber-400' },
  error: { icon: FiXCircle, color: 'text-rose-400', ring: 'ring-rose-400/30', dot: 'bg-rose-400' },
};

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');

  async function fetchLogs() {
    try {
      setLoading(true);
      const res = await api.get('/system/logs');
      setLogs(res.data || []);
    } catch (err) {
      toast.error('Failed to load logs', { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
  }, []);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (level !== 'all' && l.level !== level) return false;
      if (search) {
        const blob = `${l.action} ${JSON.stringify(l.details || {})}`.toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [logs, level, search]);

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="Audit"
        title="System Ledger"
        description="Chronological history of every automated action in the system."
        accent="logs"
      />

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
        <div className="flex items-center gap-1 surface-1 rounded-md p-1">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLevel(l.id)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                level === l.id ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action or details…"
            className="w-full pl-9 pr-3 py-2 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[var(--color-route-logs)]/50 font-mono"
          />
        </div>
        <p className="text-[10px] font-mono text-slate-500 tnum">{filtered.length} of {logs.length}</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FiInfo}
          title="Nothing to show"
          description={logs.length === 0 ? 'No activity recorded yet.' : 'No entries match the current filters.'}
        />
      ) : (
        <div className="surface-1 rounded-lg overflow-hidden">
          <ol className="relative">
            {filtered.map((log, i) => {
              const s = levelStyle[log.level] || levelStyle.info;
              const Icon = s.icon;
              const isLatest = i === 0;
              return (
                <li
                  key={log._id || i}
                  className={`relative px-5 py-3.5 ${i !== 0 ? 'border-t border-[var(--color-hairline)]' : ''} ${
                    isLatest ? 'border-l-2 border-l-[var(--color-route-logs)]' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`shrink-0 w-7 h-7 rounded-full ring-1 ${s.ring} bg-white/[0.03] flex items-center justify-center ${s.color}`}>
                      <Icon size={12} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-500 tnum">{fmtTime(log.timestamp)}</span>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{log.level}</span>
                        <span className="text-sm text-slate-100 font-medium">{log.action}</span>
                      </div>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {Object.entries(log.details).map(([k, v]) => (
                            <span key={k} className="inline-flex items-center gap-1.5 text-[10px] font-mono bg-white/[0.04] ring-1 ring-[var(--color-hairline)] px-1.5 py-0.5 rounded">
                              <span className="text-slate-500">{k}:</span>
                              <span className="text-slate-300 break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
