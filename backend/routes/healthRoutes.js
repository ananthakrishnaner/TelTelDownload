// healthRoutes.js
// Liveness + readiness probes.
//
//   GET /api/health       — always 200, reports component status (liveness)
//   GET /api/ready        — 200 when the process can serve HTTP and
//                           Mongo is connected. THIS is the probe
//                           orchestrators / health-gates should use.
//                           Read endpoints (browse, wipe, etc.) are
//                           usable as soon as this returns 200.
//   GET /api/ready-strict — 200 only when Mongo AND the Telegram session
//                           are usable AND the Rust indexer reports
//                           healthy. Used by code paths that explicitly
//                           need Telegram (download, forward) or the
//                           indexer (image-based search). Surfaced via a
//                           separate route so a cold Telegram / indexer
//                           does NOT take down the whole site.

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const sessionManager = require('../services/sessionManager');
const indexerService = require('../services/indexerService');

const STARTED_AT = Date.now();
const VERSION = process.env.npm_package_version || 'dev';

// 2-second hard timeout on the indexer health check. The indexer
// container is a separate process; we don't want a slow / hung indexer
// to make /ready-strict hang.
const INDEXER_PROBE_TIMEOUT_MS = 2000;

router.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState; // 0..3
  const mongoOk = mongoState === 1;
  const tg = sessionManager.getState();
  const telegram = tg.state;

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

async function _isIndexerReady() {
  try {
    const result = await Promise.race([
      indexerService.health(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('indexer probe timeout')), INDEXER_PROBE_TIMEOUT_MS)),
    ]);
    return !!(result && result.ok);
  } catch (e) {
    return false;
  }
}

// `/ready` is the **deploy health gate**. Treat the backend as ready
// as soon as it can serve HTTP and reach Mongo. Telegram-session state
// and indexer state belong in `/ready-strict` — a cold / disconnected
// session or a slow indexer should not block the site from coming up,
// because read endpoints (Media vault, wipe, scheduler history, etc.)
// all work without them, and the UI surfaces their state on the
// Dashboard already.
router.get('/ready', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  if (mongoOk) {
    return res.json({ ready: true, mongo: mongoOk });
  }
  res.status(503).json({ ready: false, mongo: mongoOk, reason: 'mongo' });
});

router.get('/ready-strict', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const telegramOk = _isTelegramReady();
  const indexerOk = await _isIndexerReady();
  if (mongoOk && telegramOk && indexerOk) {
    return res.json({ ready: true, mongo: mongoOk, telegram: true, indexer: true });
  }
  res.status(503).json({
    ready: false,
    mongo: mongoOk,
    telegram: telegramOk,
    indexer: indexerOk,
    reason: !mongoOk ? 'mongo' : !telegramOk ? 'telegram' : 'indexer',
  });
});

module.exports = router;
