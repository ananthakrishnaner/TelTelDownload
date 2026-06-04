const Media = require('../models/Media');
const fs = require('fs');
const path = require('path');

exports.getMedia = async (req, res) => {
  try {
    const { status, channelId, page = 1, limit = 1000 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (channelId) query.channelId = channelId;

    const media = await Media.find(query)
      .sort({ downloadedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Media.countDocuments(query);

    // Mark each row with `previewAvailable: true/false` so the UI can
    // show a placeholder for items whose file is gone (e.g. cleaned up
    // after a forward to a target group, or stored on a different
    // volume). Cheaper than making the browser probe every <img>.
    const enriched = media.map((m) => {
      const obj = m.toObject ? m.toObject() : m;
      obj.previewAvailable = !!(m.localPath && fs.existsSync(m.localPath));
      return obj;
    });

    res.json({ media: enriched, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/media/from-disk
 *
 * Authoritative listing: walks ./media_downloads/ and returns EVERY file
 * that exists on disk, regardless of whether the Media Mongo doc is
 * present. The user explicitly wants the Vault to reflect the actual
 * storage, not "what the database happens to know about".
 *
 * This is the only endpoint the UI now needs for the main grid. It
 * does NOT touch the database, and it does NOT delete anything — it
 * only reads.
 *
 * Reconciles two cases that the DB-only listing misses:
 *   - Orphan file on disk (no Media doc, e.g. download succeeded but
 *     Media.create was skipped on a duplicate-detection path)
 *   - Media doc exists but the file is gone (forwarded + unlinked,
 *     or wiped from disk out-of-band)
 *
 * For orphans we synthesise a minimal Media-shaped object so the
 * existing UI grid + Lightbox keep working.
 *
 * Optional query params:
 *   page, limit    — pagination (default page=1, limit=1000)
 *   channelId      — filter by channelId (only meaningful for DB rows;
 *                    orphans have unknown channelId)
 *   status         — filter by status (DB rows only)
 *   type           — 'photo' | 'video' | 'all' (default 'all'); uses
 *                    extension to bucket
 *
 * Response: { media, total, pages, source: { fromDb, fromDisk, orphans } }
 *   - `total` is the total number of rows after filtering, BEFORE pagination
 *   - `pages` is ceil(total/limit)
 *   - `source` is a per-source count for the UI to surface ("123 on disk
 *     · 118 in DB · 5 orphans")
 */
exports.getMediaFromDisk = async (req, res) => {
  try {
    const { status, channelId, page = 1, limit = 1000, type = 'all' } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(5000, Math.max(1, parseInt(limit) || 300));
    const downloadDir = path.join(__dirname, '..', 'media_downloads');

    // Read every file on disk. If the directory doesn't exist yet
    // (e.g. nothing has ever been downloaded) return an empty list.
    let diskFiles = [];
    if (fs.existsSync(downloadDir)) {
      diskFiles = fs.readdirSync(downloadDir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    }

    // Bucket disk files by Media doc, so we can attach DB metadata when
    // present and synthesise an orphan stub when not.
    // Filename convention: `${channelId}_${telegramMessageId}${ext}` —
    // see telegramService.js downloadAndMaybeUpload.
    const fileNameToDb = new Map();
    for (const fn of diskFiles) fileNameToDb.set(fn, null);

    // Pull DB rows that match a known file on disk. We still pull all
    // DB rows (within reason) so users can see "uploaded to group" or
    // "failed" rows whose file is gone.
    const dbQuery = {};
    if (status) dbQuery.status = status;
    if (channelId) dbQuery.channelId = channelId;
    const dbRows = await Media.find(dbQuery).sort({ downloadedAt: -1 });
    const dbByFileName = new Map();
    for (const row of dbRows) {
      if (row.fileName) dbByFileName.set(row.fileName, row);
    }

    // Build the unified list. Start with DB rows, then append any disk
    // file that doesn't have a corresponding DB row (orphan).
    const seenFileNames = new Set();
    const rows = [];
    let fromDb = 0;
    let orphans = 0;

    const matchesType = (fn) => {
      if (type === 'all') return true;
      const lower = (fn || '').toLowerCase();
      const photoExts = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
      const videoExts = /\.(mp4|webm|mov|m4v|mkv|3gp)$/i;
      if (type === 'photo') return photoExts.test(lower);
      if (type === 'video') return videoExts.test(lower);
      return true;
    };

    for (const row of dbRows) {
      if (row.fileName && !matchesType(row.fileName)) continue;
      const obj = row.toObject ? row.toObject() : row;
      obj.previewAvailable = !!(row.localPath && fs.existsSync(row.localPath));
      obj.source = obj.previewAvailable ? 'db+disk' : 'db';
      rows.push(obj);
      if (row.fileName) seenFileNames.add(row.fileName);
      fromDb += 1;
    }

    for (const fn of diskFiles) {
      if (seenFileNames.has(fn)) continue;
      if (!matchesType(fn)) continue;
      const fullPath = path.join(downloadDir, fn);
      let stats = null;
      try { stats = fs.statSync(fullPath); } catch (_) { /* file vanished between readdir and stat */ continue; }
      rows.push({
        _id: `orphan-${fn}`,
        fileName: fn,
        localPath: fullPath,
        caption: '(orphan file — no metadata on disk)',
        status: 'orphan',
        // Mtime doubles as a stand-in "downloadedAt" for sorting.
        downloadedAt: stats.mtime,
        fileSize: stats.size,
        previewAvailable: true,
        source: 'disk',
        // Channel id is encoded in the filename `${channelId}_${msgId}${ext}`.
        // Surface it so the channel filter still works.
        channelId: (fn.split('_')[0] || ''),
        telegramMessageId: Number((fn.match(/_(\d+)(?:\.[^.]+)?$/) || [])[1] || 0) || undefined,
      });
      orphans += 1;
    }

    // Sort by mtime/downloadedAt desc so the most recent is first.
    rows.sort((a, b) => {
      const aT = new Date(a.downloadedAt || 0).getTime();
      const bT = new Date(b.downloadedAt || 0).getTime();
      return bT - aT;
    });

    const total = rows.length;
    const start = (pageNum - 1) * limitNum;
    const pageRows = rows.slice(start, start + limitNum);

    res.json({
      media: pageRows,
      total,
      pages: Math.ceil(total / limitNum),
      page: pageNum,
      limit: limitNum,
      source: { fromDb, fromDisk: diskFiles.length, orphans },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Not found' });

    // Best-effort file delete, sandboxed to ./media_downloads.
    let fileDeleted = false;
    let fileError = null;
    if (media.localPath) {
      const downloadDir = path.resolve(__dirname, '..', '..', 'media_downloads');
      const resolved = path.resolve(media.localPath);
      const inSandbox = resolved === downloadDir || resolved.startsWith(downloadDir + path.sep);
      if (inSandbox && fs.existsSync(resolved)) {
        try { fs.unlinkSync(resolved); fileDeleted = true; }
        catch (e) { fileError = e.message; }
      }
    }

    await Media.findByIdAndDelete(req.params.id);
    res.json({ success: true, fileDeleted, fileError });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};

exports.bulkDeleteMedia = async (req, res) => {
  try {
    const { mediaIds } = req.body;
    if (!mediaIds || !Array.isArray(mediaIds) || mediaIds.length === 0) {
      return res.status(400).json({ error: 'Invalid mediaIds array' });
    }

    // Sanity check the download dir once, same as wipe-all.
    const downloadDir = path.resolve(__dirname, '..', '..', 'media_downloads');

    // Fetch every targeted doc in one query, then unlink best-effort
    // under the same path-sandbox rule as wipe-all, then issue a
    // single deleteMany. The old code was N round-trips (1 find +
    // 1 delete per id) and would 500 if any row had a stray
    // localPath outside the downloads dir.
    const docs = await Media.find({ _id: { $in: mediaIds } });
    let filesDeleted = 0;
    let filesMissing = 0;
    let filesFailed = 0;
    for (const m of docs) {
      if (!m.localPath) { filesMissing += 1; continue; }
      const resolved = path.resolve(m.localPath);
      if (!resolved.startsWith(downloadDir + path.sep) && resolved !== downloadDir) {
        filesFailed += 1;
        continue;
      }
      if (!fs.existsSync(resolved)) { filesMissing += 1; continue; }
      try { fs.unlinkSync(resolved); filesDeleted += 1; }
      catch (e) { filesFailed += 1; }
    }
    const docResult = await Media.deleteMany({ _id: { $in: mediaIds } });

    res.json({
      success: true,
      requested: mediaIds.length,
      deleted: {
        docs: docResult.deletedCount || 0,
        files: filesDeleted,
        filesMissing,
        filesFailed,
        notFound: mediaIds.length - docs.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};

/**
 * Wipe All — drop every Media doc and unlink every file on disk.
 *
 * This is destructive. The caller (UI) is expected to have walked
 * the user through a 3-step confirmation modal. The backend just
 * enforces a hard "confirm" token in the request body to make
 * accidental CLI hits obvious in the logs.
 *
 * Body: { confirm: "WIPE_ALL" }
 * Response: { success, deleted: { docs, files } }
 */
exports.wipeAllMedia = async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'WIPE_ALL') {
      return res.status(400).json({
        error: 'Missing confirmation token. Body must be { confirm: "WIPE_ALL" }.',
      });
    }
    // Sanity check: can we even see the downloads dir from the running
    // process? If the volume mount is wrong (common after a deploy),
    // every unlinkSync would throw EBADF/EACCES and the user would
    // see 500 even though their request was correct.
    const downloadDir = path.resolve(__dirname, '..', '..', 'media_downloads');
    let dirOk = true;
    try { fs.accessSync(downloadDir, fs.constants.W_OK); }
    catch (e) { dirOk = false; }
    const all = await Media.find({}, { localPath: 1 });
    let filesDeleted = 0;
    let filesMissing = 0;
    let filesFailed = 0;
    for (const m of all) {
      if (!m.localPath) { filesMissing += 1; continue; }
      // Defensive: only unlink paths under our known media dir. A
      // stray Media doc with a stray localPath (e.g. set on a
      // different machine) would otherwise let one bad row tank
      // the whole wipe.
      const resolved = path.resolve(m.localPath);
      if (!resolved.startsWith(downloadDir + path.sep) && resolved !== downloadDir) {
        filesFailed += 1;
        continue;
      }
      if (!fs.existsSync(resolved)) { filesMissing += 1; continue; }
      try { fs.unlinkSync(resolved); filesDeleted += 1; }
      catch (e) { filesFailed += 1; }
    }
    const docResult = await Media.deleteMany({});
    res.json({
      success: true,
      deleted: {
        docs: docResult.deletedCount || 0,
        files: filesDeleted,
        filesMissing,
        filesFailed,
      },
      dirOk,
      downloadDir,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};

exports.retryMedia = async (req, res) => {
  try {
    const { targetGroupId } = req.body || {};
    const telegramService = require('../services/telegramService');
    // Launch in background; return immediately so the request doesn't block
    // on what can be a long-running download (especially for video).
    telegramService.retryMediaItem(req.params.id, targetGroupId)
      .then(() => console.log('Retried media ' + req.params.id))
      .catch(err => console.error('Retry failed for ' + req.params.id, err));

    res.json({ success: true, message: 'Retry initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code || 'RETRY_ERROR' });
  }
};

exports.bulkRetryMedia = async (req, res) => {
  try {
    const { mediaIds, targetGroupId } = req.body;
    if (!mediaIds || !Array.isArray(mediaIds) || mediaIds.length === 0) {
      return res.status(400).json({ error: 'mediaIds must be a non-empty array' });
    }
    const telegramService = require('../services/telegramService');

    // Run retries sequentially in the background. We don't have a single
    // jobId for the bulk yet, so we fire one retryMediaItem per id.
    (async () => {
      for (const id of mediaIds) {
        if (!id) continue;
        try {
          await telegramService.retryMediaItem(id, targetGroupId);
        } catch (err) {
          console.error('Bulk retry item failed', id, err.message);
        }
      }
      console.log(`Bulk retry finished (${mediaIds.length} items)`);
    })().catch(console.error);

    res.json({ success: true, message: `Bulk retry initiated (${mediaIds.length} items)` });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code || 'BULK_RETRY_ERROR' });
  }
};

exports.forwardMedia = async (req, res) => {
  try {
    const { targetGroupId } = req.body;
    const telegramService = require('../services/telegramService');
    telegramService.forwardLocalMedia(req.params.id, targetGroupId)
      .then(() => console.log('Forwarded media ' + req.params.id))
      .catch(err => console.error(err));
      
    res.json({ success: true, message: 'Forwarding initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.bulkForwardMedia = async (req, res) => {
  try {
    const { mediaIds, targetGroupId } = req.body;
    const telegramService = require('../services/telegramService');
    
    // Launch in background
    telegramService.bulkForwardLocalMedia(mediaIds, targetGroupId)
      .then(count => console.log(`Bulk forwarded ${count} items`))
      .catch(err => console.error(err));

    res.json({ success: true, message: 'Bulk forwarding initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMediaStats = async (req, res) => {
  try {
    const stats = await Media.aggregate([
      { $group: { _id: "$channelId", count: { $sum: 1 } } }
    ]);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Distinct channels represented in the Media collection, with a
 * friendly title and a count of files per channel. Powers the
 * "filter by channel" dropdown in the Media Vault.
 */
exports.getMediaChannels = async (req, res) => {
  try {
    const stats = await Media.aggregate([
      {
        $group: {
          _id: "$channelId",
          count: { $sum: 1 },
          // Keep a sample channelTitle so the dropdown can show a
          // human label instead of a raw numeric id.
          sampleTitle: { $first: "$channelTitle" },
        },
      },
      { $sort: { count: -1 } },
    ]);
    const channels = stats
      .filter((s) => s._id != null)
      .map((s) => ({
        id: String(s._id),
        count: s.count,
        title: s.sampleTitle || String(s._id),
      }));
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================================
// Image-based reverse search (Rust indexer, see plan §Lookup).
// ============================================================================

/**
 * POST /api/media/lookup
 * Multipart, field "image". Forwards to the Rust indexer, joins matches
 * with the Media collection, and returns a UI-ready array.
 */
exports.searchByImage = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Missing image field in multipart body' });
    }
    const indexerService = require('../services/indexerService');
    const t0 = Date.now();
    const result = await indexerService.search(req.file.buffer);
    const rawMatches = (result && result.matches) || [];
    const elapsedMs = Date.now() - t0;

    // Join with the Media collection so the frontend can hand a match
    // straight to the Lightbox.
    const ids = rawMatches.map((m) => m.media_id).filter(Boolean);
    let docs = [];
    if (ids.length > 0) {
      try {
        const mongoose = require('mongoose');
        const objIds = ids
          .map((s) => { try { return new mongoose.Types.ObjectId(String(s)); } catch (e) { return null; } })
          .filter(Boolean);
        docs = await Media.find({ _id: { $in: objIds } });
      } catch (e) {
        // ignore — return raw matches only
      }
    }
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    const matches = rawMatches.map((m) => {
      const doc = byId.get(String(m.media_id));
      const previewAvailable = !!(doc && doc.localPath && fs.existsSync(doc.localPath));
      const thumb_url = m.thumb_path
        ? `/media/${m.thumb_path.replace(/^media\//, '').replace(/^\/+/, '')}`
        : null;
      return {
        media_id: m.media_id,
        score: m.score,
        matched_frame_idx: m.matched_frame_idx,
        thumb_url,
        file_name: doc ? doc.fileName : m.file_name,
        channel_id: doc ? doc.channelId : null,
        telegram_message_id: doc ? doc.telegramMessageId : null,
        caption: doc ? doc.caption : null,
        status: doc ? doc.status : null,
        local_path: doc ? doc.localPath : null,
        downloaded_at: doc ? doc.downloadedAt : null,
        preview_available: previewAvailable,
      };
    });

    res.json({
      matches,
      query_phash: result && result.query_phash,
      threshold: result && result.threshold,
      indexed_frames: result && result.indexed_frames,
      elapsed_ms: elapsedMs,
    });
  } catch (err) {
    const status = err && err.status && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err.message, stack: err.stack });
  }
};

/**
 * POST /api/media/reindex
 * JSON body: { mediaId?: string }
 * If mediaId is given, reindex that one doc. Otherwise reindex every doc
 * with phashed !== true. Fire-and-forget: returns { queued } immediately.
 */
exports.reindexMedia = async (req, res) => {
  try {
    const indexerService = require('../services/indexerService');
    const { mediaId } = (req.body && typeof req.body === 'object') ? req.body : {};
    const query = mediaId
      ? { _id: mediaId }
      : {
          fileName: /\.(mp4|mov|webm|m4v|mkv|avi)$/i,
          $or: [{ phashed: { $ne: true } }, { frames: { $size: 0 } }],
        };
    const targets = await Media.find(query).select({ _id: 1, fileName: 1, localPath: 1 }).limit(5000);
    const queued = [];
    for (const m of targets) {
      const fileName = m.fileName;
      const path = indexerService.buildIndexerPath(fileName);
      // Don't await; run in background.
      indexerService.indexFile({ path, mediaId: String(m._id), frames: 5 })
        .then((r) => Media.updateOne(
          { _id: m._id },
          { $set: { frames: r.frames || [], phashed: true, indexedAt: new Date() } },
        ))
        .catch((err) => console.warn(`[reindex] ${fileName} -> ${err.message}`));
      queued.push(String(m._id));
    }
    res.json({ queued: queued.length, ids: queued.slice(0, 50) });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};

/**
 * GET /api/media/lookup/thumb/:mediaId/:idx
 * Fallback: serve a thumbnail from disk. Most clients use the thumb_url
 * path in /lookup responses (which goes through /media/ -> express.static);
 * this route is here for parity and for clients that can't hit /media/
 * (e.g. CSP-blocked frames).
 */
exports.getLookupThumb = async (req, res) => {
  try {
    const { mediaId, idx } = req.params;
    const doc = await Media.findById(mediaId).select({ frames: 1 });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const frame = (doc.frames || []).find((f) => String(f.idx) === String(idx));
    if (!frame || !frame.thumbPath) return res.status(404).json({ error: 'Frame not found' });
    const downloadDir = path.resolve(__dirname, '..', '..', 'media_downloads');
    const abs = path.resolve(downloadDir, frame.thumbPath);
    if (!abs.startsWith(downloadDir + path.sep)) return res.status(400).json({ error: 'bad path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'thumb missing on disk' });
    res.set('content-type', 'image/jpeg');
    res.set('cache-control', 'public, max-age=86400');
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
