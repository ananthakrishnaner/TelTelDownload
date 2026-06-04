// healthRoutes.js
// Liveness + readiness probes.
//
//   GET /api/health       — always 200, reports component status (liveness)
//   GET /api/ready        — 200 when the process can serve HTTP and
//                           Mongo is connected. THIS is the probe
//                           orchestrators / health-gates should use.
//                           Read endpoints (browse, wipe, etc.) are
//                           usable as soon as this returns 200.
//   GET /api/ready-strict — 200 only when Mongo AND the Telegram
//                           session are usable. Used by code paths
//                           that explicitly need Telegram (download,
//                           forward). Surfaced via a separate route
//                           so a cold / revoked Telegram session
//                           does NOT take down the whole site.

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const sessionManager = require('../services/sessionManager');

const STARTED_AT = Date.now();
const VERSION = process.env.npm_package_version || 'dev';

router.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState; // 0..3
  const mongoOk = mongoState === 1;
  const tg = sessionManager.getState();
  const telegram = tg.state; // 'connected' | 'connecting' | 'lost' | 'revoked' | 'disconnected'

  res.json({
    status: mongoOk ? 'ok' : 'degraded',
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    version: VERSION,
    mongo: { ok: mongoOk, state: mongoState },
    telegram: { state: telegram, lastError: tg.lastError, isReconnecting: tg.isReconnecting },
    timestamp: new Date().toISOString(),
  });
});

function _isTelegramReady() {
  const tg = sessionManager.getState();
  return tg.state === sessionManager.STATES.CONNECTED
      || tg.state === sessionManager.STATES.CONNECTING;
}

// `/ready` is the **deploy health gate**. Treat the backend as ready
// as soon as it can serve HTTP and reach Mongo. Telegram-session
// state belongs in `/ready-strict` — a cold / disconnected session
// should not block the site from coming up, because read endpoints
// (Media vault, wipe, scheduler history, etc.) all work without it,
// and the UI surfaces the Telegram state on the Dashboard already.
router.get('/ready', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  if (mongoOk) {
    return res.json({ ready: true, mongo: mongoOk });
  }
  res.status(503).json({ ready: false, mongo: mongoOk, reason: 'mongo' });
});

router.get('/ready-strict', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const telegramOk = _isTelegramReady();
  if (mongoOk && telegramOk) {
    return res.json({ ready: true, mongo: mongoOk, telegram: true });
  }
  res.status(503).json({
    ready: false,
    mongo: mongoOk,
    telegram: telegramOk,
    reason: !mongoOk ? 'mongo' : 'telegram',
  });
});

module.exports = router;
