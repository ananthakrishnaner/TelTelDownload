import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiCheckCircle, FiKey, FiSmartphone, FiShield, FiLock, FiSave, FiArrowRight } from 'react-icons/fi';
import api from '../services/api';
import { toast } from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import Stepper from '../components/Stepper';

const STEPS = [
  { label: 'Credentials' },
  { label: 'Phone' },
  { label: 'OTP' },
  { label: '2FA' },
  { label: 'Done' },
];

function Field({ label, value, onChange, type = 'text', placeholder, mono = true, big = false, maxLength, hint }) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-4 py-3 bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded-md text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[var(--color-route-settings)]/50 focus:ring-1 focus:ring-[var(--color-route-settings)]/30 transition-colors text-center ${
          mono ? 'font-mono' : ''
        } ${big ? 'text-2xl tracking-widest' : 'text-sm'}`}
      />
      {hint && <p className="text-[10px] text-slate-500 mt-2">{hint}</p>}
    </div>
  );
}

export default function Settings() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneHash, setPhoneHash] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  async function fetchConfig() {
    try {
      const res = await api.get('/system/settings');
      if (res.data.apiId) setApiId(res.data.apiId.toString());
      if (res.data.apiHash) setApiHash(res.data.apiHash.toString());
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig();
  }, []);

  const saveConfig = async () => {
    setLoading(true);
    try {
      await api.put('/system/settings', { apiId, apiHash });
      toast.success('Credentials saved to DB');
    } catch (err) {
      toast.error('Save failed', { description: err.message });
    }
    setLoading(false);
  };

  const saveCreds = async () => {
    setLoading(true);
    try {
      await api.post('/telegram/credentials', { apiId, apiHash });
      setStep(2);
    } catch (err) {
      toast.error('Could not initiate handshake', { description: err.message });
    }
    setLoading(false);
  };

  const sendCode = async () => {
    if (!phone) {
      toast.error('Phone number required');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/telegram/send-code', { phoneNumber: phone });
      if (res.data.phoneCodeHash) {
        setPhoneHash(res.data.phoneCodeHash);
        setStep(3);
      }
    } catch (err) {
      toast.error('Could not send code', { description: err.message });
    }
    setLoading(false);
  };

  const signIn = async () => {
    setLoading(true);
    try {
      await api.post('/telegram/sign-in', { phoneNumber: phone, phoneCodeHash: phoneHash, code, password });
      setStep(5);
      toast.success('Session secured');
    } catch (err) {
      if (err.response?.data?.error === '2FA_REQUIRED') {
        setStep(4);
      } else {
        toast.error('Sign-in failed', { description: err.response?.data?.error || err.message });
      }
    }
    setLoading(false);
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto pb-32 md:pb-12">
      <PageHeader
        eyebrow="System"
        title="Configuration"
        description="Telegram API credentials and MTProto authentication flow."
        accent="settings"
      />

      {/* DB Config panel */}
      <section className="surface-1 rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">Database</p>
            <h3 className="text-sm font-semibold text-slate-100">API credentials</h3>
          </div>
          <button
            onClick={saveConfig}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-slate-100 border border-[var(--color-hairline)] rounded-md transition-colors"
          >
            {loading ? <div className="w-3 h-3 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin" /> : <FiSave size={12} />}
            Save
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="APP ID" value={apiId} onChange={setApiId} placeholder="1234567" />
          <Field label="API HASH" value={apiHash} onChange={setApiHash} placeholder="abc123def456..." />
        </div>
      </section>

      {/* Stepper */}
      <section className="mb-8">
        <Stepper steps={STEPS} current={step - 1} />
      </section>

      {/* Step content */}
      <div className="surface-1 rounded-lg p-6 md:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 1 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-[var(--color-route-settings)]/10 ring-1 ring-[var(--color-route-settings)]/30 flex items-center justify-center text-[var(--color-route-settings)]">
                    <FiKey size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Step 01 · Initiate Handshake</h3>
                    <p className="text-xs text-slate-500">Use the credentials saved above.</p>
                  </div>
                </div>
                <button
                  onClick={saveCreds}
                  disabled={loading || !apiId || !apiHash}
                  className="w-full py-3 bg-[var(--color-route-settings)]/15 text-[var(--color-route-settings)] ring-1 ring-[var(--color-route-settings)]/30 rounded-md text-sm font-semibold hover:bg-[var(--color-route-settings)]/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading
                    ? <div className="w-4 h-4 border-2 border-[var(--color-route-settings)]/30 border-t-[var(--color-route-settings)] rounded-full animate-spin" />
                    : <>Start Authentication Flow <FiArrowRight size={14} /></>
                  }
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-[var(--color-route-settings)]/10 ring-1 ring-[var(--color-route-settings)]/30 flex items-center justify-center text-[var(--color-route-settings)]">
                    <FiSmartphone size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Step 02 · Identity Verification</h3>
                    <p className="text-xs text-slate-500">International E.164 format required.</p>
                  </div>
                </div>
                <Field label="Phone" value={phone} onChange={setPhone} placeholder="+1234567890" big />
                <button
                  onClick={sendCode}
                  disabled={loading || !phone}
                  className="w-full py-3 bg-[var(--color-route-settings)]/15 text-[var(--color-route-settings)] ring-1 ring-[var(--color-route-settings)]/30 rounded-md text-sm font-semibold hover:bg-[var(--color-route-settings)]/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading
                    ? <div className="w-4 h-4 border-2 border-[var(--color-route-settings)]/30 border-t-[var(--color-route-settings)] rounded-full animate-spin" />
                    : <>Transmit OTP Request <FiArrowRight size={14} /></>
                  }
                </button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-[var(--color-route-settings)]/10 ring-1 ring-[var(--color-route-settings)]/30 flex items-center justify-center text-[var(--color-route-settings)]">
                    <FiShield size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Step 03 · OTP Authentication</h3>
                    <p className="text-xs text-slate-500">Awaiting Telegram system payload.</p>
                  </div>
                </div>
                <Field label="Code" value={code} onChange={setCode} placeholder="00000" big maxLength={5} />
                <button
                  onClick={signIn}
                  disabled={loading || code.length < 5}
                  className="w-full py-3 bg-[var(--color-route-settings)]/15 text-[var(--color-route-settings)] ring-1 ring-[var(--color-route-settings)]/30 rounded-md text-sm font-semibold hover:bg-[var(--color-route-settings)]/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading
                    ? <div className="w-4 h-4 border-2 border-[var(--color-route-settings)]/30 border-t-[var(--color-route-settings)] rounded-full animate-spin" />
                    : <>Verify Token <FiArrowRight size={14} /></>
                  }
                </button>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 flex items-center justify-center text-rose-400">
                    <FiLock size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">Step 04 · 2FA Enforced</h3>
                    <p className="text-xs text-slate-500">Cloud password required to unlock session.</p>
                  </div>
                </div>
                <Field label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
                <button
                  onClick={signIn}
                  disabled={loading || !password}
                  className="w-full py-3 bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30 rounded-md text-sm font-semibold hover:bg-rose-500/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading
                    ? <div className="w-4 h-4 border-2 border-rose-400/30 border-t-rose-400 rounded-full animate-spin" />
                    : <>Authenticate <FiArrowRight size={14} /></>
                  }
                </button>
              </div>
            )}

            {step === 5 && (
              <div className="text-center py-10 space-y-5">
                <div className="relative inline-block">
                  <div className="absolute inset-0 bg-emerald-400/20 rounded-full blur-2xl animate-pulse-soft" />
                  <div className="relative w-20 h-20 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto ring-1 ring-emerald-500/30">
                    <FiCheckCircle size={36} />
                  </div>
                </div>
                <div>
                  <h3 className="font-display text-3xl font-light text-slate-100 tracking-tight mb-2">Session Secured</h3>
                  <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                    Your MTProto connection is authenticated and state is preserved. You can now operate the dashboard.
                  </p>
                </div>
                <a
                  href="/"
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest text-slate-100 border border-[var(--color-hairline)] rounded-md hover:border-slate-400 transition-colors"
                >
                  Go to Dashboard <FiArrowRight size={12} />
                </a>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
