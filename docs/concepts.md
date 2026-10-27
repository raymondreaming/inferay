# Concepts

Inferay is a desktop workspace for working with Claude and Codex, and a local harness that turns what you build in chat into capabilities that run on their own: on a schedule, under your approval, with a record of what they did. This page explains each building block and how they differ. File formats are in [reference/project-files.md](reference/project-files.md); the rules the core enforces are in [ADR 0002](adr/0002-automation-kernel.md).

Status words on this page: **works** (runs in the current build), **planned** (designed, not built). Definitions are files; see the [roadmap](roadmap.md) for remaining gates.

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
| **Project** | Durable identity for one effort, independent of any folder: name, instructions, linked repositories. Has a managed folder for its definitions and files. | project store | works (file-owned definition) |
| **Repository** | A folder you work in (usually Git). Linked to a project by ID; the path on this Mac is local state, so the same project can point at different checkouts on different Macs. Inferay never copies it. | project + local path table | works (ID references) |
| **Record** | A typed, structured fact stored in Memory: `brand.brand`, `brand.mind`, `brand.genome`, or a type a plugin adds. Agents get a resource only when an automation or chat explicitly selects it. | project | works (file-owned); no Memory page view yet |
| **Skill** | Markdown instructions with a name and description: how to do something. Global skills live in the Skills library (bundled with the app, plus your own); project skills live inside a plugin. A skill holds judgment, never secrets or schedules. | Skills library / plugin | works (global and plugin-local) |
| **Tool** | A program Inferay runs with a declared input and output schema, a timeout and captured logs. Holds rules and measurements: a check that must pass or fail is a tool, not a skill. | plugin | works (in-plugin) |
| **Automation** | A saved job: a trigger (manual, interval, or calendar time in a timezone), an execution (an agent with chosen skills, resources and repositories, or a single tool), an overlap policy, and the permissions it needs (`may`). | project; optionally supplied by a plugin | works (standalone or in a plugin) |
| **Plugin** | A persistent folder of reusable code and supporting files for a capability, plus a descriptive manifest and declared permissions. Skills, tools and automations are optional. The unit you approve, share (by copying the folder) and see in the Plugins view. | project | works; imported-folder organization through chat remains unfinished |
| **Run** | One execution of an automation: captured inputs, state (`queued`, `running`, `succeeded`, `failed`, `waiting_input`, `cancelled`, `interrupted`, `skipped`), events, logs, artifacts. A crash or restart never turns into success. | run store | works |
| **Artifact** | A file a run declares as output (a report, a render, a JSON result), with its size and hash. | run | works |
| **Approval** | Your local decision that an automation may run on its schedule, stored as a hash of every input it reads. Any change to those inputs turns the schedule off until you enable it again. | local state | works (hash of file inputs) |
| **Memory** | The project's long-term knowledge: notes saved from chats and runs, dropped files, and typed records. Agents search and read it through a `memory` tool instead of loading it all. Memory informs; it never authorizes. See [memory.md](memory.md). | project | notes, dropped files and graph view **work**; records on the page **planned** |
| **Pack** | Someone else's folder of scripts and modules (for example a Blender kit) linked as a repository and used in place, pinned by commit. Not a separate object: a repository a plugin's tools point into. | repository + plugin | works for clean Git checkouts (E1) |
| **Connection** | A secret (API key, token) held in the Keychain and injected only into the tools that declare it. Never in a definition file, never shown to an agent. | core | Keychain management, approved tool bindings and an authenticated GET relay work; remote authenticated MCP is **planned** (E4). See [Connections](connections.md). |
| **Effect** | A consequential action outside Inferay (post, deploy, send, spend). Runs emit effect *intents*; the core checks them against an approved budget, records them in an outbox before sending, and reconciles receipts. | core + handler plugin | intent capture, Needs review inbox and dismissal work; handler kinds can be declared; binding, budgets and the delivery worker are **planned** (E5). See [Effects](effects.md). |
| **Observation** | A fact flowing back in (post analytics, build status, store numbers) that skills can read and triggers can react to. | core + observer plugin | **planned** |

## The differences that matter

**Skill vs tool.** A skill is text an agent reads and interprets ("how to make today's hero post"). A tool is a program Inferay executes with checked input ("run the caption check; exit 1 means fail"). If two people should get the same answer every time, it is a tool.

**Skill vs automation.** A skill says *how*; an automation says *when* and *with what*. Asking for a daily job creates an automation. It can reuse an existing global skill or plugin; creating a job does not create a plugin automatically.

**Tool vs automation.** A tool is a building block; an automation is a scheduled or manual job that uses an agent or a tool. A tool can be used by many automations.

**Plugin vs project.** A project is *what you are working on*; a plugin is *a capability inside it*. One project has many plugins; a plugin can be copied into another project.

**Plugin vs pack.** A plugin is yours: small, inspectable definitions. A pack is a body of code you link and use (often someone else's). Fork a pack to make it yours; your plugins keep pointing at it by repository ID.

**Record vs document.** Both belong in Memory. A record is a typed fact with a schema; a document or image is an original file under `memory/documents/`.

**Definition vs state.** Definitions (project, resources, plugins, skills, tools, automations) are files you can read, copy and put under Git if you want. State (approvals, enabled schedules, next due times, runs, events, artifacts, which folder a repository ID means on this Mac) stays in Inferay's local database and is never shared by copying a folder. Pulling or copying someone's plugin never enables anything.

**Run vs effect.** An agent run starts a regular local chat with its configured instructions, provider and working directory. It has the same tools and access as other local chats. Tool-only runs and explicitly granted library tools use declared permissions and the native process sandbox. An effect is a core-mediated external action with an approved budget, durable intent and receipt. Runs can propose effect intents for review and dismissal; delivery remains planned. Ordinary chat shell/network access is not restricted to the effects interface.

## Managing repositories

The repository picker and sidebar show each linked checkout's name and path. Add repository links a folder immediately. The × control removes that repository from the current project without deleting its files; there is no separate save step. The shared project command refuses removal while an automation or repository-backed tool still references it, and the UI shows that error. Change those references before retrying. Removing the selected repository selects another linked checkout; removing the last closes the panel. Add repository remains available in the sidebar when the list is empty.

Chat titles use the provider’s thread name when available (including Codex name updates), with the first user message as the fallback. Naming a chat does not launch a separate Claude request. Saved provider-error titles are repaired from the transcript when the workspace loads, including unopened chats.

## Project navigation

During an app session, each project tab remembers its last section, active conversation, selected repository, and whether its repository panel is open. Switching projects restores that location; a project opened for the first time starts in Chat. Clicking the active project tab keeps the current page. ⌘← and ⌘→ switch between project tabs in their displayed order, wrapping at either end. Text fields retain their normal cursor shortcuts, and dialogs suspend tab switching.

The top-right repository button opens and closes history and changes beside the current page. Selecting a repository in the left navigation opens the same panel. Its dropdown lists locally linked repositories for the current project, using their project names and local paths. It grows to show up to ten repositories, bounded by the available window height, and scrolls for longer lists. Manage repositories in the left sidebar links missing checkouts. The panel header keeps the folder picker, current branch, Actions, History, Changes and expand control on one row. Actions contains Fetch, Pull and Push alongside branch, tag and stash operations, and uses the same confirmation and operation feedback as graph context menus. Drag the panel’s left edge, or focus it and use arrow keys, to change its width; the width is saved locally. Expand fills the workspace, and Escape restores the chat beside it. Branch stays immediately left of Graph in both narrow and expanded layouts, including after column reordering. Narrow panels reserve room for branch, graph and date/time before sizing the message; enabled columns remain accessible by horizontal scrolling when needed. Column headings can be dragged to reorder and their edges dragged to resize in both sidebar and expanded views. Branch and Graph move together. Column order is shared; compact and expanded widths are saved independently. Transparent column headings sit above the scroll viewport, remaining visible without hovering or covering the rows. History returns to the graph; Changes toggles the commit details, working-tree files and commit controls below it. Drag the top border of the changes area to adjust its height; the saved height is bounded to keep both panels reachable. The focused divider also supports Up, Down, Home and End. Working-tree changes use independently scrolling Unstaged and Staged columns, with discard beside each count and Stage All or Unstage All aligned to the right. The message and compact commit action sit below those lists, moving into a third column when the panel is at least 900px wide. Closing the panel stops its mounted Git observers.

Chats automatically fill up to three columns, independent of older hidden layout settings. Each chat keeps at least half the available workspace height, including after divider resizing; a third row scrolls below the first two. Narrow windows reduce the column count; extra chats remain accessible by scrolling. Pane dividers can still be resized and panes reordered. The sidebar’s New chat action sits beside the Chats heading. Press ⌘K (Ctrl+K on other keyboards) to open the command palette, where New chat is the first action.

Settings opens as a full app page with grouped navigation and search. Skills lives under Agents in Settings, including the library, new-skill form, editing, and copying built-in skills. Chat skill cards and command-menu actions open the same Settings page at the requested skill or new draft. Leaving an edited skill checks for unsaved changes; saving keeps the existing validation and storage path. Returning to the workspace preserves its mounted chats and layout.

## Reviewing run output

History retains a run's result, logs and artifacts. Agent runs appear as regular chats in the grid. **Open chat** selects the same live conversation, with its full history and normal replies; it does not copy progress into another chat. Removing that pane hides it without stopping the run or deleting its history, and Open chat restores it. After the task completes or the app restarts, replies resume the saved conversation. Run Now and scheduled triggers use the same launch path. Open a text report, image or video directly from its artifact button. Videos have playback and seeking controls, with a 50 MB preview limit and codec support determined by the browser or desktop webview.

CSV and TSV files display their first record as column headings. JSON arrays of objects display their field names as columns. Table previews show up to 200 rows and 64 columns from files up to 1 MB; the row count identifies a partial preview. **View source** shows the original text. Invalid or unsupported table shapes remain available as text. Previews never execute formulas or markup from a cell.

## Plugins are local libraries

A plugin is deliberately created or imported reusable work. It can contain many Python files for Blender, browser automation for Point Marketing, a browser-based image workflow, Figma helpers, social API code, templates or assets. These are examples of plugin content, not new categories built into Inferay's core.

Each library uses the same discovery and execution conventions: a manifest gives its name and purpose; a README explains usage; skills teach agents when and how to use it; declared tools provide named entrypoints, inputs, outputs, timeouts and run results. Implementations can use different languages. JSON-on-stdin, CLI and local stdio MCP tools use declared inputs, bounded execution and retained run output. Machine requirements are checked before execution. Agents can receive optional or required tool grants; a required tool must succeed for the run to succeed. Local MCP servers are declared as tools inside the library and use the same per-run grants. Authenticated remote MCP connections remain planned. Imported scripts need declared entrypoints before Inferay can execute them as tools.

**Ownership.** Workflow and automation definitions live in Inferay's project folder, alongside its plugins and Memory. They are not installed into linked repositories. Global skills remain in the global Skills library; library-specific skills travel with the plugin. A linked repository may contain its own process guide or implementation, which Inferay can reference without taking ownership of it. Repository-backed tools use linked repository IDs, a pinned commit and an entrypoint hash. They run from a verified clean checkout.

**Automations are independent.** An existing daily research or weekly briefing job belongs in Automations. It does not become a plugin merely because it has a schedule. Several jobs can reuse one meaningful library; a library can have no jobs at all. Plugins should start empty for a project that has never created or imported one. Earlier one-plugin-per-automation wrappers must be migrated with the previous Inferay build before opening this version.

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

Definitions live in the project folder; SQLite indexes them and stores local run, approval and schedule state.

## Worked examples

**Daily repository job.** A project linking the Point-Marketing repository has an automation: calendar 08:00 America/Chicago, agent execution with the repository as working directory and a skill that says "follow `agents/POINT-AUTOBUILD-GUIDE.md`, choose one app, run its checks, commit on a branch, never deploy". The process stays defined in the repository; Inferay schedules it, holds the approval and keeps the record.

**Brand content lane** (needs E1–E3, E7). A Hatching Point project links a forked Blender kit as a repository. Its `hatch-content` plugin has a `lane-hero` skill that names the kit's modules, tools whose entrypoints are the kit's render and check scripts, and an automation at 09:00 New York. The kit's code is never copied; the approval pins its commit.

**Posting with a limit** (needs E4, E5). The lane finishes by emitting post intents. A `hatch-posting` plugin declares a Post Bridge connection and a handler. The core sends at most the approved number per day, records each intent before sending, and reconciles after a crash so nothing posts twice.

**Brand-aware design** (needs E6). A `hatch-design` plugin declares the Spline MCP server; its skill reads the project's genome resource so every screen uses that brand's colors and type.
