import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FiActivity, FiInfo, FiAlertTriangle, FiXCircle } from 'react-icons/fi';

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/system/logs');
      setLogs(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (level) => {
    switch(level) {
      case 'warning': return <FiAlertTriangle className="text-yellow-500" />;
      case 'error': return <FiXCircle className="text-red-500" />;
      default: return <FiInfo className="text-blue-500" />;
    }
  };

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="flex items-center space-x-4 mb-8">
        <div className="p-3 bg-purple-500/10 rounded-2xl text-purple-400 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
          <FiActivity size={28} />
        </div>
        <div>
          <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400 tracking-tight">System Audit</h1>
          <p className="text-slate-400 font-medium mt-1">Chronological history of all automated actions.</p>
        </div>
      </div>

      <div className="glass-panel rounded-[2rem] border border-slate-700/50 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/50 text-slate-300 text-sm uppercase tracking-wider">
                <th className="p-4 font-semibold">Time</th>
                <th className="p-4 font-semibold">Level</th>
                <th className="p-4 font-semibold">Action</th>
                <th className="p-4 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {logs.map((log) => (
                <tr key={log._id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="p-4 text-slate-400 font-mono text-sm whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-900/50 border border-slate-700/50 group-hover:border-slate-500 transition-colors">
                      {getIcon(log.level)}
                    </span>
                  </td>
                  <td className="p-4 text-white font-medium whitespace-nowrap">
                    {log.action}
                  </td>
                  <td className="p-4 text-slate-400 text-sm">
                    <div className="flex flex-wrap gap-2">
                      {log.details && Object.entries(log.details).map(([key, val]) => (
                        <div key={key} className="bg-slate-900/50 border border-slate-700/50 px-2 py-1 rounded-md flex items-center space-x-2 text-[11px]">
                          <span className="text-slate-500 uppercase tracking-wider font-bold">{key}:</span>
                          <span className="text-slate-300 font-mono break-all">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan="4" className="p-12 text-center text-slate-500 font-medium">No activity recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
