# Inferay harness progress — October 7, 2026

This is the requested checkpoint checklist for the preceding 24 hours, through
commit `b7ff6a72`. Git contains 122 commits in that window, including the other
agent's Memory work. This document records that checkpoint; [the roadmap](../roadmap.md)
remains the current planning authority.

Checked items are implemented. They do not imply that every release gate or
native desktop interaction has passed. Specific verification limits and unfinished
work are retained below.

Scope: build the generic local Inferay harness. Real posting, production account
setup and individual production workflows are deferred. Work is committed on
`main`; nothing is pushed as part of this checkpoint.

## 1. Project structure

- [x] Projects have durable identity independent of repository paths and can link zero or many repositories.
- [x] Establish four project areas: Memory, Plugins, Automations and Repositories, alongside chats.
- [x] Consolidate Resources and Files into Memory.
- [x] Remove the standalone Tools page; tools belong inside libraries.
- [x] Separate plugins from automations. A daily research job does not automatically need a plugin.
- [x] Keep workflow definitions in Inferay's project folder while linked repositories retain their implementations and process guides.
- [x] Keep the core generic: Blender, browser automation, research and API integrations are plugin content.
- [x] Defer real posting and account setup; use disposable local fixtures for delivery work.
- [x] Remove the unnecessary standalone Astro site.

A project groups one effort. Memory holds knowledge, plugins hold reusable
implementations, automations schedule approved work, and runs retain evidence.

## 2. File-owned definitions and local state

- [x] Define portable formats for projects, records, plugins, skills, tools and automations.
- [x] Add native format validation.
- [x] Switch the runtime to file-owned definitions.
- [x] Remove the retired SQLite definition-writing path.
- [x] Make definition tables rebuildable indexes.
- [x] Keep approvals, enabled schedules, next-run times, runs, events, artifact indexes, conversation associations and machine-specific repository paths in SQLite.
- [x] Require expected hashes for conflict-aware writes; refuse stale writes.
- [x] Stage and atomically publish validated files and library bundles.
- [x] Keep invalid definitions visible and repairable with their errors.
- [x] Preserve stable IDs through migration.
- [x] Add disposable-profile migration and database-rebuild checks.
- [x] Rehearse migration without changing live data.
- [x] Separate global custom-skill storage from the project index.

| Files own | Local database owns |
|---|---|
| Project identity and instructions | Run history and events |
| Memory documents and records | Search and definition indexes |
| Plugin code, documentation and assets | Approval hashes and timestamps |
| Tool, skill and automation definitions | Enabled schedules and next-run times |
| Portable repository IDs | Checkout paths on this Mac |

Deleting the project database can rebuild definitions. It cannot reconstruct
lost run history, approvals or schedule state.

## 3. Approval and autosave

- [x] Remove automatic re-enabling after autosave.
- [x] Bind execution approval to captured inputs.
- [x] Disable affected schedules after outside edits.
- [x] Revoke dependent automations after shared input changes.
- [x] Include selected library files and supporting assets in capture.
- [x] Include repository-pack identity and resolved Git metadata locations.
- [x] Include selected connection revisions and credential-request destinations.
- [x] Recheck approval at queue admission.
- [x] Let Run now reuse valid approval and request review when inputs change.
- [x] Keep repair separate from authorization; repairing a file does not restore approval.
- [x] Persist proposal decisions across chats and restarts.
- [x] Recover interrupted proposal saves against the published file hashes.

## 4. Plugins as reusable local libraries

- [x] Support libraries containing multiple scripts, modules, documentation, templates and binary assets.
- [x] Make skills, tools and automations optional contents.
- [x] Add raw folder/file intake while preserving originals.
- [x] Let agents inspect libraries and read their text files.
- [x] Propose complete new libraries from chat.
- [x] Propose reviewed updates to existing libraries.
- [x] Preserve unmentioned binary assets during updates.
- [x] Review text changes, additions, removals, hashes and permissions before saving.
- [x] Edit proposals before acceptance.
- [x] Persist Save and Decline decisions.
- [x] Keep invalid libraries visible for repair.
- [x] Show requirements, problems, contents and recent activity in library presentation.
- [x] Show standalone automations that use a library.
- [x] Preserve editor identity across refreshes and protect unsaved edits from dismissal.
- [x] Finish library refresh before reporting a saved edit as complete.
- [ ] Finish verification of the complete arbitrary-folder → chat organization → reusable-library experience.

Reusable Blender helpers form a library; a morning render job is an automation
using it. Several jobs can share one implementation. The import, inspection,
proposal and update pieces exist, but the complete organization experience needs
further verification.

## 5. Chat-based authoring

- [x] Distinguish automation requests from skill requests.
- [x] Propose standalone automations without unnecessary plugin wrappers.
- [x] Present complete plugin proposals as one reviewable bundle.
- [x] Reuse existing global skills.
- [x] Guide agents toward calendar triggers, repository IDs and explicit permissions.
- [x] Give Claude and Codex access to the shared project-tool dispatcher.
- [x] Use a scoped local MCP bridge for Claude's Inferay tools.
- [x] Make proposal-card decisions durable.
- [x] Verify a chat-created library through approval, execution, retained output and invalidation after editing.

Acceptance publishes definitions through the validated storage path. A prose
claim that something was created is not a saved definition or execution approval.

## 6. Workspace and automation interface

- [x] Build project-oriented workspace navigation.
- [x] Reuse shared controls across chat, skills and automation editors.
- [x] Add timezone-aware calendar scheduling.
- [x] Add persistent automation editing and autosave.
- [x] Improve automation proposal cards and review controls.
- [x] Consolidate context controls for skills, records, repositories and library tools.
- [x] Refine the automation sidebar and History layout.
- [x] Restore native title-bar dragging.
- [x] Stabilize project and library identity across refreshes.
- [x] Cover project reordering, repository navigation and conversation-grid deletion in browser regression checks.
- [x] Publish generated renderer contracts safely when exports overlap.
- [ ] Finish a comprehensive native desktop interaction and visual-polish pass.

## 7. Run-to-chat continuation

- [x] Open recorded automation progress in the chat grid.
- [x] Allow opening an active run before completion.
- [x] Open active runs as snapshots of recorded progress.
- [x] Continue completed agent runs using their retained provider session.
- [x] Focus the existing chat when reopening the same run.
- [x] Preserve provider, model and reasoning settings when creating the chat.
- [x] Preserve later user changes when reopening that chat.
- [x] Offer continuation only when a retained agent transcript exists.
- [x] Refresh project membership so the conversation appears in the grid.

An active-run chat is a snapshot, not a live takeover of the running provider.

## 8. History and honest results

- [x] Add project-wide History and per-automation filtering.
- [x] Show upcoming schedules using saved next-run times displayed locally.
- [x] Keep queued/running work visible even when finished runs fill the history window.
- [x] Improve result presentation and access.
- [x] Handle preflight failures without assuming a complete execution snapshot.
- [x] Retain captured inputs, logs, artifacts and stop controls.
- [x] Distinguish “Agent finished” from independently verified task success.

A provider turn ending normally does not prove a build, research task or delivery
succeeded. The week-long production-job gate has not been met.

## 9. Artifact viewers

- [x] Render Markdown reports using shared formatting.
- [x] Preview retained images directly from History.
- [x] Play and seek video artifacts.
- [x] Preview CSV and TSV as tables.
- [x] Preview JSON arrays of objects as tables.
- [x] Preview structured drafts.
- [x] Preserve access to original source text.
- [x] Bound previews by file size and row/column limits.
- [x] Collect CLI-generated files as run artifacts.
- [x] Allow explicit saving of run outputs into Memory.

Table previews do not execute formulas or markup from cells.

## 10. Provider usage

- [x] Capture provider-reported token usage.
- [x] Persist usage while runs are active and retain emitted usage after cancellation.
- [x] Avoid double-counting cumulative Codex updates.
- [x] Display input, output and cached-input counts.
- [x] Display provider-reported cost when supplied.
- [x] Verify retained usage with real-provider checks.
- [ ] Finish cost estimates for providers that do not report cost.

Usage the provider never emits remains unknown. Runs use the configured provider
CLI and authentication; displayed usage does not guarantee a particular account's
billing treatment.

## 11. Reusable script and MCP execution

- [x] Support JSON-on-stdin tools.
- [x] Add ordinary CLI scripts and typed argument templates.
- [x] Avoid shell expansion of substituted arguments.
- [x] Fail tool execution on a nonzero exit.
- [x] Retain stdout, stderr, results and artifacts.
- [x] Grant agents explicit library tools.
- [x] Require selected tools to succeed when marked required.
- [x] Run local stdio MCP callables through the same native runner.
- [x] Apply approval, timeout, cancellation, sandbox and output bounds to MCP calls.
- [x] Verify real Claude and Codex runs calling granted library tools.
- [x] Verify real Claude and Codex runs calling local MCP tools.
- [ ] Add authenticated remote MCP.

## 12. Requirements and repository-backed tools

- [x] Declare program/module requirements such as `blender>=5.0`, `ffmpeg` and Python modules.
- [x] Check requirements before execution and report specific missing dependencies.
- [x] Isolate dependency probes.
- [x] Execute tools from linked repositories pinned by full commit and entrypoint hash.
- [x] Require a verified clean checkout and refuse unreviewed content.
- [x] Verify Origin's actual caption checker from a disposable linked checkout.
- [x] Run a real Blender fixture with explicit GPU permission.
- [x] Retain beauty/depth images as artifacts.
- [x] Verify a scheduled Codex fixture using the required checker and renderer.
- [ ] Verify sustained daily operation, production creative quality and the Spline gate.

These are representative execution proofs, not completed production workflows.

## 13. Automation execution boundaries

- [x] Separate automation policy from interactive-chat policy.
- [x] Route automation commands through Inferay's native runner.
- [x] Restrict provider-native tools that could bypass that runner.
- [x] Sandbox native tool execution on macOS.
- [x] Restrict writes to approved locations and reads to selected inputs and required runtime locations.
- [x] Refuse socket access without network permission in tested paths.
- [x] Require commit permission for Git metadata writes.
- [x] Capture/check separate Git directories and linked-worktree metadata.
- [x] Test symlinks, hard links and changed metadata bindings.
- [x] Give tools and dependency probes private HOME/XDG environments.
- [x] Remove ambient environment variables and automatic global Git configuration.
- [x] Clean up process groups and check cancellation before/during execution.
- [x] Record launched PIDs without depending on child-written logs.
- [x] Disable implicit project instructions in Codex automations.
- [x] Exclude tested personal Codex instruction overrides.
- [x] Exclude unselected personal/project Codex skills after reproducing leakage.
- [x] Force native tool calls in fixtures to test refusal independently of model cooperation.
- [x] Run real-provider write, commit and network-refusal probes.
- [ ] Enforce independent push and pull-request authority.
- [ ] Complete provider ambient-context auditing.
- [ ] Implement equivalent execution adapters for additional platforms.
- [ ] Complete a comprehensive security audit.

These checks establish the named boundaries on tested provider versions. They
do not establish that every possible bypass has been eliminated.

## 14. Credentials and connections

- [x] Manage project credentials in macOS Keychain, with add/replace/remove controls.
- [x] Return metadata rather than secrets from credential APIs.
- [x] Reject stale updates using revisions.
- [x] Bind selected revisions into approval and revoke approval after rotation.
- [x] Show requested connections in review.
- [x] Review HTTPS destination and header configuration as inputs.
- [x] Provide an invocation-scoped authenticated GET relay.
- [x] Keep raw keys out of tool environments.
- [x] Refuse redirects, oversized responses and recognized credential echoes.
- [x] End relay access with the invocation.
- [x] Verify Keychain and temporary HTTPS relay behavior.
- [ ] Complete real-service and authenticated remote-MCP checks.

The implemented relay supports reviewed GET requests. It is not a general posting
or arbitrary authenticated-write facility.

## 15. Generic effects foundation

- [x] Define `inferay.effect/1` intent artifacts.
- [x] Capture canonical intents transactionally with successful-run artifacts.
- [x] Deduplicate identical project/key proposals and reject conflicting reuse.
- [x] Add a Needs review inbox with independent pagination and project/automation scope.
- [x] Keep older pending proposals discoverable.
- [x] Review canonical saved payloads instead of mutable source artifacts.
- [x] Support hash-bound persistent dismissal.
- [x] Add durable outbox storage primitives.
- [x] Add approval revisions, atomic count reservations and earliest-delivery times.
- [x] Store immutable receipts.
- [x] Recover interrupted attempts as uncertain and retain their capacity reservation.
- [x] Persist cancellation requests and display honest delivery states.
- [x] Accept later receipts after stop requests when the outcome was uncertain.
- [x] Test concurrent admission and a local destination that commits before losing its reply.
- [x] Let the shared callable runner accept explicit authority without an automation snapshot.
- [x] Declare supported handler kinds and explicit retry safety.
- [x] Refuse declared handlers through ordinary automation execution and agent grants.
- [ ] Bind selected handlers to effects.
- [ ] Add delivery approval and limit controls.
- [ ] Implement the production delivery/reconciliation worker.
- [ ] Prove complete crash recovery end to end through that worker.

No real posting occurred. The local destination fixture exercises storage and
recovery primitives directly; it does not yet prove the complete delivery path.
Declaring a handler never grants delivery authority. Ordinary-tool admission
checks do not prevent source execution through an otherwise permitted shell.

## 16. Memory work from the shared history

- [x] Add file-backed notes and searchable indexing.
- [x] Save chat material to Memory.
- [x] Provide agent memory access and track notes read by runs.
- [x] Make Memory the project knowledge area.
- [x] Add an interactive graph with pan, zoom, fit, search and type filters.
- [x] Group items by source chat/run and connect note links.
- [x] Add drop/paste intake and a details panel.
- [x] Navigate back to source chats.
- [x] Fix graph production compilation.

These include the other agent's landed commits. Every Memory interaction was not
independently rerun in the final effects batch. The separately staged
`docs/memory.md` and `docs/storage.md` edits were left untouched.

## 17. Verification and documentation

- [x] Expand disposable-profile native tests and browser project-workflow checks.
- [x] Add real Claude/Codex runtime gates and deterministic local provider fixtures.
- [x] Move reusable proof fixtures into the repository.
- [x] Document formats, authority boundaries, connections, effects and roadmap gates.
- [x] Commit focused batches directly on main.

Final batch (`b7ff6a72`):

- 9 core file-contract tests passed.
- 1 native regression covering direct and granted handler refusal passed.
- 6 effect persistence/recovery tests passed.
- Renderer contracts regenerated.
- TypeScript checking passed.

No app-server restart or external delivery was performed for this batch.

## Remaining overall

- [ ] Complete generic effect binding, approval, execution and reconciliation.
- [ ] Close remaining permission boundaries.
- [ ] Finish authenticated remote MCP.
- [ ] Add event-driven triggers and observations.
- [ ] Verify an unfamiliar-domain workflow built from chat without changing the core.
- [ ] Finish native desktop interaction and visual-polish checks.
- [ ] Reconcile older documentation status statements with newer implementation.
- [ ] Background execution while Inferay is closed remains future work.

The foundation now includes file-backed projects, reusable libraries, approved
automation execution, inspectable output and run-to-chat continuation. The broader
roadmap is not complete.
