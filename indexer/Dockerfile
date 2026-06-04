# ---- build stage --------------------------------------------------------
FROM rust:1.83-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Cache deps separately from source so source changes don't bust the cache.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src target/release/deps/teltel_indexer*
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ---- runtime stage -----------------------------------------------------
FROM debian:bookworm-slim
# ffmpeg 6.x pinned. The `7:6.1*` glob catches the latest 6.1 patch.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg=7:6.1* ca-certificates libstdc++6 wget \
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
