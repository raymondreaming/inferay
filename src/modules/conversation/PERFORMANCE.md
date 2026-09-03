# Chat Performance Rules

The chat surface stays fast only when hidden panes are inert and streaming work
touches the smallest possible part of React.

- Gate live work with `renderVisibleChat`. Hidden chat panes must not own
  websocket reconnects, pending-send consumption, queue hydration, storage
  listeners, file-preview listeners, speech recognition, prompt loading, branch
  polling, or DOM observers.
- Keep rapid chat actions ref-based. Queue appends, queued-message shifts, and
  streaming callbacks should read current refs instead of depending on a React
  render that may not have committed yet.
- Batch streaming deltas once per animation frame and update only the message
  being streamed. Stable messages should keep stable object references.
- Virtualize message rendering and memoize rows. Do not map every stored
  message into mounted markdown/code DOM on each token.
- Persist chat state off the critical path. Debounce message/input writes,
  collapse queue saves to latest-write-wins, and never block the first token on
  local storage, checkpoint, or transcript work.
- Clearing state must clear every durable layer that can restore it. If a value
  is saved to both legacy pane storage and the preference collection, clear both.
