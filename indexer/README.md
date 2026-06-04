# teltel_indexer (Rust)

A separate-container microservice that computes 64-bit perceptual hashes (pHash) of video frames in the TelTel Media Vault and serves a `POST /search` endpoint to find matches from a probe image.

## API

| Route | Method | Body | Response |
|---|---|---|---|
| `/health` | GET | – | `{ ok, indexed_media, indexed_frames, threshold, uptime_secs }` |
| `/index` | POST | JSON `{ path, media_id, frames? }` | `{ media_id, frames: [{ idx, phash, thumb_path, duration, width, height }] }` |
| `/search` | POST | multipart `image` | `{ matches: [{ media_id, score, matched_frame_idx, thumb_url, file_name, channel_id }] }` |

## Curl examples

```bash
# Health
curl http://localhost:9000/health

# Index a video
curl -X POST http://localhost:9000/index \
  -H 'content-type: application/json' \
  -d '{"path":"/media/-1003797535973_182.mp4","media_id":"65f3a8b1c9d4e2f0a1b2c3d4","frames":5}'

# Search
curl -X POST http://localhost:9000/search -F image=@probe.jpg | jq
```

## Environment

- `PORT` (default 9000)
- `MEDIA_DIR` (default `/media`) — the directory in this container where video files are bind-mounted
- `MONGO_URI` (default `mongodb://mongodb:27017/teltel`)
- `INDEXER_HAMMING_THRESHOLD` (default 12) — max Hamming distance for a match
- `INDEXER_FRAMES_PER_VIDEO` (default 5)
- `INDEXER_REFRESH_SECS` (default 30) — how often to reload the in-memory index from Mongo
- `RUST_LOG` (default `info`)

## Perf

- pHash DCT: < 5 ms per frame
- `/index`: < 1.5 s per video (5 frames + Mongo write)
- `/search`: < 100 ms typical (1 probe hash + 50K linear scan)
- Image size: ~150 MB (debian:bookworm-slim + ffmpeg 6)
