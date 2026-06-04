// api.js — single axios instance, shared across the app.
//
// We export the default instance (import api from '.../api') for ordinary
// calls, plus a named `api` (import { api } from '.../api') so newer
// features (image-based lookup, reindex) can hang custom methods off
// the same instance without breaking existing call sites.

import axios from 'axios';

const instance = axios.create({
  baseURL: '/api',
  // 60 s default; image-search overrides per-call below.
  timeout: 60_000,
});

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Image-based reverse search (see plan §Lookup) -------------------

/**
 * Upload a probe image and return the top-K matching video frames.
 * `onProgress` is called with a number in [0, 100] as the request body uploads.
 * @param {File|Blob} file
 * @param {(pct: number) => void} [onProgress]
 * @returns {Promise<{ matches, query_phash, threshold, indexed_frames, elapsed_ms }>}
 */
async function lookup(file, onProgress) {
  const fd = new FormData();
  fd.append('image', file, 'probe.jpg');
  const r = await instance.post('/media/lookup', fd, {
    headers: { 'content-type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
    },
  });
  return r.data;
}

/**
 * Re-index the pHash index. Pass a mediaId to reindex one item, or omit
 * to reindex every video that isn't already indexed (server-side cap 5000).
 * @param {string} [mediaId]
 * @returns {Promise<{ queued, ids }>}
 */
async function reindex(mediaId) {
  const r = await instance.post('/media/reindex', mediaId ? { mediaId } : {});
  return r.data;
}

export const api = {
  ...instance,
  lookup,
  reindex,
};

export default instance;
