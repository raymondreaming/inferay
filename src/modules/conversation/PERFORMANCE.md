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
- Coalesce native streaming patches in the 32 ms transcript flush. Reconcile
  messages by ID with `createProjection`; stable messages retain their identity.
  Row grouping must read only structural metadata, never streamed text.
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

Run `bun run check:architecture` for wrapper checks, native lint and the renderer build.
Run `bun test scripts/tests/workbench-navigation.test.ts` for Rust-backed navigation
and persistence race checks. Temporary browser fixtures and profiling artifacts
were retired after the migration cleanup; their earlier measurements are historical,
not a current benchmark suite.
