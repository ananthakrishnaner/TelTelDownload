# ---- build stage --------------------------------------------------------
# Pinned to Rust 1.96 (current stable, on the bookworm base). We
# previously used 1.83, but the mongodb 3.7 / bson 2.15 dependency
# graph ships crates that require the Cargo `edition2024` feature,
# which was only stabilized in Rust 1.85. Bumping the toolchain
# is the long-term fix; pinning the crate down is fragile because
# the next dep upgrade would re-introduce the same break.
FROM rust:1.96-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Cache deps separately from source so source changes don't bust the cache.
# `Cargo.lock` is committed in-repo for reproducibility; the `*` glob on
# the second COPY keeps the build green if a future `cargo update` deletes
# the lockfile. In that fallback the dep-cache layer resolves from
# `Cargo.toml` directly (slower, but the build still completes).
COPY Cargo.toml ./
COPY Cargo.lock* ./
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs \
 && cargo build --release \
 && rm -rf src target/release/deps/teltel_indexer*
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ---- runtime stage -----------------------------------------------------
FROM debian:bookworm-slim
# ffmpeg 5.1.x pinned to the 5.1 series via a `7:5.1*` epoch-major glob
# (the `7:` is the ffmpeg epoch; `5.1*` catches every 5.1.y patch from
# bookworm + bookworm-security). 6.x and 7.x are no longer in bookworm
# (they're in trixie, the new stable), so cross-pinning would require a
# trixie backports source — not worth the fragility for dHash.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg=7:5.1* ca-certificates libstdc++6 wget \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/local/bin
COPY --from=build /app/target/release/teltel_indexer /usr/local/bin/teltel_indexer
ENV PORT=9000 \
    MEDIA_DIR=/media \
    MONGO_URI=mongodb://mongodb:27017/teltel \
    RUST_LOG=info,teltel_indexer=debug \
    INDEXER_HAMMING_THRESHOLD=12 \
    INDEXER_FRAMES_PER_VIDEO=5 \
    INDEXER_REFRESH_SECS=30
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:9000/health || exit 1
ENTRYPOINT ["/usr/local/bin/teltel_indexer"]
