# Chat Performance Rules

The chat surface stays fast only when hidden panes are inert and streaming work
updates only the Solid computations that need it.

- Gate live work with `renderVisibleChat`. Hidden chat panes must not own
  websocket reconnects, pending-send consumption, queue hydration, storage
  listeners, file-preview listeners, speech recognition, prompt loading, branch
  polling, or DOM observers.
- Keep rapid chat actions ref-based. Queue appends, queued-message shifts, and
  streaming callbacks should read current refs instead of depending on a
  reactive update that may not have committed yet.
- Coalesce native streaming patches on the next animation frame. Cancel pending
  frames on reset or disposal; hidden panes retain pending data without
  publishing it. Publish the validated replacement range with the snapshot
  revision. Combine ranges across the flush; membership changes invalidate
  shifted positions. Local edits and
  notices use the full comparison path. Consumers may use a range only when they
  observed its immediately preceding revision; skipped revisions compare fully.
- Mounted rows read immutable messages at their original transcript indices;
  unchanged message references suppress ordinary bubble updates. Do not maintain
  a separate projected slice and offset: a window transition can expose a row
  before that representation is consistent, crashing tool rendering. Edit groups
  slice their full original range. Row grouping reads only structural metadata,
  never streamed text.
  Prepare descriptors only when grouping changes; do not retain a second
  per-message descriptor cache. Reuse snapshot ID strings in the grouped rows
  when their values match, instead of retaining JSON-decoded duplicates.
- `ChatViewport` owns the prefix offsets and retained row range in Rust. Send
  measured heights as a numeric buffer only when rows or measurements change;
  scroll updates pass position and viewport height only. Do not serialize the
  entire offset table per scroll event. Dispose the model with its chat list.
  The offset buffer releases excess capacity when history shrinks substantially.
- Virtualize message rendering and preserve rows by message ID. Do not map every stored
  message into mounted markdown/code DOM on each token.
- Persist chat state off the critical path. Debounce message/input writes,
  collapse queue saves to latest-write-wins, and never block the first token on
  local storage, checkpoint, or transcript work.
- Clearing state must clear every durable layer that can restore it. If a value
  is saved to both legacy pane storage and the preference collection, clear both.

- Keep background queries nonblocking with `useBackgroundQuery` when the view
  renders its own loading and error states. Disabled queries must not suspend
  unrelated controls.
- Return independent reactive getters from hooks. Building every property in
  one `merge(() => ({ ... }))` ties unrelated reads together.
- Preserve pane and control identity with keyed `For` or stable `Show` boundaries.
  Do not recreate a component in a memo whenever its data object changes.

- Publish query snapshots through a shallow `createStore`. Fetch-status changes
  must not invalidate consumers of unchanged data.
- Keep one row measurement observer per chat list. Read sizes in the observer,
  apply updates in one animation frame, and commit offsets before correcting
  scroll position. Disable browser anchoring on the measured list so it does
  not apply a second correction.
- Keep native subscriptions dependent on session identity and enabled state.
  Event callbacks read current options without resubscribing the pane.
- Use positional `For` for streaming Markdown blocks and keyed `For` for chat,
  graph, source, and diff rows. Derive branch types separately so text changes
  update existing components instead of rebuilding their DOM.

## Validation

Use the focused checks described in [CODING_GUIDELINES.md](../../../CODING_GUIDELINES.md).
Transcript, subscription, Markdown streaming and workbench navigation tests live
in `scripts/tests`; pure viewport cases live with the Rust presentation model.
For UI validation, exercise mixed-height scrolling, history replacement,
append/tail-follow, hidden panes and disposal without page errors. Measure with
the production WebKit renderer before claiming an application speedup.
