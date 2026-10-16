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

Repository status has two query shapes. `/api/git/statuses` returns file lists,
groups and display metadata for detailed workbenches; `/api/git/summaries` returns
`GitChangeSummary` values keyed by canonical repository path for project navigation.
Both use the same native Git status and line-count computation, path authorization
and deduplication. Only the detailed query builds file groups and presentation
metadata. The core status model owns the summary. Graph preparation computes it
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

## Workspace ownership

The core workspace resolves pane actions by stable pane ID. Selecting, removing or changing a chat does not require the renderer to supply its owning group. The WebAssembly workspace replica owns optimistic selection and acknowledgement rollback; the Solid adapter owns only the request queue and a shared memoized project view. There is no second renderer state setter bypassing that queue.

The chat canvas uses the native grid dock model for layout, pointer placement and scrolling. Panel transitions and optimistic replay use the same typed Rust session. Legacy snapshots are repaired only when read from storage; graph and history display flags are derived rather than persisted. Saved detached document panels still restore, while the unused document-detaching commands and drag controls have been removed. Repository documents and changes remain in the repository workbench; the chat dock has no alternate row layout or auxiliary-panel rendering path. The repository diff rail fills its available area, while the changes sidebar retains its independent resize control.

Native repository commands share the diff engine's `git_exec::command` boundary.
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
- **Tool environment.** The shared sandbox command builder gives native tools, `inferay_exec` commands and executable dependency probes a writable private home and XDG configuration, cache, data and state directories beneath their run scratch directory. Only PATH and locale variables carry over from the app. Git ignores global/system configuration and cannot prompt for credentials; repository-local configuration remains available. Jobs that commit must supply identity through their approved repository configuration or command. Provider processes keep their separate login setup. The native runner also scopes file contents to the project, permitted selected repositories, their resolved Git metadata, run scratch/output and installed runtime locations. Global file metadata remains readable for path lookup. Provider processes still load their own runtime, credentials and context outside the native command sandbox; that ambient context boundary requires a separate audit.
- **Automatic instruction discovery.** Codex automation threads set `project_doc_max_bytes` to zero, preventing automatic repository `AGENTS.md` injection. Approved instructions still arrive explicitly; repository guidance can be read through `inferay_exec` within the run's read scope. Installed-provider fixtures verify this and verify Claude excludes the tested project/personal `CLAUDE.md` files in restricted mode. Codex 0.155.1 loads personal instructions independently through its home instruction loader. On macOS, automation app-server processes now deny reads of `CODEX_HOME/AGENTS.md` and `AGENTS.override.md`, including their resolved symlink targets at launch. Authentication and session storage keep the original provider home; no credentials are copied. The installed-provider fixture verifies personal instructions and a symlinked personal override are absent while explicit run instructions remain. Codex automation threads also disable automatic skill instructions, bundled/cloud skill discovery, skill search, and native memory use/generation/tools. The installed-provider fixture places unselected skills in both the personal and project skill directories and verifies their markers never enter the request; it reproduced personal skill leakage before this policy. Inferay supplies selected skills and project memory explicitly. These restrictions do not establish isolation from every provider-home source of context. Other platforms refuse Codex automation startup until an equivalent adapter exists. Interactive chats keep normal discovery.
- **Permissions.** Interactive chats retain their existing provider access. Automation commands use `inferay_exec`, backed by the same bounded native runner as library tools. Each call rechecks approved inputs, retains its script, input, logs and artifacts, and shares cancellation and the per-run serial 64-call limit. Codex runs read-only with its shell disabled, networking off, web search disabled and ambient MCP removed; Claude exposes only Inferay MCP, with native Read/Glob/Grep/Bash/Edit/Write/web tools denied and ambient settings/hooks disabled. File reads, searches, writes and shell commands go through Inferay. Installed-Claude fixture checks force Read/Glob/Grep/Bash/Write/Edit calls and verify actual tool refusals without exposing a private file sentinel. Real Claude and Codex runs read a project file through `inferay_exec`, pass its otherwise undisclosed contents to a granted library tool and retain the resulting report. On macOS, the runner and its children use a required OS sandbox: writes are limited to output, private temporary files and approved project/repository roots; sockets require `network`. Native commands can read project files and selected repositories with `read_repositories` or `write_repositories`. Unrelated file contents and symlinks escaping those roots are refused. macOS system/runtime directories, the selected executable and its app bundle, the Xcode license receipt, resolver/timezone files and random devices supply runtime dependencies. Custom runtimes with dependencies outside those locations may fail closed. `gpu` grants the Apple Silicon graphics services needed by rendering tools. Other platforms refuse native tool execution until an adapter exists. Approval fingerprints capture resolved Git metadata locations for the project and selected repositories, including worktree common directories. Changing a pointer invalidates approval even when definition files are unchanged; invalid or missing targets refuse input capture. For `commit` plus project/repository write permission, review also lists the resolved Git write locations, including shared worktree metadata. Individual and plugin-bundle approval screens show those paths. The runner re-resolves them against the captured list before granting access; a mismatch refuses execution. Only the metadata directories gain access, not their parent folders. Without `commit`, Git metadata is protected, including separate directories, worktree common directories, symlink targets, existing hard-link aliases and ancestor renames. Alias inspection is bounded and fails closed. Native checks cover these layouts and granted commits; real Codex and Claude gates verify working-file writes, denied staging/commits without permission and successful approved commits. Both providers also pass outside-write and loopback/public TCP refusal probes; permission errors are required, not timeouts. These checks do not establish the complete permission model: provider ambient-context isolation and independent `push`/`open_pr` authority remain unfinished. See the [execution-authority decision](adr/0002-automation-kernel.md#execution-authority-remaining-boundary).
- **Codex reliability choices.** A fresh app-server per turn keeps a broken transport from poisoning later turns. Resume failures are shown rather than silently starting a new thread. An interrupt waits up to 5 s and RPCs time out after 15 s. Tool-input and MCP elicitation requests are answered through the UI; other server requests, such as approvals, are refused with JSON-RPC `-32601`. Large tool-returned image payloads (tens of MB of base64) have caused transport failures, independent of the renderer.
- **Provider event flow.** Interactive chat and automation runs use a 64-event bounded channel between protocol translation and persistence/diff/log consumers. Producers await capacity, preserving order and draining accepted events before a turn completes. This limits queued event count, not individual payload bytes. Provider control has its own channel; a saturated event queue may pause protocol reads until the consumer advances. Inventory-only MCP discovery has no chat consumer and discards those emissions instead of retaining them.
- **One-shot jobs** (`one_shot.rs`): conversation titles, commit messages and side questions, each through `claude -p`.
- **History** (`provider_history.rs`) reads `~/.codex/sessions` and `~/.claude/projects` and never writes to them.

## MCP

Inferay owns no MCP server configuration. It reads each provider's own: Codex through the app-server (`config/read`, `mcpServerStatus/list`), Claude through `claude mcp list` and `~/.claude.json`. Inferay stores only per-provider enable/disable overrides (`mcp-preferences.json`), passed to the child as `INFERAY_MCP_OVERRIDES` and applied as Claude `deniedMcpServers` or Codex per-server `enabled` overrides. Sign-in runs the CLI's `mcp login`.

An explicit per-turn server list is strict: an empty list excludes external MCP servers, and a missing or disabled requested server fails selection instead of reverting to ambient configuration. `agent_mcp.rs` owns this selection and the shared override policy. Codex applies the selection on both new and resumed threads; an installed-provider fixture verifies that only the selected local server starts and reports tools. Claude creates a private temporary config from the selected **user-scope** entries; local/project/plugin-only entries require separate scoped-resolution support and produce an error today. Configuration comes from the child environment, including [`CLAUDE_CONFIG_DIR/.claude.json`](https://code.claude.com/docs/en/mcp-quickstart#find-your-configuration-on-disk) when set. Missing or malformed config never falls back to the app process's home, and diagnostics omit config contents. Omitting the server list retains normal provider discovery. Automation providers still select no ambient external servers. Local plugin MCP tools execute through the approved native tool runner and per-run grants; authenticated remote connections remain planned.

## Chat runtime and storage

The full storage model (files versus databases, every table, how writes and reads flow) is in [storage.md](storage.md).

Everything lives in the profile directory, `~/Library/Application Support/Inferay` (`INFERAY_USER_DATA_DIR` overrides it).

| File | Contents | Owner |
|---|---|---|
| `chat.sqlite3` | Pane documents (session reference, agent context, queue), transcripts with epochs and revisions, transcript messages. WAL, full sync. | `chat_persistence.rs` |
| `projects.sqlite3` | Rebuildable definition indexes, repository bindings, local approvals and schedule state, runs, run events, artifacts, conversation links, migration markers | `project_store.rs` |
| `skills.sqlite3` | Global custom skills and their one-time import marker | `prompt_store.rs` |
| `projects/<id>/` | Managed project files and run directories (`runs/<run>/inputs`, `logs`, `output`) | `project_store.rs`, `project_runtime.rs` |
| `agent-state.json` | Workspace and panes | `workspace_store.rs` |
| `client-storage.sqlite3`, `settings.json` | UI preferences, search folders | `client_storage.rs`, `settings_store.rs` |
| `checkpoints.json` | Checkpoint metadata; file contents go into the repository's Git object store | `checkpoint.rs` |
| `agent-context.json`, `mcp-preferences.json`, `mcp-icons.json`, `runtime-pids.json` | Context layers, MCP overrides, icon cache, child-process cleanup | server stores |

Bundled skills ship in the app (`data/prompts.json`). Global custom skills live in `skills.sqlite3`, independently of the project index. On first use, the Skills library imports existing global skill records from `projects.sqlite3`, or the older `prompts.json` when that migration has not happened. The import is transactional and marked once; old sources stay untouched and are never reread after import. Slash commands expand skill chains (`/name`), and `/clear` and `/exit` are handled by the chat connection.

## Projects and automations

- The scheduler (`ProjectRuntime::start`, `project_runtime.rs`) ticks every second: it queues up to 8 due automations, then starts queued runs.
- Admission: 4 operations at once shared with interactive chats, at most 2 of them background runs. One running run per automation.
- Before a run, `execution_inputs` (`project_index.rs`) captures the current definition, project instructions, selected resources and skills, tool invocation and package file hashes. Approval stores that snapshot’s hash in `automation_state.approved_hash`; queue admission and execution recheck the current snapshot.
- Tool runs use JSON stdin/stdout by default, or the `cli` interface with literal argument templates, closed stdin and success determined by exit status. Both receive `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT`; stdout, stderr and the host-recorded process ID (`process.json`) are retained in run logs. Callers provide reviewed permissions and cancellation checks to the shared runner; it validates inputs and refuses an already-cancelled call before creating execution files. Tool execution owns a process cleanup guard: normal exit, timeout, cancellation, errors and dropped futures release the PID tracker and terminate the private Unix process group. Active leaders also receive process-tree termination. This prevents same-group helpers that ignore SIGTERM from surviving a dropped execution task. Agent runs launch Codex or Claude with the selected skills (without `inferay_projects`) and log to `logs/agent.jsonl`. A finished agent run can be opened as a chat (`project_chat.rs`).
- Definition files and the move away from SQLite-owned definitions: [reference/project-files.md](reference/project-files.md) and [roadmap.md](roadmap.md).

## Environment variables

| Variable | Effect |
|---|---|
| `INFERAY_USER_DATA_DIR` | Profile directory (use a temporary one for tests) |
| `INFERAY_DEV_BACKEND_ADDR` | Listen address for the embedded or development server |
| `INFERAY_DEV_APP_ROOT` | Development server asset root; defaults to its compiled checkout. Disposable browser checks set it to the checkout under test. |
| `INFERAY_EXTERNAL_BACKEND_ADDR` | Desktop host attaches to a running server instead of starting one |
| `INFERAY_LIVE_RELOAD` | Live reload for the embedded server |
| `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT` | Given to automation tool processes |
| `INFERAY_MCP_OVERRIDES` | Internal: MCP enable/disable overrides for provider children |
| `INFERAY_RELEASE_URL`, `INFERAY_RELEASE_REPO` | Update check and release tooling |
| `INFERAY_CODESIGN_IDENTITY` | Signing identity for `scripts/build-rust-app.sh` |

## Checks

`bun run check:architecture` (`scripts/check-architecture.sh`) runs oxlint, import and native boundary checks, the presentation build and usage check, component structure, `tsc`, the Solid audit, `cargo fmt`, clippy with warnings denied, the renderer build and a dependency audit. Its "Solid reactivity regression" step currently runs nothing. Script tests: `bun test scripts/tests`. Rust tests sit beside their modules (`*/tests.rs`, `native/*/tests/`). `bun run verify:projects` drives project workflows end to end in Playwright against a temporary profile. Git hooks run lint-staged; there is no CI.

Installed-binary regressions run with `cargo test -p inferay-server refuses_native_mutation_paths_in_automation_policy -- --ignored`. Disposable local API fixtures supply tool calls directly, independently of model cooperation. Codex must reject native `apply_patch` and report `exec_command` unavailable. Claude must refuse Bash, Write and Edit as unavailable tools. Target files remain absent or unchanged, even with Inferay project-write permission. Each CLI uses an isolated configuration and local API endpoint; these checks make no paid provider request. They establish refusal for these native mutation paths on the installed versions, not read isolation or every future provider tool.

A migration rehearsal runs with `INFERAY_MIGRATION_SOURCE="<profile>" cargo test -p inferay-server existing_profile_migrates_and_rebuilds_in_disposable_copy -- --ignored --nocapture`. It opens the source database read-only, takes a SQLite backup including committed WAL contents, and copies project files into a bounded disposable profile. All migrations, second-startup checks and database deletion happen in that copy. It verifies retained job IDs and run states, rebuilt definitions (including local skills), disabled schedules, absent approvals and local repository bindings. The source app keeps running; run against a quiet profile so file edits do not race the snapshot. This rehearsal targets file-backed profiles (schema 3 or newer); legacy fixture tests cover the original database export.

Opt-in real-provider filesystem gates run with `cargo test -p inferay-server real_claude_automation_uses_sandbox_and_records_a_run --lib -- --ignored` and the corresponding `real_codex_automation_uses_sandbox_and_records_a_run` test. They use disposable project profiles, consume provider account usage, and inspect output files and recorded tool results. They do not launch or restart the desktop app or development server. The opt-in `calls_granted_library_tool` test filter runs real Claude and Codex tool-grant gates: each must discover and execute a library tool through Inferay, retain the exact input and generated report, and index both report and agent response in run history.

Run history exposes conversation availability from the retained agent log. Finished, failed, interrupted, cancelled and waiting-for-input agent runs can open in chat when a nonempty transcript remains. Queued/running runs, tool-only runs and preflight failures without a transcript cannot. The history button and continuation endpoint use the same server decision; reopening retains the provider session when available and otherwise supplies captured context.
