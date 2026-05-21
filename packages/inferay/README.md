# inferay

A macOS AI workspace for multi-pane Claude and Codex chats, real terminals,
project context, reusable slash commands, git diffs, and image-aware agent work.

```sh
npx inferay
```

Inferay is built for working with several agents, folders, and tasks at once.
Open a workspace from your shell, start multiple chat panes, attach the right
files or folders with `@`, and run repeatable workflows through your own
reusable `/slash` commands.

## Quick Start

```sh
npx inferay          # install or launch Inferay
npx inferay .        # open the current folder
npx inferay ~/code   # open a workspace
```

If Inferay is already installed, the command launches it. If not, it downloads
the latest compatible macOS release and installs the app.

## What Inferay Does

- Run Claude, Codex, and terminal panes side by side
- Start several agent chats with different context at the same time
- Attach files and folders directly in chat with `@`
- Work across multiple project folders from one workspace
- Create reusable skills that appear as `/slash` commands
- Review git changes with fast split/full-file diffs
- Attach or paste images into agent chats
- Keep real PTY terminal sessions next to AI conversations

## Why Use The CLI?

The npm package is a small installer and launcher. It does not contain the
desktop app. It resolves the right GitHub release for your machine, installs
Inferay, and opens workspaces from your terminal.

```sh
cd ~/code/my-app
npx inferay .
```

## Images

Inferay supports image attachments in chat. You can attach or paste images into
agent conversations, reference them from queued messages, and revisit them in
the app's image view.

The npm page can also show screenshots or GIFs in this README. Use absolute
HTTPS image URLs for npm screenshots.

## Advanced CLI

```sh
inferay install         # install or replace Inferay
inferay update          # replace Inferay with the latest release
inferay doctor          # check user setup
inferay channel nightly # switch release channel
inferay version         # print CLI version
```

Contributor/debug commands are still available:

```sh
inferay install --local ./build/stable-macos-arm64/inferay.app
inferay doctor --dev
inferay channel
```

## Requirements

- macOS
- Node.js 18+ for the `npx inferay` wrapper
- Claude Code and/or Codex CLI if you want to run those agents

Users do not need Bun or a source checkout.

## Development

Contributors should work from the source repo:

```sh
bun install
bun run dev
```

The CLI package lives in `packages/inferay`. The desktop app and release assets
are built from the repository root.
