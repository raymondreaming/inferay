<p align="center">
  <img src="public/icon.iconset/icon_128x128.png" width="128" height="128" alt="inferay" />
</p>

<h1 align="center">inferay</h1>

<p align="center">
  <strong>Run Claude and Codex side by side in a multi-pane agent workspace.</strong><br/>
  Compare responses. Switch instantly. No lock-in.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/backend-Rust-f74c00?style=flat-square" />
  <img src="https://img.shields.io/badge/frontend-React_19_%2B_Octane-61dafb?style=flat-square" />
  <img src="https://img.shields.io/badge/agent_shell-xterm.js-22c55e?style=flat-square" />
  <img src="https://img.shields.io/badge/styling-Tailwind_4-38bdf8?style=flat-square" />
  <img src="https://img.shields.io/badge/desktop-Rust%20%2B%20Wry-f74c00?style=flat-square" />
</p>

---

## What is this?

inferay is a multi-pane agent workspace with Claude and Codex built in. Run AI agents side by side, compare responses, and switch between them instantly.

Every pane is a real PTY. Every agent chat is a real conversation.

## Features

**Multi-agent panes**

- Claude and Codex in split panes
- Compare responses side by side
- Use the right agent for the job

**Your keys**

- Connect with your own API keys
- No middleman. No subscriptions. Direct access.

**Agent native**

- Real PTY sessions alongside AI chat
- Slash commands (`/review`, `/refactor`, `/debug`, `/test`, etc.)
- 12 built-in themes
- Keyboard-first workflow

**Fast**

- Rust-owned local server and agent runtime
- Streaming responses
- Native macOS host written in Rust with Tao and Wry
- No Electron bloat

## Download

Download the latest release from [inferay.com](https://inferay.com) and drag to Applications.

## Building from Source

UI styling ownership and selection rules are documented in the
[design system](src/design-system/README.md). Import its implementing files directly.

Requires Bun 1.4.0. The repository's `.bun-version` file allows compatible
version managers to select it automatically.

```bash
# Install dependencies
bun install

# Install Rust toolchain
# https://rustup.rs

# Build the Rust workspace
bun run build:native

# Build the app and create DMG installer
bash scripts/build-dmg.sh
```

After the build completes, you'll find the installer at `artifacts/inferay-installer.dmg`.

## Release

Use one command so the CLI version, DMG asset, GitHub release, and npm package
stay in sync.

```bash
# Standard release: bump patch, build, tag, GitHub release, npm publish
bun run release

# Use only when you need a different version bump:
bun run release minor
bun run release 0.2.0

# Use only if publishing was interrupted after prepare/build:
bun run release:resume
```

The script updates `packages/inferay` and the desktop app version, builds the
DMG, creates `artifacts/inferay-macos-arm64.dmg`, writes
`artifacts/checksums.txt`, commits `release vX.Y.Z`, tags `vX.Y.Z`, publishes
the GitHub release, and publishes the npm CLI package.

### Installing

1. Download the `.dmg` file
2. Double-click to mount it
3. Drag **inferay** to your **Applications** folder
4. First launch: Right-click the app → **Open** (to bypass unsigned app warning)
   - Or run: `xattr -cr /Applications/inferay.app`

## Tech stack

- **Application server and agent runtime**: Rust
- **Frontend**: [Octane](https://github.com/octanejs/octane), TypeScript/TSX, and StyleX
- **Agent workspace**: xterm.js
- **Styling**: Tailwind CSS v4
- **Desktop**: Rust, Tao, and Wry

## License

This project is source-available for reference and educational purposes. All rights are reserved by the author.

See [LICENSE](LICENSE) for the full terms.
