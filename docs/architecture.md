# Architecture

How Inferay is built. For what the product's concepts mean, read [concepts.md](concepts.md); for the rules on dependency direction and ownership, read [CODING_GUIDELINES.md](../CODING_GUIDELINES.md).

## Processes

```
┌──────────── inferay-desktop (one process) ────────────┐
│ Tao window + Wry WebView ──HTTP/WS──► Axum server     │──► claude / codex CLIs (per turn)
│   renderer (Solid + WASM)   loopback   (tokio runtime)│──► git, gh, tool processes
└────────────────────────────────────────────────────────┘
```

- **Desktop host** (`native/desktop-host/src/main.rs`) opens a Tao window with a Wry WebView and starts the Axum server **in the same process** on `127.0.0.1` with a random port. Navigation stays on that origin; other links open in the default app. Window controls go over a Wry IPC channel.
- **Server** (`native/server/src/lib.rs`) serves the renderer from `dist/`, one WebSocket at `/ws` (chat send, reconnect, control, unsubscribe, destroy) and `/api/*` routes dispatched by path and method. Every launch makes a random token, checked from the `X-Inferay-Auth` header or a cookie; only loopback hosts are accepted.
- **Development** (`bun run dev`, `scripts/dev-app.sh`) builds the renderer and `inferay-dev-server`, serves on `127.0.0.1:4317` with live reload, watches `src`, `public` and `native` to rebuild the renderer, and starts the desktop host attached to that server (`INFERAY_EXTERNAL_BACKEND_ADDR`). Server changes need a restart.

## Crates and renderer

| Part | Role |
|---|---|
| `native/core` | Pure vocabulary and rules: chat and agent protocol, workspace state and transitions, skills (`prompts/`), projects and definition files, provider config, path policy. No tokio, HTTP or UI (enforced by `check-native-boundaries.sh`). |
| `native/presentation` | Pure renderer models compiled to WebAssembly: chat view, transcript, composer, diff, graph, dock, panels, workbench, markdown, shortcuts. |
| `native/diff-engine` | Git execution, prepared diffs, graph layout, worktree renames. |
| `native/server` | HTTP and WebSocket, provider runner, chat runtime, persistence, projects and automations, Git, forge and MCP integration. |
| `native/desktop-host` | Window, menus, vibrancy. |
| `native/tooling` | Release tooling and `export-renderer-types`. |
| `src/` | Solid renderer: `app/` composition, `modules/` (agents, context, conversation, explorer, onboarding, repository, settings, skills, workspace), `shared/`, `design-system/`. One route, `/`. |

**Contracts.** `scripts/build-presentation.sh` exports Rust types to `build/presentation/contracts` (imported as `@contracts`), builds the presentation crate for `wasm32-unknown-unknown`, runs `wasm-bindgen` and inlines the module so the renderer loads it synchronously. The renderer calls Rust models through one `presentation(op, json)` entry. See [ADR 0001](adr/0001-rust-models-solid-views.md).

## Provider runner

Inferay drives the installed CLIs; accounts and credentials stay with them (`agent_account.rs` only checks that they exist).

- **Claude**: `claude -p … --output-format stream-json --verbose --include-partial-messages`, resuming with `--resume <session>`, scoped MCP servers through a temporary `--mcp-config` with `--strict-mcp-config`, and project or skill context through `--append-system-prompt`. Output is read as NDJSON. Claude receives the skill library in its prompt and proposes skills in fenced `inferay-skill` blocks.
- **Codex**: one `codex app-server --listen stdio://` process **per turn**, JSON-RPC `initialize` → `config/read` → `thread/resume` or `thread/start` → `turn/start`. Codex gets dynamic tools: `inferay_list_skills`, `inferay_read_skill`, `inferay_propose_skill`, and `inferay_projects` in interactive chats.
- **Permissions.** Both providers currently run with full access: Claude with `--dangerously-skip-permissions`, Codex with `danger-full-access` and approval policy `never`. Inferay does not sandbox agent processes. Permission declarations on automations (`may`) are passed to the agent as instructions and checked as a ceiling against the plugin, but nothing stops an agent's own shell from exceeding them.
- **Codex reliability choices.** A fresh app-server per turn keeps a broken transport from poisoning later turns. Resume failures are shown rather than silently starting a new thread. An interrupt waits up to 5 s and RPCs time out after 15 s. Tool-input and MCP elicitation requests are answered through the UI; other server requests, such as approvals, are refused with JSON-RPC `-32601`. Large tool-returned image payloads (tens of MB of base64) have caused transport failures, independent of the renderer.
- **One-shot jobs** (`one_shot.rs`): conversation titles, commit messages and side questions, each through `claude -p`.
- **History** (`provider_history.rs`) reads `~/.codex/sessions` and `~/.claude/projects` and never writes to them.

## MCP

Inferay owns no MCP server configuration. It reads each provider's own: Codex through the app-server (`config/read`, `mcpServerStatus/list`), Claude through `claude mcp list` and `~/.claude.json`. Inferay stores only per-provider enable/disable overrides (`mcp-preferences.json`), passed to the child as `INFERAY_MCP_OVERRIDES` and applied as Claude `deniedMcpServers` or Codex `mcp_servers.<name>.enabled`. Sign-in runs the CLI's `mcp login`.

## Chat runtime and storage

Everything lives in the profile directory, `~/Library/Application Support/Inferay` (`INFERAY_USER_DATA_DIR` overrides it).

| File | Contents | Owner |
|---|---|---|
| `chat.sqlite3` | Pane documents (session reference, agent context, queue), transcripts with epochs and revisions, transcript messages. WAL, full sync. | `chat_persistence.rs` |
| `projects.sqlite3` | Projects, resources and revisions, plugins and resource types, automations, approvals, runs, run events, artifacts, conversation links, migration markers; also custom skills (`inferay.skill` resources with no project) | `project_store.rs`, `prompt_store.rs` |
| `projects/<id>/` | Managed project files and run directories (`runs/<run>/inputs`, `logs`, `output`) | `project_store.rs`, `project_runtime.rs` |
| `agent-state.json` | Workspace and panes | `workspace_store.rs` |
| `client-storage.json`, `settings.json` | UI preferences, search folders | `client_storage.rs`, `settings_store.rs` |
| `checkpoints.json` | Checkpoint metadata; file contents go into the repository's Git object store | `checkpoint.rs` |
| `agent-context.json`, `mcp-preferences.json`, `mcp-icons.json`, `runtime-pids.json` | Context layers, MCP overrides, icon cache, child-process cleanup | server stores |

Bundled skills ship in the app (`data/prompts.json`). Custom skills moved from the profile's `prompts.json` into `projects.sqlite3` at startup (migration `skills-v1`); the old file is only read for that migration. Slash commands expand skill chains (`/name`), and `/clear` and `/exit` are handled by the chat connection.

## Projects and automations

- The scheduler (`ProjectRuntime::start`, `project_runtime.rs`) ticks every second: it queues up to 8 due automations, then starts queued runs.
- Admission: 4 operations at once shared with interactive chats, at most 2 of them background runs. One running run per automation.
- Before a run, `capture_snapshot` (`project_store.rs`) records the execution, revision, project instructions, tool definition and entrypoint hash, selected resources and skills. Enabling an automation stores that snapshot's hash in `automation_approvals`.
- Tool runs receive JSON on stdin and `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT`. Agent runs launch Codex or Claude with the selected skills (without `inferay_projects`) and log to `logs/agent.jsonl`. A finished agent run can be opened as a chat (`project_chat.rs`).
- Definition files and the move away from SQLite-owned definitions: [reference/project-files.md](reference/project-files.md) and [roadmap.md](roadmap.md).

## Environment variables

| Variable | Effect |
|---|---|
| `INFERAY_USER_DATA_DIR` | Profile directory (use a temporary one for tests) |
| `INFERAY_DEV_BACKEND_ADDR` | Listen address for the embedded or development server |
| `INFERAY_EXTERNAL_BACKEND_ADDR` | Desktop host attaches to a running server instead of starting one |
| `INFERAY_LIVE_RELOAD` | Live reload for the embedded server |
| `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT` | Given to automation tool processes |
| `INFERAY_MCP_OVERRIDES` | Internal: MCP enable/disable overrides for provider children |
| `INFERAY_RELEASE_URL`, `INFERAY_RELEASE_REPO` | Update check and release tooling |
| `INFERAY_CODESIGN_IDENTITY` | Signing identity for `scripts/build-rust-app.sh` |

## Checks

`bun run check:architecture` (`scripts/check-architecture.sh`) runs oxlint, import and native boundary checks, the presentation build and usage check, component structure, `tsc`, the Solid audit, `cargo fmt`, clippy with warnings denied, the renderer build and a dependency audit. Its "Solid reactivity regression" step currently runs nothing. Script tests: `bun test scripts/tests`. Rust tests sit beside their modules (`*/tests.rs`, `native/*/tests/`). `bun run verify:projects` drives project workflows end to end in Playwright against a temporary profile. Git hooks run lint-staged; there is no CI.
