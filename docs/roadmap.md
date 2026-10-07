# Roadmap

Inferay is becoming a general automation harness on top of a daily coding-agent workspace: you describe a capability in chat, Inferay saves it as a plugin you can read and approve, and it runs on its own within limits you set. The kernel stays small and generic ([ADR 0002](adr/0002-automation-kernel.md)); every domain (brand content, app builds, design, research) is a plugin.

This page says what works, what is being built and what comes next. Remove items when they ship and update [concepts.md](concepts.md), [architecture.md](architecture.md) and [reference/project-files.md](reference/project-files.md) in the same change.

## What works

- Chats with Claude and Codex side by side, attached to repositories, with diffs, history, worktrees and skills.
- Projects independent of repositories, with linked repositories, managed files and Brand, Mind and Genome resources.
- Automations that run an agent or a tool, manually, on an interval or at calendar times in a timezone; approvals bound to a hash of their inputs; editing turns the schedule off until you enable it again.
- Durable runs with captured inputs, events, logs, artifacts, bounded concurrency and honest interruption states; finished agent runs open as chats.
- Portable definition formats and validators for projects, resources, plugins, skills, tools and automations.

## In progress: definitions as files

Branch `projects-foundation`. Definitions move out of `projects.sqlite3` into the project folder; the database keeps local state and a rebuildable index. Formats and validators are done; the steps below connect them.

### Settled decisions

- Files own definitions; SQLite never holds a second editable copy. Deleting `projects.sqlite3` loses only run history, approvals and schedule state.
- Local by design: definitions live in `<profile>/projects/<id>/`. Linked repositories are never written to by the store.
- A plugin is the unit of a capability: one folder of skills, tools and automations, approved and shared as a whole.
- Anything written by a chat, a migration or by hand starts disabled. Enabling records a hash of every input; any change disables it again.
- Definitions name repositories by ID and files by relative path; each Mac's checkout path is local state.
- Git is optional for project folders.
- The file-owned path replaces the SQLite-owned one in the same change; no dual paths.

### 1. Storage boundary

`project_store.rs` and `project_runtime.rs` read definitions from files.

| Table | Kind | Contents |
|---|---|---|
| `projects`, `resources`, `plugins`, `tools`, `automations`, `resource_types` | index | Rebuilt from files, each row with `source_path`, `source_hash`, `valid`, `error`; written only by the indexer |
| `automation_state` | local | `enabled`, `next_due_at`, `approved_hash`, `approved_at` |
| `plugin_state` | local | `approved_hash`, `approved_at` |
| `repository_paths` | local | project, repository ID, path on this Mac |
| `runs`, `run_events`, `artifacts`, `project_conversations`, `project_migrations` | local | unchanged |

`resource_revisions` goes away; history comes from the files or Git.

- **Indexer.** Runs on launch, project open, window focus and after every write. Bounded (256 projects, 512 resources, 256 automations, 100 plugins). An invalid file indexes with its error, and whatever depends on it shows as blocked and cannot run.
- **Writes.** Each write carries the file's expected hash; a mismatch is a visible conflict, never an overwrite. Files are validated, written to a temporary file, synced and renamed; new plugins are staged in `plugins/.staging-<uuid>/` and renamed into place.
- **Admission.** `capture_snapshot` hashes every file a run reads: the automation, `plugin.json`, each skill, the tool definition and entrypoint, each resource, and project instructions. Every scheduled run and Run now recomputes it; a difference disables the schedule, records "inputs changed" and asks for review. An unlinked repository blocks the run with "Link this repository".
- **Removals.** Row-writing commands (`SaveProject`, `SaveResource`, `SaveAutomation`, `InstallPlugin` copies) are replaced by file-writing commands, and `project_commands.json` describes the new ones.

### 2. Migration

One-time and idempotent, before the first index, tested only against a disposable `INFERAY_USER_DATA_DIR`:

1. Back up `projects.sqlite3` with SQLite's backup API.
2. Write `project.json` per project; move repository locations into `repository_paths`.
3. Write resources to `resources/<type>/<slug>.json`, keeping IDs.
4. Group each automation with the tools and skills it uses into a plugin folder, keeping IDs so run history still links.
5. Convert installed plugins to the new manifest.
6. Every automation arrives disabled.
7. Absolute paths found in instructions are flagged with a suggested repository reference, not rewritten.

Global custom skills stay in the Skills library for now.

### 3. Chat writes plugins

- Agents get file-oriented commands (`createPlugin`, `writePluginFile`, `writeResource`, `writeProjectFile`) that go through the same write path as the UI.
- A chat-built capability appears as one card: skills, tools, automations, permissions and a diff since the last approval, with Approve, Edit and Decline.
- Agent guidance (`chat_runtime.rs`, `agent_runner.rs`) asks for plugins, calendar triggers for daily or weekly work, repository IDs and declared permissions.
- Claude gets the same `inferay_projects` commands Codex has.

### 4. Interface

Plugins is the main view: each card shows status (draft, enabled, changed, invalid, blocked), contents, permissions, last runs and Open folder. Tools and Automations are filtered views across plugins. Invalid files show their error; files changed on disk offer Reload.

### 5. Verification and merge

`verify:projects` covers:
- a chat-built plugin approved and run;
- edits disabling schedules;
- changes made outside the app;
- invalid manifests;
- rebuilding after deleting `projects.sqlite3`;
- migration;
- calendar triggers across daylight-saving changes;
- unlinked repositories.

Then one real Codex run and one real Claude run in the native app, and the branch merges to `main`.

### Open decisions

- How automations name skills: by the skill's UUID or by a short name (the contract tests use `"daily"` while skill files require a UUID). Pick one and enforce it in one place.
- When an automation's tool or skill is shared, migration either makes one plugin per automation with shared tools copied (default) or one plugin per shared tool.
- Run now on a changed automation either confirms and records approval (default) or refuses until it is re-enabled.

## Next: kernel extensions

Each extension lands with a reference plugin that exercises it. The definitions in `~/Developer/inferay-proofs` already express the four reference capabilities and fail only on these gaps.

| Order | Extension | Unlocks | Reference |
|---|---|---|---|
| 1 | E2 CLI tools, E7 per-run tool grants | Existing scripts as tools; agents calling declared tools | Daily repository build |
| 2 | **Permission enforcement** | `may` becomes real for agent runs: map it to provider sandbox modes (Codex read-only or workspace-write sandbox and network setting; Claude permission mode and allowed tools) instead of full access | All agent automations |
| 3 | E1 packs, E3 requirements | Tools that live in a linked, pinned repository; clear "missing Blender" before a run | Blender content lane |
| 4 | E6 MCP declarations | Plugins that need Spline, Figma or other MCP servers | Brand-aware design |
| 5 | E4 connections | Secrets in the Keychain, injected only into declaring tools | Posting, app builds |
| 6 | E5 effects, review inbox, outbox | Posting, deploys and spending within approved budgets, with no duplicates after a crash | Social posting with daily limits |
| 7 | Events as triggers | Render then post later, react to finished runs, without a workflow engine | Lane plus timed post |
| 8 | Observations | Analytics and build status flowing back so automations adapt | Weekly lane review |

The kernel is finished when a domain nobody designed for can be built entirely from chat without a kernel change.

## Known gaps

- Agent runs execute with full provider access; permissions are advisory until step 2 above.
- `check:architecture` has a "Solid reactivity regression" step that runs nothing.
- `bunx tsc --noEmit` reports errors in `scripts/tests/fixtures/solid-runtime.tsx`, so it is not a clean gate.
- There is no CI; checks run locally and through lint-staged.
- The README describes a source-available license, but the repository has no `LICENSE` file.

## Later

- Resources as a drop canvas: originals under `resources/files/`, extracted metadata and search in a rebuildable index.
- Global skills as files.
- Running scheduled work while the app is closed (a background helper or a dedicated machine).
- Sharing beyond copying folders, if a team needs it.
