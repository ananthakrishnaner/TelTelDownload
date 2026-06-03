import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { io } from 'socket.io-client';
import { FiActivity, FiXCircle, FiRefreshCcw, FiTrash2 } from 'react-icons/fi';

export default function ActiveJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef(null);

  useEffect(() => {
    fetchJobs();

    socketRef.current = io(window.location.origin);
    
    socketRef.current.on('job_progress', (data) => {
      setJobs(prev => prev.map(job => 
        job.id === data.jobId 
          ? { ...job, progress: data.progress, total: data.total }
          : job
      ));
    });

    return () => socketRef.current.disconnect();
  }, []);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await api.get('/telegram/active-jobs');
      setJobs(res.data.jobs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const stopJob = async (id) => {
    try {
      await api.post(`/telegram/stop-job/${id}`);
      fetchJobs();
    } catch (err) {
      alert('Failed to stop job: ' + err.message);
    }
  };

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 rounded-2xl text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
            <FiActivity size={28} />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400 tracking-tight">Active Jobs</h1>
            <p className="text-slate-400 font-medium mt-1">Monitor and control your running transfers.</p>
          </div>
        </div>
        <button onClick={fetchJobs} className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors">
          <FiRefreshCcw className={loading ? "animate-spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="glass-panel rounded-[2rem] overflow-hidden border border-slate-700/50 shadow-2xl">
        {jobs.length === 0 && !loading ? (
          <div className="text-center p-20 text-slate-500 font-medium text-lg flex flex-col items-center">
            <FiActivity size={48} className="mb-4 text-slate-600" />
            No active jobs running at the moment.
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {jobs.map(job => {
              const percentage = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
              const isRunning = job.status === 'running';
              return (
                <div key={job.id} className={`p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:bg-white/[0.02] transition-colors relative overflow-hidden ${!isRunning ? 'opacity-50' : ''}`}>
                  {isRunning && (
                    <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300" style={{width: `${percentage}%`}}></div>
                  )}
                  
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className={`px-2 py-1 text-xs font-bold uppercase rounded-md border ${isRunning ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                        {job.status}
                      </span>
                      <span className="text-slate-400 text-sm font-mono tracking-wider">{job.type.replace('_', ' ').toUpperCase()}</span>
                    </div>
                    <h3 className="text-white font-bold text-lg">Group ID: {job.groupId}</h3>
                    <p className="text-slate-500 text-sm mt-1">Started at: {new Date(job.startedAt).toLocaleTimeString()}</p>
                  </div>

                  <div className="flex flex-col md:flex-row items-center gap-6 w-full md:w-auto">
                    <div className="flex flex-col items-center min-w-[120px]">
                      <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 to-blue-500">{percentage}%</span>
                      <span className="text-slate-400 text-xs font-medium uppercase tracking-widest mt-1">{job.progress} / {job.total} Files</span>
                    </div>
                    
                    {isRunning && (
                      <button 
                        onClick={() => stopJob(job.id)}
                        className="w-full md:w-auto flex items-center justify-center space-x-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl transition-all font-bold group"
                      >
                        <FiXCircle className="group-hover:scale-110 transition-transform" /> <span>Stop Job</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
