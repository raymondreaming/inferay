# Project definition files

Exact formats for the files that define a project. The types and validators are `native/core/src/project_files.rs` (tests: `native/core/tests/project_files.rs`); renderer types are exported through `@contracts`. This page describes that code. For what each concept means, read [concepts.md](../concepts.md).

**Status.** The formats and validators are implemented. The server reads and writes definitions as files; `projects.sqlite3` stores a rebuildable index and local execution state ([roadmap](../roadmap.md)). Sections marked *planned* are not in the code.

## Layout

```
<profile>/projects/<project-id>/
  project.json
  memory/<type>/<slug>.json
  memory/documents/                     original documents and images
  automations/<id>/automation.json       ordinary project jobs
  automations/<id>/skills/               private job support when needed
  plugins/<slug>/
    plugin.json
    README.md
    source/                             originals from raw folder intake
    src/, assets/                       reusable implementations and assets
    skills/<name>.md
    tools/<name>/tool.json + entrypoint
    automations/<name>.json
```

Plugins are deliberately created libraries. An ordinary automation does not require a plugin manifest. Raw folder imports preserve original bytes under `source/`; imported definitions there are not installed as jobs or tools.

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
| `archived` | optional boolean, defaults to false; retains archived projects without deleting their files |
| `description` | up to 8,000 bytes |
| `instructions` | up to 64,000 bytes; given to every agent run in the project |
| `repositories` | up to 512; each `id` a unique UUID, `name` 1–200 bytes, optional `remote` up to 2,048 bytes |

The local checkout path for a repository ID is local state, not part of this file.

### Saving project membership and local folders

The host's `saveProject` command accepts `definition` (the complete project definition), `expectedHash` (null only for creation), and `repositoryPaths` (a map from declared repository IDs to local directories). Omitted bindings are retained for repositories that remain declared. Removed repositories lose their local bindings. All supplied paths are canonicalized and checked before writing; two repository IDs cannot bind the same folder in one project. Referenced repositories must remain declared until their automation/tool references are changed.

The repository controls use the host-only `editRepository` command with `projectId`, `expectedHash` and an `add`, `relink` or `remove` change. Rust loads the current definition, assigns IDs for additions, checks automation and tool dependencies for removals, and delegates to the same validated project writer. The renderer does not reconstruct project definitions for membership edits.

Catalog responses include derived resource, skill and tool choices, repository dependencies, and plugin overviews. Definitions remain authoritative; these relationships are rebuilt in Rust and are not persisted. Plugin overviews retain invalid libraries for repair, exclude archived consumers from display, and include cross-library skill/tool consumers. Repository dependency checks include archived automations and repository-backed tools.

`GET /api/projects/history?projectId=…&before=…` returns only a `ProjectHistory` page, using the same cursor, active-run, artifact and effect rules as the initial catalog response. It does not rescan definitions or reload global skills. Run rows include native status/action/log projections. Browser pagination uses query keys scoped to project and cursor, with selection-scoped cursor state.


One native operation owns validation, definition writing and local binding updates. An unchanged definition preserves its source hash, and unchanged paths do not revoke approvals. Changed bindings require review before automations run again. Local paths never enter the portable definition, and removing a binding never deletes checkout files. Ordinary definition edits still use `saveDefinition`; it cannot set local bindings.

## memory/&lt;type&gt;/&lt;slug&gt;.json

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

### Machine requirements

Both `plugin.json` and `tool.json` accept an optional `requires` array (empty by default). Each declaration has at most 32 unique entries, each at most 256 bytes:

```json
{ "requires": ["blender>=5.0", "ffmpeg", "python3:numpy"] }
```

A bare program name requires an executable on PATH. `program>=major.minor` runs `program --version` and compares numeric version components, padding missing components with zero; programs without that version interface must use a presence requirement. `python3:module.name` checks module availability with that interpreter in isolated mode. Names are literal: no shell syntax, absolute paths or arbitrary check commands.

A run captures requirements from its owning library and selected tools, including libraries granted to an agent. Before starting its provider or tool, the runtime checks those captured requirements. Probes have a five-second deadline (30 seconds for the entire preflight), bounded output, no network and writes limited to temporary files. Missing dependencies produce a failed run naming the requirement; Inferay does not install anything automatically. Changing a requirement changes the approved input hash. Requirement checks that launch processes currently require the macOS sandbox adapter.

### Permissions

`read_repositories`, `write_repositories`, `commit`, `push`, `open_pr`, `network`, `gpu`, `write_project_files`. Any other value is refused. An automation's `may` must fit within its plugin's `may`; that ceiling is checked. Native commands and library tools on macOS read project files and selected repositories with `read_repositories` or `write_repositories`; repository-backed tools need that read authority too. Output and private temporary files are writable, and declared write permissions add repository/project roots. `commit` permits writes to reviewed Git metadata locations, `network` enables sockets, and `gpu` enables required graphics services. Providers route file access and mutations through this runner. Claude automation built-ins are disabled; its supported capabilities are Inferay MCP tools. Other platforms refuse native execution. Provider ambient-context isolation and independent `push`/`open_pr` enforcement remain incomplete. See [Provider runner](../architecture.md#provider-runner) for the current boundary, runtime read allowances and verification limits.

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


`gpu` grants local tools access to Apple Silicon Metal devices, surfaces, graphics
context registration and shader compilation services. It does not add socket or
filesystem write access. Version probes inherit this permission because graphics
applications can initialize their driver even during startup. Probes retain their
own scratch-only write boundary and receive no network permission. This adapter
is verified on Apple Silicon; other GPU backends remain unsupported. Provider
shell GPU policy is separate; use a granted Inferay tool for this execution path.

Local executable discovery preserves interpreter/virtual-environment aliases.
Aliases into a macOS `.app` bundle resolve to the actual executable so bundled
fonts, shaders and other resources can be found.

A skill in another library can be selected as
`plugin:<plugin UUID>:<skill UUID>`. A bare UUID selects a skill in the automation's
own folder; `global:<id>` selects a global skill. Qualified library references
capture the whole library in the approval hash and inject the selected skill's
instructions. Using knowledge alone does not require that library's executables
or repository binding; tool grants add those execution requirements. The automation
editor lists global, library and local skills with their source labels. Missing
selected references remain visible for repair or removal.

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
| `interface` | `json_stdin` (default), `cli`, or `{ "mcp": { "tool": "name" } } |
| `args` | up to 64, each up to 8,000 bytes; CLI placeholders occupy a whole argument |
| `timeoutSeconds` | 1–3,600 |
| `effectHandler` | optional `{ "kinds": ["example.deliver"], "retrySafety": "idempotent" }`. Requires JSON stdin; 1–32 nonempty kinds, at most 128 bytes each, without control characters. Retry safety must explicitly be `idempotent` or `never`. This declaration grants no execution or delivery approval. |
| `connections` | optional map of credential aliases to `{id, baseUrl, header, prefix}` request bindings; at most 16. The ID is local, and the HTTPS destination/header are reviewed. Aliases start with an uppercase letter and use uppercase letters, digits and underscores (64 characters maximum). Selected metadata participates in approval. With network permission, tools use the invocation-scoped `INFERAY_CONNECTIONS_URL` relay for authenticated GET requests; they never receive the raw key. See [Connections](../connections.md). |
| `inputSchema`, `outputSchema` | the supported JSON Schema subset below |

The default `json_stdin` interface runs `program entrypoint ...args`: input is JSON on stdin, output is JSON on stdout, and diagnostics go to stderr.

For a local stdio MCP server, use `interface: { "mcp": { "tool": "report" } }`.
Inferay launches `program entrypoint ...args` inside the same approved process boundary.
Arguments stay literal. The named tool is discovered through `tools/list`, then called
with the validated input. Server names are not looked up in personal provider settings.
Both providers call it through their existing `inferay_tools` grants; an automation can
also invoke it directly like any other local tool.

MCP results have the shape `{ "response": <MCP result>, "artifacts": [<relative paths>] }`;
`outputSchema` validates that wrapper. The complete response is saved as
`mcp-response.json` in the run output; that filename is reserved and collisions fail.
Text, image and structured content remain in the MCP response. Output files use the
ordinary artifact collector. Protocol messages and diagnostics are retained in the
run logs, including tool errors. A server error, missing tool, timeout, invalid
response or output limit fails the call. Each stream is limited to 1 MiB, discovery
to 32 pages, and the exchange to 1,000 incoming messages. The tool timeout includes
initialization and discovery. Cancellation stops the server process group.

Supported negotiated versions are `2024-11-05`, `2025-03-26` and `2025-06-18`.
Inferay grants no sampling, elicitation or filesystem-root capabilities to the
server. Local MCP processes receive the ordinary private tool environment and
permissions; importing their files does not launch them. Remote authenticated MCP
connections remain planned.

For an existing script, use `interface: "cli"`. Its `args` must contain exactly one `{entrypoint}` argument; place it after any interpreter flags. Each `{input.field}` argument reads a top-level input string, number or boolean. Missing, null or structured values fail preflight. Fields use letters, digits, underscores or hyphens. Values are passed as individual arguments, never split, re-expanded or interpolated through a shell. Stdin is closed. Exit zero returns `{ "stdout": "…", "stderr": "…", "exitCode": 0 }`, checked against `outputSchema`; nonzero exit fails the run. Both streams are retained under the run's logs, including on failure, with the existing 1 MiB limit per stream.

Use `{output}` for the run's output directory, or `{output}/render` for an output
path or filename prefix inside it. Output paths cannot traverse upwards or contain
another placeholder. These runtime arguments stay distinct from input strings:
an input value containing `{output}` is passed literally. For example,
`["{entrypoint}", "--out", "{output}/render"]` passes a run-specific absolute path
without a shell or a machine path in the definition.

After a successful CLI exit, regular files under that output directory become
`artifacts` in the result and are indexed in run history. Nested directories are
supported; symlinks and special files fail the run. Collection is bounded to 100
files, 1,000 filesystem entries and 32 directory levels. Existing artifact limits
apply (50 MB per file). Failed commands retain logs and files on disk, but do not
register their partial output as successful artifacts. JSON-stdin tools continue
to name their artifacts explicitly in their response.

```json
{ "schema": "inferay.tool/1", "id": "7a41…", "name": "copy-check",
  "interface": "cli", "program": "python3", "entrypoint": "copy_check.py",
  "args": ["{entrypoint}", "--caption", "{input.caption}"], "timeoutSeconds": 300,
  "inputSchema": { "type": "object", "properties": { "caption": { "type": "string" } }, "required": ["caption"] },
  "outputSchema": { "type": "object" } }
```

### Repository-backed tools (packs)

A tool can keep its code in a linked repository by adding `pack`:

```json
{
  "entrypoint": "content/scripts/copy_check.py",
  "pack": {
    "repositoryId": "03f01791-60c3-58e0-97a6-eaae9dc5f78c",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

The hashes above are illustrative. `commit` is the full Git commit ID; `sha256` is
the entrypoint's SHA-256. The repository ID must be declared by the project and
bound locally to the checkout root. `entrypoint` is relative to that root; the
working directory is the checkout root. Without `pack`, paths remain relative to
the tool's own folder.

Approval capture and run admission require HEAD to match the pin, a clean checkout
(including no untracked or ignored files), and entrypoint bytes matching both the
SHA-256 and the committed blob. Sparse/assume-unchanged index entries and submodules
are refused. Tracked symlinks may resolve to tracked content inside the same
checkout; outside paths, Git metadata, missing targets and cycles are refused.
Entrypoints themselves must use their real path, without symlink components.
Use a dedicated clean checkout for a kit that has
local caches or build outputs. Checks do not fetch, checkout, reset or alter Git
configuration. A mismatch prevents execution and invalidates the affected approval.
Both direct tools and agent tool grants use this resolver. Source stays in the
checkout; per-run inputs retain an entrypoint copy for execution evidence. Outputs
belong in `INFERAY_RUN_OUTPUT`, and the normal tool sandbox still applies.

For Blender, arguments can be `["--background", "--python", "{entrypoint}", "--", "{input.scene}"]`. All tool interfaces use the same required macOS process sandbox. Tools receive PATH, HOME and locale variables plus Inferay’s explicit run variables and private temporary directory; arbitrary ambient environment variables are omitted. Machine requirements are checked before execution; additional platform adapters remain planned.

Environment: `INFERAY_PROJECT_DIR`, `INFERAY_RUN_ID`, `INFERAY_RUN_OUTPUT` (write artifacts here).

**JSON Schema subset.** Offline only: `type`, `properties`, `required`, `items`, `enum`, boolean `additionalProperties`, and numeric, length and count bounds. Other keywords are refused; remote references are never fetched.

## Tools available to automation agents

An agent execution can include `tools: [{ "pluginId": "<plugin UUID>", "toolId": "<tool UUID>" }]` (default empty, maximum 32 distinct grants). The pair identifies an entrypoint inside a reusable library, including a library separate from the automation. The library’s declared permissions must fit within the automation’s permissions. Missing or invalid tools prevent approval.

The automation editor exposes these grants under Context & execution → Configure → Library tools. Claude and Codex receive the same `inferay_tools` interface: `{"action":"list"}` lists only granted tools and their input schemas; `{"action":"call","pluginId":"…","toolId":"…","input":{}}` runs one. Approval captures the entire referenced library, including companion scripts and binary assets. Each invocation rechecks current approved inputs. Outside edits require review again.

Calls run serially, with at most 64 calls per agent run. Each call retains its input, entrypoint, stdout, stderr and result event under the parent run; returned artifacts become parent-run artifacts. Ending or cancelling the agent closes the tool grants and stops an active helper. These controls govern Inferay’s tool interface; they do not yet sandbox an agent’s own shell.

## Automation proposals from chat

An ordinary automation is saved at `automations/<id>/automation.json`. A plugin may also contain automations at `plugins/<slug>/automations/<name>.json`; a standalone job does not create a plugin.

For standalone jobs, agents call `inferay_projects` with `saveDefinition`. The tool validates the complete definition, references and expected file hash, then returns a proposal card without writing. Accepting the card uses the same validated writer and checks the hash again. New files require `expectedHash: null`; updates require the current `sourceHash` from the catalog. Saving does not approve execution or enable a schedule.

Chat decisions are local records in `project_proposals`, keyed by the transcript message identity and a hash of its exact command. Save and decline decisions survive reopening a conversation. A declined card cannot later save, and a saved card never reapplies its files. An agent-generated replacement proposal needs a new message identity. Host edits preserve the original command hash and target; the save receipt also records the exact accepted command. Recovery resumes those accepted bytes even when the renderer reloads the original card. Edits cannot redirect the project or library, change creation identity, or replace an update’s expected hash. Save records an intent before publishing; if the app exits after publication, the expected output hashes identify the completed write on recovery. Recovery refreshes the index before reporting success, preserving approval invalidation. A preview does not create a decision record.

Library discovery uses `readPlugin`. Its inventory includes per-file hashes and a whole-library `sourceHash`, including binary assets. Reading or previewing never executes a plugin. Agents propose whole-library changes with `updatePlugin`: `projectId`, `slug`, `expectedHash` from the inventory, `files` containing complete text for additions/replacements, and `remove` listing explicit file paths. Unmentioned files retain their bytes, including binary assets. The manifest ID stays unchanged. Preview validates the complete resulting project without writing. Acceptance rechecks the whole-library hash, stages the complete candidate and atomically swaps directories on macOS and Linux; unsupported platforms refuse publication. Changes revoke execution approvals through the index refresh. The library editor also supports individual text edits with per-file hashes.

## Automation definition


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

Agent tool grants accept `required: true` alongside `pluginId` and `toolId`.
Required tools must be called, and their latest attempt must succeed before the
agent run can finish successfully. A skipped check, failed call, or invalid retry
cannot be hidden by the provider's final response. A successful retry restores the
check. Omitted `required` means optional, preserving recoverable tool calls.
The editor exposes these grant modes as Not available, Available and Must pass.
Required grants are included in approved inputs, and duplicate tool identities
are refused even when their `required` values differ. This validates tool outcomes;
it does not prove an agent selected the right inputs or satisfied brand goals.

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

## Extension status

Designed in [ADR 0002](../adr/0002-automation-kernel.md). E1–E3, E4 (authenticated GET relay), E6 (local stdio) and E7 are implemented; E5 covers intent capture, review and handler declarations, while delivery is planned. See the [roadmap](../roadmap.md) for per-extension status.

| | Extension | Adds |
|---|---|---|
| E1 | Packs | tool entrypoints inside a linked repository (`{base: "repository", id, path}`), pinned by commit and file hash |
| E2 | CLI tools | Implemented: `interface: "cli"`, `{entrypoint}` / `{input.field}` arguments, durable streams and failure on nonzero exit |
| E3 | Requirements | `requires` on plugins and tools (`blender>=5.0`, `ffmpeg`, Python modules), checked before a run |
| E4 | Connections | `connections` declared by plugins and tools; secrets held in the Keychain and injected only into declaring tools |
| E5 | Effects | `effect:<kind>` permissions, `effects` with budgets on automations, `effectHandlers` on plugins |
| E6 | MCP | Local stdio servers use the existing tool definition and per-run grants; remote authenticated connections remain planned |
| E7 | Agent tools | `tools` on agent executions: which tools an agent run may call |

## Plugin proposal review

The chat card’s **Review changes** action validates the proposed package and compares it with the current library without writing files, decision receipts or approvals. It shows added, changed and removed files, before/after text where available, and current/proposed permissions. Binary and oversized files retain their content hashes but have no text preview. An update must still match its expected whole-library hash; outside changes reject the comparison and the eventual save. Saving files and approving execution remain separate actions.

**Edit proposal** opens the proposed text files in a draft editor. Files can be adjusted, added or omitted; update proposals can also remove existing files or keep a proposed removal. Review validates the complete candidate before displaying the comparison. Unsaved edits remain local to the card; accepting the reviewed draft records and writes the edited command atomically through the existing package writer.

## Draft artifacts

Tools and agents can return a structured draft as a run artifact named
`<name>.draft.json`. History displays its title, literal text and labeled details;
**View source** retains access to the original JSON. This is a preview format,
with no publication or scheduling behavior. For example:

```json
{
  "schema": "inferay.draft/1",
  "draft": {
    "title": "Launch announcement",
    "text": "A new release is ready.\n#launch",
    "details": [{ "label": "Channel", "value": "Instagram" }]
  }
}
```

The format is domain-neutral: details can describe a channel, audience, subject,
or another aspect of the draft. `details` is optional. Unknown fields and schema
versions are rejected for preview; the source remains readable. The preview is
limited to 1 MiB, a nonblank title of at most 512 bytes, nonblank text, and at most
32 details with nonblank labels of at most 128 bytes and values of at most 4096
bytes. Draft text renders literally, including HTML and Markdown punctuation.
Ordinary JSON files keep their existing source or table views.

## Effect intent artifacts

A tool or agent can propose an external action with a retained `.json` artifact:

```json
{
  "schema": "inferay.effect/1",
  "key": "weekly-update-2026-10-12",
  "kind": "message.publish",
  "target": "test-account",
  "payload": { "text": "Draft update" },
  "notBefore": null
}
```

`kind` and `target` are opaque to the core. `key` identifies one intended action
within a project. Keys and kinds have a 128-byte limit; targets have a 512-byte
limit. They must be nonempty and contain no control characters. `payload` is an
object up to 64 KiB; the complete artifact is limited to 70,000 bytes.
`notBefore` is optional and uses nonnegative Unix milliseconds. It does not start
a timer or authorize delivery.

Successful run completion validates these artifacts and records immutable intent
bodies in SQLite's operational `effect_intents` table, in the same transaction as
artifact indexing. Identical retries reuse the original intent. Different contents
under the same project/key fail the run and roll back its new artifact/intent rows.
History shows the original run's intents as **Pending review · Not sent**.
Its **Needs review** inbox lists pending proposals independently of run pagination,
filtered to the current project or automation. Older reviews have their own cursor.
**View intent** reads the canonical stored payload, not the source artifact, which
may have been edited since capture. **Dismiss intent** records a hash-bound local
decision in `effect_dismissals`. Mismatched hashes are refused, repeated dismissal
preserves the original timestamp, and dismissal survives restart. Dismissed intents
remain visible as **Dismissed · Not sent** and cannot be replaced by retrying the
same key.

This supports proposal capture, viewing and dismissal. Outbox, receipt and recovery storage exists, but handler
binding, budgets, approval controls and the delivery/reconciliation worker remain planned. No external request is made by
capturing or viewing an intent. Never include credentials in an intent payload.
