# inferay

A macOS AI workspace for Claude, Codex, agent workspaces, project context, slash
commands, git diffs, and image-aware agent work.

```sh
npx inferay
```

Or with Bun:

```sh
bunx inferay
```

```sh
npx inferay .
```

If Inferay is not installed yet, the CLI downloads the latest compatible macOS
release, installs it, and launches the app. If it is already installed, the same
command opens Inferay directly.

## Requirements

- macOS
- Node.js 18+ for `npx inferay`, or Bun for `bunx inferay`
- Claude Code and/or Codex CLI if you want to run those agents

Users do not need Bun, a source checkout, or any build commands to use Inferay.
