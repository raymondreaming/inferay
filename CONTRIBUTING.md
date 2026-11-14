# Contributing

Inferay's desktop UI is the Rune app in `native/rune`. Build new behavior there and in the shared Rust application services; test incrementally against the remaining gaps in [the desktop guide](native/rune/README.md).

## Setup

Install Rust, Xcode command-line tools, and the Bun version in `.bun-version`. Run `bun install`, then `bun run dev`. If another Inferay instance owns the profile, attach to its actual local backend with `INFERAY_EXTERNAL_BACKEND_ADDR`; otherwise use an isolated `INFERAY_USER_DATA_DIR`. Do not launch two backend owners against one profile.

## Build and verify

- `bun run build`: build the production app in `build/rust-macos-arm64/inferay.app`.
- `bun run build:dev`: build the separately identified development bundle (`bun run dev` also opens it).
- `bun run check`: native dependency boundaries, Clippy, and Rust tests.
- `bun run code`: production Rust line counts, excluding tests and vendored dependencies.
- `bun run generate:api`: regenerate the native API reference.
- `bun run dmg`: package and validate an installer.
- `bun run release`: release orchestration for the desktop app.

Read [coding guidelines](CODING_GUIDELINES.md) for ownership and verification rules. Shared service tests use temporary profiles/repositories. Check the actual UI for visual and input changes; never infer parity from passing unit tests.
