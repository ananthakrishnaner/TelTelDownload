import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { io } from 'socket.io-client';
import cronParser from 'cron-parser';
import { FiDownload, FiClock, FiSearch, FiLayers, FiActivity, FiRefreshCw, FiImage, FiX, FiTrash2, FiArrowRight, FiCheck } from 'react-icons/fi';

export default function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [mediaStats, setMediaStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [progresses, setProgresses] = useState({});
  const socketRef = useRef(null);

  // Modals state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  
  // Schedule Form
  const [cronExp, setCronExp] = useState('0 * * * *');
  const [targetGroup, setTargetGroup] = useState('');
  
  // Browse Media Form
  const [recentMedia, setRecentMedia] = useState([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  useEffect(() => {
    fetchData();
    socketRef.current = io(window.location.origin);
    socketRef.current.on('progress', (data) => {
      setProgresses(prev => ({
        ...prev,
        [data.groupId]: data
      }));
      if (data.type === 'download_complete' || data.type === 'upload_complete') {
        setTimeout(() => {
          setProgresses(prev => {
            const next = { ...prev };
            delete next[data.groupId];
            return next;
          });
          fetchData(); // Refresh stats
        }, 3000);
      }
    });
    return () => socketRef.current.disconnect();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [groupsRes, tasksRes, statsRes] = await Promise.all([
        api.get('/telegram/groups'),
        api.get('/scheduler'),
        api.get('/media/stats')
      ]);
      setGroups(groupsRes.data.groups || []);
      setTasks(tasksRes.data.tasks || []);
      
      const statsObj = {};
      (statsRes.data || []).forEach(s => statsObj[s._id] = s.count);
      setMediaStats(statsObj);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualDownload = async (groupId) => {
    const target = prompt('Optional: Enter a Destination Group ID to Auto-Upload to (leave blank to just download):');
    try {
      await api.post('/telegram/download', { groupId, targetGroupId: target || null });
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const openScheduleModal = (group) => {
    setSelectedGroup(group);
    setShowScheduleModal(true);
  };

  const submitSchedule = async () => {
    try {
      await api.post('/scheduler', {
        name: `Auto-Sync ${selectedGroup.title}`,
        cronExpression: cronExp,
        targetChannels: [selectedGroup.id],
        isActive: true
        // Note: Future backend update could store targetGroupId in the task too!
      });
      setShowScheduleModal(false);
      fetchData();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const deleteTask = async (id) => {
    if(!confirm('Delete this task?')) return;
    try {
      await api.delete(`/scheduler/${id}`);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const openBrowseMedia = async (group) => {
    setSelectedGroup(group);
    setShowMediaModal(true);
    setMediaLoading(true);
    setRecentMedia([]);
    setSelectedMediaIds([]);
    try {
      const res = await api.get(`/telegram/group-media/${group.id}`);
      setRecentMedia(res.data.media || []);
    } catch (err) {
      alert('Error fetching media: ' + err.message);
    } finally {
      setMediaLoading(false);
    }
  };

  const toggleMediaSelection = (id) => {
    setSelectedMediaIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const downloadSpecific = async () => {
    if (selectedMediaIds.length === 0) return;
    try {
      await api.post('/telegram/download-specific', {
        groupId: selectedGroup.id,
        messageIds: selectedMediaIds,
        targetGroupId: targetGroup || null
      });
      setShowMediaModal(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const formatNextRun = (cron) => {
    try {
      const interval = cronParser.parseExpression(cron);
      return interval.next().toDate().toLocaleString();
    } catch (err) {
      return 'Invalid Cron';
    }
  };

  const filteredGroups = groups.filter(g => g.title?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20 relative">
      
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
                  type="text" placeholder="Search channels..." value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700/50 text-slate-200 placeholder-slate-500 rounded-xl pl-11 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all shadow-inner"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-slate-700/30 relative">
              {loading && groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
                  <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                </div>
              ) : filteredGroups.map((group, i) => (
                <div key={group.id} className="p-4 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-white/[0.02] transition-colors group relative">
                  
                  {/* Progress Bar Overlay */}
                  {progresses[group.id] && (
                    <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300" style={{width: `${progresses[group.id].progress}%`}}></div>
                  )}

                  <div className="flex items-center space-x-4 mb-4 sm:mb-0">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-xl font-bold text-white border border-slate-600/50 shadow-inner group-hover:border-blue-500/30 transition-colors shrink-0">
                      <span>{group.title.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-white font-semibold text-lg truncate pr-4 group-hover:text-blue-200 transition-colors">
                        {group.title}
                        {progresses[group.id] && <span className="ml-2 text-xs text-blue-400 animate-pulse">{progresses[group.id].type === 'upload' ? 'Uploading...' : 'Downloading...'} {progresses[group.id].progress}%</span>}
                      </h3>
                      <div className="flex items-center mt-1 space-x-2 text-xs font-medium">
                        <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">{group.isChannel ? 'Channel' : 'Group'}</span>
                        <span className="text-slate-500 font-mono">ID: {group.id}</span>
                        {mediaStats[group.id] > 0 && <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">{mediaStats[group.id]} Media</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button onClick={() => openBrowseMedia(group)} className="flex items-center space-x-2 px-3 py-1.5 bg-slate-500/10 text-slate-300 text-sm rounded-lg hover:bg-slate-500/20 transition-all border border-slate-500/20">
                      <FiImage /> <span>Browse</span>
                    </button>
                    <button onClick={() => handleManualDownload(group.id)} className="flex items-center space-x-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-sm rounded-lg hover:bg-blue-500/20 transition-all border border-blue-500/20">
                      <FiDownload /> <span>Pull</span>
                    </button>
                    <button onClick={() => openScheduleModal(group)} className="flex items-center space-x-2 px-3 py-1.5 bg-purple-500/10 text-purple-400 text-sm rounded-lg hover:bg-purple-500/20 transition-all border border-purple-500/20">
                      <FiClock /> <span>Schedule</span>
                    </button>
                  </div>
                </div>
              ))}
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
              {tasks.map((task) => (
                <div key={task._id} className="p-6 group hover:bg-white/[0.02] transition-colors relative">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-white font-semibold pr-2 leading-tight">{task.name}</h3>
                    <button onClick={() => deleteTask(task._id)} className="text-slate-500 hover:text-red-400 transition-colors p-1 opacity-0 group-hover:opacity-100"><FiTrash2 /></button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center text-xs font-mono text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-700/50">
                      <FiClock className="mr-2 text-emerald-400" /> Cron: {task.cronExpression}
                    </div>
                    <div className="flex items-center text-xs font-mono text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-700/50">
                      <FiClock className="mr-2 text-blue-400" /> Next: {formatNextRun(task.cronExpression)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Modals */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-[2rem] p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-2xl font-bold text-white mb-2">Schedule Task</h3>
            <p className="text-slate-400 text-sm mb-6">Set up automated downloads for {selectedGroup?.title}.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">Cron Expression</label>
                <input type="text" value={cronExp} onChange={e => setCronExp(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white font-mono focus:ring-2 focus:ring-purple-500" />
              </div>
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setShowScheduleModal(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors">Cancel</button>
              <button onClick={submitSchedule} className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors">Save Job</button>
            </div>
          </div>
        </div>
      )}

      {showMediaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-[2rem] p-8 w-full max-w-4xl shadow-2xl flex flex-col h-[80vh]">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white">Browse {selectedGroup?.title}</h3>
                <p className="text-slate-400 text-sm mt-1">Select specific media to download or auto-forward.</p>
              </div>
              <button onClick={() => setShowMediaModal(false)} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-full"><FiX size={24} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto no-scrollbar bg-slate-950 rounded-xl border border-slate-800 p-4">
              {mediaLoading ? (
                <div className="flex justify-center items-center h-full"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {recentMedia.map(m => (
                    <div 
                      key={m.id} 
                      onClick={() => toggleMediaSelection(m.id)}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${selectedMediaIds.includes(m.id) ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-slate-700 hover:border-slate-500'}`}
                    >
                      <div className="absolute inset-0 bg-slate-800 flex flex-col items-center justify-center p-2 text-center">
                        {m.type === 'photo' ? <FiImage size={32} className="text-slate-500 mb-2" /> : <FiActivity size={32} className="text-slate-500 mb-2" />}
                        <span className="text-xs text-slate-400 line-clamp-2">{m.caption || `Msg ${m.id}`}</span>
                      </div>
                      {selectedMediaIds.includes(m.id) && (
                        <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white"><FiCheck size={14} /></div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <input type="text" placeholder="Optional: Destination Group ID to Auto-Upload" value={targetGroup} onChange={e => setTargetGroup(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500" />
              </div>
              <button 
                onClick={downloadSpecific} 
                disabled={selectedMediaIds.length === 0}
                className="py-3 px-6 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all disabled:opacity-50 flex items-center justify-center"
              >
                Fetch Selected ({selectedMediaIds.length}) <FiArrowRight className="ml-2" />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
