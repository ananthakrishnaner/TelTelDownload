// mongo.rs — MongoDB connection, write_frames, and the in-memory index.
//
// The in-memory index is a `Vec<IndexedFrame>` protected by `RwLock`.
// `load_into` rebuilds it from Mongo (eagerly on boot, then every 30 s).
// `/search` readers acquire a read lock; the refresh task acquires a write lock.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use mongodb::{
    bson::{doc, Document},
    options::ClientOptions,
    Client, Collection, Database,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

pub const DB_NAME_DEFAULT: &str = "teltel";
pub const COLL: &str = "media";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub idx: u32,
    /// 64-bit pHash, hex-encoded (16 chars).
    pub phash: String,
    /// Path relative to MEDIA_DIR, e.g. "thumbs/<id>/0.jpg".
    pub thumb_path: String,
    pub duration: Option<f32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct IndexedFrame {
    pub media_id: String,
    pub idx: u32,
    pub phash_u64: u64,
    pub thumb_path: String,
    pub file_name: String,
}

pub type IndexLock = Arc<RwLock<Vec<IndexedFrame>>>;

pub async fn client(uri: &str) -> Result<Client> {
    let mut opts = ClientOptions::parse(uri).await.context("parse MONGO_URI")?;
    opts.app_name = Some("teltel_indexer".into());
    opts.server_selection_timeout = Some(std::time::Duration::from_secs(3));
    let c = Client::with_options(opts)?;
    // Ping once so we fail fast on a bad URI.
    c.database(DB_NAME_DEFAULT)
        .run_command(doc! { "ping": 1 })
        .await
        .context("mongo ping")?;
    Ok(c)
}

pub fn media_coll(client: &Client) -> Collection<Document> {
    let db: Database = client.database(DB_NAME_DEFAULT);
    db.collection(COLL)
}

/// Write the per-frame records back to the Media doc and mark it as indexed.
/// Idempotent: caller can re-run.
pub async fn write_frames(
    client: &Client,
    media_id_hex: &str,
    frames: &[Frame],
    duration: Option<f32>,
) -> Result<()> {
    let oid = mongodb::bson::oid::ObjectId::parse_str(media_id_hex)
        .with_context(|| format!("invalid media_id hex: {}", media_id_hex))?;
    let now = Utc::now();
    let bson_frames: Vec<mongodb::bson::Document> = frames
        .iter()
        .map(|f| {
            doc! {
                "idx": f.idx as i32,
                "phash": &f.phash,
                "thumbPath": &f.thumb_path,
                "duration": f.duration.map(|d| d as f64).unwrap_or(0.0),
                "width": f.width.map(|w| w as i32).unwrap_or(0),
                "height": f.height.map(|h| h as i32).unwrap_or(0),
            }
        })
        .collect();

    media_coll(client)
        .update_one(
            doc! { "_id": oid },
            doc! {
                "$set": {
                    "frames": bson_frames,
                    "phashed": true,
                    "indexedAt": mongodb::bson::DateTime::from_chrono(now),
                    "duration": duration.map(|d| d as f64).unwrap_or(0.0_f64),
                }
            },
        )
        .await
        .context("update Media.frames")?;
    Ok(())
}

/// Rebuild the in-memory index from the Media collection.
/// Streams only the projection we need: _id, frames.idx, frames.phash, frames.thumbPath, fileName.
pub async fn load_into(client: &Client, index: &IndexLock) -> Result<usize> {
    let coll = media_coll(client);
    let mut cursor = coll
        .find(doc! { "phashed": true })
        .projection(doc! {
            "_id": 1,
            "fileName": 1,
            "frames.idx": 1,
            "frames.phash": 1,
            "frames.thumbPath": 1,
        })
        .await
        .context("query Media")?;

    let mut new_index: Vec<IndexedFrame> = Vec::new();
    use futures_util::StreamExt;
    while let Some(doc_res) = cursor.next().await {
        let d = match doc_res {
            Ok(d) => d,
            Err(e) => { tracing::warn!("cursor: {}", e); continue; }
        };
        let _id = match d.get_object_id("_id").ok() {
            Some(v) => v.to_hex(),
            None => continue,
        };
        let file_name = d.get_str("fileName").unwrap_or("").to_string();
        let frames = match d.get_array("frames") {
            Ok(arr) => arr,
            Err(_) => continue,
        };
        for fv in frames {
            let f = match fv.as_document() {
                Some(fd) => fd,
                None => continue,
            };
            let idx = f.get_i32("idx").unwrap_or(0) as u32;
            let phash_hex = f.get_str("phash").unwrap_or("").to_string();
            let thumb_path = f.get_str("thumbPath").unwrap_or("").to_string();
            let phash_u64 = match u64::from_str_radix(&phash_hex, 16) {
                Ok(v) => v,
                Err(_) => continue,
            };
            new_index.push(IndexedFrame {
                media_id: _id.clone(),
                idx,
                phash_u64,
                thumb_path,
                file_name: file_name.clone(),
            });
        }
    }

    let count = new_index.len();
    *index.write().await = new_index;
    Ok(count)
}

pub async fn count_indexed_media(client: &Client) -> u64 {
    media_coll(client)
        .count_documents(doc! { "phashed": true })
        .await
        .unwrap_or(0)
}

/// Spawn a tokio task that reloads the in-memory index on an interval.
pub fn spawn_refresh_task(
    client: Client,
    index: IndexLock,
    every_secs: u64,
    started_at: DateTime<Utc>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(every_secs));
        // Skip the immediate first tick (eager load already happened in main).
        interval.tick().await;
        loop {
            interval.tick().await;
            match load_into(&client, &index).await {
                Ok(n) => tracing::info!("indexer: refreshed in-memory index, {} entries (uptime={}s)",
                    n, (Utc::now() - started_at).num_seconds()),
                Err(e) => tracing::warn!("indexer: refresh failed: {:#}", e),
            }
        }
    });
}
