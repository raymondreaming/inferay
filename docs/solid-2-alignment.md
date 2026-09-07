> Migration audit history. Temporary browser fixtures and profiling artifacts referenced below were removed during the requested cleanup. Current validation commands are in README.md.

# Solid 2 alignment and interaction verification

Reviewed September 7, 2026 against the local Solid 2 documentation in
`docs/solid-2.0/upstream/src/routes` (ignored upstream download).

| Documentation principle | Implementation | Verification |
| --- | --- | --- |
| Read changing props in tracked expressions; components set up once | Removed generated setup snapshots and passthrough prop memos; independent getters in workbench and chat hooks | Typecheck and structural checker |
| Derive state rather than synchronizing it with effects | Writable derivations for document navigation, repository preferences, search and editable initialization | Navigation tests; manual dependency review |
| Preserve list identity with keyed accessors | Chat rows, workspace panes, files and tabs use stable keys; positional content uses positional For | Chat row and pane DOM identity browser checks |
| Use field-level store dependencies | Background query snapshots use a shallow store; chat messages reconcile by ID | 1,000-message test: 100 content updates leave grouping at one computation |
| Own lifecycle setup outside ref callbacks | onSettled owns listeners and observers; refs only capture DOM elements | Structural guard and resize/browser coverage |
| Keep async boundaries local | Background query adapter keeps stale data visible; author identity has a local Loading boundary | Settings remain interactive with pending account requests |
| Avoid deriving JSX trees in memos | Stable component branches and live auxiliary document props | Structural guard, diff mode and shared control identity checks |
| Use the Solid router | @solidjs/router 2 prerelease with lazy routes | Production renderer build |

`bun scripts/check-solid-principles.ts` checks structural hazards in 232 source
files. It does not prove complete semantic correctness or a performance target.
Static visual arrays intentionally remain ordinary arrays. Custom query and
external-signal bridges intentionally retain owner cleanup.

## Observed interactions

The production renderer was opened in a separate visible Chrome instance against
an isolated native server on port 4329. This is not the user's populated desktop
session. All four native interaction tests passed: pending-account settings and
menus, commit/file selection and diff modes, 100-commit viewport scrolling, and
split resizing with retained drafts. The renderer production build passed.

A CPU profile and Event Timing/Long Tasks observers captured repeated settings
section changes, model menu opening, typing, and a separate workspace-tab pass.
The initial recorded click durations were 24–48 ms; the subsequent pass included
32–56 ms events. These are rounded browser event durations, not API timings or
an exhaustive latency distribution (events below the observer threshold are
omitted). No tasks exceeding 50 ms were observed in these short samples.

Pressing Enter inserted the optimistic message and cleared the composer. The
`chat:send` WebSocket request was intercepted, verifying submission UI without a
real provider response. Streaming latency is therefore unmeasured.

Local inspection scripts, screenshots and CPU profiles are under the ignored
`.test-tmp/profiles` directory. These exploratory scripts are not a benchmark
suite. No before/after speedup was established, and the reported desktop freeze
has not been reproduced. Larger histories/diffs and the native desktop webview
still need profiling before attributing that behavior or claiming a 3× gain.

The larger chat browser fixture subsequently reproduced an intermittent initial
scroll failure: the last row was absent while the visible window still reflected
an earlier offset. Automatic scroll-to-end now commits the final virtual window
before reading the DOM height. Smooth scrolling retains its intermediate windows.
The browser regression passed twice after the fix; typecheck and structural checks
also passed. This is a correctness fix for incomplete history, not evidence that
the desktop freeze or streaming slowdown is resolved.

## WIP sidebar hover/scroll regression

A focused browser fixture with 50 staged and 50 unstaged files reproduced the
reported flashing: hovering a tree file disconnected its button. The shared
`rowProps` memo combined hover state with tree data, so each hover invalidated
all row visibility expressions and recreated their DOM.

File groups now expose independent getters, hover state belongs to each row,
and row visibility is a boolean memo behind Show. Equivalent presentation
snapshots preserve the tree container. Selection scrolling tracks path/staged/view
identity instead of replacement selection objects. The regression test fails
before the fix and passes after it, including status snapshot replacement and
selection in both file groups:

`node --test scripts/tests/changes-interactions.test.mjs`

A production smoke profile opened a 12,000-line modified file while receiving
40 ms transcript patches against 1,000 messages. Opening took approximately
120 ms in the first run, with 32 patches delivered during diff mode changes and
scrolling; no long tasks or page errors were recorded. A follow-up also checked
that streamed text reached the visible final message. This synthetic transport
exercise does not cover provider tool execution or native repository changes.
The initial large-file probe expected split mode while another mode was active;
waiting for the actual diff viewport resolved that test mismatch.

## Diff refreshes while an agent changes files

A dedicated diff-query fixture reproduced two failures. In Solid development
mode, subscribing to QueryObserver during component construction synchronously
wrote the result store, triggering REACTIVE_WRITE_IN_OWNED_SCOPE and preventing
the initial request. Subscription now starts in onSettled and returns its
unsubscribe cleanup. The regression also checks for Solid diagnostics.

Each repository revision previously discarded the visible diff while requesting
its replacement. Query identity now separates the selected document/view from
repository revision. Previous data is retained only for the same document/view;
switching files immediately clears the old diff. Query functions use the request
snapshot that produced their key. Rapid held revision requests and switching to
another file are covered by:

`node --test scripts/tests/diff-refresh.test.mjs`

This test failed before each repair and passes after both. It verifies the
repository-refresh mechanism independently of provider timing.

## Repository tab switching during a running chat

The production workspace-switch test initially failed: a quick tab switch and
input reached the previous composer. Repository tabs waited for the native
mutation queue, although pane/workspace selection already used optimistic state.
Repository selection now uses a Rust projection with the native preference order
(current group, remembered pane, first match) and the existing optimistic
selection/acknowledgement mechanism. Native persistence remains authoritative.

The browser test creates two repository workspaces, supplies a 1,000-message
transcript with running status and 40 ms updates, opens a WIP diff, and switches
between repository tabs eight times. It verifies both drafts, restored diff
selection, and applied streamed text. It passes with repository-selection HTTP
responses held throughout the interactions. Click-plus-assertion times were
58–73 ms; these include automation overhead and are not pure input latency.

Run against the isolated server, sequentially with other native fixture tests:

`node --test scripts/tests/workspace-switching.test.mjs`

The projection preference-order test and existing persistence-race tests pass.
No provider network or native tool execution was invoked by this test.
