# Contributing to Inferay

## Active development target

GPUI (`native/gpui`) is the supported target for all future UI features, fixes, and performance work. The Solid renderer (`src/`) and webview desktop host (`native/desktop-host`) are deprecated and retained temporarily as migration references. Do not implement new UI work in the deprecated version unless explicitly requested. Validate GPUI incrementally as features are used; deprecation does not mean feature parity is complete. Keep the shared Rust core, presentation, diff engine, and server.

Use `bun run dev:gpui` for native UI development and `bun run build:gpui` to build the app. Run `cargo test --manifest-path native/gpui/Cargo.toml` and `cargo clippy --manifest-path native/gpui/Cargo.toml --all-targets -- -D warnings`. See [GPUI setup](native/gpui/README.md) for backend/profile ownership and incremental verification.

The web renderer setup and release commands below describe the deprecated distribution pipeline, which remains until native packaging replaces it.


## Development

Use **Bun 1.4.4**. The version is pinned in `.bun-version` and `package.json`; dependency installation and development/build entry points check it.

Install the Rust toolchain, then prepare the renderer bindings:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
bun install
bun run dev
```

`bun run dev` starts the renderer watcher, local Rust server, and desktop host. `bun run build:renderer` rebuilds the Rust WebAssembly bindings and renderer. `bun run build` packages the desktop app; `bash scripts/build-dmg.sh` builds the installer.

## Ownership and checks

Rust owns application models and native operations. `native/presentation` shares pure models with the renderer through WebAssembly and generated TypeScript contracts. Solid owns the DOM, view composition, local UI state, and browser events.

See the [design system](src/design-system/README.md) for styling and selection rules. Import its implementing files directly.

```sh
bun run check:architecture
bun test scripts/tests
bun run code
```

The architecture check covers ownership boundaries, TypeScript, Rust linting, and the renderer build. The test suite includes navigation and streaming regressions. The code report separates Rust from renderer code.

`bun run format` formats renderer source with Bun's built-in formatter;
`bun run format:check` checks without writing. Bun reads the existing
`.prettierrc.json` and `.prettierignore`. `bun run typecheck` uses Bun's built-in
TypeScript checker; the pinned TypeScript editor dependency matches it.
`bun run check` runs lint, types, formatting, import organization and CSS/JSON
checks. Oxlint owns JavaScript/TypeScript linting; Biome retains import
organization and CSS/JSON linting with its formatter disabled. The staged-file
hook runs those checks before Bun formats the files.

## Releases

The release command coordinates the CLI version, desktop app, installer, GitHub release, and npm package:

```sh
bun run release
bun run release minor
bun run release 0.2.0
```

Use `bun run release:resume` when a release was interrupted after preparation or build. Release commands publish artifacts; use the build commands above for local validation.
