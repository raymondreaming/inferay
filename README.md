<p align="center">
  <img src="public/icon.iconset/icon_128x128.png" width="128" height="128" alt="inferay" />
</p>

<h1 align="center">inferay</h1>

<p align="center">
  <strong>A desktop workspace for building with Claude and Codex.</strong><br/>
  Keep your conversations, repositories, and code changes together.
</p>

## Work with agents side by side

Inferay brings Claude and Codex into one workspace. Give each conversation its own pane, run several tasks at once, and compare their progress without juggling terminal windows.

Repository tabs keep related chats together. Arrange panes to suit your work, return to saved conversations, and give each agent the directory and reference files it needs.

## Follow the work

- **Live conversations.** Read streaming responses, inspect tool calls, and respond to agent questions and approval requests.
- **Multiple agents.** Work with Claude and Codex in the same workspace, with model and reasoning settings for each chat.
- **Repository context.** Keep chats attached to their projects and include images and file references in your messages.
- **Code review alongside chat.** Inspect changed files, diffs, commit history, and worktrees without leaving the workspace.
- **Reusable instructions.** Use slash commands and saved skills for recurring tasks.
- **Subagents (`/agents`).** Opt-in workers for explore / general / evaluate (default-FAIL), with Adaptive model routing on the parent turn. Inferay owns the harness and cards; Claude and Codex own the model runs. See the hand-off note below.
- **Your workspace.** Choose a theme and arrange chat and document panes around the task at hand.

Inferay works with your local Claude and Codex installations and their configured accounts or credentials. Access to those services is managed separately.

## Subagents and Adaptive (hand-off)

Send `/agents on` in a chat, then `/agents help` for the short in-product guide. `/agents status` and `/agents cancel <id|all>` manage workers. `/goal` is unchanged and remains Codex's objective loop.

| Piece | Owned by |
| --- | --- |
| Slash mode, worker registry, MCP/Codex tool bridge, cards, Adaptive routing | Inferay |
| Model tokens, tool approvals, file edits inside a worker | Claude / Codex |
| Custom `.agents/` profiles | Out of scope for this hand-off |

What's next after this PR: custom agent files, richer evaluate UX, and any Ray feedback on caps or profile defaults.

## Get Inferay

Download the macOS app from [inferay.com](https://inferay.com), then move it to Applications.

Open a repository, start a chat, and choose an agent. Add another pane when you want to work on a second task or compare an approach.

## Built for the desktop

Inferay uses a Rust desktop host and local backend. Rust also owns application models shared with the interface through WebAssembly; Solid 2 handles the views and browser interactions.

For development setup, architecture checks, and release instructions, see [Contributing](CONTRIBUTING.md).

## License

Inferay is source-available for reference and educational purposes. All rights are reserved by the author. See [LICENSE](LICENSE) for the full terms.
