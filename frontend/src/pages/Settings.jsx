import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { FiSmartphone, FiKey, FiLock, FiShield, FiCheckCircle, FiSave, FiSettings as FiSettingsIcon } from 'react-icons/fi';

export default function Settings() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  
  const [phone, setPhone] = useState('');
  const [phoneHash, setPhoneHash] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await api.get('/system/settings');
      if (res.data.apiId) setApiId(res.data.apiId);
      if (res.data.apiHash) setApiHash(res.data.apiHash);
    } catch (err) {
      console.error(err);
    } finally {
      setConfigLoading(false);
    }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      await api.put('/system/settings', { apiId, apiHash });
      alert('Config saved to database.');
    } catch (err) {
      alert('Error saving config');
    }
    setLoading(false);
  };

  const saveCreds = async () => {
    setLoading(true);
    await api.post('/telegram/credentials', { apiId, apiHash });
    setStep(2);
    setLoading(false);
  };

  const sendCode = async () => {
    setLoading(true);
    const res = await api.post('/telegram/send-code', { phoneNumber: phone });
    if (res.data.phoneCodeHash) {
      setPhoneHash(res.data.phoneCodeHash);
      setStep(3);
    }
    setLoading(false);
  };

  const signIn = async () => {
    setLoading(true);
    try {
      await api.post('/telegram/sign-in', { phoneNumber: phone, phoneCodeHash: phoneHash, code, password });
      setStep(5);
    } catch (err) {
      if (err.response?.data?.error === '2FA_REQUIRED') {
        setStep(4);
      } else {
        alert('Error: ' + err.response?.data?.error);
      }
    }
    setLoading(false);
  };

  return (
    <div className="p-4 md:p-10 max-w-3xl mx-auto animate-fade-in pb-20">
      
      <div className="mb-10">
        <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-indigo-300 to-purple-400 tracking-tight mb-2">
          System Configuration
        </h1>
        <p className="text-slate-400 font-medium">Manage your Telegram API credentials and establish MTProto connections.</p>
      </div>

      <div className="glass-panel p-6 md:p-10 rounded-[2rem] border border-slate-700/50 shadow-2xl relative overflow-hidden mb-8">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/10 rounded-full mix-blend-screen filter blur-[100px] pointer-events-none"></div>
        <div className="relative z-10 space-y-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400 border border-blue-500/20">
                <FiSettingsIcon size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Database Config</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">Credentials stored securely in MongoDB.</p>
              </div>
            </div>
            <button onClick={saveConfig} disabled={loading} className="px-5 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl font-bold transition-all border border-blue-500/30 flex items-center shadow-lg hover:shadow-[0_0_15px_rgba(59,130,246,0.2)]">
               {loading ? <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mr-2"></div> : <FiSave className="mr-2" />} Save Settings
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2 uppercase tracking-wider">APP ID</label>
              <input type="text" className="w-full px-5 py-4 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all shadow-inner font-mono" value={apiId} onChange={e => setApiId(e.target.value)} placeholder="e.g. 1234567" disabled={configLoading} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2 uppercase tracking-wider">API HASH</label>
              <input type="text" className="w-full px-5 py-4 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-blue-500/50 outline-none transition-all shadow-inner font-mono" value={apiHash} onChange={e => setApiHash(e.target.value)} placeholder="e.g. abc123def456..." disabled={configLoading} />
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 md:p-10 rounded-[2rem] border border-slate-700/50 shadow-2xl relative overflow-hidden">
        
        {/* Dynamic Background */}
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-600/10 rounded-full mix-blend-screen filter blur-[100px] pointer-events-none"></div>

        {step === 1 && (
          <div className="space-y-8 animate-fade-in-up">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400 border border-indigo-500/20">
                <FiKey size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Step 1: Initiate Handshake</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">Uses the API credentials stored above.</p>
              </div>
            </div>
            
            <button onClick={saveCreds} disabled={loading} className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold tracking-wide transition-all shadow-lg hover:shadow-blue-500/25 transform hover:-translate-y-0.5 disabled:opacity-50 flex justify-center">
              {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Start Authentication Flow'}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8 animate-fade-in-up">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400 border border-indigo-500/20">
                <FiSmartphone size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Identity Verification</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">International E.164 format required.</p>
              </div>
            </div>

            <div>
              <input type="text" className="w-full px-5 py-5 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 outline-none transition-all shadow-inner font-mono text-2xl tracking-wider text-center" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1234567890" />
            </div>
            
            <button onClick={sendCode} disabled={loading} className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-bold tracking-wide transition-all shadow-lg hover:shadow-indigo-500/25 transform hover:-translate-y-0.5 disabled:opacity-50 flex justify-center">
               {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Transmit OTP Request'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8 animate-fade-in-up">
             <div className="flex items-center space-x-4">
              <div className="p-3 bg-purple-500/10 rounded-2xl text-purple-400 border border-purple-500/20">
                <FiShield size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">OTP Authentication</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">Awaiting telegram system payload.</p>
              </div>
            </div>

            <div>
              <input type="text" className="w-full px-5 py-5 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 outline-none transition-all shadow-inner font-mono text-4xl tracking-[1em] text-center" value={code} onChange={e => setCode(e.target.value)} placeholder="00000" maxLength={5} />
            </div>
            
            <button onClick={signIn} disabled={loading} className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl font-bold tracking-wide transition-all shadow-lg hover:shadow-purple-500/25 transform hover:-translate-y-0.5 disabled:opacity-50 flex justify-center">
               {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Verify Token'}
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-8 animate-fade-in-up">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-rose-500/10 rounded-2xl text-rose-400 border border-rose-500/20">
                <FiLock size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">2FA Enforced</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">Cloud password required to unlock session.</p>
              </div>
            </div>

            <div>
              <input type="password" className="w-full px-5 py-4 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500/50 outline-none transition-all shadow-inner text-xl" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            
            <button onClick={signIn} disabled={loading} className="w-full py-4 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white rounded-xl font-bold tracking-wide transition-all shadow-lg hover:shadow-rose-500/25 transform hover:-translate-y-0.5 disabled:opacity-50 flex justify-center">
               {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Authenticate'}
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="text-center py-16 space-y-6 animate-fade-in-up">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-emerald-500/20 rounded-full filter blur-xl animate-pulse-slow"></div>
              <div className="relative w-24 h-24 bg-emerald-500/10 text-emerald-400 rounded-3xl flex items-center justify-center mx-auto border border-emerald-500/30 shadow-[inset_0_0_20px_rgba(16,185,129,0.2)]">
                <FiCheckCircle size={48} />
              </div>
            </div>
            <div>
              <h2 className="text-3xl font-black text-white tracking-tight mb-2">Session Secured</h2>
              <p className="text-slate-400 font-medium max-w-md mx-auto">Your MTProto connection is successfully authenticated and state is preserved. You may now operate the Dashboard.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
