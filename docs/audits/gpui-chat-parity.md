# Interactive chat parity audit

Reference: Solid conversation UI at `275d1a66^`; target: GPUI only. Shared Rust behavior remains the source of truth. This audit distinguishes provider event ingestion from native rendering: adding a loader cannot recover a dropped event.

| Previous behavior / source | Native state and work |
|---|---|
| `ToolTimeline.tsx`: connected milestones, source, label, detail, expansion, copy | Connected timeline and source labels render. This pass adds compact visible output previews and copy from expanded output. |
| Provider commentary and tool events | Assistant deltas render. MCP/dynamic/web-search items were restored in the prior pass. This pass preserves raw function/custom calls and results and Claude tool-result payloads, keyed by call ID. |
| Progress while waiting | This pass explicitly requests provider summaries and streams summary text into persisted transcript rows. Only provider-supplied summaries are displayed; no invented activity or raw internal reasoning. |
| Plans / roadmap | This pass handles `turn/plan/updated`, retaining one updating checklist per turn with pending, active, and completed steps plus explanation. |
| `ChatRenderRow.tsx`: grouped edits and checkpoints | Shared edit metadata and native diff cards exist. Full grouped-edit presentation and checkpoint revert controls still need native interaction work. |
| `ToolMessage.tsx`: questions and MCP elicitation | Shared parsers remain. Native specialized answer/consent controls are still missing; generic expandable output is not equivalent. |
| `SystemMessage.tsx`: skills, automations, plugins, goals, command cards | Summary cards exist. Proposal apply/reject, review state, and full details remain incomplete. Must reuse existing server APIs and approval semantics. |
| `AssistantMessagePart.tsx`: inline skill proposals | Native assistant Markdown does not yet split all proposal segments into actionable cards. |
| `Bubble.tsx`: copy, save to memory, side questions | Assistant copy exists; tool copy added here. Save-to-memory and dedicated side-question presentation remain gaps. |
| Rich Markdown, file links, embedded apps | Native Markdown/highlighting exists. Embedded interactive apps, full link/file actions, and matched visual behavior remain gaps. |
| Viewport / interaction | Follow-tail and virtualized retained transcript exist. Verify new row heights, output expansion, draft preservation, and manual scroll position during streaming. |

## Regression checks

- Summary deltas update a visible transcript row before the final response.
- Plan updates replace the same turn's checklist rather than append stale plans.
- Overlapping tool results update their own calls and retain input.
- Ordinary user prompt echoes do not become tool results.
- Native timeline expansion remains interactive; previews do not replace full output.

Provider latency is independent of rendering. A provider that emits no summary, commentary, or tool event still has no activity to display beyond its known run status. A production replay is required before claiming full parity; passing compilation or fixture tests does not establish it.

## Confirmed launch regression and live verification

The GPUI executor's blocked Unix signal mask was inherited by provider children. A diagnostic child confirmed that `SIGCHLD`, `SIGTERM`, and other signals were blocked. Codex emitted `hook/started` but could not observe the hook subprocess exiting; the subprocess remained a zombie and no model request or tool output followed. Replaying the same provider configuration and startup exchange outside the GUI completed in seconds. The pre-cutover server launch code was substantially the same; the launching thread's signal state changed with the host.

Provider process creation now clears the signal mask in the child before exec, without changing the host's mask. A regression test launches from a thread with blocked `SIGCHLD`/`SIGTERM`, verifies the child receives neither block, verifies its own child completes, and verifies the parent's mask is retained. This applies to both Codex and direct provider launches.

Verified through computer use in the installed app: an actual greeting and `pwd` produced commentary, command output and an answer within roughly ten seconds; the original repository-history request produced Git calls and a completed summary; Stop cancelled a running `sleep 120` and returned the composer to Send. Hook lifecycle events now have transcript rows, and completed hooks are excluded from both missing-final-summary recovery and fallback. A fresh printf/JSON turn completed without an extra recovery run. Expanded output showed the complete highlighted JSON, with separate command and working-directory sections and icon-only copy controls.

Responsive columns now serialize as an integer, matching the dock projection input. Previously the floating-point JSON value failed `as_u64()` and silently restored three columns. Computer use verified one and two chat columns beside the repository panel and restoration to three columns when it closed; the persisted layout is retained.
