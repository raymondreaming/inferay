#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! command -v wasm-bindgen >/dev/null || [[ "$(wasm-bindgen --version)" != "wasm-bindgen 0.2.127" ]]; then
  echo 'Install the matching bindings tool: cargo install wasm-bindgen-cli --version 0.2.127 --locked' >&2
  exit 1
fi
cargo run -p inferay-tooling --bin export-renderer-types
cargo build --lib -p inferay-presentation --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/inferay_presentation.wasm \
  --target web --out-dir build/presentation --out-name presentation

node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const bytes = readFileSync('build/presentation/presentation_bg.wasm').toString('base64');
writeFileSync('build/presentation/bytes.js', `// Generated from inferay-presentation.
export default "${bytes}";
`);
JS
