# Roadmap

Inferay is becoming a general automation harness on top of a daily coding-agent workspace: you describe work in chat, save reusable implementations as local plugin libraries, and schedule tasks as automations with explicit approval. The kernel stays small and generic ([ADR 0002](adr/0002-automation-kernel.md)); domain-specific code (brand content, app builds, design, research) lives in reusable plugins.

The work is a sequence of milestones. Each one ends with something real running, and each is done only when its acceptance list passes. When a milestone ships, remove it from this page and update [concepts.md](concepts.md), [architecture.md](architecture.md) and [reference/project-files.md](reference/project-files.md) in the same change.

## What works

- Chats with Claude and Codex side by side, attached to repositories, with diffs, history, worktrees and skills.
- Projects independent of repositories, with linked repositories, managed files and Brand, Mind and Genome resources.
- Automations that run an agent or a tool, manually, on an interval or at calendar times in a timezone; approvals bound to a hash of their inputs; editing turns the schedule off until you enable it again.
- Durable runs with captured inputs, events, logs, artifacts, bounded concurrency and honest interruption states; agent runs with retained transcripts open as chats. Active runs open a separate snapshot of recorded progress without resuming the running provider session; finished runs can continue their provider session. Reopening selects the existing chat.
- Portable definition formats and validators for projects, resources, plugins, skills, tools and automations.

## Settled decisions

- Files own definitions; SQLite holds local state and a rebuildable index, never a second editable copy. Deleting `projects.sqlite3` loses only run history, approvals and schedule state.
- Local by design. Definitions live in `<profile>/projects/<id>/`; linked repositories are never written to by the store. Sharing is copying a plugin folder; Git on a project folder is optional.
- The Plugins page shows referencing workflows, including standalone automations that select its tools or skills, and their latest run.
- A plugin is a reusable library: one folder of code, documentation and assets, optionally including skills, tools and automations. It is reviewed and shared as a whole; a schedule is not required.
- Anything written by a chat, a migration or by hand starts disabled. Enabling records a hash of every input; any change disables it again.
- Definitions name repositories by ID and files by relative path; each Mac's checkout path is local state.
- The project has four pages: **Memory** (what it knows), **Plugins** (what it can do), **Automations** (what is running), **Repositories** (linked code), plus its chats. There is no separate Files or Tools page.
- When a repository already defines its own process (for example Point's AutoBuild guide), an automation runs an agent there and follows it; Inferay schedules, authorizes and records.
- New behavior replaces old behavior in the same change; no dual paths or compatibility shims.

## M1. Definitions are files

Development continues directly on `main`. The formats and validators exist; this milestone connects them to storage. Managed file writes use expected hashes, and global custom skills have a separate `skills.sqlite3` store so rebuilding the project index does not remove them. The bounded filesystem scanner, validated writer, index rebuild, legacy exporter and file-store startup have disposable-profile tests. File-backed approval and queue admission feed the existing executor, including a verified local-tool run and artifact. Chat-context lookup reads current files, and run history has a shared durable reader. The runtime and project HTTP command boundary now open the file-backed store and accept file commands. The renderer uses file commands and can create complete plugin bundles. Memory imports original files into `memory/documents/` and browses them by file type with image and text previews. The retired database definition writer has been removed; migration tests seed the legacy schema directly. Older repository workspace chats migrate to file-backed projects with stable IDs and preserved associations. The live profile has migrated. Proposal decisions are durable and interrupted save receipts recover against published file hashes. Before/after review and editable library proposals are implemented; full native-app provider runs remain unfinished. Claude and Codex now share the project, memory and skill tool dispatcher; Claude accesses it through a turn-scoped local MCP bridge. A real Claude tool-call test passes, but does not replace the automation-run release gate.

**Storage.** `project_store.rs` and `project_runtime.rs` read definitions from files.

| Table | Kind | Contents |
|---|---|---|
| `projects`, `resources`, `plugins`, `tools`, `automations`, `resource_types` | index | Rebuilt from files, each row with `source_path`, `source_hash`, `valid`, `error`; written only by the indexer |
| `automation_state` | local | `enabled`, `next_due_at`, `approved_hash`, `approved_at` |
| `plugin_state` | local | `approved_hash`, `approved_at` |
| `project_proposals` | local | chat decision receipts, command hashes and expected publication hashes |
| `repository_paths` | local | project, repository ID, path on this Mac |
| `runs`, `run_events`, `artifacts`, `project_conversations`, `project_migrations` | local | unchanged |

- The indexer runs on launch, project open, window focus and after every write, within the current catalog bounds. An invalid file indexes with its error; whatever depends on it is blocked.
- Writes carry the file's expected hash (a mismatch is a visible conflict), validate, write to a temporary file, sync and rename. New plugins are staged in `plugins/.staging-<uuid>/` and renamed into place.
- `capture_snapshot` hashes every file a run reads. Every scheduled run and Run now recomputes it; a difference disables the schedule and asks for review. An unlinked repository blocks the run with "Link this repository".
- Row-writing commands and `resource_revisions` are removed; `project_commands.json` describes the file commands.

**Layout.** Documents move from `files/` to `memory/documents/`; typed records stay in `memory/<type>/`. Agent automations default to the project folder as their working directory.

**Migration**, one-time and idempotent, covered by disposable-profile tests. The original file export is applied to the live profile; its generated automation wrappers are converted on startup by the current code:

1. Back up `projects.sqlite3` with SQLite's backup API.
2. Write `project.json` for each project, and move repository locations into `repository_paths`.
3. Write records to `memory/<type>/`, moving `files/` to `memory/documents/` and keeping every ID.
4. Preserve each standalone automation and its private dependencies under automations/<id>/. Remove only identifiable wrappers created by the old exporter; keep deliberately created plugin libraries intact.
5. Convert installed plugins to the new manifest.
6. Every automation arrives disabled.
7. Flag absolute paths found in instructions, with a suggested repository reference. Do not rewrite them.

The opt-in profile rehearsal copies the live SQLite snapshot and project files, then runs migration, reopens the copy and deletes its database to verify rebuilding. It passes against the current profile: all three job IDs and seventeen indexed definitions survive; schedules and approvals remain off after rebuilding. The live backup and current database both contain zero historical runs, so preservation of existing run results is covered by the populated migration fixtures. Applying the wrapper conversion to the running profile still requires a user-controlled restart.

**Skill references:** automations name skills in their own folder by stable UUID, skills in another library by `plugin:<plugin UUID>:<skill UUID>`, and global library skills by `global:<id>`. Selected library files participate in approval hashes; reading a skill alone does not require that library’s executables. Names are display labels. `validate_references` checks the reference format and resolves it against the supplied inventory.

**Done when**
- the live profile's Rthmn automations migrate into standalone packages, arrive disabled and keep their run history, and a second launch changes nothing;
- deleting `projects.sqlite3` rebuilds every definition;
- an edit made outside the app disables the affected schedule.

## M2. One place for each job

**Chat builds plugins.**
- Agents inspect libraries with `readPlugin` and propose new reusable libraries with `createPlugin`. Standalone automation requests use `saveDefinition` at `automations/<id>/automation.json`, producing their own proposal card. Both paths validate before displaying and save only through a user action. Existing libraries support `updatePlugin` proposals with a current library hash, text replacements and explicit removals; unmentioned binary assets are preserved and the accepted bundle is published atomically on macOS and Linux.
- A library proposal appears as one card with durable Save and Decline decisions. Review changes compares current and proposed text, added and removed files, binary file hashes, and declared permissions before saving. Execution approval uses the same comparison surface against the previously approved files. The Edit proposal action adjusts text files, additions and removals, then validates and returns to comparison before saving. The original card identity stays fixed; durable save receipts retain the exact accepted edits for recovery.
- Agent guidance distinguishes libraries from jobs, requests calendar triggers, repository IDs and declared permissions, and reuses existing global skills.
- Claude gets the same `inferay_projects` commands Codex has.

**Pages.**
- **Memory** combines notes, dropped documents and images, and typed records in one searchable card library, with a Records filter. There are no separate Resources or Files pages.
- **Plugins** is where you build and approve. Invalid manifests remain visible by folder name with their current error and can be repaired in the library editor. Repair does not restore execution approval. Cards show contents, declared permissions, machine requirements, schedule state, definition errors within the library, and the latest available run of an owned automation. History handles preflight failures without assuming an execution snapshot exists. Native UI interaction checks remain.
- **Automations** is where you operate: on/off, next run, last result, and history per automation. Sidebar History opens project-wide runs; individual History tabs keep their automation filter. The latest History view lists enabled, unarchived upcoming schedules by their saved next-run time, displayed locally, with links to their settings. Queued and running jobs remain on the latest page even when newer completed runs fill its fifty-result history window. Older run pages stay focused on past results. A run artifact can be saved to Memory explicitly; nothing is saved there automatically.
- The Tools page is removed; tools appear inside their plugin.

**Done when** `verify:projects` covers:
- a chat-built plugin that is approved and runs;
- an edit that disables a schedule;
- an invalid manifest;
- a document moved into Memory;
- an unlinked repository.

A disposable-profile runtime check covers accepting a chat library, refusing unapproved execution with a recorded failure, approving the bundle, executing its tool into an artifact, and disabling it after an outside edit while keeping run history. This checks the native path. The browser verifier now uses the current file contracts and passes project creation/reordering, repository linking and unlinking, graph navigation, conversation-grid deletion, automation autosave and local-tool execution, artifact viewing, chat plugin saving, and reopening a retained run as a chat. The run-to-chat case uses a synthetic provider log. The browser verifier also approves a chat-created library with explicit schedule enabling, changes its instructions on disk and verifies revoked approval and a disabled schedule, then repairs an invalid manifest through the library editor without restoring approval. Escape and backdrop clicks preserve unsaved edits, and catalog refreshes preserve the open editor. The same chat-created bundle also supplies a local report tool and manual automation: the browser executes it through Run now using its existing approval, checks one successful run, and opens the retained report. Run now asks the backend whether approval matches current inputs and opens review only when needed; queue admission still rechecks the inputs. After an outside edit, the browser confirms review appears and dismissing it starts no additional run. Memory import and native desktop interaction remain separate gates; browser verification uses a disposable profile and excludes the separately staged Memory work.

Real Codex and Claude runs now pass disposable native-runtime filesystem probes, including recorded successful runs and outside-write refusal. Native app interaction checks remain. These changes are developed and committed directly on `main`; the remaining interaction and permission checks remain release gates.

Agent runs commit each changed provider-reported usage snapshot in `run_events` as `provider_usage` when it arrives, independently of the bounded transcript. Repeated identical snapshots are skipped. History uses the latest committed snapshot, including while a run is active and after cancellation. Codex cumulative notifications replace earlier snapshots; Claude result usage includes reported cost when supplied. Real Codex and Claude runtime gates verify retained token counts. History displays normalized input/output counts, cached input and provider-reported USD cost. The native projection includes Claude cache reads/writes in total input and preserves Codex cumulative totals without double counting. A native history test covers failed runs and latest-snapshot selection; the browser checks the display using explicit fixture usage. A real Codex cancellation gate observes usage while the run is active, stops it, and verifies retained counts through History and a separate database connection. Usage that a provider never emits remains unknown, including a Claude interruption before its result event. Pricing for providers without reported cost remains unfinished.

Run History previews retained PNG, JPEG, WebP, GIF, BMP, ICO and SVG images through the existing bounded local-image endpoint. Markdown reports reuse the chat Markdown renderer, with a source toggle; plain reports and logs use cancellable text previews. The browser gate verifies rendered formatting and switching back to source. Retained MP4/M4V, WebM, MOV and OGV clips use native video controls without autoplay. The authenticated local-video endpoint supports byte-range seeking, streams bounded chunks and limits each preview to 50 MB. Codec support depends on the webview. HTTP tests cover ranges, oversized files and path refusal; the browser gate plays and seeks an original silent WebM artifact. CSV and TSV artifacts use the first row as headers; JSON arrays of objects use their field names as columns. A native projection preserves literal values, multiline cells and nested JSON, caps display at 200 rows and 64 columns, and reports malformed records without hiding the source. The browser verifies CSV/JSON artifact tables and switching between table and source. Structured drafts use the domain-neutral `inferay.draft/1` artifact format, with title, literal text, labeled details and a source toggle. Native-app visual verification is still required.

## M3. Safe to leave running

- **CLI tools (E2): implemented.** Existing scripts run with literal argument templates, explicit entrypoint placement, closed stdin and pass/fail from the exit code. Successful output includes stdout/stderr; `{output}` arguments bind to the run directory and produced files are indexed as artifacts. Failed runs retain both logs. Disposable-profile tests exercise success and failure. Execution cleanup also runs when its future is dropped. A macOS regression aborts an active task and verifies its SIGTERM-resistant helper in the private process group is stopped; existing tool-grant cancellation and CLI success/failure checks pass.
- **Tool grants (E7): implemented in the shared provider tool path.** Agent automations select library tools by plugin and tool ID. Calls recheck the approved library contents, execute through the normal tool runner, and retain inputs, events, logs and artifacts with the parent run. Native integration checks exercise the path. Real Codex and Claude automation gates each discover and call a granted library tool, retain its exact input and output, and index its artifact alongside the agent response in run history. Native app interaction remains a release gate. Grants restrict `inferay_tools`; automation shell commands use the same runner through `inferay_exec`.
- **Permission enforcement.** `may` controls Inferay's command runner; providers retain read-only native access:
  - Automation commands run through `inferay_exec`, sharing library-tool approval checks, bounded execution, retained scripts/logs/artifacts and cancellation. Calls are serial and capped at 64 per run.
  - Native tool, command and dependency-probe invocations share private home/XDG setup in the sandbox command builder, retain only PATH and locale from the app environment, and disable automatic Git global/system configuration and credential prompts. Runtime regression checks writable private directories, configuration isolation and distinct homes across runs. Repository-local identity remains usable; personal Git identity must be made explicit for a job. The macOS native runner now restricts file contents to the project, permitted selected repositories, resolved Git metadata, run directories and installed runtime locations. A native probe verifies granted repository reads and refuses unrelated files and escaping symlinks. Metadata lookup remains global; provider ambient-context isolation still needs an audit.
  - Codex has read-only provider access, disabled shell/web search/network and no ambient MCP. Optional ambient executors (JS REPL, apps, plugins, hooks, subagents, browser/computer tools and image generation) are disabled. Claude exposes only Inferay MCP; native Read/Glob/Grep/Bash/Edit/Write/web tools and ambient hooks/settings are disabled. Interactive chats keep their existing policy.
  - Real Codex and Claude gates pass approved writes, refused outside writes, and OS permission refusal for both loopback and numeric public TCP without a network grant. Both pass refused Git staging/commits without `commit` and successful commits with it, through the native runner.
  - Approval inputs capture resolved Git metadata paths, including worktree common directories. Changing a Git pointer invalidates the approved hash and turns the schedule off; invalid targets refuse capture. Review screens for individual automations and plugin bundles list the Git write locations. With commit and working-directory write permission, the runner grants the reviewed metadata directories after rechecking their bindings. Native tests verify commits with external separate Git directories and linked worktrees, neighboring files remain unwritable, and changed, unrelated or symlink-replaced locations are refused.
  - The macOS runner protects Git metadata, separate directories, worktree common directories, metadata symlink targets, existing hard-link aliases and ancestor renames. Bounded preflight inspection fails closed. Native probes cover these paths and granted commits.
  - Automatic repository instruction injection is disabled for Codex automations, with approved instructions passed explicitly. Installed-provider fixtures check the actual request: Codex excludes project `AGENTS.md`; Claude excludes the tested personal/project `CLAUDE.md`; both retain explicit run instructions. On macOS, Codex automation processes deny reads of personal `CODEX_HOME/AGENTS.md` and `AGENTS.override.md` while retaining the original authentication/session home. The installed-binary fixture verifies personal instructions are excluded. It also verifies unselected personal/project skills stay out of the model request after reproducing personal skill leakage. Automation policy disables automatic skill instructions, bundled/cloud skills, skill search and native memory use/generation/tools; approved Inferay context is still supplied explicitly. Broader provider-home/context isolation remains open; other platforms refuse Codex automation startup until an adapter exists.
  - Installed-provider regressions use local API fixtures to force native mutation calls without model cooperation or paid requests. Codex rejects its native patch and reports its shell unavailable; Claude refuses Bash, Write, Edit, Read, Glob and Grep as unavailable, and its fixture confirms private file contents never enter the API transcript. Real Claude and Codex checks read a project file through `inferay_exec`, pass its contents to a granted library tool and retain the resulting report. Target files stay absent or unchanged even with Inferay project-write permission. Provider ambient-context isolation and independent `push` / `open_pr` enforcement remain release gates. These tests cover the named tools on the installed versions, not every future provider tool. The [execution-authority decision](adr/0002-automation-kernel.md#execution-authority-remaining-boundary) records the boundary and remaining checks.
- **Requirements (E3): implemented.** Plugins and tools declare required programs and modules (`blender>=5.0`, `ffmpeg`, `python3:numpy`). Requirements are captured with approved inputs and checked before a provider or tool starts. Missing dependencies produce a failed run naming the requirement. Bounded version/module probes run without network in the local-tool sandbox; additional platform adapters remain needed. Native tests cover presence, minimum versions, modules, and refusal before both direct-tool and agent execution.
- **Conformance suite: in progress.** The proof definitions are retained under `scripts/tests/fixtures/plugins/`. Point is converted to the current format and checked through the native store, bindings and approval inputs. Creative examples remain explicitly planned reference data until packs, connections, MCP and effects exist. The fixture README maps the original eleven cases to native checks or remaining work; the old Python model is not a second validator.

**Done when**
- the Point daily build runs at 08:00 Chicago for a week with permissions enforced, committing on branches and never deploying;
- a script tool fails a run on a non-zero exit;
- an undeclared push is refused.

## M4. Builds on other people's work

- **Packs (E1): implemented for clean Git checkouts.** Tools resolve entrypoints in linked repositories pinned by full commit ID and SHA-256. Direct tools and agent grants use the same resolver; changed, untracked or ignored files, hidden index entries and submodules are refused. Tracked aliases must resolve to tracked content inside the checkout. Native checks cover bindings, pins, in-place execution and refusal after an outside edit. An opt-in native-runtime check runs Origin’s actual caption checker from a disposable linked checkout: accepted copy succeeds, rejected copy fails with retained findings, and the source stays clean. A second opt-in native-runtime check runs the actual pillar-stack scene with explicit gpu permission, retains beauty and depth PNGs, and indexes both as run artifacts. The Apple Silicon sandbox grants only the required graphics device/context/compiler services; user-cache writes remain refused. The `origin-studio` fixture now separates the reusable studio library from a standalone daily automation. A real Codex run admitted through the scheduler reads the library skill, passes the required caption checker and renderer, retains both images and its response, and leaves the pinned checkout clean. Required tool grants prevent successful completion when a tool is skipped or its latest attempt fails. This proves one scheduled preview occurrence; sustained daily operation, production image quality and the Spline gate remain open.
- **MCP callables (E6): local stdio implemented; remote connections planned.** A plugin tool declares its server program, entrypoint and MCP tool name using the existing tool format. Both providers reuse `inferay_tools`; direct tool automations use the same runner. Approval covers the implementation files, each call rechecks inputs, and the native sandbox, private environment, timeout, cancellation and retained artifacts apply. Disposable fixtures exercise successful calls, missing tools, server errors, timeouts, output limits, denied outside writes and agent-grant revocation after edits. Real Claude and Codex automation checks each read a fresh project marker through `inferay_exec`, call the MCP library through `inferay_tools`, and retain the matching report, protocol response and agent response in run history. No parallel plugin-level MCP execution contract is added. Authenticated remote servers and the real Spline release gate remain unfinished. Explicit provider server selections also fail closed, but automation ambient external MCP stays disabled.

**Done when**
- a Blender content lane from a forked kit renders daily into run artifacts, with no posting, its quality checks failing runs that do not meet the bar, and the kit's code never copied;
- a Spline design skill produces a frame in the brand's colors and type from the genome resource.

## M5. Acts in the world

Current scope is the generic harness, verified with disposable local handlers. Real posting, account setup and individual production workflows are deferred; they are not completion gates for this work.

- **Connections (E4): key management, library binding controls and GET relay implemented.** Plugins → Connections adds, replaces and removes project credentials in macOS Keychain. The authenticated API returns metadata only, revisions prevent stale updates, and a profile lock serializes cross-process writes. The native Keychain gate checks persistence, isolation, rotation, removal and no secret files. Tool declarations can reference local connection IDs, and selected revisions participate in approval hashes; rotation revokes approval. Selected tools receive an invocation-scoped loopback URL; the host attaches credentials only to reviewed HTTPS GET requests. Network permission is required before provider/tool launch. Redirects, oversized responses and literal/common credential echoes are refused, and access ends with the invocation. Temporary HTTPS and sandboxed-tool gates pass. Library tool forms save connection aliases and destinations through conflict-checked definition writes. Real-service checks and authenticated remote MCP remain unfinished; raw keys never enter tool environments. See [Connections](connections.md).
- **Effects (E5): intent capture implemented; delivery planned.** Successful runs can retain `inferay.effect/1` JSON artifacts. Inferay validates and records them transactionally with artifact indexing, deduplicates identical project/key retries and refuses conflicting reuse. History includes a paginated Needs review inbox independent of the run-history cursor, scoped to the project or selected automation. Pending intents remain discoverable when their source runs are older than the visible history page. Review reads the canonical stored payload and supports hash-bound, persistent dismissal. Native checks verify rollback, stale-review refusal and persistence across reopening; the browser changes the source artifact and verifies the review still displays the stored proposal before dismissing it. Approval budgets, the delivery outbox, handlers, receipts and reconciliation remain unfinished. The target is for external consequences to pass exclusively through this boundary; unrestricted network permissions do not enforce that yet.
  - The core checks each intent against an approved budget (count, window, accounts).
  - It records the intent in an outbox before sending, through a handler plugin.
  - It saves the receipt and reconciles after a crash.
  - The review inbox supports inspection and dismissal; delivery approval remains planned.

**Done when**
- a generic local fixture handler demonstrates an approved limit of 2 effects per day;
- a force-quit between recording and fixture delivery produces no duplicate after relaunch;
- a search of every run folder finds no key.

## M6. Closes the loop

- **Events as triggers:** a run finished, an effect delivered, an observation arrived, a document added. Effects carry a not-before time. Together these give "render at 09:00, post at 12:00" without a workflow engine.
- **Observations.** Observer tools fetch facts (post analytics, build status, store numbers) on a schedule into typed records that skills read and triggers react to.

**Done when** a weekly review automation reads last week's post analytics and proposes an updated lane, which arrives as a changed plugin waiting for approval.

## M7. Any domain

Build an automation for a domain nobody designed for (for example a weekly finance summary or an inbox digest) entirely from chat. **Done when** it needs no kernel change. If it does, the missing piece is a generic concept added to ADR 0002, never domain-specific code.

## Known gaps



- Permission enforcement is partial: automation providers restrict native tools and route file access and commands through Inferay's sandboxed runner. macOS writes, Git metadata and socket access are constrained; other platforms refuse native commands. Provider ambient-context isolation and independent push/PR authority remain open in M3. Real Claude and Codex probes verify the tested write, commit and TCP limits; they are not a complete security audit.
- There is no CI; checks run locally and through lint-staged.
- The README describes a source-available license, but the repository has no `LICENSE` file.

## Later

- Global skills as files.
- Running scheduled work while the app is closed (a background helper or a dedicated machine).
- Sharing beyond copying folders, if a team needs it.
