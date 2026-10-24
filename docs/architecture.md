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
- **Development** (`bun run dev`, `scripts/dev-app.sh`) builds the renderer, server and desktop host, then runs the binaries directly so cleanup owns their processes. It serves on `127.0.0.1:4317` with live reload, watches `src`, `public` and `native` to rebuild the renderer, and attaches the desktop host through `INFERAY_EXTERNAL_BACKEND_ADDR`. The profile defaults to `build/dev-profile`, separate from the installed app; `INFERAY_USER_DATA_DIR` and `INFERAY_DEV_BACKEND_ADDR` can override the profile and address. Server changes need a restart. For a standalone dev bundle, omit `INFERAY_EXTERNAL_BACKEND_ADDR` so the desktop process owns its backend, and set an isolated `INFERAY_USER_DATA_DIR` in the bundle environment.

## Crates and renderer

| Part | Role |
|---|---|
| `native/core` | Pure vocabulary and rules: chat and agent protocol, workspace state and transitions, skills (`prompts/`), projects and definition files, provider config, path policy. No tokio, HTTP or UI (enforced by `check-native-boundaries.sh`). |
| `native/presentation` | Pure renderer models compiled to WebAssembly: chat view, transcript, composer, diff, graph, dock, panels, workbench, markdown, shortcuts. |
| `native/diff-engine` | Git execution, prepared diffs, graph layout, worktree renames. |
| `native/server` | HTTP and WebSocket, provider runner, chat runtime, persistence, projects and automations, Git, forge and MCP integration. |
| `native/desktop-host` | Window, menus, vibrancy. |
| `native/tooling` | Release tooling and `export-renderer-types`. |
| `src/` | Solid renderer: `app/` composition, `modules/` (agents, context, conversation, explorer, onboarding, repository, settings, skills, workspace), `shared/`, `design-system/`. One application shell at `/`, composed directly without a client router. Startup normalizes restored legacy paths to `/` while preserving search/hash. |

**Contracts.** `scripts/build-presentation.sh` exports Rust types to `build/presentation/contracts` (imported as `@contracts`), builds the presentation crate for `wasm32-unknown-unknown`, runs `wasm-bindgen` and inlines the module so the renderer loads it synchronously. The renderer calls Rust models through one `presentation(op, json)` entry. See [ADR 0001](adr/0001-rust-models-solid-views.md).

The automation editor edits the canonical definition directly, preserving fields that its controls do not expose. Rust supplies new-definition defaults and schedule presets. Project views retain indexed definitions rather than copying their fields into a second renderer model. Library content summaries reuse native definition classification.

Automation execution parses immutable typed inputs once and shares them with granted tools. Approval comparisons and retained run files still use the original JSON snapshot, so this runtime representation does not change approval hashes or saved formats.

Commit details read author identity, message and changed files; graph refs and provider metadata stay in the graph/forge queries that consume them. Commit, comparison and working-tree line counts share Git’s NUL-delimited numstat parser. Historical changes combine raw status and numstat in one Git invocation, retaining literal filenames and rename paths.

Repository status has two query shapes. `/api/git/statuses` returns one canonical file list
and display metadata for detailed workbenches; `/api/git/summaries` returns
`GitChangeSummary` values keyed by canonical repository path for project navigation.
Both use the same native Git status and line-count computation, path authorization
and deduplication. Only the detailed query builds presentation metadata. The presentation model
derives staged and unstaged sections from the canonical list; status responses
do not duplicate file records into groups. The core status model owns the summary. Graph preparation computes it
once per readable worktree, includes it as `GitWorktree.changeSummary`, and reuses
it for graph WIP rows. Clean worktrees carry a zero summary; unreadable worktrees
omit it. This remains available when graph search hides WIP rows.

Project navigation observes the existing active graph queries and displays their
native summaries directly, excluding those paths from its independent five-second
summary poll. Successful graphs retain their three-second refresh interval. If a
graph closes, becomes disabled, or fails, its paths return to independent polling.
No separate result cache or renderer-side line aggregation is introduced.

The detailed workbench also lets its initial graph request own the current
repository's status read. The workbench hook establishes the graph intent before
its first query subscription, while the panel transition settles. Its changes
panel remains loading until that request settles; unrelated paths still load
independently, and graph failure enables the independent status query. The
presentation component does not issue a second initialization command.

Detailed native status includes an opaque revision covering status fields and
changed-file size/mtime. Diff requests use that status revision, whether supplied
by the visible graph or the independent status poll. Opening a diff stops the
graph poll without freezing the diff at a remembered graph revision. Graph
preparation reuses these fingerprints rather than scanning file metadata again.

Repository diff queries retain recently visited files for 30 seconds. After a
successful response, the query lifecycle releases superseded revisions of the same
diff identity only when they have no observers, have settled, and predate the
new request. Other views/files and newer or in-flight results remain cached;
failed or cancelled reads do not evict snapshots. Validators stay with those query results. Refreshes reuse a validator only for
an identical repository/file/view/staging/history scope. An unchanged native
response returns 304; the renderer preserves the previous diff object and skips
JSON decoding and syntax preflight. Selected-file changes still return new data,
and failed responses still hide stale content. Working-tree image URLs include
the existing file/index fingerprint so changed images invalidate both the diff
and the browser image source. Native diff computation and its two-second cache
lifetime remain unchanged. Native inline-view preparation borrows source rows
while selecting context windows and ordering removals/additions. It allocates
owned strings only for retained output rows; the transport contract is unchanged.

Graph refreshes retain one validator and snapshot per reader, scoped by repository,
limit, search and ref preferences. The native renderer cache owns both serialized
bytes and their precomputed ETag under the existing 64 MiB / 128-entry budget.
Clients with an exact base negotiate `A-IM: inferay-graph`; a 226 response carries
changed root fields and an optional commit splice, with `IM`, `Delta-Base`, the
new ETag and `Cache-Control: no-store`. This follows the conditional-response
semantics in [RFC 3229](https://www.rfc-editor.org/rfc/rfc3229.html#section-10.3).
The server compares borrowed serialized JSON on its bounded blocking pool, reading
commit arrays once. It never predicts graph stability from refs alone. Once a
replacement is available, it releases older cached responses for that exact scope;
in-flight comparisons retain their own base references, and late reads of older
cached entries cannot remove newer entries. History collection reserves the
requested row count, and graph serialization reserves the prior response size
plus 4 KiB for small edits, avoiding repeated growth of large allocations. A missing/evicted base, unsupported
negotiation, small response, comparison failure or insufficient size reduction
returns the ordinary full representation. Unchanged graphs still return 304.
The renderer applies a delta only to its matching base and keeps unchanged arrays
and commit objects; failures and cancelled requests never publish a new base.
This reduces transport and browser reconstruction, not native Git history work.
Graph presentation includes the maximum commit column; renderer layout sends that scalar and the commit count instead of resending history on resize. History lookups remain independent of geometry, and rendered search rows already belong to the native filtered result. The workbench indexes canonical commit objects once per graph snapshot and shares that lookup with selection reconciliation; retained selections survive filtering but reset across repositories. Resolving selected objects stays in the renderer, without serializing history or worktree status through WASM. Diff prefetch sends only the visible file count and selected index; native adjacency rules return indices into the same file objects.

Project editor operations use request/result signatures generated from their Rust dispatch entries: automation defaults, trigger presets, proposal paths, graph layout, import manifests, skill choices, tool grants and effect controls. TypeScript infers their results and rejects mismatched inputs or caller-selected result types. Older unrelated JSON projections retain an explicitly generated operation-name union; they have not all been converted to typed requests. The existing exporter owns dependency exports, and there is no separate handwritten operation registry.

Sent user messages keep their full text. The composer presentation model badges only complete known slash commands and recognizes HTTP(S) links without changing their stored URL. Link badges fetch optional page titles and raster favicons through `/api/link-metadata`, with a hostname fallback and an hour of renderer query caching. The native fetcher sends no browser credentials, bounds time and response size, and validates and pins public DNS addresses on every redirect. Private and unavailable pages remain usable as links without metadata.

## Workspace ownership

The core workspace resolves pane actions by stable pane ID and owns repository/workspace/chat selection rules. Selecting, removing or changing a chat does not require the renderer to supply its owning group. The WebAssembly workspace replica uses those rules with typed, shared snapshots; optimistic edits copy only when necessary, while acknowledged snapshots share ownership. It owns pending intent and acknowledgement rollback; the Solid adapter owns only the request queue and a shared memoized project view. Workspace responses contain the canonical groups and panes once. The presentation model returns visible chat indices into that snapshot; sidebar consumers reference the original pane records. There is no second renderer state setter bypassing that queue.

The chat canvas uses the native grid dock model for layout, pointer placement and scrolling. Its local `useWorkspaceDock` adapter owns persistence, responsive sizing, pointer capture and cancellation; the canvas owns pane rendering, text selection and wheel routing. Canceling a drag or hiding the workspace releases its listeners without selecting a pane. Wheel routing checks the event's ancestors and the chat's explicit scroll area instead of scanning every descendant. Panel transitions and optimistic replay use the same typed Rust session. Legacy snapshots are repaired only when read from storage; graph and history display flags are derived rather than persisted. Saved detached document panels still restore, while the unused document-detaching commands and drag controls have been removed. Repository documents and changes remain in the repository workbench; the chat dock has no alternate row layout or auxiliary-panel rendering path. The project repository panel is the sole workbench host beside the current page. Its Rust resize projection leaves room for chat, while its browser adapter owns pointer and keyboard resizing. Repository selection and open state belong to the project navigation owner and restore per project. History and diffs fill the upper panel; optional changes and commit controls occupy the lower panel. The workbench unmounts on close or repository switch, so global keyboard handlers and Git observers belong to only one active repository.

Native repository and checkpoint commands share the diff engine's Git command boundary.
On macOS, when the first executable Git on PATH is `/usr/bin/git`, it resolves
Apple's selected tool with a bounded `xcrun --find git` call and reuses that binary.
Every call still checks PATH precedence; custom installations, wrappers and
relative PATH entries retain normal command lookup. A failed lookup or missing
resolved binary falls back to `git`. The selected Apple toolchain is retained
for the process lifetime; restart Inferay after switching Xcode installations.
Other platforms retain normal Git lookup. No Git results, credentials or remote
operations are cached by this resolver.

Repository `+`/`−` totals count lines across staged, unstaged and untracked changes. The diff engine uses a disposable index to include new files in Git’s numstat and rename detection without staging them in the user’s index; binary files contribute no text lines.


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

`bun run check:architecture` (`scripts/check-architecture.sh`) runs oxlint, import and native boundary checks, the presentation build and usage check, component structure, Bun's TypeScript checker, the Solid audit, `cargo fmt`, clippy with warnings denied, the renderer build and a dependency audit. Script tests: `bun test scripts/tests`. Rust tests sit beside their modules (`*/tests.rs`, `native/*/tests/`). `bun run verify:projects` drives project workflows end to end in Playwright against a temporary profile. Git hooks run lint-staged with Oxlint, Biome import/CSS/JSON checks and Bun formatting; there is no CI.

Goodbot (`npx goodbot-ai analyze`) is an advisory renderer scan. Its configuration places design tokens below shared UI and features below app composition, and does not require barrels. It does not resolve the renderer's aliases or analyze Rust. Its `_root` aggregation combines generated presentation files outside `src` with `client.tsx`, producing a false module cycle; the configuration documents that specific suppression. The repository's alias-aware file-cycle and native boundary checks remain authoritative and have no cycle exceptions. File-size and complexity findings require an ownership review, not automatic splitting or threshold changes.

Installed-binary regressions run with `cargo test -p inferay-server refuses_native_mutation_paths_in_automation_policy -- --ignored`. Disposable local API fixtures supply tool calls directly, independently of model cooperation. Codex must reject native `apply_patch` and report `exec_command` unavailable. Claude must refuse Bash, Write and Edit as unavailable tools. Target files remain absent or unchanged, even with Inferay project-write permission. Each CLI uses an isolated configuration and local API endpoint; these checks make no paid provider request. They establish refusal for these native mutation paths on the installed versions, not read isolation or every future provider tool.

A migration rehearsal runs with `INFERAY_MIGRATION_SOURCE="<profile>" cargo test -p inferay-server existing_profile_migrates_and_rebuilds_in_disposable_copy -- --ignored --nocapture`. It opens the source database read-only, takes a SQLite backup including committed WAL contents, and copies project files into a bounded disposable profile. All migrations, second-startup checks and database deletion happen in that copy. It verifies retained job IDs and run states, rebuilt definitions (including local skills), disabled schedules, absent approvals and local repository bindings. The source app keeps running; run against a quiet profile so file edits do not race the snapshot. This rehearsal targets file-backed profiles (schema 3 or newer); older database fixtures verify refusal without modifying stored data.

The `manual_and_scheduled_agents_are_durable_regular_chats` regression uses a local provider fixture to exercise both trigger paths, live transcript persistence, ordinary launch arguments, one shared capacity permit, follow-up messages and provider-session restoration. Failure/cancellation coverage retains the chat association. Explicit library tools keep their native sandbox tests. Opt-in `calls_granted_library_tool` tests exercise real Claude and Codex tool grants and consume provider account usage.

Run history exposes conversation availability as soon as the run has a chat association, including active runs. Open chat selects that same pane; if it was removed, it restores the saved pane identity. Legacy runs without an association can import a nonempty retained agent log. Tool-only runs and preflight failures without a conversation cannot open a chat.
