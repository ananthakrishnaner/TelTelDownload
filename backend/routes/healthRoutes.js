// healthRoutes.js
// Liveness + readiness probes.
//
//   GET /api/health  — always 200, reports component status (liveness)
//   GET /api/ready   — 200 only when Mongo is connected AND the
//                      Telegram session is not in a terminal `revoked`
//                      state. Used by load balancers / orchestrators.

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

router.get('/ready', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const tg = sessionManager.getState();
  const telegramReady = tg.state === sessionManager.STATES.CONNECTED || tg.state === sessionManager.STATES.CONNECTING;
  if (mongoOk && telegramReady) {
    return res.json({ ready: true, mongo: mongoOk, telegram: tg.state });
  }
  res.status(503).json({ ready: false, mongo: mongoOk, telegram: tg.state, reason: !mongoOk ? 'mongo' : 'telegram' });
});

module.exports = router;
