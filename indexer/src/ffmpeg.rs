// ffmpeg.rs — extract N evenly-spaced frames from a video as JPEG bytes.
//
// Spawns `ffmpeg -ss <t> -i <path> -frames:v 1 -f image2pipe -` for each timestamp.
// Each spawn's stdout is piped to `image::load_from_memory`. This avoids
// pulling in `ffmpeg-next` (which pins C headers in CI) at the cost of one
// ffmpeg process per frame — at n=5 frames per video, this is ~250-1000 ms
// per video on a single core, which is fine for offline indexing.

use anyhow::{Context, Result};
use image::{DynamicImage, ImageFormat};
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct Frame {
    pub idx: u32,
    pub timestamp_secs: f32,
    pub width: u32,
    pub height: u32,
    pub img: DynamicImage,
}

/// Extract N evenly-spaced frames from a video. Returns frames in order.
/// `duration_secs` should be probed beforehand; for unknown duration, pass `None`
/// and the function will fall back to 1-second spacing.
///
/// On any per-frame failure (corrupted file, encrypted Telegram media, etc.)
/// the function returns the frames it has so far and logs a warning — the
/// caller decides whether that's an error.
pub async fn extract_n_frames(
    path: &Path,
    n: u32,
    duration_secs: Option<f32>,
) -> Result<Vec<Frame>> {
    if n == 0 {
        return Ok(Vec::new());
    }
    let duration = match duration_secs {
        Some(d) if d > 0.0 => d,
        _ => 1.0_f32, // fallback: assume 1 second, sample evenly within
    };

    let mut frames = Vec::with_capacity(n as usize);
    for i in 0..n {
        // Sample at D * (i + 0.5) / n — skip the very first frame
        // (often a black title card) and the very last (often a fade).
        let t = duration * (i as f32 + 0.5) / n as f32;
        match extract_one_frame(path, t).await {
            Ok(Some((img, w, h))) => {
                frames.push(Frame {
                    idx: i,
                    timestamp_secs: t,
                    width: w,
                    height: h,
                    img,
                });
            }
            Ok(None) => {
                tracing::warn!("ffmpeg returned no frame for {} at t={:.2}s", path.display(), t);
            }
            Err(e) => {
                tracing::warn!("ffmpeg failed for {} at t={:.2}s: {:#}", path.display(), t, e);
            }
        }
    }
    Ok(frames)
}

async fn extract_one_frame(path: &Path, t_secs: f32) -> Result<Option<(DynamicImage, u32, u32)>> {
    let mut child = Command::new("ffmpeg")
        .arg("-ss").arg(format!("{:.3}", t_secs))
        .arg("-i").arg(path)
        .arg("-frames:v").arg("1")
        .arg("-f").arg("image2pipe")
        .arg("-vcodec").arg("mjpeg")
        .arg("-q:v").arg("3")
        .arg("-")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .with_context(|| format!("spawn ffmpeg for {}", path.display()))?;

    let mut stdout = child.stdout.take().context("ffmpeg stdout")?;

    let mut buf = Vec::with_capacity(64 * 1024);
    use tokio::io::AsyncReadExt;
    stdout.read_to_end(&mut buf).await.context("read ffmpeg stdout")?;

    let status = child.wait().await.context("wait ffmpeg")?;
    if !status.success() && buf.is_empty() {
        return Ok(None);
    }
    if buf.is_empty() {
        return Ok(None);
    }

    let img = image::load_from_memory_with_format(&buf, ImageFormat::Jpeg)
        .with_context(|| format!("decode jpeg from ffmpeg ({} bytes)", buf.len()))?;
    let (w, h) = (img.width(), img.height());
    Ok(Some((img, w, h)))
}

/// Best-effort duration probe using ffprobe. Returns None on failure.
pub async fn probe_duration_secs(path: &Path) -> Option<f32> {
    let out = Command::new("ffprobe")
        .arg("-v").arg("error")
        .arg("-show_entries").arg("format=duration")
        .arg("-of").arg("default=noprint_wrappers=1:nokey=1")
        .arg(path)
        .output()
        .await
        .ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    s.parse::<f32>().ok()
}
