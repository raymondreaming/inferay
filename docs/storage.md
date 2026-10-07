# 🗄️ Storage: files, databases and how data moves

How Inferay stores what you define, what happens and what you remember; how anything gets written; and how chats, automations and the interface read it back. For what each concept means, read [concepts.md](concepts.md). Exact file formats are in [reference/project-files.md](reference/project-files.md); Memory has its own page, [memory.md](memory.md).

## The rule

**Files are the source of truth for anything you define. Databases hold what happened on this Mac, what you approved, and fast indexes of the files.**

- 📚 The files are the books: you can open, edit, copy, share or put them under Git.
- 🗂️ The databases are the card catalogue (an index of the books) and the checkout log (runs, approvals).
- 🔁 Delete an index and Inferay rebuilds it from the files. You lose history and approvals, never a definition.

## Where everything lives

The profile is `~/Library/Application Support/Inferay/` (`INFERAY_USER_DATA_DIR` overrides it for development and tests).

```
Inferay/
├── projects/<project-id>/            FILES: one folder per project
│   ├── project.json                    name, instructions, linked repositories (by ID)
│   ├── plugins/<name>/                 one capability each
│   │   ├── plugin.json                   name, version, permission ceiling (may)
│   │   ├── skills/<id>.md                instructions an agent reads
│   │   ├── tools/<name>/tool.json        programs Inferay runs, plus their entrypoints
│   │   └── automations/<id>.json         trigger, execution, permissions
│   ├── resources/
│   │   ├── notes/*.md                    Memory notes
│   │   ├── documents/                    dropped or saved files
│   │   └── <type>/*.json                 typed records (brand genome, Mind, …)
│   ├── files/                          managed project files
│   └── runs/<run-id>/                  RUN EVIDENCE
│       ├── inputs/                       exactly what the run received
│       ├── logs/                         agent events (agent.jsonl), tool output
│       └── output/                       what it produced
├── projects.sqlite3                  DATABASE: definition index + local state + run history
├── projects.lock                     only one Inferay process owns this profile
├── memory.sqlite3                    DATABASE: Memory search index (rebuildable)
├── chat.sqlite3                      DATABASE: conversations and transcripts
├── agent-state.json                  workspace and panes
├── client-storage.json, settings.json  interface preferences, search folders
└── checkpoints.json, mcp-*.json, …   see architecture.md
```

## The databases

### `projects.sqlite3`

Schema version 3 (`PRAGMA user_version`). Two kinds of tables:

**🗂️ Index tables: rebuilt from the files** (`native/server/src/project_index.rs`)

`projects`, `resources`, `plugins`, `tools`, `automations`, `resource_types`, `project_skills`. Each has the same shape:

| Column | Meaning |
|---|---|
| `id` | The definition's stable ID (from inside the file) |
| `project_id`, `plugin_id` | Where it belongs |
| `source_path` | The file it came from, relative to the project |
| `source_hash` | Hash of the file's bytes when indexed |
| `valid`, `error` | Whether the file passed validation, and why not |
| `body` | The parsed definition as JSON |

`definition_errors` lists every file that failed validation, with the reason, so broken files are visible instead of silently skipped.

**📒 Local state: lives only on this Mac and never travels with a copied folder**

| Table | Holds |
|---|---|
| `automation_state` | `enabled`, `next_due_at`, `approved_hash`, `approved_at`, `inputs_changed`, `error` |
| `plugin_state` | plugin approval hash and time |
| `repository_paths` | which folder on this Mac each repository ID means |
| `runs` | each run: automation, request key, captured snapshot, status, times, result, error |
| `run_events` | ordered events within a run (`memory_read`, progress, errors) |
| `artifacts` | each declared output: name, path, size, hash |
| `project_conversations` | which chat panes belong to which project |
| `project_migrations` | one-time migrations already applied |

Because approvals and on/off state live here and not in the files, **copying or pulling a plugin folder can never switch it on**. You approve on your own Mac.

### `memory.sqlite3`

The search index for Memory notes (`native/server/src/memory_store.rs`): `notes` (one row per note file, with the file's size and modified time), `notes_fts` (SQLite full-text search over title, tags and body), `links` (`[[link]]` targets) and `errors` (note files that failed to parse). It is rebuilt from `resources/notes/*.md` whenever it is missing, and updated for changed files only. See [memory.md](memory.md).

### `chat.sqlite3`

Conversations (`native/server/src/chat_persistence.rs`): per-pane documents (session reference, agent context, queued messages) and transcripts with their messages. It is not derived from files; it is the conversation record.

## ✍️ How things get written

**Nothing writes SQL directly, not the interface and not agents.** Every change goes through one validated command on the Inferay server (`ProjectCommand`, handled by `project_file_store.rs` and `project_index::save_definition`, or the Memory routes):

```
 Save in the interface            Agent tool call (inferay_projects / inferay_memory)
          │                                   │
          └────────────────┬──────────────────┘
                           ▼
             one validated server command
                           │
   1. Validate the definition (format, IDs, relative paths, permission ceiling)
   2. Compare the file's current hash with the one you loaded; refuse on conflict
   3. Write the file safely: temporary file, then rename
   4. Refresh the index in projects.sqlite3 (or memory.sqlite3)
   5. If an automation's inputs changed, switch it off until you approve again
```

Other ways files change, and how Inferay notices:

- ✏️ **You edit a file by hand** or copy a plugin folder in. The next index refresh picks it up. A broken file appears in `definition_errors`, and anything depending on it is blocked.
- 🧠 **Saving to Memory** (the chat Memory button, the Memory page, or an agent in a chat) writes a `.md` note and updates `memory.sqlite3`. Automation runs can read Memory but never save to it.
- 🏃 **Runs** write only their own evidence: `runs/<id>/` and rows in `runs`, `run_events` and `artifacts`.

**When the index refreshes:** at startup, whenever the project catalogue is read (the project pages poll every 3 seconds while visible), when a chat in a project starts a turn, and when a run checks its inputs.

## 📖 How the contents get used

### The interface

Project pages, plugin lists and automation lists read the **index** through `GET /api/projects`. Memory reads `GET /api/memory`, which returns ranked hits rather than whole notes. Run history reads `runs`, `run_events` and `artifacts`.

### Automations

1. ⏰ The scheduler (`project_runtime.rs`) checks every second for automations that are **on** and **due** in `automation_state`.
2. 🔒 Before starting, it re-reads and hashes **every file the run will use**: the automation, `plugin.json`, its skills, its tools and their entrypoints, selected resources and project instructions (`project_index::approved_inputs`). If that hash differs from `approved_hash`, the run does not start; the automation switches off and is marked "inputs changed".
3. 📸 It saves those exact inputs to `runs/<id>/inputs/` and to the `runs` row.
4. ▶️ It runs the tool, or launches Codex or Claude with project instructions, pinned resources, pinned skill text and the Memory guide with relevant notes.
5. 🧾 It records events, logs, outputs and artifacts, then finishes with an honest status: `succeeded`, `failed`, `waiting_input`, `cancelled` or `interrupted`. A restart never turns an unfinished run into a success.

### Agents in chats

Agents never query a database. They use tools that go through the same validated commands:

| Tool | Gives the agent |
|---|---|
| `inferay_projects` (Codex today) | list projects and definitions, read command shapes, propose changes as cards you accept |
| `inferay_memory` (Codex today) | search notes (short hits), read one note, save a note when you ask |
| Prompt context (Codex and Claude) | project instructions, plus a short Memory guide with the best-matching notes |

An agent asks for what it needs instead of loading everything, and each run records which notes it read (`memory_read` events).

## 🛡️ Guarantees

- **Files win.** The index is always derived from files; it is never an independent copy you can edit.
- **No silent overwrites.** Writes check the expected file hash; a stale edit is refused.
- **Approval follows content.** Any change to an input switches the automation off until you enable it again.
- **Local state stays local.** Approvals, on/off, repository paths and run history never travel with a folder.
- **One owner.** `projects.lock` keeps two Inferay processes from writing the same profile.
- **History is honest.** Runs keep their captured inputs and outcome even after the definitions change.

## 🔄 Upgrades and migration

Older profiles kept definitions in database rows. On first launch of a version-3 build, `project_migration::export` writes every project, resource, tool, skill and automation out as files (keeping all IDs, so run history still links), `replace_definition_tables` swaps in the index tables, and every automation comes over **switched off with no approval**. Absolute folder paths become repository references. Test migrations only against a disposable `INFERAY_USER_DATA_DIR`.

## ⚠️ Known limits

- **Full rebuild on every refresh.** `project_index::refresh` deletes and re-reads every project's definition files on each call, and the project pages call it every 3 seconds. That is fine for a handful of projects but grows with every plugin. Planned fix: re-read only files whose size or modified time changed, as `memory_store` already does.
- **Old write paths remain.** `project_store.rs` still contains row-writing code for the pre-file schema (`resources`, `resource_revisions`, `projects`, `automations`, `plugins`), now used only by migration and slated for removal ([roadmap](roadmap.md), M1).
- **Claude lacks the tools.** `inferay_projects` and `inferay_memory` are offered to Codex only; Claude gets Memory as prompt text and can search the notes folder itself.
- **No cost on runs yet.** Token counts and cost are not recorded on `runs` ([roadmap](roadmap.md), M2).

## ☁️ What is local and what could be shared

Everything on this page is local to one Mac by design. Shared brand data (brand context, accounts, shared brand memory) and posting are expected to live in **Origin Cloud**, reached with a token through a tool, never copied into these databases. That split is being agreed; see the [roadmap](roadmap.md).
