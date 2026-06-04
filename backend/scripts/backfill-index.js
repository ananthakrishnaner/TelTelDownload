// scripts/backfill-index.js
//
// One-shot CLI to backfill the pHash index for every video already on disk
// that hasn't been indexed yet. Run inside the backend container:
//
//   docker exec -d teltel_backend node scripts/backfill-index.js \
//     > /var/log/teltel-backfill.log 2>&1 &
//
// Idempotent: skips Media docs that already have frames.length > 0 and
// phashed === true. Concurrency 4 by default. Progress logged every 50 files.
//
// Env:
//   CONCURRENCY      default 4
//   ONLY_FILE        optional: reindex just one fileName
//   DRY_RUN          if "1", don't call the indexer, just list targets

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Media = require('../models/Media');
const indexerService = require('../services/indexerService');
const { createLimiter } = require('../utils/concurrency');

const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv|avi)$/i;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '4', 10);
const ONLY_FILE = process.env.ONLY_FILE || null;
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://mongodb:27017/teltel';
  console.log(`[backfill] connecting to ${uri}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('[backfill] connected');

  const query = ONLY_FILE
    ? { fileName: ONLY_FILE }
    : {
        fileName: VIDEO_RE,
        $or: [{ phashed: { $ne: true } }, { frames: { $size: 0 } }],
      };

  const targets = await Media.find(query)
    .select({ _id: 1, fileName: 1, localPath: 1, channelId: 1 })
    .lean();

  console.log(`[backfill] candidates: ${targets.length} (concurrency=${CONCURRENCY}, dry_run=${DRY_RUN})`);
  if (DRY_RUN) {
    targets.slice(0, 20).forEach((t) => console.log(`  - ${t.fileName}  (${t._id})`));
    if (targets.length > 20) console.log(`  ... and ${targets.length - 20} more`);
    await mongoose.disconnect();
    return;
  }

  const limit = createLimiter(CONCURRENCY);
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  const logEvery = 50;

  const tasks = targets.map((t) => limit(async () => {
    try {
      if (!t.localPath || !fs.existsSync(t.localPath)) {
        console.warn(`[backfill]   skip (file missing on disk): ${t.fileName}`);
        failed += 1;
        return;
      }
      const indexerPath = indexerService.buildIndexerPath(t.fileName);
      const result = await indexerService.indexFile({
        path: indexerPath,
        mediaId: String(t._id),
        frames: 5,
      });
      await Media.updateOne(
        { _id: t._id },
        { $set: { frames: result.frames || [], phashed: true, indexedAt: new Date() } },
      );
    } catch (err) {
      failed += 1;
      console.warn(`[backfill]   FAIL ${t.fileName} -> ${err.message}`);
    } finally {
      done += 1;
      if (done % logEvery === 0 || done === targets.length) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = (targets.length - done) / Math.max(rate, 0.0001);
        console.log(
          `[backfill] ${done}/${targets.length}  failed=${failed}  ` +
          `elapsed=${elapsed.toFixed(1)}s  rate=${rate.toFixed(2)}/s  eta=${eta.toFixed(0)}s`,
        );
      }
    }
  }));

  await Promise.all(tasks);
  await limit.drain();
  await mongoose.disconnect();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[backfill] DONE: ${done} processed, ${failed} failed, ${elapsed}s elapsed`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
