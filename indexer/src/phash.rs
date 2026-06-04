// phash.rs — 64-bit perceptual hash via 2D DCT on 32×32 luminance.
//
// Algorithm:
//   1. Resize the input to 32×32 (CatmullRom).
//   2. Convert to 8-bit grayscale.
//   3. Compute 32×32 DCT-II (separable, naïve O(N⁴) — fine at N=32, ~65k multiplies).
//   4. Take the top-left 8×8 block of coefficients.
//   5. Drop the DC term (0,0), leaving 63 AC values.
//   6. Compute the median of those 63 values.
//   7. Each AC coefficient > median -> bit 1, else 0.
//   8. Pack the 64 bits LSB-first into a u64 (bit 0 is the first AC coefficient
//      read row-major from the top-left, skipping DC).
//
// Pure function, no IO. Easy to unit-test.

use image::{imageops::FilterType, DynamicImage};

const N: usize = 32;
const BLOCK: usize = 8;

pub fn phash(img: &DynamicImage) -> u64 {
    let resized = img.resize_exact(N as u32, N as u32, FilterType::CatmullRom).to_luma8();
    let pixels: Vec<f32> = resized.into_vec().into_iter().map(|v| v as f32).collect();

    // 2D DCT-II, separable: 1D DCT on rows, then on columns.
    let mut buf = pixels;
    dct_1d_row_major(&mut buf, N, /*axis=*/0);
    dct_1d_row_major(&mut buf, N, /*axis=*/1);

    // Collect 8×8 top-left coefficients, skip DC.
    let mut ac: Vec<f32> = Vec::with_capacity(BLOCK * BLOCK - 1);
    for y in 0..BLOCK {
        for x in 0..BLOCK {
            if y == 0 && x == 0 { continue; }
            ac.push(buf[y * N + x]);
        }
    }

    let median = median_f32(&ac);
    let mut hash: u64 = 0;
    // The naïve 2D DCT on a uniform input is *mathematically* all zeros
    // except at the DC, but the floating-point implementation produces
    // tiny non-zero values (~1e-3) due to cos() + sin() rounding. A
    // strict `>` against the median (which is also ~1e-11) catches these
    // as "above median" and gives a hash full of 1s. The fix is a
    // small absolute threshold (0.5) — orders of magnitude below any
    // real AC coefficient from a non-uniform image, but well above
    // the f32 noise floor of a uniform image.
    let threshold = median + 0.5_f32;
    for (i, v) in ac.iter().enumerate() {
        if *v > threshold {
            // bit i, LSB-first
            hash |= 1u64 << (i as u32);
        }
    }
    hash
}

/// Hamming distance between two pHashes. Range 0..=64.
pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

// ---- DCT ---------------------------------------------------------------

fn dct_1d_row_major(buf: &mut [f32], n: usize, axis: usize) {
    // axis 0: apply to each row (length n)
    // axis 1: apply to each column (length n)
    let mut tmp = vec![0.0f32; n];
    if axis == 0 {
        for row in 0..n {
            for i in 0..n { tmp[i] = buf[row * n + i]; }
            dct_1d(&mut tmp);
            for i in 0..n { buf[row * n + i] = tmp[i]; }
        }
    } else {
        for col in 0..n {
            for i in 0..n { tmp[i] = buf[i * n + col]; }
            dct_1d(&mut tmp);
            for i in 0..n { buf[i * n + col] = tmp[i]; }
        }
    }
}

fn dct_1d(v: &mut [f32]) {
    let n = v.len();
    let mut out = vec![0.0f32; n];
    for k in 0..n {
        let mut sum = 0.0f32;
        for i in 0..n {
            sum += v[i] * ((std::f32::consts::PI / n as f32) * (i as f32 + 0.5) * k as f32).cos();
        }
        out[k] = sum;
    }
    v.copy_from_slice(&out);
}

fn median_f32(v: &[f32]) -> f32 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    s[s.len() / 2]
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, GrayImage, ImageBuffer, Luma};

    fn blank_gray(w: u32, h: u32, val: u8) -> GrayImage {
        ImageBuffer::from_fn(w, h, |_, _| Luma([val]))
    }

    fn as_dyn(gray: GrayImage) -> DynamicImage {
        DynamicImage::ImageLuma8(gray)
    }

    #[test]
    fn blank_image_hash_is_zero() {
        // All pixels equal -> all AC coefficients are 0 -> all `> median` are false -> hash 0.
        let img = as_dyn(blank_gray(64, 64, 128));
        let h = phash(&img);
        assert_eq!(h, 0u64);
    }

    #[test]
    fn identical_image_is_zero_distance() {
        let img = as_dyn(blank_gray(64, 64, 200));
        let h1 = phash(&img);
        let h2 = phash(&img);
        assert_eq!(hamming(h1, h2), 0);
    }

    #[test]
    fn slight_brightness_shift_small_distance() {
        // pHash is robust to mild brightness changes.
        let img1 = as_dyn(blank_gray(64, 64, 100));
        let img2 = as_dyn(blank_gray(64, 64, 130));
        let h1 = phash(&img1);
        let h2 = phash(&img2);
        // Both are blank with different brightness — AC coefficients are all 0
        // in both, so distance must be exactly 0 (pHash is not brightness-sensitive).
        assert_eq!(hamming(h1, h2), 0);
    }
}
