import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FiDownload, FiClock, FiCheck, FiPlay, FiSearch, FiLayers, FiActivity, FiRefreshCw } from 'react-icons/fi';

export default function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [groupsRes, tasksRes] = await Promise.all([
        api.get('/telegram/groups'),
        api.get('/scheduler')
      ]);
      setGroups(groupsRes.data.groups || []);
      setTasks(tasksRes.data.tasks || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualDownload = async (groupId) => {
    try {
      await api.post('/telegram/download', { groupId });
      alert('Download triggered in background!');
    } catch (err) {
      alert('Error triggering download: ' + err.message);
    }
  };

  const handleSchedule = async (groupId, title) => {
    const cron = prompt('Enter a cron expression (e.g. "0 * * * *" for hourly):', '0 * * * *');
    if (!cron) return;

    try {
      await api.post('/scheduler', {
        name: `Download ${title}`,
        cronExpression: cron,
        targetChannels: [groupId],
        isActive: true
      });
      fetchData();
    } catch (err) {
      alert('Failed to schedule: ' + err.message);
    }
  };

  const filteredGroups = groups.filter(g => g.title?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 bg-gradient-to-r from-blue-900/10 to-indigo-900/10 p-6 md:p-8 rounded-[2rem] border border-blue-500/10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full mix-blend-screen filter blur-[80px]"></div>
        <div className="relative z-10">
          <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400 tracking-tight mb-2">
            Command Center
          </h1>
          <p className="text-slate-400 text-sm md:text-base font-medium">Orchestrate and automate your Telegram media pipelines.</p>
        </div>
        <button onClick={fetchData} className="group relative z-10 flex items-center px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-medium transition-all shadow-lg hover:shadow-white/5">
          <FiRefreshCw className={`mr-2 transition-transform ${loading ? 'animate-spin' : 'group-hover:rotate-180 duration-500'}`} />
          Refresh Sync
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Groups List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel rounded-[2rem] border border-slate-700/50 overflow-hidden shadow-2xl flex flex-col h-[700px]">
            
            <div className="p-6 md:p-8 border-b border-slate-700/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800/30">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20 shadow-inner">
                  <FiLayers size={22} />
                </div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Sources</h2>
              </div>
              <div className="relative w-full md:w-64 group">
                <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                <input 
                  type="text" 
                  placeholder="Search channels..." 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700/50 text-slate-200 placeholder-slate-500 rounded-xl pl-11 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all shadow-inner"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-slate-700/30">
              {loading && groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
                  <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                  <p className="font-medium">Syncing Telegram Directory...</p>
                </div>
              ) : filteredGroups.map((group, i) => (
                <div key={group.id} className="p-4 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-white/[0.02] transition-colors group animate-fade-in-up" style={{animationDelay: `${i * 0.05}s`}}>
                  <div className="flex items-center space-x-4 mb-4 sm:mb-0">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-xl font-bold text-white border border-slate-600/50 shadow-inner group-hover:border-blue-500/30 transition-colors shrink-0 relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      <span className="relative z-10 drop-shadow-md">{group.title.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-white font-semibold text-lg truncate pr-4 group-hover:text-blue-200 transition-colors">{group.title}</h3>
                      <div className="flex items-center mt-1 space-x-2 text-xs font-medium">
                        <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">{group.isChannel ? 'Channel' : 'Group'}</span>
                        <span className="text-slate-500 font-mono">ID: {group.id}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-3 shrink-0">
                    <button 
                      onClick={() => handleManualDownload(group.id)}
                      className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-500/10 text-blue-400 font-medium rounded-xl hover:bg-blue-500/20 transition-all border border-blue-500/20 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                    >
                      <FiDownload size={16} />
                      <span className="hidden sm:inline">Pull</span>
                    </button>
                    <button 
                      onClick={() => handleSchedule(group.id, group.title)}
                      className="flex items-center justify-center space-x-2 px-4 py-2 bg-purple-500/10 text-purple-400 font-medium rounded-xl hover:bg-purple-500/20 transition-all border border-purple-500/20 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                    >
                      <FiClock size={16} />
                      <span className="hidden sm:inline">Cron</span>
                    </button>
                  </div>
                </div>
              ))}
              {!loading && filteredGroups.length === 0 && (
                <div className="p-12 text-center flex flex-col items-center justify-center h-full opacity-50">
                  <FiLayers size={48} className="mb-4 text-slate-600" />
                  <p className="text-lg text-slate-400 font-medium">No sources found.</p>
                  <p className="text-sm text-slate-500 mt-2">Connect your account in Settings.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scheduled Tasks */}
        <div className="space-y-6">
          <div className="glass-panel rounded-[2rem] border border-slate-700/50 overflow-hidden shadow-2xl h-auto lg:h-[700px] flex flex-col">
            <div className="p-6 md:p-8 border-b border-slate-700/50 bg-slate-800/30 flex items-center space-x-3">
              <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20 shadow-inner">
                <FiActivity size={22} />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Active Jobs</h2>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-slate-700/30">
              {tasks.map((task, i) => (
                <div key={task._id} className="p-6 group hover:bg-white/[0.02] transition-colors animate-fade-in-up" style={{animationDelay: `${i * 0.1}s`}}>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-white font-semibold pr-2 leading-tight">{task.name}</h3>
                    <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider rounded-full border border-emerald-500/20 flex items-center shrink-0 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5 animate-pulse"></div> Active
                    </span>
                  </div>
                  <div className="flex items-center text-sm font-mono text-slate-400 bg-slate-900/50 p-2.5 rounded-lg border border-slate-700/50">
                    <FiClock className="mr-2 text-slate-500" /> {task.cronExpression}
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="p-12 text-center flex flex-col items-center justify-center h-full opacity-50">
                  <FiActivity size={48} className="mb-4 text-slate-600" />
                  <p className="text-lg text-slate-400 font-medium">No active jobs.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
