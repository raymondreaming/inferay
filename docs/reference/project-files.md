# Project definition files

Exact formats for the files that define a project. The types and validators are `native/core/src/project_files.rs` (tests: `native/core/tests/project_files.rs`); renderer types are exported through `@contracts`. This page describes that code. For what each concept means, read [concepts.md](../concepts.md).

**Status.** The formats and validators are implemented. The server still stores definitions in `projects.sqlite3`; switching it to read and write these files is in progress ([roadmap](../roadmap.md)). Sections marked *planned* are not in the code.

## Layout

```
<profile>/projects/<project-id>/
  project.json
  resources/<type>/<slug>.json
  files/                                managed documents (no schema)
  plugins/<slug>/
    plugin.json
    skills/<name>.md
    tools/<name>/tool.json + entrypoint
    automations/<name>.json
```

`<profile>` is `~/Library/Application Support/Inferay` unless `INFERAY_USER_DATA_DIR` is set.

## Rules for every definition file

- JSON with a `schema` string naming its format and version (`inferay.project/1`, …). Any other value is refused.
- Unknown fields are refused (`deny_unknown_fields`). There is no `enabled` field anywhere: enablement is local state.
- `id` is a UUID and must stay stable across renames; runs and approvals refer to it.
- At most 131,072 bytes per file (`MANIFEST_LIMIT`).
- `name`: 1–200 bytes. Text fields contain no NUL and have the limits listed below.
- Paths are relative: not empty, no leading `/`, no `..` or empty segments, no `\` or `:`. Absolute paths are never valid in a definition; a folder on this Mac is reached through a repository ID.
- Errors are prefixed with the file path, for example `automations/daily.json: may exceeds plugin permissions`.

## project.json

```json
{
  "schema": "inferay.project/1",
  "id": "3f0c…",
  "name": "Point app factory",
  "description": "",
  "instructions": "Point's own docs are the authority. Never deploy from an automation.",
  "repositories": [{ "id": "49e0…", "name": "Point-Marketing", "remote": "git@github.com:…" }]
}
```

| Field | Rule |
|---|---|
| `archived` | optional boolean, defaults to false; preserves archive state during migration |
| `description` | up to 8,000 bytes |
| `instructions` | up to 64,000 bytes; given to every agent run in the project |
| `repositories` | up to 512; each `id` a unique UUID, `name` 1–200 bytes, optional `remote` up to 2,048 bytes |

The local checkout path for a repository ID is local state, not part of this file.

## resources/&lt;type&gt;/&lt;slug&gt;.json

```json
{ "schema": "inferay.resource/1", "id": "b310…", "type": "brand.genome", "typeVersion": 1,
  "name": "Hatching Point genome", "archived": false,
  "body": { "brandId": "…", "colors": ["#1C1A1C", "#FF4D00"], "typography": ["Hatch Split Display"], "rules": ["Orange sparingly"] } }
```

`typeVersion` is positive; `body` is an object. Built-in types validate `body`:

| Type | Body |
|---|---|
| `brand.brand` | `description`, `voice`, `parentBrandId` (all optional strings) |
| `brand.mind` | `brandId` (required), `instructions`, `knowledge` (array, at most 1,000) |
| `brand.genome` | `brandId` (required), `colors`, `typography`, `rules` (string arrays) |

Other type IDs are accepted as relative names; their schemas come from plugins (*planned*).

## plugins/&lt;slug&gt;/plugin.json

```json
{ "schema": "inferay.plugin/1", "id": "c1a2…", "name": "Point daily autobuild", "version": "0.1.0",
  "description": "Research, pick one app, run Point's checks, leave evidence.",
  "may": ["read_repositories", "write_repositories", "commit"] }
```

`version` 1–100 bytes; `description` up to 8,000. `may` is the ceiling for every automation in the plugin. Contents are found by folder convention; the manifest does not list them. Plugin size limits: 50 MB and 1,000 entries.

### Permissions

`read_repositories`, `write_repositories`, `commit`, `push`, `open_pr`, `network`, `write_project_files`. Any other value is refused. An automation's `may` must fit within its plugin's `may`; that ceiling is checked. Beyond that, permissions are currently advisory: agent runs launch Claude and Codex with full access (see [architecture.md](../architecture.md#provider-runner)) and receive `may` as instructions. Enforcing them requires Inferay to perform those actions itself or to run providers under a sandbox; until then, treat `may` as a declaration you review, not a guarantee.

## skills/&lt;name&gt;.md

```markdown
---
id: 9d2e…
name: Daily autobuild
description: Pick one Point app and advance it through the AutoBuild guide.
command: /daily-autobuild
---
1. Read POINT.md and agents/POINT-AUTOBUILD-GUIDE.md.
…
```

Front matter fields: `id` (UUID), `name`, `description` (up to 8,000 bytes), optional `command` (a relative name, leading `/` allowed). Unknown or duplicate fields are refused. Fields occupy one line each, with either plain text or a JSON-quoted string (which preserves embedded newlines and quotes). The body is the instructions, 1–64,000 bytes.

## tools/&lt;name&gt;/tool.json

```json
{ "schema": "inferay.tool/1", "id": "7a41…", "name": "report", "program": "python3",
  "entrypoint": "report.py", "args": [], "timeoutSeconds": 300,
  "inputSchema": { "type": "object" }, "outputSchema": { "type": "object" } }
```

| Field | Rule |
|---|---|
| `program` | a program name resolved on this Mac's `PATH` (`python3`, `bun`, `blender`). Absolute paths are refused so the definition stays portable. |
| `entrypoint` | relative path inside the tool's folder |
| `args` | up to 64, each up to 8,000 bytes |
| `timeoutSeconds` | 1–3,600 |
| `inputSchema`, `outputSchema` | the supported JSON Schema subset below |

Execution contract: the tool receives its input as JSON on stdin and writes JSON to stdout; diagnostics go to stderr. Environment: `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT` (write artifacts here).

**JSON Schema subset.** Offline only: `type`, `properties`, `required`, `items`, `enum`, boolean `additionalProperties`, and numeric, length and count bounds. Other keywords are refused; remote references are never fetched.

## automations/&lt;name&gt;.json

```json
{
  "schema": "inferay.automation/1",
  "id": "f4b1…",
  "name": "Autobuild at 08:00",
  "trigger": { "kind": "calendar", "timezone": "America/Chicago", "days": [1,2,3,4,5,6,7], "times": ["08:00"] },
  "overlap": "skip",
  "execution": {
    "kind": "agent", "provider": "codex", "model": null, "reasoningLevel": "high",
    "instructions": "Run the daily autobuild skill.",
    "skills": ["9d2e0000-0000-4000-8000-000000000001"], "resources": [], "repositories": ["49e0…"],
    "workingDirectory": { "base": "repository", "id": "49e0…" },
    "timeoutSeconds": 14400
  },
  "may": ["read_repositories", "write_repositories", "commit"]
}
```

### trigger

| `kind` | Fields | Rule |
|---|---|---|
| `manual` | none | runs only on Run now |
| `interval` | `seconds` | 60–31,536,000 |
| `calendar` | `timezone`, `days`, `times` | IANA timezone; `days` unique 1–7 (Monday = 1); `times` 1–24 unique `HH:MM`. The next run is the earliest day/time pair in that timezone, correct across daylight-saving changes. |

`overlap`: `skip` (drop a due run while one is active) or `queue_one`.

`archived` is an optional boolean, defaulting to false. It belongs to the definition; enabled state remains local.

### execution

**Agent** (`"kind": "agent"`): `provider` is `codex` or `claude`; optional `model` and `reasoningLevel`; `instructions` 1–64,000 bytes; up to 20 `skills`, 32 `resources`, 512 `repositories`; `timeoutSeconds` 1–86,400. `workingDirectory` is one of:

- `{ "base": "repository", "id": "<repository UUID>" }`, a repository listed in `project.json`
- `{ "base": "project", "path": "files" }`, relative to the project folder
- `{ "base": "plugin", "path": "…" }`, relative to the plugin folder

**Tool** (`"kind": "tool"`): `tool` names a tool in the same plugin; `input` is JSON up to 64 KB, validated against the tool's `inputSchema` at run time.

### Reference checks

`validate_references` checks an automation against the inventory the server supplies, without reading files:

- `may` must be a subset of the plugin's `may`.
- Every skill, tool, resource and repository it names must exist in that inventory, including a repository working directory.

Skills are referenced by their stable UUID; global Skills library entries use `global:<id>`. Short names are not references. `validate_references` checks this format and requires an exact match in the supplied inventory. Renaming a skill does not change its identity.

## Local state (never in these files)

Kept in `projects.sqlite3`, not copied with a folder:

- whether each automation is enabled, and its next due time
- approvals: the hash of every input an automation reads, recorded when you enable it; any change disables the schedule until you enable it again
- which folder each repository ID means on this Mac
- runs, run events, artifacts and conversation associations

Run states: `queued`, `running`, `succeeded`, `failed`, `waiting_input`, `cancelled`, `interrupted`, `skipped`. A restart marks unfinished runs `interrupted` (or `cancelled` if a stop was requested), never `succeeded`. Up to 4 chat and background operations run at once, at most 2 of them background runs.

## Planned extensions

Designed in [ADR 0002](../adr/0002-automation-kernel.md); not in the code yet. Each adds fields to the formats above.

| | Extension | Adds |
|---|---|---|
| E1 | Packs | tool entrypoints inside a linked repository (`{base: "repository", id, path}`), pinned by commit and file hash |
| E2 | CLI tools | `interface: "cli"` with an argument template and pass/fail on exit code, for existing scripts that do not speak JSON |
| E3 | Requirements | `requires` on plugins and tools (`blender>=5.0`, `ffmpeg`, Python modules), checked before a run |
| E4 | Connections | `connections` declared by plugins and tools; secrets held in the Keychain and injected only into declaring tools |
| E5 | Effects | `effect:<kind>` permissions, `effects` with budgets on automations, `effectHandlers` on plugins |
| E6 | MCP | `mcp` server declarations on plugins |
| E7 | Agent tools | `tools` on agent executions: which tools an agent run may call |
