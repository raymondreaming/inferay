# Roadmap

Inferay is becoming a general automation harness on top of a daily coding-agent workspace: you describe a capability in chat, Inferay saves it as a plugin you can read and approve, and it runs on its own within limits you set. The kernel stays small and generic ([ADR 0002](adr/0002-automation-kernel.md)); every domain (brand content, app builds, design, research) is a plugin.

The work is a sequence of milestones. Each one ends with something real running, and each is done only when its acceptance list passes. When a milestone ships, remove it from this page and update [concepts.md](concepts.md), [architecture.md](architecture.md) and [reference/project-files.md](reference/project-files.md) in the same change.

## What works

- Chats with Claude and Codex side by side, attached to repositories, with diffs, history, worktrees and skills.
- Projects independent of repositories, with linked repositories, managed files and Brand, Mind and Genome resources.
- Automations that run an agent or a tool, manually, on an interval or at calendar times in a timezone; approvals bound to a hash of their inputs; editing turns the schedule off until you enable it again.
- Durable runs with captured inputs, events, logs, artifacts, bounded concurrency and honest interruption states; finished agent runs open as chats.
- Portable definition formats and validators for projects, resources, plugins, skills, tools and automations.

## Settled decisions

- Files own definitions; SQLite holds local state and a rebuildable index, never a second editable copy. Deleting `projects.sqlite3` loses only run history, approvals and schedule state.
- Local by design. Definitions live in `<profile>/projects/<id>/`; linked repositories are never written to by the store. Sharing is copying a plugin folder; Git on a project folder is optional.
- A plugin is the unit of a capability: one folder of skills, tools and automations, approved and shared as a whole.
- Anything written by a chat, a migration or by hand starts disabled. Enabling records a hash of every input; any change disables it again.
- Definitions name repositories by ID and files by relative path; each Mac's checkout path is local state.
- The project has four pages: **Resources** (what it knows), **Plugins** (what it can do), **Automations** (what is running), **Repositories** (linked code), plus its chats. There is no separate Files or Tools page.
- When a repository already defines its own process (for example Point's AutoBuild guide), an automation runs an agent there and follows it; Inferay schedules, authorizes and records.
- New behavior replaces old behavior in the same change; no dual paths or compatibility shims.

## M1. Definitions are files

Branch `projects-foundation`. The formats and validators exist; this milestone connects them to storage.

**Storage.** `project_store.rs` and `project_runtime.rs` read definitions from files.

| Table | Kind | Contents |
|---|---|---|
| `projects`, `resources`, `plugins`, `tools`, `automations`, `resource_types` | index | Rebuilt from files, each row with `source_path`, `source_hash`, `valid`, `error`; written only by the indexer |
| `automation_state` | local | `enabled`, `next_due_at`, `approved_hash`, `approved_at` |
| `plugin_state` | local | `approved_hash`, `approved_at` |
| `repository_paths` | local | project, repository ID, path on this Mac |
| `runs`, `run_events`, `artifacts`, `project_conversations`, `project_migrations` | local | unchanged |

- The indexer runs on launch, project open, window focus and after every write, within the current catalog bounds. An invalid file indexes with its error; whatever depends on it is blocked.
- Writes carry the file's expected hash (a mismatch is a visible conflict), validate, write to a temporary file, sync and rename. New plugins are staged in `plugins/.staging-<uuid>/` and renamed into place.
- `capture_snapshot` hashes every file a run reads. Every scheduled run and Run now recomputes it; a difference disables the schedule and asks for review. An unlinked repository blocks the run with "Link this repository".
- Row-writing commands and `resource_revisions` are removed; `project_commands.json` describes the file commands.

**Layout.** Documents move from `files/` to `resources/documents/`; typed records stay in `resources/<type>/`. Agent automations default to the project folder as their working directory.

**Migration**, one-time and idempotent, tested only against a disposable `INFERAY_USER_DATA_DIR`:

1. Back up `projects.sqlite3` with SQLite's backup API.
2. Write `project.json` for each project, and move repository locations into `repository_paths`.
3. Write records to `resources/<type>/`, moving `files/` to `resources/documents/` and keeping every ID.
4. Group each automation with the tools and skills it uses into a plugin folder. Where a tool or skill is shared, copy it into each plugin.
5. Convert installed plugins to the new manifest.
6. Every automation arrives disabled.
7. Flag absolute paths found in instructions, with a suggested repository reference. Do not rewrite them.

**Decide first:** automations name skills by their UUID or by a short name. Pick one and enforce it in `validate_references`.

**Done when**
- the live profile's Rthmn automations migrate into plugins, arrive disabled and keep their run history, and a second launch changes nothing;
- deleting `projects.sqlite3` rebuilds every definition;
- an edit made outside the app disables the affected schedule.

## M2. One place for each job

**Chat builds plugins.**
- Agents get file commands (`createPlugin`, `writePluginFile`, `writeResource`) that go through the M1 write path.
- A capability built in chat appears as **one card**: skills, tools, automations, permissions and a diff since the last approval, with Approve, Edit and Decline.
- The agent guidance in `chat_runtime.rs` and `agent_runner.rs` asks for plugins, calendar triggers, repository IDs and declared permissions.
- Claude gets the same `inferay_projects` commands Codex has.

**Pages.**
- **Resources** merges the Files page. It shows records (typed, with the existing editors) and documents (with previews), and has Open folder.
- **Plugins** is where you build and approve. Each card shows its status (draft, enabled, changed, invalid, blocked), its skills and tools, its permissions and its last runs.
- **Automations** is where you operate: on/off, next run, last result, and history per automation. A run artifact can be saved to Resources explicitly; nothing is saved there automatically.
- The Tools page is removed; tools appear inside their plugin.

**Done when** `verify:projects` covers:
- a chat-built plugin that is approved and runs;
- an edit that disables a schedule;
- an invalid manifest;
- a document moved into Resources;
- an unlinked repository.

It also needs one real Codex run and one real Claude run in the native app. Then `projects-foundation` merges to `main`.

## M3. Safe to leave running

- **CLI tools (E2) and tool grants (E7).** Existing scripts run as tools, with an argument template and pass/fail taken from the exit code. Agent automations name the tools they may call.
- **Permission enforcement.** `may` maps to each provider's own controls instead of full access:
  - Codex: read-only or workspace-write sandbox, and its network setting.
  - Claude: permission mode and allowed tools.
  - `push` and `open_pr` are only possible when declared.
- **Requirements (E3).** Plugins and tools declare required programs and modules (`blender>=5.0`, `ffmpeg`, `python3:numpy`). A missing one blocks the run up front with a clear message.
- **Conformance suite.** The proof definitions (`~/Developer/inferay-proofs`) move into the repository as test fixtures, and every kernel change runs against them.

**Done when**
- the Point daily build runs at 08:00 Chicago for a week with permissions enforced, committing on branches and never deploying;
- a script tool fails a run on a non-zero exit;
- an undeclared push is refused.

## M4. Builds on other people's work

- **Packs (E1).** Tool entrypoints can live inside a linked repository, pinned by its commit and the file's hash. An upstream change disables the schedule until it is reviewed.
- **MCP declarations (E6).** A plugin names the MCP servers it needs; a missing server blocks the run.

**Done when**
- a Blender content lane from a forked kit renders daily into run artifacts, with no posting, its quality checks failing runs that do not meet the bar, and the kit's code never copied;
- a Spline design skill produces a frame in the brand's colors and type from the genome resource.

## M5. Acts in the world

- **Connections (E4).** Secrets live in the Keychain and are injected only into the tools that declare them. They never appear in a definition, a log or an agent transcript.
- **Effects (E5).** Runs emit intents; they never call external services that have consequences.
  - The core checks each intent against an approved budget (count, window, accounts).
  - It records the intent in an outbox before sending, through a handler plugin.
  - It saves the receipt and reconciles after a crash.
  - A review inbox shows intents waiting for approval.

**Done when**
- posting to a test account works with a limit of 2 per day;
- a force-quit between recording and sending produces no duplicate after relaunch;
- a search of every run folder finds no key.

## M6. Closes the loop

- **Events as triggers:** a run finished, an effect delivered, an observation arrived, a document added. Effects carry a not-before time. Together these give "render at 09:00, post at 12:00" without a workflow engine.
- **Observations.** Observer tools fetch facts (post analytics, build status, store numbers) on a schedule into typed records that skills read and triggers react to.

**Done when** a weekly review automation reads last week's post analytics and proposes an updated lane, which arrives as a changed plugin waiting for approval.

## M7. Any domain

Build an automation for a domain nobody designed for (for example a weekly finance summary or an inbox digest) entirely from chat. **Done when** it needs no kernel change. If it does, the missing piece is a generic concept added to ADR 0002, never domain-specific code.

## Known gaps

- Agent runs execute with full provider access; permissions are advisory until M3.
- `check:architecture` has a "Solid reactivity regression" step that runs nothing.
- `bunx tsc --noEmit` reports errors in `scripts/tests/fixtures/solid-runtime.tsx`, so it is not a clean gate.
- There is no CI; checks run locally and through lint-staged.
- The README describes a source-available license, but the repository has no `LICENSE` file.

## Later

- Global skills as files.
- Running scheduled work while the app is closed (a background helper or a dedicated machine).
- Sharing beyond copying folders, if a team needs it.
