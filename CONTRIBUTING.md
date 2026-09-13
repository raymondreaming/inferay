# Contributing to Inferay

## Development

Use **Bun 1.4.1**. The version is pinned in `.bun-version` and `package.json`; dependency installation and development/build entry points check it.

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

## Releases

The release command coordinates the CLI version, desktop app, installer, GitHub release, and npm package:

```sh
bun run release
bun run release minor
bun run release 0.2.0
```

Use `bun run release:resume` when a release was interrupted after preparation or build. Release commands publish artifacts; use the build commands above for local validation.
