// heic.rs — iPhone (HEIC/HEIF) image decode via libheif.
//
// The `image` crate doesn't support HEIC, and iOS photos are HEIC by
// default since iOS 11. We link libheif directly through
// `libheif-sys` and decode the primary image to an RGB plane, then
// hand it to the existing pHash code as a `DynamicImage`.
//
// All public functions are total — they return `Result<DynamicImage,
// ApiError>` and never panic, so a malformed HEIC upload can't take
// down the worker.

use crate::error::ApiError;
use image::{DynamicImage, RgbImage};
use libheif_sys as ffi;
use std::ptr;

/// Returns true if the buffer starts with an ISOBMFF `ftyp` box whose
/// major brand indicates HEIC/HEIF (covers .heic, .heif, .heix,
/// .mif1, .msf1, .avif, and friends). Skips the first 4 bytes
/// (the box size) and matches on bytes 4..8.
pub fn is_heic(buf: &[u8]) -> bool {
    if buf.len() < 12 {
        return false;
    }
    if &buf[4..8] != b"ftyp" {
        return false;
    }
    let brand = &buf[8..12];
    matches!(
        brand,
        b"heic" | b"heix" | b"heim" | b"heis" | b"hevc" | b"hevv" | b"heif" | b"mif1" | b"msf1" | b"avif" | b"avis"
    )
}

/// Decode a HEIC/HEIF buffer to an RGB `DynamicImage`. The returned
/// image has 8-bit channels; pHash is color-blind so any color space
/// that maps to RGB bytes is fine.
pub fn decode_heic(buf: &[u8]) -> Result<DynamicImage, ApiError> {
    unsafe { decode_heic_inner(buf) }
}

unsafe fn decode_heic_inner(buf: &[u8]) -> Result<DynamicImage, ApiError> {
    // 1. Create a context and feed the whole upload into it.
    let ctx = ffi::heif_context_alloc();
    if ctx.is_null() {
        return Err(ApiError::Internal("heif_context_alloc returned null".into()));
    }
    // RAII guard: free the context on every return path.
    let _ctx_guard = scopeguard::guard(ctx, |c| ffi::heif_context_free(c));

    let err = ffi::heif_context_read_from_memory_without_copy(
        ctx,
        buf.as_ptr() as *const libc::c_void,
        buf.len(),
        ptr::null(),
    );
    if err.code != ffi::heif_error_code_heif_error_Ok {
        return Err(heif_err_to_api("heif_context_read_from_memory", err));
    }

    // 2. Get the primary image handle. The function fills *out_handle
    //    with a pointer to an opaque struct.
    let mut img_handle: *mut ffi::heif_image_handle = ptr::null_mut();
    let err = ffi::heif_context_get_primary_image_handle(ctx, &mut img_handle);
    if err.code != ffi::heif_error_code_heif_error_Ok {
        return Err(heif_err_to_api("heif_context_get_primary_image_handle", err));
    }
    if img_handle.is_null() {
        return Err(ApiError::BadRequest("HEIC: no primary image".into()));
    }
    let _img_guard = scopeguard::guard(img_handle, |i| {
        if !i.is_null() {
            ffi::heif_image_handle_release(i);
        }
    });

    // 3. Decode to interleaved RGB8.
    let mut decoded: *mut ffi::heif_image = ptr::null_mut();
    let err = ffi::heif_decode_image(
        img_handle,
        &mut decoded,
        ffi::heif_colorspace_heif_colorspace_RGB,
        ffi::heif_chroma_heif_chroma_interleaved_RGB,
        ptr::null(),
    );
    if err.code != ffi::heif_error_code_heif_error_Ok {
        return Err(heif_err_to_api("heif_decode_image(RGB)", err));
    }
    if decoded.is_null() {
        return Err(ApiError::Internal("HEIC: heif_decode_image returned null".into()));
    }
    let _dec_guard = scopeguard::guard(decoded, |d| {
        if !d.is_null() {
            ffi::heif_image_release(d);
        }
    });

    let width = ffi::heif_image_get_width(decoded, ffi::heif_channel_heif_channel_interleaved);
    let height = ffi::heif_image_get_height(decoded, ffi::heif_channel_heif_channel_interleaved);
    if width <= 0 || height <= 0 {
        return Err(ApiError::BadRequest("HEIC decode: empty image".into()));
    }

    // 4. Lock the interleaved plane. heif_image_get_plane returns a
    //    *mut u8 directly and writes the stride into *out_stride.
    let mut stride: libc::c_int = 0;
    let plane = ffi::heif_image_get_plane(
        decoded,
        ffi::heif_channel_heif_channel_interleaved,
        &mut stride,
    );
    if plane.is_null() || stride <= 0 {
        return Err(ApiError::Internal("HEIC: heif_image_get_plane returned null/0".into()));
    }
    let w = width as usize;
    let h = height as usize;
    let s = stride as usize;
    if s < w * 3 {
        return Err(ApiError::Internal(format!(
            "HEIC decode: stride {} < width*3 {}",
            s, w * 3
        )));
    }

    // 5. Copy the bytes into a Rust-owned buffer. We need contiguous
    //    RGB for `RgbImage`, so we walk the rows even when stride
    //    matches width*3.
    let mut rgb = RgbImage::new(w as u32, h as u32);
    {
        let dst = rgb.as_mut(); // returns &mut [u8] of length w*h*3
        for y in 0..h {
            let src = std::slice::from_raw_parts(plane.add(y * s), w * 3);
            let row_start = y * w * 3;
            dst[row_start..row_start + w * 3].copy_from_slice(src);
        }
    }

    Ok(DynamicImage::ImageRgb8(rgb))
}

fn heif_err_to_api(where_: &str, err: ffi::heif_error) -> ApiError {
    let msg_ptr = err.message;
    let msg = if msg_ptr.is_null() {
        String::new()
    } else {
        unsafe { std::ffi::CStr::from_ptr(msg_ptr) }
            .to_string_lossy()
            .into_owned()
    };
    let kind = match err.code {
        ffi::heif_error_code_heif_error_Ok => "ok",
        // libheif 1.23 dropped some of the old error codes. The
        // "this isn't a HEIC file" path is now reported as
        // Input_does_not_exist (1) or Invalid_input (2). Anything
        // before Unsupported_filetype is bad input; anything from
        // there on is codec / plugin / memory.
        ffi::heif_error_code_heif_error_Input_does_not_exist => "input_invalid",
        ffi::heif_error_code_heif_error_Invalid_input => "input_invalid",
        ffi::heif_error_code_heif_error_Plugin_loading_error => "plugin",
        ffi::heif_error_code_heif_error_Decoder_plugin_error => "decoder_plugin",
        ffi::heif_error_code_heif_error_Encoder_plugin_error => "encoder_plugin",
        ffi::heif_error_code_heif_error_Unsupported_filetype => "unsupported_filetype",
        ffi::heif_error_code_heif_error_Unsupported_feature => "unsupported_feature",
        ffi::heif_error_code_heif_error_Memory_allocation_error => "oom",
        _ => "unknown",
    };
    // 4xx-ish errors: bad HEIC, missing codec plugin, unsupported file.
    // 5xx: out of memory / unexpected.
    match kind {
        "input_invalid" | "unsupported_filetype" | "unknown_image_type" => {
            ApiError::BadRequest(format!("HEIC decode at {where_}: {msg}"))
        }
        "unsupported_feature" => ApiError::UnsupportedMediaType(format!(
            "HEIC feature not available at {where_}: {msg}"
        )),
        "plugin" | "decoder_plugin" | "encoder_plugin" => ApiError::Internal(format!(
            "HEIC codec plugin error at {where_}: {msg}"
        )),
        "oom" => ApiError::Internal(format!("HEIC decode OOM at {where_}: {msg}")),
        _ => ApiError::Internal(format!("HEIC decode at {where_}: {msg}")),
    }
}
