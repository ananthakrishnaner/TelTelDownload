import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FiDownload, FiClock, FiCheck, FiPlay } from 'react-icons/fi';

export default function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <div className="p-8 text-gray-400 flex justify-center items-center h-full">Loading Telegram Groups...</div>;
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-gray-400">Manage your Telegram groups and download schedules.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Groups List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gray-800/50 backdrop-blur-md rounded-2xl border border-gray-700/50 overflow-hidden">
            <div className="p-6 border-b border-gray-700/50">
              <h2 className="text-xl font-semibold text-white">Your Groups & Channels</h2>
            </div>
            <div className="divide-y divide-gray-700/50 max-h-[600px] overflow-y-auto">
              {groups.map(group => (
                <div key={group.id} className="p-6 flex items-center justify-between hover:bg-gray-700/20 transition-colors">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold">
                      {group.title.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-white font-medium">{group.title}</h3>
                      <p className="text-sm text-gray-500">{group.isChannel ? 'Channel' : 'Group'} • ID: {group.id}</p>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => handleManualDownload(group.id)}
                      className="p-2 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors border border-blue-500/20"
                      title="Download Now"
                    >
                      <FiDownload size={18} />
                    </button>
                    <button 
                      onClick={() => handleSchedule(group.id, group.title)}
                      className="p-2 bg-purple-500/10 text-purple-400 rounded-lg hover:bg-purple-500/20 transition-colors border border-purple-500/20"
                      title="Schedule Downloads"
                    >
                      <FiClock size={18} />
                    </button>
                  </div>
                </div>
              ))}
              {groups.length === 0 && (
                <div className="p-8 text-center text-gray-500">No groups found. Please ensure you are logged in via Settings.</div>
              )}
            </div>
          </div>
        </div>

        {/* Scheduled Tasks */}
        <div className="space-y-6">
          <div className="bg-gray-800/50 backdrop-blur-md rounded-2xl border border-gray-700/50 overflow-hidden">
            <div className="p-6 border-b border-gray-700/50">
              <h2 className="text-xl font-semibold text-white">Active Schedules</h2>
            </div>
            <div className="divide-y divide-gray-700/50">
              {tasks.map(task => (
                <div key={task._id} className="p-6">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-white font-medium">{task.name}</h3>
                    <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded-full border border-green-500/20 flex items-center">
                      <FiCheck className="mr-1" /> Active
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 flex items-center mt-2">
                    <FiClock className="mr-2" /> Cron: {task.cronExpression}
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="p-8 text-center text-gray-500">No scheduled tasks.</div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
