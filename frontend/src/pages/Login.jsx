import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import { FiArrowRight, FiUser, FiLock } from 'react-icons/fi';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/admin/login', { username, password });
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        toast.success('Welcome back', { description: 'Session established · redirects to mission control' });
        navigate('/');
      }
    } catch {
      setError('Invalid admin credentials.');
      toast.error('Sign-in failed', { description: 'Username or password is incorrect.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--color-surface-0)]">
      {/* Subtle dot grid + radial wash */}
      <div className="absolute inset-0 dot-grid opacity-40" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] bg-[var(--color-route-settings)]/5 rounded-full blur-[120px]" />

      <div className="relative z-10 w-full max-w-5xl mx-auto grid md:grid-cols-2 gap-12 px-6 md:px-10 items-center">
        {/* Editorial left column */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="hidden md:block"
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-route-settings)] mb-6">
            Issue №001 · v1.0
          </p>
          <h1 className="font-display text-7xl lg:text-8xl font-light italic text-slate-100 leading-[0.95] tracking-tight">
            Tel<span className="text-[var(--color-route-settings)]">Tel</span>
          </h1>
          <p className="font-display text-2xl text-slate-400 mt-6 font-light leading-snug max-w-md">
            A personal mission control for your Telegram media pipelines.
          </p>
          <div className="mt-12 flex items-center gap-3 text-xs font-mono text-slate-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            All systems operational
          </div>
        </motion.div>

        {/* Form right column */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="surface-1 rounded-xl p-8 shadow-2xl shadow-black/40"
        >
          <div className="md:hidden mb-6">
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-route-settings)] mb-3">
              Issue №001
            </p>
            <h1 className="font-display text-4xl font-light italic text-slate-100">
              Tel<span className="text-[var(--color-route-settings)]">Tel</span>
            </h1>
          </div>

          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Sign in</p>
          <h2 className="font-display text-2xl font-light text-slate-100 mb-8 tracking-tight">
            Welcome back
          </h2>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">
                Username
              </label>
              <div className="relative">
                <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input
                  type="text"
                  required
                  autoFocus
                  className="w-full pl-10 pr-3 py-2.5 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[var(--color-route-settings)] focus:ring-1 focus:ring-[var(--color-route-settings)]/50 transition-colors font-mono"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(''); }}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">
                Password
              </label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input
                  type="password"
                  required
                  className="w-full pl-10 pr-3 py-2.5 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[var(--color-route-settings)] focus:ring-1 focus:ring-[var(--color-route-settings)]/50 transition-colors font-mono"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-400 font-mono">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 bg-slate-100 hover:bg-white text-[var(--color-surface-0)] text-sm font-semibold rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
              ) : (
                <>
                  Sign In <FiArrowRight size={14} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-[10px] font-mono uppercase tracking-widest text-slate-600 text-center">
            build 2f3a9c · 2026
          </p>
        </motion.div>
      </div>
    </div>
  );
}
