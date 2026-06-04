// search.rs — Hamming top-K over the in-memory index.

use crate::mongo::IndexedFrame;
use crate::phash::hamming;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Match {
    pub media_id: String,
    /// 0.0 (no match) to 1.0 (perfect match).
    pub score: f32,
    pub matched_frame_idx: u32,
    /// Path relative to MEDIA_DIR.
    pub thumb_path: String,
    pub file_name: String,
}

pub fn top_k(query_hash: u64, index: &[IndexedFrame], threshold: u32, k: usize) -> Vec<Match> {
    let mut scored: Vec<(u32, &IndexedFrame)> = index
        .iter()
        .map(|f| (hamming(query_hash, f.phash_u64), f))
        .filter(|(d, _)| *d <= threshold)
        .collect();

    // Ascending by distance; tie-break on (media_id, idx) for determinism.
    scored.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.media_id.cmp(&b.1.media_id))
            .then_with(|| a.1.idx.cmp(&b.1.idx))
    });

    scored
        .into_iter()
        .take(k)
        .map(|(d, f)| Match {
            media_id: f.media_id.clone(),
            score: 1.0 - (d as f32 / 64.0),
            matched_frame_idx: f.idx,
            thumb_path: f.thumb_path.clone(),
            file_name: f.file_name.clone(),
        })
        .collect()
}
