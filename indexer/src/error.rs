// error.rs — uniform error type that maps cleanly to actix HTTP responses.

use actix_web::{http::StatusCode, HttpResponse, ResponseError};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("unsupported media type: {0}")]
    UnsupportedMediaType(String),

    #[error("payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("frame extraction failed: {0}")]
    FrameExtraction(String),

    #[error("mongo error: {0}")]
    Mongo(#[from] mongodb::error::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("multipart error: {0}")]
    Multipart(String),

    #[error("image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("internal: {0}")]
    Internal(String),
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        // anyhow::Error is opaque; the `.source()` chain has the real
        // context but the display string is what the user sees in the
        // HTTP body, so just stringify. Status is INTERNAL_SERVER_ERROR.
        ApiError::Internal(e.to_string())
    }
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) | ApiError::Multipart(_) | ApiError::Image(_) => {
                // Image decode failures are 400s: the user uploaded a
                // file the server can't process, not an internal fault.
                // The detailed `error` body still tells them what was
                // wrong (e.g. "decode probe image: ...").
                StatusCode::BAD_REQUEST
            }
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::UnsupportedMediaType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ApiError::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            ApiError::FrameExtraction(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::Mongo(_) | ApiError::Io(_) | ApiError::Internal(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    fn error_response(&self) -> HttpResponse {
        let status = self.status_code();
        HttpResponse::build(status).json(json!({
            "error": self.to_string(),
            "code": status.as_u16(),
        }))
    }
}
