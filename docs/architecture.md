# Architecture

## GPUI-only desktop

The GPUI-only cutover removes the Solid renderer, WebAssembly UI bridge, and Tao/Wry host. GPUI owns the desktop window, native input, and rendering. It starts the shared Rust backend or attaches to an existing authenticated loopback backend. Only one backend may own a profile.

| Owner | Responsibility |
|---|---|
| `native/gpui` | Native views, input, window, retained UI state and task lifetimes |
| `native/core` | Pure domain vocabulary and transitions |
| `native/presentation` | Pure layout, transcript, dock, and interaction models |
| `native/diff-engine` | Local Git reads, operations, diffs, and graph projection |
| `native/server` | HTTP/WebSocket APIs, providers, persistence, projects, and network integrations |
| `native/tooling` | API reference and release tooling |

There is no browser renderer or HTML fallback route. Shared media and authenticated APIs remain available. See [GPUI](../native/gpui/README.md) for capabilities, remaining feature gaps, and native build instructions.

## Provider runner

Inferay drives the installed CLIs; accounts and credentials stay with them (`agent_account.rs` only checks that they exist).

- **Claude**: `claude -p … --output-format stream-json --verbose --include-partial-messages`, resuming with `--resume <session>`, scoped MCP servers through a temporary `--mcp-config` with `--strict-mcp-config`, and project or skill context through `--append-system-prompt`. Output is read as NDJSON. Claude receives the skill library in its prompt and proposes skills in fenced `inferay-skill` blocks.
- **Codex**: one `codex app-server --listen stdio://` process **per turn**, JSON-RPC `initialize` → `config/read` → `thread/resume` or `thread/start` → `turn/start`. Codex gets dynamic tools: `inferay_list_skills`, `inferay_read_skill`, `inferay_propose_skill`, and `inferay_projects` in interactive chats.
- **Tool environment.** The shared sandbox command builder gives native library tools and executable dependency probes a writable private home and XDG configuration, cache, data and state directories beneath their run scratch directory. Only PATH and locale variables carry over from the app. Git ignores global/system configuration and cannot prompt for credentials; repository-local configuration remains available. Jobs that commit must supply identity through their approved repository configuration or command. Provider processes keep their separate login setup. The native runner also scopes file contents to the project, permitted selected repositories, their resolved Git metadata, run scratch/output and installed runtime locations. Global file metadata remains readable for path lookup. Provider processes still load their own runtime, credentials and context outside the native command sandbox; that ambient context boundary requires a separate audit.
- **Agent automations.** `project_runtime` admits manual and due runs and submits them to `chat_runtime::run_automation`. It creates a pane, retains its identity and context, and uses ordinary `send_message` with the configured working directory. Provider-native tools and normal instruction discovery remain enabled. The run follows the chat task, records logs/usage and required library-tool outcomes, and applies cancellation/deadlines. The shared capacity permit is acquired only by the chat runtime. History selects or restores the same pane and transcript rather than importing a progress snapshot. Old runs without a chat association can still import retained logs.
- **Library-tool authority.** Explicit library calls and tool-only automations keep the native process sandbox, approved input checks, connection grants and Git metadata protections. Agent `may` declarations do not restrict ordinary chat tools. The `local-chat/1` input marker invalidates previous restricted-run approvals.
- **Codex reliability choices.** A fresh app-server per turn keeps a broken transport from poisoning later turns. Resume failures are shown rather than silently starting a new thread. An interrupt waits up to 5 s and RPCs time out after 15 s. Tool-input and MCP elicitation requests are answered through the UI; other server requests, such as approvals, are refused with JSON-RPC `-32601`. Large tool-returned image payloads (tens of MB of base64) have caused transport failures, independent of the renderer.
- **Provider event flow.** Interactive chat and automation runs use a 64-event bounded channel between protocol translation and persistence/diff/log consumers. Producers await capacity, preserving order and draining accepted events before a turn completes. This limits queued event count, not individual payload bytes. Provider control has its own channel; a saturated event queue may pause protocol reads until the consumer advances. Inventory-only MCP discovery has no chat consumer and discards those emissions instead of retaining them.
- **One-shot jobs** (`one_shot.rs`): conversation titles, commit messages and side questions, each through `claude -p`.
- **History** (`provider_history.rs`) reads `~/.codex/sessions` and `~/.claude/projects` and never writes to them.

## MCP

External MCP configuration belongs to each provider. Inferay reads it: Codex through the app-server (`config/read`, `mcpServerStatus/list`), Claude through `claude mcp list` and `~/.claude.json`. Inferay stores only per-provider enable/disable overrides (`mcp-preferences.json`), passed to the child as `INFERAY_MCP_OVERRIDES` and applied as Claude `deniedMcpServers` or Codex per-server `enabled` overrides. Sign-in runs the CLI's `mcp login`.

An explicit per-turn server list is strict: an empty list excludes external MCP servers, and a missing or disabled requested server fails selection instead of reverting to ambient configuration. `agent_mcp.rs` owns this selection and the shared override policy. Codex applies the selection on both new and resumed threads; an installed-provider fixture verifies that only the selected local server starts and reports tools. Claude creates a private temporary config from the selected **user-scope** entries; local/project/plugin-only entries require separate scoped-resolution support and produce an error today. Configuration comes from the child environment, including [`CLAUDE_CONFIG_DIR/.claude.json`](https://code.claude.com/docs/en/mcp-quickstart#find-your-configuration-on-disk) when set. Missing or malformed config never falls back to the app process's home, and diagnostics omit config contents. Omitting the server list retains normal provider discovery. Automation providers still select no ambient external servers. Local plugin MCP tools execute through the approved native tool runner and per-run grants; authenticated remote connections remain planned.

Native Inferay tools use the shared agent dispatcher. Codex receives dynamic tool definitions through its app server; Claude uses a temporary, turn-scoped loopback MCP bridge with bearer authentication. See [MCP contracts and scope](mcp.md) for the complete native tool catalogue, lifecycle and generated transport spec.

## Chat runtime and storage

`native/core/src/chat_status.rs` owns the shared activity value and transitions for local submission, provider acknowledgement, terminal events, reconnects, and failed submissions. The server, transcript replica, and GPUI use that value directly; JSON conversion happens at the transport. `native/gpui/src/transcript.rs` owns immutable prepared rows and viewport publication, while background tasks prepare or recolor content.

The full storage model (files versus databases, every table, how writes and reads flow) is in [storage.md](storage.md). Settings → Database hosts the isolated `modules/database` reader backed by `server/database_explorer`; it introspects stores without initializing, migrating or mutating them. [API documentation](api.md) links generated schema and OpenAPI references.

Everything lives in the profile directory, `~/Library/Application Support/Inferay` (`INFERAY_USER_DATA_DIR` overrides it).

| File | Contents | Owner |
|---|---|---|
| `chat.sqlite3` | Pane documents (session reference, agent context, queue), transcripts with epochs and revisions, transcript messages. WAL, full sync. | `chat_persistence.rs` |
| `projects.sqlite3` | Rebuildable definition indexes, repository bindings, local approvals and schedule state, runs, run events, artifacts, conversation links, migration markers | `project_store.rs` |
| `skills.sqlite3` | Global custom skills and their one-time import marker | `prompt_store.rs` |
| `projects/<id>/` | Managed project files and run directories (`runs/<run>/inputs`, `logs`, `output`) | `project_store.rs`, `project_runtime.rs` |
| `agent-state.json` | Workspace and panes | `workspace_store.rs` |
| `client-storage.sqlite3`, `settings.json` | UI preferences, search folders | `client_storage.rs`, `settings_store.rs` |
| `checkpoints.json` | Checkpoint metadata and changed-file contents; Git repositories retain contents in their object store | `checkpoint.rs` |
| `agent-context.json`, `mcp-preferences.json`, `mcp-icons.json`, `runtime-pids.json` | Context layers, MCP overrides, icon cache, child-process cleanup | server stores |

Workspace persistence returns the core `Workspace` model to internal callers. Title and session mutations save directly without building a JSON snapshot; HTTP workspace reads serialize the model directly, without an intermediate JSON tree; migrations serialize when needed. Every read still validates current file contents, and mutations retain atomic replacement. The HTTP dispatcher owns API authentication and final CORS headers; route errors share the `ApiError` response conversion.

Bundled skills ship in the app (`data/prompts.json`). Global custom skills live in `skills.sqlite3`, independently of the project index. On first open, the Skills library transactionally imports custom records from `prompts.json` and records `global-skills-v1` in its migration table. Incompatible pre-version-3 project profiles are refused before creating an import receipt. The import is transactional and marked once; old sources stay untouched and are never reread after import. The skill store owns one SQLite connection, initialized when the store opens. Reads query current rows without reopening the database or taking a migration write lock. Slash commands expand skill chains (`/name`), and `/clear` and `/exit` are handled by the chat connection.

## Projects and automations

- The scheduler (`ProjectRuntime::start`, `project_runtime.rs`) checks for queued or due work every second. Idle checks only read SQLite. Active admission loads skills once, queues up to 8 due automations, then starts queued runs; the store owns transactional scheduling and claim checks. Each tick uses one blocking task, releasing the store lock between phases.
- Admission: 4 operations at once shared with interactive chats, at most 2 of them background runs. One running run per automation.
- Before a run, `execution_inputs` (`project_index.rs`) captures the current definition, project instructions, selected resources and skills, tool invocation and package file hashes. Approval stores that snapshot’s hash in `automation_state.approved_hash`; queue admission and execution recheck the current snapshot.
- Tool runs use JSON stdin/stdout by default, or the `cli` interface with literal argument templates, closed stdin and success determined by exit status. Both receive `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT`; stdout, stderr and the host-recorded process ID (`process.json`) are retained in run logs. Callers provide reviewed permissions and cancellation checks to the shared runner; it validates inputs and refuses an already-cancelled call before creating execution files. Tool execution owns a process cleanup guard: normal exit, timeout, cancellation, errors and dropped futures release the PID tracker and terminate the private Unix process group. Active leaders also receive process-tree termination. This prevents same-group helpers that ignore SIGTERM from surviving a dropped execution task. Agent runs create a persistent chat through the shared `ChatRuntime`, with normal chat tools and the selected skills, and log to `logs/agent.jsonl`. Run history opens that same chat during or after execution (`project_chat.rs`).
- Definition files and the move away from SQLite-owned definitions: [reference/project-files.md](reference/project-files.md) and [roadmap.md](roadmap.md).

## Environment variables

| Variable | Effect |
|---|---|
| `INFERAY_USER_DATA_DIR` | Profile directory (use a temporary one for tests) |
| `INFERAY_DISABLE_AUTOMATIONS` | Set to `1` when inspecting a production-profile snapshot to prevent queued or scheduled automations from running |
| `INFERAY_DEV_BACKEND_ADDR` | Listen address for the embedded or development server |
| `INFERAY_DEV_APP_ROOT` | Development server asset root; defaults to its compiled checkout. Disposable browser checks set it to the checkout under test. |
| `INFERAY_EXTERNAL_BACKEND_ADDR` | Desktop host attaches to a running server instead of starting one |
| `INFERAY_LIVE_RELOAD` | Live reload for the embedded server |
| `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT` | Given to automation tool processes |
| `INFERAY_MCP_OVERRIDES` | Internal: MCP enable/disable overrides for provider children |
| `INFERAY_RELEASE_URL`, `INFERAY_RELEASE_REPO` | Update check and release tooling |
| `INFERAY_CODESIGN_IDENTITY` | Signing identity for `scripts/build-rust-app.sh` |

## Checks

`bun run check` runs native dependency boundaries, Clippy, and Rust tests for the shared workspace and GPUI. Native tests use temporary profiles and repositories. Visual/input changes additionally require native UI verification.
