// indexerService.js — thin HTTP client to the Rust indexer container.
//
// The indexer is reachable on the compose net at INDEXER_URL (default
// http://indexer:9000). The Node backend is a pure proxy — it never hashes
// anything. All work happens in the Rust service.
//
// Resilience:
//   - 30 s HTTP timeout per call
//   - 2 retries with 500 ms backoff on 5xx / network errors (no retry on 4xx)
//   - Tiny circuit breaker: 5 consecutive failures -> open 30 s -> half-open
//
// The breaker state is process-local; on a backend restart it resets. That's
// fine — we just retry the next call normally.

const path = require('path');

const INDEXER_URL = process.env.INDEXER_URL || 'http://indexer:9000';
const INDEXER_MEDIA_DIR = process.env.INDEXER_MEDIA_DIR || '/media';

const CLIENT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;
const CB_FAIL_THRESHOLD = 5;
const CB_OPEN_DURATION_MS = 30_000;

const cb = { failures: 0, openedAt: 0 };

function _breakerOpen() {
  if (cb.failures < CB_FAIL_THRESHOLD) return false;
  if (Date.now() - cb.openedAt < CB_OPEN_DURATION_MS) return true;
  // Half-open: allow one probe through.
  return false;
}

function _recordSuccess() { cb.failures = 0; }
function _recordFailure() {
  cb.failures += 1;
  if (cb.failures === CB_FAIL_THRESHOLD) cb.openedAt = Date.now();
}

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function _req(method, route, opts = {}) {
  if (_breakerOpen()) {
    const err = new Error('indexer circuit breaker open');
    err.code = 'CB_OPEN';
    throw err;
  }
  const url = `${INDEXER_URL}${route}`;
  const fetchOpts = { method, ...opts };
  delete fetchOpts.timeout;

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await _fetchWithTimeout(url, fetchOpts);
      if (res.status >= 500) {
        lastErr = new Error(`indexer ${method} ${route} -> ${res.status}`);
        lastErr.status = res.status;
        if (attempt < MAX_RETRIES) { await _sleep(RETRY_BACKOFF_MS); continue; }
        _recordFailure();
        throw lastErr;
      }
      if (res.status >= 400) {
        const body = await res.text().catch(() => '');
        const err = new Error(`indexer ${method} ${route} -> ${res.status} ${body.slice(0, 200)}`);
        err.status = res.status;
        // 4xx is a bug in OUR request, not a transient failure — don't count
        // it against the breaker, and don't retry.
        throw err;
      }
      _recordSuccess();
      return await res.json();
    } catch (e) {
      // Network / abort / 5xx — retryable.
      if (e && e.status && e.status < 500) throw e; // already-formatted 4xx
      lastErr = e;
      if (attempt < MAX_RETRIES) { await _sleep(RETRY_BACKOFF_MS); continue; }
      _recordFailure();
      throw e;
    }
  }
  _recordFailure();
  throw lastErr || new Error('indexer request failed');
}

// ---- Public API --------------------------------------------------------

/** GET /health -> { ok, indexed_media, indexed_frames, threshold, uptime_secs } */
exports.health = () => _req('GET', '/health');

/**
 * POST /index
 * @param {{ path: string, mediaId: string, frames?: number }} args
 * @returns {Promise<{ media_id, frames, duration }>}
 */
exports.indexFile = async ({ path: filePath, mediaId, frames = 5 }) => {
  if (!filePath) throw new Error('indexFile: path is required');
  if (!mediaId) throw new Error('indexFile: mediaId is required');
  return _req('POST', '/index', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: filePath, media_id: String(mediaId), frames }),
  });
};

/**
 * POST /search
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ matches, query_phash, threshold, indexed_frames }>}
 */
exports.search = async (imageBuffer) => {
  if (!Buffer.isBuffer(imageBuffer)) throw new Error('search: imageBuffer must be a Buffer');
  const fd = new FormData();
  // Node 18+ global File/Blob are available; FormData accepts a Blob.
  const blob = new Blob([imageBuffer]);
  fd.append('image', blob, 'probe.jpg');
  return _req('POST', '/search', { body: fd });
};

/**
 * Build the path the indexer will see for a file written by telegramService.
 * The backend writes to e.g. /usr/src/app/media_downloads/<fileName>; the
 * indexer container has the same dir bind-mounted at /media, so we translate.
 */
exports.buildIndexerPath = (fileName) => path.join(INDEXER_MEDIA_DIR, fileName);

exports.config = { INDEXER_URL, INDEXER_MEDIA_DIR, CLIENT_TIMEOUT_MS };
