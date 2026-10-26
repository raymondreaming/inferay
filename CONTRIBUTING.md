# Contributing

Inferay is GPUI-only. The former Solid/webview implementation was removed at the native cutover. Build new behavior in GPUI and the shared Rust application services; test incrementally against the remaining gaps in [the GPUI guide](native/gpui/README.md).

## Setup

Install Rust, Xcode command-line tools, and the Bun version in `.bun-version`. Run `bun install`, then `bun run dev`. If another Inferay instance owns the profile, attach to its actual local backend with `INFERAY_EXTERNAL_BACKEND_ADDR`; otherwise use an isolated `INFERAY_USER_DATA_DIR`. Do not launch two backend owners against one profile.

## Build and verify

- `bun run build`: build the production GPUI app in `build/rust-macos-arm64/inferay.app`.
- `bun run build:gpui`: build the separately identified development bundle.
- `bun run check`: native dependency boundaries, Clippy, and Rust tests.
- `bun run code`: production Rust line counts, excluding tests and vendored dependencies.
- `bun run generate:api`: regenerate the native API reference.
- `bun run dmg`: package and validate a GPUI installer.
- `bun run release`: existing release orchestration, now using the GPUI app.

Read [coding guidelines](CODING_GUIDELINES.md) for ownership and verification rules. Shared service tests use temporary profiles/repositories. Check the actual UI for visual and input changes; never infer parity from passing unit tests.
