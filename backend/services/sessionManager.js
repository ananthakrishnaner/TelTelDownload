// sessionManager.js
// Owns the singleton Telegram client and the connection-state machine.
// Replaces the module-level `let client` that used to live in telegramService.
//
// State machine:
//   disconnected → connecting → connected ⇄ lost
//                                          → revoked (terminal; needs sign-in again)
//
// All status transitions emit a `state` event that other services (and the
// Socket.IO bridge) can subscribe to. The reconnect loop uses exponential
// backoff with a hard cap.

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Setting = require('../models/Setting');
const logActivity = require('../utils/logger');
const { EventEmitter } = require('events');

const STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  LOST: 'lost',
  REVOKED: 'revoked',
};

const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;

// Module-level state. There is exactly one TelegramClient per process.
let client = null;
let state = STATES.DISCONNECTED;
let reconnectAttempts = 0;
let reconnectTimer = null;
let lastError = null;
let lastConnectedAt = null;

const emitter = new EventEmitter();

async function loadCredentials() {
  const apiIdSetting = await Setting.findOne({ key: 'apiId' });
  const apiHashSetting = await Setting.findOne({ key: 'apiHash' });
  const sessionSetting = await Setting.findOne({ key: 'sessionString' });
  return {
    apiId: apiIdSetting ? parseInt(apiIdSetting.value, 10) : null,
    apiHash: apiHashSetting ? apiHashSetting.value : null,
    sessionString: sessionSetting ? sessionSetting.value : '',
  };
}

function transition(next, error = null) {
  const prev = state;
  state = next;
  lastError = error ? (error.message || String(error)) : null;
  if (next === STATES.CONNECTED) {
    lastConnectedAt = Date.now();
    reconnectAttempts = 0;
  }
  if (prev === next) return;
  emitter.emit('state', getState());
  logActivity('Session state change', { from: prev, to: next, error: lastError }, next === STATES.REVOKED ? 'error' : 'info');
}

function getState() {
  return {
    state,
    lastError,
    lastConnectedAt,
    reconnectAttempts,
    isReconnecting: state === STATES.LOST || state === STATES.CONNECTING,
  };
}

function isAuthError(err) {
  if (!err) return false;
  const msg = err.message || '';
  return (
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('SESSION_PASSWORD_NEEDED') === false && msg.includes('AUTH_KEY')
  );
}

/**
 * Build the client from credentials in the DB and connect. Idempotent —
 * safe to call repeatedly; will only do work if state is `disconnected` or `revoked`.
 *
 * Returns true if we end up with a connected, authenticated client.
 */
async function connect() {
  if (state === STATES.CONNECTED && client) return true;
  if (state === STATES.CONNECTING) return false;

  transition(STATES.CONNECTING);

  try {
    const { apiId, apiHash, sessionString } = await loadCredentials();
    if (!apiId || !apiHash) {
      transition(STATES.DISCONNECTED, new Error('API credentials missing'));
      return false;
    }

    // Replace any stale client to avoid leaks.
    if (client) {
      try { await client.disconnect(); } catch (e) { /* ignore */ }
      client = null;
    }

    const stringSession = new StringSession(sessionString || '');
    client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });
    await client.connect();

    // Probe auth state. If we have no sessionString we are connected-but-anonymous.
    const saved = (client.session.save() || '');
    if (saved.length < 8) {
      transition(STATES.DISCONNECTED, new Error('Not signed in'));
      return false;
    }

    transition(STATES.CONNECTED);
    return true;
  } catch (err) {
    if (isAuthError(err)) {
      transition(STATES.REVOKED, err);
    } else {
      transition(STATES.LOST, err);
      scheduleReconnect();
    }
    return false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    transition(STATES.REVOKED, new Error('Reconnect attempts exhausted'));
    return;
  }
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    const ok = await connect();
    if (!ok && state === STATES.LOST) scheduleReconnect();
  }, delay);
  emitter.emit('state', getState());
}

/** Public: report that the client is broken (e.g. caught a 401 mid-job). */
function reportLost(err) {
  if (state === STATES.REVOKED || state === STATES.DISCONNECTED) return;
  transition(STATES.LOST, err);
  scheduleReconnect();
}

function reportRevoked(err) {
  if (state === STATES.REVOKED) return;
  transition(STATES.REVOKED, err);
}

async function reconnectNow() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  if (state === STATES.REVOKED) {
    // Session is gone — caller must re-auth via Settings.
    return { ok: false, reason: 'revoked' };
  }
  const ok = await connect();
  return { ok, state: getState() };
}

function getClient() {
  return client;
}

function hasClient() {
  return client !== null;
}

function on(event, handler) {
  emitter.on(event, handler);
}

function off(event, handler) {
  emitter.off(event, handler);
}

module.exports = {
  STATES,
  connect,
  reconnectNow,
  reportLost,
  reportRevoked,
  getClient,
  hasClient,
  getState,
  on,
  off,
  isAuthError,
};
