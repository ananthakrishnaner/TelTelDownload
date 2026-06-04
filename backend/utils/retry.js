// retry.js
// Shared retry helper for all Telegram-bound operations.
//
// Three error classes get treated differently:
//   1. FloodWaitError (GramJS) — wait the exact `seconds` Telegram demands
//      before retrying. This OVERRIDES the backoff schedule; we never
//      retry faster than Telegram allows.
//   2. SESSION_REVOKED / AUTH_KEY_UNREGISTERED — surface as SESSION_EXPIRED
//      so callers can prompt the user to re-auth. Do NOT retry; it will
//      keep failing.
//   3. Everything else — exponential backoff with jitter, capped at maxMs.
//
// The helper takes an `onRetry` callback so the caller can surface
// progress (toast, log line) between attempts.

const DEFAULT_OPTS = {
  attempts: 4,
  baseMs: 1000,
  maxMs: 60_000,
  onRetry: null,
};

function isFloodWait(err) {
  if (!err) return false;
  // GramJS: FloodWaitError has `.seconds`
  if (typeof err.seconds === 'number') return true;
  const msg = err.message || '';
  return msg.includes('FLOOD_WAIT') || msg.includes('FloodWaitError') || /wait of \d+ seconds/i.test(msg);
}

function floodWaitSeconds(err) {
  if (typeof err.seconds === 'number') return err.seconds;
  const m = /wait of (\d+) seconds/i.exec(err.message || '');
  if (m) return parseInt(m[1], 10);
  return 30;
}

function isAuthError(err) {
  if (!err) return false;
  const msg = err.message || '';
  return msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('SESSION_REVOKED');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with retry. `fn` receives `(attempt)` and is expected to
 * return a Promise.
 *
 * Throws SESSION_EXPIRED on auth errors and the last error otherwise.
 */
async function retryWithBackoff(fn, opts = {}) {
  const { attempts, baseMs, maxMs, onRetry } = { ...DEFAULT_OPTS, ...opts };
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break;

      if (isAuthError(err)) {
        const e = new Error('Telegram session expired or revoked');
        e.code = 'SESSION_EXPIRED';
        e.cause = err;
        throw e;
      }

      let waitMs;
      if (isFloodWait(err)) {
        waitMs = floodWaitSeconds(err) * 1000;
      } else {
        // Exponential with full jitter, capped.
        const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
        waitMs = Math.floor(Math.random() * exp);
      }

      if (typeof onRetry === 'function') {
        try { onRetry({ attempt, err, waitMs, reason: isFloodWait(err) ? 'flood_wait' : 'transient' }); } catch (e) { /* ignore */ }
      }
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

module.exports = {
  retryWithBackoff,
  isFloodWait,
  isAuthError,
  floodWaitSeconds,
};
