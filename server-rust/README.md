# Rust Server Package

## Overview
High-performance standalone backend service for the movie streaming catalog. Compiled to a statically linked musl binary, providing Axum HTTP APIs, JWT authentication, SQLite catalog and bookmark storage, and static asset delivery.

## Interface
- `[Cargo.toml:server-rust]` Package manifest configuring Tokio, Axum, SQLx SQLite, JWT, Mimalloc, and Moka in-memory cache
- `[start.sh]` Startup automation script for building musl release binary and starting service
- [Source Code Engine](./src/README.md) - Axum web handlers, SQLite queries, authentication middleware, and route definitions
- `[GET /api/home]` Consolidated single-flight catalog payload serving hero, spotlight, popular, series, and blockbuster movies with in-memory caching and stampede prevention
- `[POST /api/admin/cache/clear]` Localhost-restricted administrative endpoint purging in-memory catalog and search caches

## Invariants
- `[start.sh:PORT]` Defaults to port `3001` if unset
- `[start.sh:DB_DIR]` Defaults database directory to `../server/data`
- `[start.sh:STATIC_ROOT]` Defaults static asset root to parent directory `..`
- `[search:trigrams]` Multi-word search queries are tokenized into Boolean AND conjunctions of trigram terms (≥ 3 chars) on `movies_fts`, explicit quoted strings preserve phrase matching, and 1–2 character queries fall back to parameterized B-tree index prefix scans
- `[search:normalization]` Index-time (SQL triggers/backfill) and query-time normalization share an identical 87-character replacement pipeline unifying Persian/Arabic characters, digits, and stripping all harakat, Quranic marks, and ZWNJ
- `[cache:ttl]` In-memory catalog cache (`home`) enforces a 60-second TTL (max 5 items); search cache enforces a 30-second TTL (max 500 items)
- `[admin:security]` `POST /api/admin/cache/clear` strictly permits requests originating from loopback addresses (`127.0.0.1` / `::1`)

## Side Effects
- `[start.sh:cargo build]` Invokes `cargo build --release --target x86_64-unknown-linux-musl` when binary is missing
- `[start.sh:exec]` Spawns and replaces process with the compiled server binary
- `[cache:allocation]` Allocates bounded in-memory cache entries via `moka`
- `[db:fts_backfill]` Automatically triggers atomic startup backfill if `movies_fts_docsize` count does not match `movies` table count

## Verification
- Run: `cargo test`
