#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

bun run build:renderer
node node_modules/vite/bin/vite.js build --watch --mode development &
RENDERER_WATCH_PID=$!

cleanup() {
  kill "${RENDERER_WATCH_PID}" 2>/dev/null || true
  wait "${RENDERER_WATCH_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cargo run -p inferay-desktop
