# Concepts

Inferay is a desktop workspace for working with Claude and Codex, and a local harness that turns what you build in chat into capabilities that run on their own: on a schedule, under your approval, with a record of what they did. This page explains each building block and how they differ. File formats are in [reference/project-files.md](reference/project-files.md); the rules the core enforces are in [ADR 0002](adr/0002-automation-kernel.md).

Status words on this page: **works** (runs in the current build), **defined** (format and validator exist; the storage switch to files is in progress, see the [roadmap](roadmap.md)), **planned** (designed, not built).

## The one-paragraph model

A **project** groups everything for one effort: a codebase, a brand, a business. It can link **repositories** without copying them and keep notes, documents and structured records (such as a brand genome) in **Memory**. Reusable capability lives in **plugins**: each plugin is a persistent workspace containing reusable code, helper modules, documentation, templates and assets. It can also contain **skills** (instructions an agent reads), **tools** (programs with declared entry points), and **automations** (when to do something and with what); none of those three is required. An automation produces a **run**; a run leaves **artifacts** and an event log. Inferay's core decides what may run, holds approvals and secrets, and is the only part that will ever carry out consequential actions (**effects**). Plugins declare; the core acts.

```
Project ─┬─ Repositories (linked, never copied)
         ├─ Memory ─┬─ Notes
         │          ├─ Documents and images
         │          └─ Records (brand, Mind, genome, …)
         └─ Plugins ─┬─ Skills       what to do and how
                     ├─ Tools        programs to call
                     └─ Automations  when, with which skills/tools, under which permissions
                                         │
                                         ▼
                                       Runs ── events, logs, artifacts
```

## Building blocks

| Concept | What it is | Owned by | Status |
|---|---|---|---|
| **Chat** | A conversation with Claude or Codex in a pane, optionally attached to a project or repository. Where you work day to day and where plugins get authored. | chat runtime | works |
| **Project** | Durable identity for one effort, independent of any folder: name, instructions, linked repositories. Has a managed folder for its definitions and files. | project store | works; file-owned definition **defined** |
| **Repository** | A folder you work in (usually Git). Linked to a project by ID; the path on this Mac is local state, so the same project can point at different checkouts on different Macs. Inferay never copies it. | project + local path table | works; ID references **defined** |
| **Record** | A typed, structured fact stored in Memory: `brand.brand`, `brand.mind`, `brand.genome`, or a type a plugin adds. Agents get a resource only when an automation or chat explicitly selects it. | project | works; file-owned **defined** |
| **Skill** | Markdown instructions with a name and description: how to do something. Global skills live in the Skills library (bundled with the app, plus your own); project skills live inside a plugin. A skill holds judgment, never secrets or schedules. | Skills library / plugin | works (global and plugin-local) |
| **Tool** | A program Inferay runs with a declared input and output schema, a timeout and captured logs. Holds rules and measurements: a check that must pass or fail is a tool, not a skill. | plugin | works; in-plugin **defined** |
| **Automation** | A saved job: a trigger (manual, interval, or calendar time in a timezone), an execution (an agent with chosen skills, resources and repositories, or a single tool), an overlap policy, and the permissions it needs (`may`). | project; optionally supplied by a plugin | works; standalone file layout in progress |
| **Plugin** | A persistent folder of reusable code and supporting files for a capability, plus a descriptive manifest and declared permissions. Skills, tools and automations are optional. The unit you approve, share (by copying the folder) and see in the Plugins view. | project | works; imported-folder organization through chat remains unfinished |
| **Run** | One execution of an automation: captured inputs, state (`queued`, `running`, `succeeded`, `failed`, `waiting_input`, `cancelled`, `interrupted`, `skipped`), events, logs, artifacts. A crash or restart never turns into success. | run store | works |
| **Artifact** | A file a run declares as output (a report, a render, a JSON result), with its size and hash. | run | works |
| **Approval** | Your local decision that an automation may run on its schedule, stored as a hash of every input it reads. Any change to those inputs turns the schedule off until you enable it again. | local state | works (snapshot hash); file-input hashing **defined** |
| **Memory** | The project's long-term knowledge: notes saved from chats and runs, dropped files, and typed records. Agents search and read it through a `memory` tool instead of loading it all. Memory informs; it never authorizes. See [memory.md](memory.md). | project | notes **work**; files and records on the page **planned** (M2) |
| **Pack** | Someone else's folder of scripts and modules (for example a Blender kit) linked as a repository and used in place, pinned by commit. Not a separate object: a repository a plugin's tools point into. | repository + plugin | **planned** (E1) |
| **Connection** | A secret (API key, token) held in the Keychain and injected only into the tools that declare it. Never in a definition file, never shown to an agent. | core | Keychain management works; approved tool bindings and injection are **planned** (E4). See [Connections](connections.md). |
| **Effect** | A consequential action outside Inferay (post, deploy, send, spend). Runs emit effect *intents*; the core checks them against an approved budget, records them in an outbox before sending, and reconciles receipts. | core + handler plugin | **planned** (E5) |
| **Observation** | A fact flowing back in (post analytics, build status, store numbers) that skills can read and triggers can react to. | core + observer plugin | **planned** |

## The differences that matter

**Skill vs tool.** A skill is text an agent reads and interprets ("how to make today's hero post"). A tool is a program Inferay executes with checked input ("run the caption check; exit 1 means fail"). If two people should get the same answer every time, it is a tool.

**Skill vs automation.** A skill says *how*; an automation says *when* and *with what*. Asking for a daily job creates an automation. It can reuse an existing global skill or plugin; creating a job does not create a plugin automatically.

**Tool vs automation.** A tool is a building block; an automation is a scheduled or manual job that uses an agent or a tool. A tool can be used by many automations.

**Plugin vs project.** A project is *what you are working on*; a plugin is *a capability inside it*. One project has many plugins; a plugin can be copied into another project.

**Plugin vs pack.** A plugin is yours: small, inspectable definitions. A pack is a body of code you link and use (often someone else's). Fork a pack to make it yours; your plugins keep pointing at it by repository ID.

**Record vs document.** Both belong in Memory. A record is a typed fact with a schema; a document or image is an original file under `memory/documents/`.

**Definition vs state.** Definitions (project, resources, plugins, skills, tools, automations) are files you can read, copy and put under Git if you want. State (approvals, enabled schedules, next due times, runs, events, artifacts, which folder a repository ID means on this Mac) stays in Inferay's local database and is never shared by copying a folder. Pulling or copying someone's plugin never enables anything.

**Run vs effect.** A run does work inside the project and its linked repositories. Automation agents use provider sandbox settings for filesystem and network limits; local tools use an OS sandbox. Local tools additionally require `commit` for Git metadata changes. Enforcement is partial: read isolation, provider-shell commit control, and separate push and PR permissions remain unfinished. See [architecture.md](architecture.md#provider-runner). An effect is a planned, core-mediated external action with an approved budget, durable intent and receipt. That effect path is not implemented yet.

## Reviewing run output

History retains a run's result, logs and artifacts. Open a text report, image or video directly from its artifact button. Videos have playback and seeking controls, with a 50 MB preview limit and codec support determined by the browser or desktop webview.

CSV and TSV files display their first record as column headings. JSON arrays of objects display their field names as columns. Table previews show up to 200 rows and 64 columns from files up to 1 MB; the row count identifies a partial preview. **View source** shows the original text. Invalid or unsupported table shapes remain available as text. Previews never execute formulas or markup from a cell.

## Plugins are local libraries

A plugin is deliberately created or imported reusable work. It can contain many Python files for Blender, browser automation for Point Marketing, a browser-based image workflow, Figma helpers, social API code, templates or assets. These are examples of plugin content, not new categories built into Inferay's core.

Each library uses the same discovery and execution conventions: a manifest gives its name and purpose; a README explains usage; skills teach agents when and how to use it; declared tools provide named entrypoints, inputs, outputs, timeouts and run results. Implementations can use different languages. JSON-on-stdin, CLI and local stdio MCP tools use declared inputs, bounded execution and retained run output. Machine requirements are checked before execution. Agents can receive optional or required tool grants; a required tool must succeed for the run to succeed. Local MCP servers are declared as tools inside the library and use the same per-run grants. Authenticated remote MCP connections remain planned. Imported scripts need declared entrypoints before Inferay can execute them as tools.

**Ownership.** Workflow and automation definitions live in Inferay's project folder, alongside its plugins and Memory. They are not installed into linked repositories. Global skills remain in the global Skills library; library-specific skills travel with the plugin. A linked repository may contain its own process guide or implementation, which Inferay can reference without taking ownership of it. Repository-backed tools use linked repository IDs, a pinned commit and an entrypoint hash. They run from a verified clean checkout.

**Automations are independent.** An existing daily research or weekly briefing job belongs in Automations. It does not become a plugin merely because it has a schedule. Several jobs can reuse one meaningful library; a library can have no jobs at all. Plugins should start empty for a project that has never created or imported one. The migration-generated one-plugin-per-automation wrappers are being removed while preserving job IDs and history.

**Folder intake.** Import a folder of existing work into Plugins and preserve its original files, including binary assets, as a draft library. Then ask chat to inspect it, explain what it does, organize reusable pieces, document requirements, and propose skills and tool entrypoints. Review the proposed changes before approving execution. Importing does not execute scripts, install dependencies, enable schedules or post anything. The folder picker and drag-and-drop accept raw files, including binary assets, without a manifest. Originals are kept under `source/`, with a generated manifest and usage guide. The current bound is 1,000 entries and 50 MB. Chat-driven organization of the imported library remains unfinished.

**Presentation.** A plugin card leads with its name and purpose, then summarizes the code, skills, tools and assets it contains. Linked jobs appear as uses of the library. Filenames belong in the contents view. Memory holds knowledge and reference material; Plugins holds reusable implementations and instructions for using them.

## Where things live

Inferay's profile is `~/Library/Application Support/Inferay/` (`INFERAY_USER_DATA_DIR` overrides it for development and tests).

```
Inferay/
  projects/<project-id>/       definitions and managed files for one project
    project.json
    memory/<type>/<slug>.json
    memory/documents/
    plugins/<slug>/            plugin.json, README.md, src/, assets/, optional skills/ and tools/
    automations/<id>/          automation.json and any private supporting files
    runs/<run-id>/             inputs/, logs/, output/  (run evidence)
  projects.sqlite3             local state and the rebuildable definition index
  chat.sqlite3, chat-*/        conversations
```

Definitions live in the project folder; SQLite indexes them and stores local run, approval and schedule state. Separating migrated automation folders from generated plugin wrappers is in progress.

## Worked examples

**Daily repository job.** A project linking the Point-Marketing repository has an automation: calendar 08:00 America/Chicago, agent execution with the repository as working directory and a skill that says "follow `agents/POINT-AUTOBUILD-GUIDE.md`, choose one app, run its checks, commit on a branch, never deploy". The process stays defined in the repository; Inferay schedules it, holds the approval and keeps the record.

**Brand content lane** (needs E1–E3, E7). A Hatching Point project links a forked Blender kit as a repository. Its `hatch-content` plugin has a `lane-hero` skill that names the kit's modules, tools whose entrypoints are the kit's render and check scripts, and an automation at 09:00 New York. The kit's code is never copied; the approval pins its commit.

**Posting with a limit** (needs E4, E5). The lane finishes by emitting post intents. A `hatch-posting` plugin declares a Post Bridge connection and a handler. The core sends at most the approved number per day, records each intent before sending, and reconciles after a crash so nothing posts twice.

**Brand-aware design** (needs E6). A `hatch-design` plugin declares the Spline MCP server; its skill reads the project's genome resource so every screen uses that brand's colors and type.
