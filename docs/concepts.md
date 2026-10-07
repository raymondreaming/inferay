# Concepts

Inferay is a desktop workspace for working with Claude and Codex, and a local harness that turns what you build in chat into capabilities that run on their own: on a schedule, under your approval, with a record of what they did. This page explains each building block and how they differ. File formats are in [reference/project-files.md](reference/project-files.md); the rules the core enforces are in [ADR 0002](adr/0002-automation-kernel.md).

Status words on this page: **works** (runs in the current build), **defined** (format and validator exist; the storage switch to files is in progress, see the [roadmap](roadmap.md)), **planned** (designed, not built).

## The one-paragraph model

A **project** groups everything for one effort: a codebase, a brand, a business. It can link **repositories** without copying them and hold **resources** (structured facts such as a brand genome). Reusable capability lives in **plugins**: each plugin is one folder containing **skills** (instructions an agent reads), **tools** (programs with a declared input), and **automations** (when to do something and with what). An automation produces a **run**; a run leaves **artifacts** and an event log. Inferay's core decides what may run, holds approvals and secrets, and is the only part that will ever carry out consequential actions (**effects**). Plugins declare; the core acts.

```
Project ─┬─ Repositories (linked, never copied)
         ├─ Resources (brand, mind, genome, …)
         ├─ Files (managed documents)
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
| **Resource** | A typed, structured fact the project keeps: `brand.brand`, `brand.mind`, `brand.genome`, or a type a plugin adds. Agents get a resource only when an automation or chat explicitly selects it. | project | works; file-owned **defined** |
| **Skill** | Markdown instructions with a name and description: how to do something. Global skills live in the Skills library (bundled with the app, plus your own); project skills live inside a plugin. A skill holds judgment, never secrets or schedules. | Skills library / plugin | works (global); in-plugin **defined** |
| **Tool** | A program Inferay runs with a declared input and output schema, a timeout and captured logs. Holds rules and measurements: a check that must pass or fail is a tool, not a skill. | plugin | works; in-plugin **defined** |
| **Automation** | A saved job: a trigger (manual, interval, or calendar time in a timezone), an execution (an agent with chosen skills, resources and repositories, or a single tool), an overlap policy, and the permissions it needs (`may`). | plugin | works; file-owned **defined** |
| **Plugin** | One folder holding the skills, tools and automations for one capability, plus a manifest with the most it may do. The unit you approve, share (by copying the folder) and see in the Plugins view. | project | installed copies work; chat-authored plugin folders **defined** |
| **Run** | One execution of an automation: captured inputs, state (`queued`, `running`, `succeeded`, `failed`, `waiting_input`, `cancelled`, `interrupted`, `skipped`), events, logs, artifacts. A crash or restart never turns into success. | run store | works |
| **Artifact** | A file a run declares as output (a report, a render, a JSON result), with its size and hash. | run | works |
| **Approval** | Your local decision that an automation may run on its schedule, stored as a hash of every input it reads. Any change to those inputs turns the schedule off until you enable it again. | local state | works (snapshot hash); file-input hashing **defined** |
| **Memory** | The project's long-term knowledge: notes saved from chats and runs, dropped files, and typed records. Agents search and read it through a `memory` tool instead of loading it all. Memory informs; it never authorizes. See [memory.md](memory.md). | project | **planned** (M2) |
| **Pack** | Someone else's folder of scripts and modules (for example a Blender kit) linked as a repository and used in place, pinned by commit. Not a separate object: a repository a plugin's tools point into. | repository + plugin | **planned** (E1) |
| **Connection** | A secret (API key, token) held in the Keychain and injected only into the tools that declare it. Never in a definition file, never shown to an agent. | core | **planned** (E4) |
| **Effect** | A consequential action outside Inferay (post, deploy, send, spend). Runs emit effect *intents*; the core checks them against an approved budget, records them in an outbox before sending, and reconciles receipts. | core + handler plugin | **planned** (E5) |
| **Observation** | A fact flowing back in (post analytics, build status, store numbers) that skills can read and triggers can react to. | core + observer plugin | **planned** |

## The differences that matter

**Skill vs tool.** A skill is text an agent reads and interprets ("how to make today's hero post"). A tool is a program Inferay executes with checked input ("run the caption check; exit 1 means fail"). If two people should get the same answer every time, it is a tool.

**Skill vs automation.** A skill says *how*; an automation says *when* and *with what*. Asking for a daily job creates an automation (and, if needed, a skill inside the same plugin), not a stand-alone global skill.

**Tool vs automation.** A tool is a building block; an automation is a scheduled or manual job that uses an agent or a tool. A tool can be used by many automations.

**Plugin vs project.** A project is *what you are working on*; a plugin is *a capability inside it*. One project has many plugins; a plugin can be copied into another project.

**Plugin vs pack.** A plugin is yours: small, inspectable definitions. A pack is a body of code you link and use (often someone else's). Fork a pack to make it yours; your plugins keep pointing at it by repository ID.

**Resource vs file.** A resource is a typed fact with a schema that automations select explicitly. A file under the project's `files/` is a document with no schema.

**Definition vs state.** Definitions (project, resources, plugins, skills, tools, automations) are files you can read, copy and put under Git if you want. State (approvals, enabled schedules, next due times, runs, events, artifacts, which folder a repository ID means on this Mac) stays in Inferay's local database and is never shared by copying a folder. Pulling or copying someone's plugin never enables anything.

**Run vs effect.** A run does work inside the project and its linked repositories. Its `may` permissions are declared and reviewed, but agent runs currently execute with the provider's full access, so they are not yet enforced; see [architecture.md](architecture.md#provider-runner). An effect leaves the machine with consequences. Runs never perform effects directly; the core does, within a budget you approved.

## Where things live

Inferay's profile is `~/Library/Application Support/Inferay/` (`INFERAY_USER_DATA_DIR` overrides it for development and tests).

```
Inferay/
  projects/<project-id>/       definitions and managed files for one project
    project.json
    resources/<type>/<slug>.json
    files/
    plugins/<slug>/            plugin.json, skills/, tools/, automations/
    runs/<run-id>/             inputs/, logs/, output/  (run evidence)
  projects.sqlite3             local state and the rebuildable definition index
  chat.sqlite3, chat-*/        conversations
```

The layout under `projects/<id>/` is the target of the storage switch in progress; today definitions are still stored in `projects.sqlite3` (see the status column above).

## Worked examples

**Daily repository job** (works today as a SQLite-owned automation). A project linking the Point-Marketing repository has an automation: calendar 08:00 America/Chicago, agent execution with the repository as working directory and a skill that says "follow `agents/POINT-AUTOBUILD-GUIDE.md`, choose one app, run its checks, commit on a branch, never deploy". The process stays defined in the repository; Inferay schedules it, holds the approval and keeps the record.

**Brand content lane** (needs E1–E3, E7). A Hatching Point project links a forked Blender kit as a repository. Its `hatch-content` plugin has a `lane-hero` skill that names the kit's modules, tools whose entrypoints are the kit's render and check scripts, and an automation at 09:00 New York. The kit's code is never copied; the approval pins its commit.

**Posting with a limit** (needs E4, E5). The lane finishes by emitting post intents. A `hatch-posting` plugin declares a Post Bridge connection and a handler. The core sends at most the approved number per day, records each intent before sending, and reconciles after a crash so nothing posts twice.

**Brand-aware design** (needs E6). A `hatch-design` plugin declares the Spline MCP server; its skill reads the project's genome resource so every screen uses that brand's colors and type.
