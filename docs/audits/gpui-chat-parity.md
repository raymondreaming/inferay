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
