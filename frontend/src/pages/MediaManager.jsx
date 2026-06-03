import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FiImage, FiVideo, FiTrash2, FiRefreshCcw, FiExternalLink, FiSend, FiX, FiCheck } from 'react-icons/fi';

export default function MediaManager() {
  const [media, setMedia] = useState([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forwardModal, setForwardModal] = useState({ show: false, mediaId: null, targetGroupId: '' });

  useEffect(() => {
    fetchMedia();
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await api.get('/telegram/groups');
      setGroups(res.data.groups || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMedia = async () => {
    try {
      const res = await api.get('/media');
      setMedia(res.data.media || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      await api.delete(`/media/${id}`);
      fetchMedia();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleRetry = async (id) => {
    try {
      await api.post(`/media/${id}/retry`);
      fetchMedia();
    } catch (err) {
      alert('Failed to retry: ' + err.message);
    }
  };

  const openForwardModal = (id = null) => {
    setForwardModal({ show: true, mediaId: id, targetGroupId: groups[0]?.id || '' });
  };

  const confirmForward = async () => {
    if (!forwardModal.targetGroupId) return;
    try {
      if (forwardModal.mediaId) {
        // Single forward
        await api.post(`/media/${forwardModal.mediaId}/forward`, { targetGroupId: forwardModal.targetGroupId });
      } else {
        // Bulk forward via single backend job
        await api.post(`/media/bulk-forward`, { 
          mediaIds: selectedMediaIds, 
          targetGroupId: forwardModal.targetGroupId 
        });
      }
      alert('Forwarding initiated!');
      setForwardModal({ show: false, mediaId: null, targetGroupId: '' });
      setSelectedMediaIds([]);
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  const toggleSelection = (id) => {
    setSelectedMediaIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedMediaIds.length === media.length) setSelectedMediaIds([]);
    else setSelectedMediaIds(media.map(m => m._id));
  };

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-pink-500/10 rounded-2xl text-pink-400 border border-pink-500/20 shadow-[0_0_15px_rgba(236,72,153,0.15)]">
            <FiImage size={28} />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400 tracking-tight flex items-center gap-4">
              Media Vault
            </h1>
            <p className="text-slate-400 font-medium mt-1">Manage and preview downloaded media.</p>
          </div>
        </div>
        
        {media.length > 0 && (
          <div className="flex items-center space-x-4">
            <button onClick={selectAll} className="px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-colors">
              {selectedMediaIds.length === media.length ? 'Deselect All' : 'Select All'}
            </button>
            {selectedMediaIds.length > 0 && (
              <button onClick={() => openForwardModal()} className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-500 transition-colors shadow-lg shadow-purple-500/20">
                <FiSend /> <span>Bulk Forward ({selectedMediaIds.length})</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {media.map((item) => (
          <div 
            key={item._id} 
            onClick={() => toggleSelection(item._id)}
            className={`glass-panel rounded-[1.5rem] overflow-hidden border-2 shadow-lg group hover:border-slate-500 transition-all cursor-pointer relative ${selectedMediaIds.includes(item._id) ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-slate-700/50'}`}
          >
            {selectedMediaIds.includes(item._id) && (
              <div className="absolute top-3 left-3 z-10 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white shadow-lg"><FiCheck size={14} /></div>
            )}
            <div className="h-48 bg-slate-900/80 relative flex items-center justify-center overflow-hidden">
              {item.fileName?.endsWith('.jpg') || item.fileName?.endsWith('.png') ? (
                <img src={`/media/${item.fileName}`} alt="media" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              ) : item.fileName?.endsWith('.mp4') ? (
                <video src={`/media/${item.fileName}`} muted loop playsInline onMouseOver={e => e.target.play()} onMouseOut={e => e.target.pause()} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500">
                  <FiVideo size={48} className="mb-2" />
                  <span className="text-sm font-mono">{item.fileName}</span>
                </div>
              )}
              <div className="absolute top-3 right-3 flex space-x-2">
                <span className={`px-2 py-1 text-xs font-bold uppercase rounded-md shadow-lg ${item.status === 'downloaded' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : item.status === 'uploaded_to_group' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                  {item.status.replace('_', ' ')}
                </span>
              </div>
            </div>
            <div className="p-5" onClick={e => e.stopPropagation()}>
              <p className="text-slate-300 text-sm truncate mb-4">{item.caption || 'No caption'}</p>
              <div className="flex justify-between items-center mt-4">
                <a href={`/media/${item.fileName}`} target="_blank" rel="noreferrer" className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors">
                  <FiExternalLink size={20} />
                </a>
                <div className="flex space-x-2">
                  <button onClick={() => openForwardModal(item._id)} className="p-2 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors" title="Forward to Group">
                    <FiSend size={20} />
                  </button>
                  {item.status === 'failed' && (
                    <button onClick={() => handleRetry(item._id)} className="p-2 text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors" title="Retry Download">
                      <FiRefreshCcw size={20} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(item._id)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Delete">
                    <FiTrash2 size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {media.length === 0 && !loading && (
        <div className="text-center p-20 text-slate-500 font-medium text-lg">
          No media in vault.
        </div>
      )}

      {forwardModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-[2rem] p-8 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-white">Forward Media</h3>
              <button onClick={() => setForwardModal({ show: false, mediaId: null, targetGroupId: '' })} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-full"><FiX size={24} /></button>
            </div>
            <p className="text-slate-400 text-sm mb-6">Select a destination group to forward this media to.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">Destination Group</label>
                <select 
                  value={forwardModal.targetGroupId} 
                  onChange={e => setForwardModal({...forwardModal, targetGroupId: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-purple-500"
                >
                  <option value="" disabled>Select a group...</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.title} ({g.id})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setForwardModal({ show: false, mediaId: null, targetGroupId: '' })} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors">Cancel</button>
              <button onClick={confirmForward} className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors">Forward</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
