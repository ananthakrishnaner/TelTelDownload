// handlers.rs — HTTP surface for the indexer.
//
//   GET  /health       — always 200, reports in-memory index size
//   POST /index        — extract frames from a video, compute pHashes, write thumbs + Mongo
//   POST /search       — multipart image upload, pHash it, return top-K matches

use actix_multipart::Multipart;
use actix_web::{get, post, web, HttpResponse};
use chrono::Utc;
use futures_util::StreamExt;
// (image is referenced through fully-qualified paths below; no use needed)
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::ApiError;
use crate::ffmpeg;
use crate::heic;
use crate::mongo::{self, Frame};
use crate::phash::phash as compute_phash;
use crate::search::top_k;
use crate::AppState;

// ---- /health -----------------------------------------------------------

#[derive(Serialize)]
struct HealthResp {
    ok: bool,
    indexed_media: u64,
    indexed_frames: usize,
    threshold: u32,
    uptime_secs: i64,
}

#[get("/health")]
pub async fn health(state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    let indexed_frames = state.index.read().await.len();
    let indexed_media = mongo::count_indexed_media(&state.mongo).await;
    let uptime = (Utc::now() - state.started_at).num_seconds();
    Ok(HttpResponse::Ok().json(HealthResp {
        ok: true,
        indexed_media,
        indexed_frames,
        threshold: state.cfg.threshold,
        uptime_secs: uptime,
    }))
}

// ---- /index ------------------------------------------------------------

#[derive(Deserialize)]
pub struct IndexReq {
    pub path: String,
    pub media_id: String,
    pub frames: Option<u32>,
}

#[derive(Serialize)]
pub struct IndexRespFrame {
    pub idx: u32,
    pub phash: String,
    pub thumb_path: String,
    pub duration: Option<f32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Serialize)]
pub struct IndexResp {
    pub media_id: String,
    pub frames: Vec<IndexRespFrame>,
    pub duration: Option<f32>,
}

#[post("/index")]
pub async fn index_video(
    state: web::Data<AppState>,
    body: web::Json<IndexReq>,
) -> Result<HttpResponse, ApiError> {
    let path = PathBuf::from(&body.path);
    if !path.exists() {
        return Err(ApiError::NotFound(format!("file not found: {}", body.path)));
    }
    let n = body.frames.unwrap_or(state.cfg.frames_per_video);

    let duration = ffmpeg::probe_duration_secs(&path).await;
    let frames = ffmpeg::extract_n_frames(&path, n, duration).await?;
    if frames.is_empty() {
        return Err(ApiError::FrameExtraction(format!(
            "ffmpeg produced 0 frames for {}",
            body.path
        )));
    }

    // Write thumbnails to <MEDIA_DIR>/thumbs/<media_id>/<idx>.jpg
    let thumbs_dir = state.cfg.media_dir.join("thumbs").join(&body.media_id);
    tokio::fs::create_dir_all(&thumbs_dir)
        .await
        .map_err(|e| ApiError::Io(e))?;

    let mut frame_records: Vec<Frame> = Vec::with_capacity(frames.len());
    let mut resp_frames: Vec<IndexRespFrame> = Vec::with_capacity(frames.len());

    for f in &frames {
        let hash = compute_phash(&f.img);
        let thumb_name = format!("{}.jpg", f.idx);
        let thumb_abs = thumbs_dir.join(&thumb_name);
        let thumb_rel = format!("thumbs/{}/{}.jpg", body.media_id, thumb_name);

        // Write JPEG quality 80.
        let rgb = f.img.to_rgb8();
        if let Err(e) = std::fs::create_dir_all(&thumbs_dir) {
            tracing::warn!("thumbs dir create failed: {}", e);
        }
        if let Err(e) = rgb.save_with_format(&thumb_abs, image::ImageFormat::Jpeg) {
            tracing::warn!("thumb save failed for {}: {}", thumb_abs.display(), e);
        }

        frame_records.push(Frame {
            idx: f.idx,
            phash: format!("{:016x}", hash),
            thumb_path: thumb_rel,
            duration: Some(f.timestamp_secs),
            width: Some(f.width),
            height: Some(f.height),
        });
        resp_frames.push(IndexRespFrame {
            idx: f.idx,
            phash: format!("{:016x}", hash),
            thumb_path: format!("thumbs/{}/{}.jpg", body.media_id, thumb_name),
            duration: Some(f.timestamp_secs),
            width: Some(f.width),
            height: Some(f.height),
        });
    }

    // Persist to Mongo.
    mongo::write_frames(&state.mongo, &body.media_id, &frame_records, duration).await?;

    // Eager in-memory refresh for the just-indexed media_id.
    if let Ok(n) = mongo::load_into(&state.mongo, &state.index).await {
        tracing::info!("index: wrote {} frames for {}, in-mem index now {} entries",
            frame_records.len(), body.media_id, n);
    }

    Ok(HttpResponse::Ok().json(IndexResp {
        media_id: body.media_id.clone(),
        frames: resp_frames,
        duration,
    }))
}

// ---- /search -----------------------------------------------------------

#[derive(Serialize)]
pub struct SearchResp {
    pub matches: Vec<crate::search::Match>,
    pub query_phash: String,
    pub threshold: u32,
    pub indexed_frames: usize,
}

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
// MIME `image/<suffix>` allowlist. HEIC/HEIF go through the libheif
// path in `heic.rs` regardless of this list — see the magic-bytes
// sniff below. Keeping them in this list lets the content-type
// precheck pass so we don't 415 a HEIC upload that the browser
// correctly tagged as `image/heic`.
const ALLOWED_IMAGE_FORMATS: &[&str] = &["jpeg", "jpg", "png", "webp", "gif", "bmp", "tiff", "heic", "heif", "heix"];

#[post("/search")]
pub async fn search(
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> Result<HttpResponse, ApiError> {
    // Read the multipart "image" field into memory.
    let bytes: Vec<u8> = loop {
        let field = match payload.next().await {
            Some(Ok(f)) => f,
            Some(Err(e)) => return Err(ApiError::Multipart(e.to_string())),
            None => return Err(ApiError::BadRequest("no image field in multipart body".into())),
        };
        let name = field.name().unwrap_or("").to_string();
        if name != "image" { continue; }

        let content_type = field.content_type().map(|m| m.to_string()).unwrap_or_default();
        if !content_type.starts_with("image/") {
            return Err(ApiError::UnsupportedMediaType(format!(
                "field `image` is not an image (got {})", content_type
            )));
        }
        let format_hint = content_type.split('/').nth(1).unwrap_or("");
        if !ALLOWED_IMAGE_FORMATS.contains(&format_hint) {
            return Err(ApiError::UnsupportedMediaType(format!(
                "unsupported image format: {}", format_hint
            )));
        }

        let mut buf = Vec::with_capacity(64 * 1024);
        let mut field = field;
        while let Some(chunk) = field.next().await {
            let bytes = chunk.map_err(|e| ApiError::Multipart(e.to_string()))?;
            if buf.len() + bytes.len() > MAX_IMAGE_BYTES {
                return Err(ApiError::PayloadTooLarge(format!(
                    "image exceeds {} bytes", MAX_IMAGE_BYTES
                )));
            }
            buf.extend_from_slice(&bytes);
        }
        break buf;
    };

    if bytes.is_empty() {
        return Err(ApiError::BadRequest("empty image field".into()));
    }

    // Decode + pHash the probe. iOS photos arrive as HEIC, which
    // the `image` crate can't handle — sniff the ISOBMFF magic and
    // route to libheif if needed. Everything else goes through the
    // standard `image::load_from_memory` (jpeg/png/webp/gif/bmp/tiff).
    let img = if heic::is_heic(&bytes) {
        heic::decode_heic(&bytes)?
    } else {
        image::load_from_memory(&bytes)
            .map_err(|e| ApiError::BadRequest(format!("decode probe image: {}", e)))?
    };
    let query_hash = compute_phash(&img);

    // Top-K over the in-memory index.
    let index_snapshot = state.index.read().await.clone();
    let matches = top_k(query_hash, &index_snapshot, state.cfg.threshold, 20);

    Ok(HttpResponse::Ok().json(SearchResp {
        matches,
        query_phash: format!("{:016x}", query_hash),
        threshold: state.cfg.threshold,
        indexed_frames: index_snapshot.len(),
    }))
}

// ---- helpers for the test crate ---------------------------------------

/// Used by `cargo test` to round-trip an image through `phash`.
#[allow(dead_code)]
pub fn _test_hash_from_dyn(img: &image::DynamicImage) -> u64 {
    compute_phash(img)
}
