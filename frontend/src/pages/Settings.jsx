import React, { useState } from 'react';
import api from '../services/api';

export default function Settings() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  
  const [phone, setPhone] = useState('');
  const [phoneHash, setPhoneHash] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  
  const [step, setStep] = useState(1); // 1: Creds, 2: Phone, 3: OTP, 4: 2FA, 5: Success

  const saveCreds = async () => {
    await api.post('/telegram/credentials', { apiId, apiHash });
    setStep(2);
  };

  const sendCode = async () => {
    const res = await api.post('/telegram/send-code', { phoneNumber: phone });
    if (res.data.phoneCodeHash) {
      setPhoneHash(res.data.phoneCodeHash);
      setStep(3);
    }
  };

  const signIn = async () => {
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
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Telegram Authentication</h1>
      <p className="text-gray-400 mb-8">Connect your personal Telegram account to manage media.</p>

      <div className="bg-gray-800/80 backdrop-blur-xl p-8 rounded-2xl border border-gray-700/50 shadow-2xl">
        
        {step === 1 && (
          <div className="space-y-6 transform transition-all">
            <h2 className="text-xl font-semibold text-white">1. API Credentials</h2>
            <p className="text-sm text-gray-400">Get these from my.telegram.org</p>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">API ID</label>
              <input type="text" className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none" value={apiId} onChange={e => setApiId(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">API HASH</label>
              <input type="text" className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none" value={apiHash} onChange={e => setApiHash(e.target.value)} />
            </div>
            <button onClick={saveCreds} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors">Save & Continue</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 transform transition-all animate-fade-in-up">
            <h2 className="text-xl font-semibold text-white">2. Phone Number</h2>
            <p className="text-sm text-gray-400">Enter your phone number with country code (e.g. +123456789)</p>
            <div>
              <input type="text" className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1234567890" />
            </div>
            <button onClick={sendCode} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors">Send Code</button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 transform transition-all animate-fade-in-up">
            <h2 className="text-xl font-semibold text-white">3. Enter OTP</h2>
            <p className="text-sm text-gray-400">Enter the code sent to your Telegram app.</p>
            <div>
              <input type="text" className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none tracking-widest text-center text-xl font-bold" value={code} onChange={e => setCode(e.target.value)} placeholder="00000" />
            </div>
            <button onClick={signIn} className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors">Verify Code</button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6 transform transition-all animate-fade-in-up">
            <h2 className="text-xl font-semibold text-white">4. Two-Step Verification</h2>
            <p className="text-sm text-gray-400">Your account has a 2FA password enabled.</p>
            <div>
              <input type="password" className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button onClick={signIn} className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors">Submit Password</button>
          </div>
        )}

        {step === 5 && (
          <div className="text-center py-12 space-y-4">
            <div className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/30">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h2 className="text-2xl font-bold text-white">Authentication Successful!</h2>
            <p className="text-gray-400">Your session has been securely saved. You can now use the Dashboard.</p>
          </div>
        )}

      </div>
    </div>
  );
}
