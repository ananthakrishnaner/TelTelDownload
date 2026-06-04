// useSessionStatus.js
// Single, app-wide connection to the backend Socket.IO. Exposes a React
// hook that returns the current Telegram session state, the time since
// the last status heartbeat, and a `reconnect()` action.
//
// One provider (in App.jsx) opens the socket; every consumer reads the
// same React state, so the pill in the Sidebar and the badge in the
// Dashboard never disagree.

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { toast } from './useToast';

const INITIAL_STATE = {
  state: 'disconnected',   // 'disconnected' | 'connecting' | 'connected' | 'lost' | 'revoked'
  lastError: null,
  lastConnectedAt: null,
  reconnectAttempts: 0,
  isReconnecting: false,
};

let socket = null;
let lastState = INITIAL_STATE;
const listeners = new Set();
let hasFetchedOnce = false;

function emit(state) {
  lastState = state;
  listeners.forEach((fn) => fn(state));
}

function ensureSocket() {
  if (socket) return socket;
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });

  socket.on('connect', () => { /* connection established, but state is server-driven */ });
  socket.on('disconnect', () => { /* keep lastState; UI can show "offline" if needed */ });
  socket.on('telegram:status', (payload) => {
    if (!payload) return;
    if (payload.state === 'revoked' && lastState.state !== 'revoked') {
      toast.error('Telegram session expired', {
        description: 'Re-authenticate in Settings to resume downloads.',
        duration: 8000,
        action: { label: 'Open Settings', onClick: () => { window.location.hash = ''; window.location.assign('/settings'); } },
      });
    }
    emit(payload);
  });

  return socket;
}

async function fetchInitialState() {
  if (hasFetchedOnce) return;
  hasFetchedOnce = true;
  try {
    const res = await api.get('/telegram/session');
    if (res?.data?.session) emit(res.data.session);
  } catch {
    /* ignore — will be filled by socket event */
  }
}

export function SessionStatusProvider({ children }) {
  useEffect(() => {
    ensureSocket();
    fetchInitialState();
  }, []);

  // We don't actually provide any context — components use the hook
  // which subscribes to the singleton above. The provider exists for
  // documentation/symbolic purposes and a future migration to a real
  // React context if we need per-mount isolation.
  return children;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return lastState;
}

export function useSessionStatus() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [secondsSinceBeat, setSecondsSinceBeat] = useState(0);
  const lastTickRef = useRef(0);

  // Initialize the ref on mount. The hook itself is still pure — the
  // interval is an explicit side effect that updates the visible counter.
  useEffect(() => {
    lastTickRef.current = Date.now();
    const id = setInterval(() => setSecondsSinceBeat(Math.floor((Date.now() - lastTickRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Update tick ref whenever the state actually changes.
  useEffect(() => { lastTickRef.current = Date.now(); }, [state]);

  const reconnect = useCallback(async () => {
    try {
      const res = await api.post('/telegram/session/reconnect');
      if (res?.data?.session) emit(res.data.session);
      return res?.data;
    } catch (e) {
      const code = e?.response?.data?.code;
      if (code === 'SESSION_EXPIRED') {
        toast.error('Cannot reconnect', {
          description: 'Session is revoked. Please sign in again in Settings.',
        });
      } else {
        toast.error('Reconnect failed', { description: e?.message || 'Unknown error' });
      }
      return null;
    }
  }, []);

  return { ...state, secondsSinceBeat, reconnect };
}
