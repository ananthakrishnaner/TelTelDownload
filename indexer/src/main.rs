// main.rs — bootstrap, env config, eager index load, refresh task, HTTP server.

mod error;
mod ffmpeg;
mod handlers;
mod heic;
mod mongo;
mod phash;
mod search;

use actix_web::{web, App, HttpServer};
use anyhow::Result;
use chrono::Utc;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub media_dir: PathBuf,
    pub mongo_uri: String,
    pub threshold: u32,
    pub frames_per_video: u32,
    pub refresh_secs: u64,
}

impl Config {
    fn from_env() -> Result<Self> {
        let port: u16 = std::env::var("PORT")
            .unwrap_or_else(|_| "9000".to_string())
            .parse()
            .unwrap_or(9000u16);
        let media_dir = PathBuf::from(
            std::env::var("MEDIA_DIR").unwrap_or_else(|_| "/media".to_string()),
        );
        let mongo_uri = std::env::var("MONGO_URI")
            .unwrap_or_else(|_| "mongodb://mongodb:27017/teltel".to_string());
        let threshold: u32 = std::env::var("INDEXER_HAMMING_THRESHOLD")
            .unwrap_or_else(|_| "12".to_string())
            .parse()
            .unwrap_or(12);
        let frames_per_video: u32 = std::env::var("INDEXER_FRAMES_PER_VIDEO")
            .unwrap_or_else(|_| "5".to_string())
            .parse()
            .unwrap_or(5);
        let refresh_secs: u64 = std::env::var("INDEXER_REFRESH_SECS")
            .unwrap_or_else(|_| "30".to_string())
            .parse()
            .unwrap_or(30);
        Ok(Self {
            port,
            media_dir,
            mongo_uri,
            threshold,
            frames_per_video,
            refresh_secs,
        })
    }
}

pub struct AppState {
    pub cfg: Config,
    pub mongo: mongodb::Client,
    pub index: mongo::IndexLock,
    pub started_at: chrono::DateTime<Utc>,
}

#[actix_web::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cfg = Config::from_env()?;
    tracing::info!(
        "teltel_indexer starting: port={} media_dir={} threshold={} frames={} refresh={}s",
        cfg.port, cfg.media_dir.display(), cfg.threshold, cfg.frames_per_video, cfg.refresh_secs,
    );

    let mongo_client = mongo::client(&cfg.mongo_uri).await?;
    let started_at = Utc::now();

    let index: mongo::IndexLock = Arc::new(RwLock::new(Vec::new()));

    // Eager load on boot so /search has data within seconds, not 30 s later.
    match mongo::load_into(&mongo_client, &index).await {
        Ok(n) => tracing::info!("eager index load: {} entries", n),
        Err(e) => tracing::warn!("eager index load failed: {:#}", e),
    }

    mongo::spawn_refresh_task(mongo_client.clone(), index.clone(), cfg.refresh_secs, started_at);

    let state = web::Data::new(AppState {
        cfg: cfg.clone(),
        mongo: mongo_client,
        index,
        started_at,
    });

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .app_data(web::JsonConfig::default().limit(256 * 1024))
            .app_data(web::PayloadConfig::new(25 * 1024 * 1024))
            .service(handlers::health)
            .service(handlers::index_video)
            .service(handlers::search)
    })
    .bind(("0.0.0.0", cfg.port))?
    .run()
    .await?;
    Ok(())
}
