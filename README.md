<p align="center">
  <img src="public/icon.iconset/icon_128x128.png" width="128" height="128" alt="inferay" />
</p>

<h1 align="center">inferay</h1>

<p align="center">
  <strong>Run Claude and Codex side by side in a multi-pane terminal.</strong><br/>
  Compare responses. Switch instantly. No lock-in.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" />
  <img src="https://img.shields.io/badge/frontend-React_19-61dafb?style=flat-square" />
  <img src="https://img.shields.io/badge/terminal-xterm.js-22c55e?style=flat-square" />
  <img src="https://img.shields.io/badge/styling-Tailwind_4-38bdf8?style=flat-square" />
  <img src="https://img.shields.io/badge/desktop-Electrobun-8b5cf6?style=flat-square" />
</p>

---

## What is this?

inferay is a multi-pane terminal with Claude and Codex built in. Run AI agents side by side, compare responses, and switch between them instantly.

Every pane is a real PTY. Every agent chat is a real conversation.

## Features

**Multi-agent panes**

- Claude and Codex in split panes
- Compare responses side by side
- Use the right agent for the job

**Your keys**

- Connect with your own API keys
- No middleman. No subscriptions. Direct access.

**Terminal native**

- Real PTY sessions alongside AI chat
- Slash commands (`/review`, `/refactor`, `/debug`, `/test`, etc.)
- 12 built-in themes
- Keyboard-first workflow

**Fast**

- Built on Bun
- Streaming responses
- Native macOS app via Electrobun
- No Electron bloat

## Download

Download the latest release from [inferay.com](https://inferay.com) and drag to Applications.

## Building from Source

```bash
# Install dependencies
bun install

# Install Rust toolchain
# https://rustup.rs

# Build the Rust diff sidecar
bun run build:native

# Build the app and create DMG installer
bash scripts/build-dmg.sh
```

After the build completes, you'll find the installer at `artifacts/inferay-installer.dmg`.

## Release

Use the release script so the CLI version, DMG asset, GitHub release, and npm
package stay in sync.

```bash
# Prepare the next patch release locally:
bun run release patch

# Prepare and publish in one run:
bun run release patch --publish

# Retry publishing an already prepared release:
bun run release:publish
```

The script updates `packages/inferay`, builds the DMG, creates
`artifacts/inferay-macos-arm64.dmg`, writes `artifacts/checksums.txt`, commits
`release vX.Y.Z`, tags `vX.Y.Z`, and optionally publishes the GitHub release and
npm CLI package.

### Installing

1. Download the `.dmg` file
2. Double-click to mount it
3. Drag **inferay** to your **Applications** folder
4. First launch: Right-click the app → **Open** (to bypass unsigned app warning)
   - Or run: `xattr -cr /Applications/inferay.app`

## Tech stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: React 19, React Router, TanStack Query
- **Terminal**: xterm.js
- **Styling**: Tailwind CSS v4
- **Desktop**: Electrobun
- **Native acceleration**: optional Rust sidecar for diff computation

## License

This project is source-available for reference and educational purposes. All rights are reserved by the author.

See [LICENSE](LICENSE) for the full terms.
