# 🧠 Memory

Memory is a project's long-term knowledge: things you or an agent decide are worth keeping, saved as plain files, searchable by every chat and automation in the project. It is how Inferay gets more useful the longer you use it: automations and skills draw on what the project has learned, and improvements arrive as proposals you approve.

Status: **notes work** (`native/core/src/memory.rs`, `native/server/src/memory_store.rs`, the Memory page and the chat Memory button). Files in Memory and records as one page come with the M2 page cleanup; until then Resources, Files and Tools remain separate pages.

| Part | Status |
|---|---|
| Notes as Markdown files, rebuildable FTS5 index, superseded and expired ranking, `[[links]]` | works |
| Memory page: table, search, tag filter, note view with links, New note | works |
| Memory button on assistant chat messages (saves with an automatic title; edit afterwards) | works |
| Codex `inferay_memory` tool (search, read, save in chats; no save in automations) | works |
| Claude: memory guide and best matches in the prompt; searches the folder with `rg` and writes notes as files | works (no tool yet) |
| Runs record the notes they read (`memory_read` run event) | works |
| Library view: drop zone, card grid with previews, side panel, files with companion notes, PDF text extraction, duplicate detection, records as cards, live updates; Resources and Files pages removed | planned (M2) |
| Title and tags sheet before saving, Memory button on your own messages, image and video descriptions, graph view, global memory, meaning-based search | planned |

## What it is

**Memory is the project's one library page.** It replaces the Resources and Files pages (and Tools moves into each plugin), leaving four project pages: Memory, Plugins, Automations, Repositories.

- ⬇️ **Drop anything anywhere on the page**: text, Markdown, PDFs, images, video, links. It is saved at once and appears as a card.
- 🗂️ **One continuous view** of everything saved, newest first, with filters for kind (Notes, Files, Images, Records) and tags, and one search across all of it.
- 🔎 **A side panel** opens any card: the note, a preview of the file, extracted PDF text, a record's fields, where it came from, and what links to it.
- 🔄 **Live**: saves from chats, agents and kept run outputs appear without refreshing.
- 📝 **Every file gets a companion note** (title, tags, description, link to the original) so agents find files through the same `memory.search` / `memory.read` tool. PDFs also have their text extracted into the index; images and video are searchable by title and tags until you ask for a description.
- ♻️ **Duplicates** are detected by file hash; dropping the same file twice points to the existing one.
- 🧬 **Records stay deliberate**: a dropped JSON file never silently becomes a genome that automations depend on; records are added through their editor or an explicit "use as …" action.


The project page currently called Resources becomes **Memory**. It holds three kinds of entries:

| Kind | Examples | Stored as | Role |
|---|---|---|---|
| 📝 **Notes** | a chat answer you liked, a decision, a research summary, a run's report | Markdown with a small header, `resources/notes/<slug>.md` | Knowledge: informs chats and runs |
| 📎 **Files** | PDFs, images, exports, references | The original under `resources/documents/`, plus a text note describing it | Source material |
| 🧬 **Records** | brand genome, Mind, characters | Typed JSON, `resources/<type>/<slug>.json` | Definitions: approved, hashed into automations |

Notes and files are **memory**: they inform, they never authorize. Records are **definitions**: automations that read them are approved against their exact content (see [concepts.md](concepts.md)).

The folder stays `resources/` on disk; the page and the agent tool call it Memory. Notes are plain Markdown with `[[links]]`, so the folder also opens as an Obsidian vault.

## Note format

```markdown
---
id: 7c1e9a52-3b0d-4f8e-9a61-2d4c5e8f1a90
title: Why we dropped the paywall on Bean Break
tags: [pricing, bean-break]
source: chat:9f2c…/message:41
created: 2026-10-06T20:31:00-05:00
supersedes: 2b7d…
expires: 2026-12-31
---
Conversion fell 40% with the paywall on day one. We moved it to day three…
See [[Bean Break launch plan]].
```

| Field | Rule |
|---|---|
| `id` | UUID, stable across renames |
| `title` | 1–200 bytes; the file name is a slug of it |
| `tags` | up to 30, each up to 64 bytes |
| `source` | where it came from: `chat:<pane>/message:<n>`, `run:<run-id>`, `agent:<pane>`, `manual`, or `file:<document path>` |
| `created` | timestamp |
| `supersedes` | optional ID of the note this replaces; the older note shows as superseded and ranks last in search |
| `expires` | optional date after which the note ranks last and is offered for cleanup |

Body: Markdown up to 64 KB. Larger material goes in as a file with a summary note.

## Getting things in

- **🧠 Save to memory, on any chat message.** One click opens a small sheet: title (suggested from the message), tags, and an optional "supersedes" pick. Saving writes a note with `source` pointing back to the message. Works for your messages and the agent's.
- **Ask an agent.** "Save this to memory", "make a note of the decision", "put that md file in memory instead of the repo". The agent calls `memory.save`; nothing is written to a Git repository.
- **Drop files** onto the Memory page. Each file is stored as-is and gets a note (title, short description, tags) the agent can draft for you.
- **From a run.** A run's report or artifact has Save to memory. Runs never save to memory on their own; a skill can *propose* a note, which you accept.

Every write goes through the same validated, conflict-checked file write as other project files.

## Finding things: the memory tool

Agents get one tool, `memory`, in every project chat and automation, for both Codex and Claude:

| Call | Returns |
|---|---|
| `search(query, tags?, limit?)` | Up to 10 hits by default: id, title, two-line snippet, tags, date, superseded flag. Small by design. |
| `read(id)` | One full note (or a file's note and its path) |
| `links(id)` | Notes linking to and from this one |
| `save(title, body, tags, supersedes?)` | A new note; from chats only, never silently from automations |

The prompt never contains the whole memory, only what the agent looks up. Project instructions tell agents to **search memory before answering questions about the project**, and skills can name memory searches explicitly ("search memory for prior lane results before planning").

### The index

`projects.sqlite3` keeps a rebuildable index, like the definition index:

- `memory_notes`: id, path, title, tags, source, created, supersedes, expires, content hash
- `memory_fts`: SQLite FTS5 full-text index over title, tags and body (local, no model calls)
- `memory_links`: `[[link]]` targets, shared source and supersedes edges

It updates whenever memory files change and can be rebuilt from the files at any time. Ranking: text relevance, then newer first; superseded and expired notes last. Meaning-based (embedding) search can replace the ranking later without changing the tool.

## Rules

1. **Memory informs; it never authorizes.** A note cannot grant a permission, enable an automation or change an approved definition. Note text is treated as untrusted data in prompts.
2. **Memory is not part of an automation's approval hash.** Otherwise every new note would disable every automation. Instead, each run **records which notes it read** (a `memory_read` run event with note ids and content hashes), so you can see what influenced a run and reproduce it.
3. **Skills improve by proposal.** A review or "tidy memory" automation may propose: merging duplicates, a summary note, a superseded link, or a sharper skill drawn from many notes. Each arrives as a change you approve; nothing rewrites itself.
4. **Bounded.** Up to 10,000 notes and 20,000 files per project; search returns at most 50 hits; reads return one note.

## Seeing it

- **Table** (default): title, kind, tags, source, date, superseded. Search box, tag filters, sort.
- **Note view**: rendered Markdown, "what links here", source link back to the chat or run, Supersede and Edit.
- **Graph** (after the table): notes as dots; lines from `[[links]]`, shared tags, shared source and supersedes. Bounded to the current search or tag.
- **Run view**: each run lists the notes it read.

## How it ties the flow together

```
Chat ──Save to memory──►  MEMORY  ◄──Save to memory── Run reports
                     notes · files · records
                            │  memory.search / read
                            ▼
              Chats and automations use what they need
                            │
                            ▼
   Review automation proposes better skills or notes ──► you approve ──► plugins and memory improve
```

## Later

- **Global memory**: a personal memory any project can search (read-only from projects), for lessons that apply everywhere.
- **Meaning-based search**, once plain full-text search visibly misses things.
- **Automatic suggestions**: "this answer looks worth saving" hints in chat.

## Done when (remaining M2 work)

- Save to memory on a chat message creates a note with a working link back to the message.
- An agent saves and later finds a note through `memory.search` in a new chat, in both Codex and Claude.
- A run's history lists the notes it read; adding a new note does not disable any automation.
- A superseded note ranks below its replacement and is marked in the table.
- Deleting `projects.sqlite3` rebuilds the memory index from the files.
- The memory folder opens in Obsidian with links intact.
