#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

if [ ! -f "target/x86_64-unknown-linux-musl/release/server-rust" ]; then
    echo "Building optimized release musl binary..."
    cargo build --release --target x86_64-unknown-linux-musl
fi

export PORT="${PORT:-3001}"
export DB_DIR="${DB_DIR:-../server/data}"
export STATIC_ROOT="${STATIC_ROOT:-..}"

echo "Starting Rust High-Performance Server (musl static) on port $PORT..."
exec ./target/x86_64-unknown-linux-musl/release/server-rust
