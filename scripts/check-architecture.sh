#!/usr/bin/env bash
set -euo pipefail
bash scripts/check-native-boundaries.sh
cargo clippy --workspace --all-targets -- -D warnings
cargo clippy --manifest-path native/gpui/Cargo.toml --all-targets -- -D warnings
cargo test --workspace
cargo test --manifest-path native/gpui/Cargo.toml
