# Automation kernel: a small trusted core, everything else as plugins

Status: accepted. Concepts 1, 2 and 4 are partly built; the rest is planned, in the order below and in the [roadmap](../roadmap.md). [concepts.md](../concepts.md) tracks status per concept.

## Context

Inferay is a coding-agent workspace that also needs to automate work that is not code: brand content made in Blender, social posting, design in Spline and Figma, daily builds across a portfolio of apps, research. Origin, a sibling project, builds each such domain into its core: workflow graphs, posting, studio rendering and brand records each have dedicated code and keep their definitions in a local database, which makes them hard to see, share or change.

Inferay takes the opposite approach: new domains arrive as plugins without changing the core, and execution stays safe enough to leave running unattended.

## Decision

Inferay's core is a small kernel that owns seven concepts. Everything domain-specific is a plugin that *declares* what it needs; the kernel decides, executes and records.

| # | Kernel concept | Responsibility | Status |
|---|---|---|---|
| 1 | **Definitions** | Files are the source of truth for projects, resources, plugins, skills, tools and automations; the kernel validates them and keeps a rebuildable index. | formats built; storage switch in progress |
| 2 | **References** | Projects, repositories, packs and resources are addressed by stable IDs; local paths are local state; external inputs are pinned by commit or hash. | IDs built; pinning planned (E1) |
| 3 | **Callables** | One abstraction for everything a run can invoke: agent providers, JSON tools, CLI tools, MCP tools. Granted per run, enforced in one place. | JSON tools and agents built; CLI, MCP, per-run grants planned (E2, E6, E7) |
| 4 | **Runs** | Triggers and events lead to admission, bounded execution and evidence (state, events, logs, artifacts). | built (manual, interval, calendar) |
| 5 | **Authority** | Permissions (`may`), approvals by input hash, machine requirements, connections holding secrets. | approvals and the permission ceiling built; enforcement on agent runs (providers run with full access today), requirements and connections planned (E3, E4) |
| 6 | **Effects** | The only route for consequences outside the machine: intent, budget check, review, outbox record before sending, handler, receipt, reconcile. | planned (E5) |
| 7 | **Observations** | Facts flowing back (analytics, build status, store numbers) as typed records that skills read and triggers react to. | planned |

Plugins contribute through these extension points only: skills, callables (tools, MCP servers), resource types, effect handlers, observers, and triggers on events. Chat is the authoring surface: an agent creates and edits plugins through the same validated operations as the UI.

### Invariants

1. A plugin never holds a secret, never acts outside its declared permissions, and never ships renderer code. It declares; the kernel executes. (Enforcement for agent runs is not built yet: providers currently run with full access.)
2. Nothing runs on a schedule without a local approval bound to the hash of its inputs. Any change to an input, including a pulled file or an upstream pack commit, disables the schedule until a person enables it again. Copying or pulling a definition never enables it.
3. Every external consequence is an effect: within an approved budget, recorded before it is sent, receipted after, reconciled after a crash. No duplicate is acceptable.
4. Definitions are files; the database holds state and an index that can be rebuilt from them.
5. Every run is bounded in time, concurrency and size, and records honest failure states. An interrupted run is never reported as a success.
6. The kernel contains no domain vocabulary. Words like post, render, blender or app appear only in plugins (an effect kind is an opaque string to the kernel).

### Composition without a workflow engine

Multi-stage work (render, check, review, publish later) is built from small automations, effects with a `notBefore` time, and triggers on events (run finished, effect delivered, observation arrived, file added). The kernel does not model workflow graphs.

### Domain repositories keep their own process

When a repository already defines its process (for example Point's AutoBuild guide and its own job orchestration), an Inferay automation runs an agent in that repository and follows it. Inferay schedules, authorizes and records; it does not reimplement the repository's operations.

## Consequences

- A new domain is a plugin folder. If it needs a kernel change, that change must be a generic concept added to this ADR, never domain-specific code.
- The proof set in `~/Developer/inferay-proofs` (four real capabilities as definition files, a validator and negative tests) is the starting conformance suite; each kernel concept lands with a reference plugin that exercises it.
- Not in scope: remote sync, multi-user coordination, running while the app is closed, plugin-supplied UI code. Sharing is by copying folders; Git on a project folder is optional.

## Delivery order

1. Definitions and references (the storage switch in the [roadmap](../roadmap.md)).
2. Callables: CLI tools, per-run tool grants, MCP declarations (E2, E7, E6).
3. Packs and requirements (E1, E3).
4. Connections (E4).
5. Effects with review inbox and outbox (E5).
6. Events as triggers.
7. Observations.

Last, a surprise-domain test: build an automation for a domain nobody designed for, entirely from chat. It must need no kernel change.
