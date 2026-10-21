# Automation kernel: a small trusted core, everything else as plugins

Status: accepted. Definitions, references and runs are implemented; callables and authority are partly implemented. Effect capture, review and dismissal are implemented; delivery and observations remain planned, in the order below and in the [roadmap](../roadmap.md). [concepts.md](../concepts.md) tracks status per concept.

## Context

Inferay is a coding-agent workspace that also needs to automate work that is not code: brand content made in Blender, social posting, design in Spline and Figma, daily builds across a portfolio of apps, research. Origin, a sibling project, builds each such domain into its core: workflow graphs, posting, studio rendering and brand records each have dedicated code and keep their definitions in a local database, which makes them hard to see, share or change.

Inferay takes the opposite approach: new domains arrive as plugins without changing the core, and execution stays safe enough to leave running unattended.

## Decision

Inferay's core is a small kernel that owns seven concepts. Everything domain-specific is a plugin that *declares* what it needs; the kernel decides, executes and records.

| # | Kernel concept | Responsibility | Status |
|---|---|---|---|
| 1 | **Definitions** | Files are the source of truth for projects, resources, plugins, skills, tools and automations; the kernel validates them and keeps a rebuildable index. | file storage and rebuildable index implemented; migration/release gates tracked in the roadmap |
| 2 | **References** | Projects, repositories, packs and resources are addressed by stable IDs; local paths are local state; external inputs are pinned by commit or hash. | stable IDs and repository packs pinned by commit and entrypoint hash implemented |
| 3 | **Callables** | One abstraction for everything a run can invoke: agent providers, JSON tools, CLI tools, MCP tools. Granted per run, enforced in one place. | JSON, CLI and local stdio MCP tools, agents and per-run tool grants implemented; authenticated remote MCP connections planned (E6) |
| 4 | **Runs** | Triggers and events lead to admission, bounded execution and evidence (state, events, logs, artifacts). | built (manual, interval, calendar) |
| 5 | **Authority** | Permissions (`may`), approvals by input hash, machine requirements, connections holding secrets. | approvals, permission ceilings, machine requirements and partial provider/tool sandbox enforcement implemented; Keychain management implemented; privileged Git enforcement and approved credential access remain open |
| 6 | **Effects** | The only route for consequences outside the machine: intent, budget check, review, outbox record before sending, handler, receipt, reconcile. | intent capture, review inbox and dismissal implemented; budgets, delivery and receipts planned (E5) |
| 7 | **Observations** | Facts flowing back (analytics, build status, store numbers) as typed records that skills read and triggers react to. | planned |

Plugins contribute through these extension points only: skills, callables (tools, MCP servers), resource types, effect handlers, observers, and triggers on events. Chat is the authoring surface: an agent creates and edits plugins through the same validated operations as the UI.

### Invariants

1. A plugin never holds a secret, never acts outside its declared permissions, and never ships renderer code. It declares; the kernel executes. (This is the target invariant. Automation write/socket controls and local-tool GPU grants are implemented; read isolation, privileged Git actions and secret connections remain incomplete. Interactive chats and agent automations use ordinary local chat access; declared permissions govern library callables.)
2. Nothing runs on a schedule without a local approval bound to the hash of its inputs. Any change to an input, including a pulled file or an upstream pack commit, disables the schedule until a person enables it again. Copying or pulling a definition never enables it.
3. Every external consequence is an effect: within an approved budget, recorded before it is sent, receipted after, reconciled after a crash. No duplicate is acceptable.
4. Definitions are files; the database holds state and an index that can be rebuilt from them.
5. Every run is bounded in time, concurrency and size, and records honest failure states. An interrupted run is never reported as a success.
6. The kernel contains no domain vocabulary. Words like post, render, blender or app appear only in plugins (an effect kind is an opaque string to the kernel).

### Agent runs are regular local chats

Manual and scheduled agent runs submit their instructions through the same chat
runtime as interactive conversations. Each run owns one durable pane and provider
session, created before the task starts. The configured repository is its actual
working directory. Normal provider tools, local instructions, MCP configuration,
project context and skills remain available under the regular chat policy.

History opens that same conversation while it is running or after it finishes.
Removing its pane from the grid hides the conversation without clearing its
history or stopping the task; History restores the original pane identity.
Replies use normal steering or queuing, and later turns resume the saved provider
session. A restart interrupts the run record but preserves the chat for continuation.
The scheduler submits the initial task once; it does not own a second agent process.

Run admission, input approval, overlap handling, deadlines, cancellation and
required library-tool outcomes still apply. Agent runs consume one shared chat
execution permit. Logs and reported usage remain run evidence; the ordinary chat
transcript retains the full conversation. A provider completion is not independent
verification of the requested business outcome.

Agent access follows ordinary chat policy, not the automation's `may` list.
`may` still governs explicit library tools and tool-only automations, whose native
runner retains its process sandbox, connection grants and Git metadata controls.
Approving an agent automation authorizes a regular local chat. Its captured inputs
include `agentRuntime: "local-chat/1"`, so approvals issued for the old restricted
runner are invalidated and must be reviewed before another launch.

Effects remain a separate explicit interface for reviewed external actions;
ordinary chat shell/network access is not an effects enforcement boundary.

### Local library ownership

Plugins are intentionally created reusable libraries, not mandatory containers for every automation. Workflow definitions belong to Inferay projects, outside linked repositories. A project can have automations and no plugins; code, assets and usage skills can form a plugin with no automation. Related jobs may reuse one library.

All domains use the same manifest, discovery and callable contracts. Importing raw files is draft intake, not approval or execution. The UI presents purpose and capabilities first and files as drilldown. Global skills stay global; plugin-specific skills travel with their library. See [Plugins are local libraries](../concepts.md#plugins-are-local-libraries) for the authoring and ownership model, including what is still planned.

### Composition without a workflow engine

Multi-stage work (render, check, review, publish later) is built from small automations, effects with a `notBefore` time, and triggers on events (run finished, effect delivered, observation arrived, file added). The kernel does not model workflow graphs.

Agent-led composition can declare required library tools. The runtime checks that
each was invoked and its latest attempt passed before reporting a successful run.
Failures may be repaired and retried. This prevents a successful provider turn
from hiding a failed quality gate; it does not verify the semantic relationship
between a tool's input and the user's intended outcome. Shared skills use qualified
library references, so workflows can reuse knowledge without copying it.

### Domain repositories keep their own process

When a repository already defines its process (for example Point's AutoBuild guide and its own job orchestration), an Inferay automation runs an agent in that repository and follows it. Inferay schedules, authorizes and records; it does not reimplement the repository's operations.

## Consequences

- A new domain is a plugin folder. If it needs a kernel change, that change must be a generic concept added to this ADR, never domain-specific code.
- The proof set lives under `scripts/tests/fixtures/plugins/`. Current fixtures use the production Rust validator and runtime; proposed future shapes remain labeled planned. Each kernel concept lands with a reference plugin that exercises it.
- Not in scope: remote sync, multi-user coordination, running while the app is closed, plugin-supplied UI code. Sharing is by copying folders; Git on a project folder is optional.

## Delivery order

1. Definitions and references (the storage switch in the [roadmap](../roadmap.md)).
2. Callables: CLI tools, per-run tool grants, MCP declarations (E2, E7, E6).
3. Packs and requirements (E1, E3).
4. Connections (E4).
5. Effects with review inbox and outbox (E5), verified against local fixture handlers. Real publishing and account-specific workflows are deferred.
6. Events as triggers.
7. Observations.

Last, a surprise-domain test: build an automation for a domain nobody designed for, entirely from chat. It must need no kernel change.

### Local MCP uses the callable contract

A local MCP server is an invocation interface on an ordinary plugin tool. Its
program, entrypoint, companion files, input/output schemas and permissions are
reviewed with the library. The MCP tool name selects one callable; discovery does
not grant the rest of the server. Claude and Codex reach it through the same
per-run tool grants, keeping lifecycle, cancellation, sandboxing and evidence in
the native tool runner. Remote authenticated servers will require connections;
they do not inherit a user's ambient provider configuration.
