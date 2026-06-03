import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FiImage, FiVideo, FiTrash2, FiRefreshCcw, FiExternalLink } from 'react-icons/fi';

export default function MediaManager() {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMedia();
  }, []);

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

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-pink-500/10 rounded-2xl text-pink-400 border border-pink-500/20 shadow-[0_0_15px_rgba(236,72,153,0.15)]">
            <FiImage size={28} />
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400 tracking-tight">Media Vault</h1>
            <p className="text-slate-400 font-medium mt-1">Manage and preview downloaded media.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {media.map((item) => (
          <div key={item._id} className="glass-panel rounded-[1.5rem] overflow-hidden border border-slate-700/50 shadow-lg group hover:border-slate-500 transition-colors">
            <div className="h-48 bg-slate-900/80 relative flex items-center justify-center overflow-hidden">
              {item.fileName?.endsWith('.jpg') ? (
                <img src={`/media/${item.fileName}`} alt="media" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
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
            <div className="p-5">
              <p className="text-slate-300 text-sm truncate mb-4">{item.caption || 'No caption'}</p>
              <div className="flex justify-between items-center">
                <a href={`/media/${item.fileName}`} target="_blank" rel="noreferrer" className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors">
                  <FiExternalLink size={20} />
                </a>
                <div className="flex space-x-2">
                  {item.status === 'failed' && (
                    <button onClick={() => handleRetry(item._id)} className="p-2 text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors">
                      <FiRefreshCcw size={20} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(item._id)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
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
    </div>
  );
}
