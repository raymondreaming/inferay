# Effects: review, delivery and recovery

Effects are proposed consequences of a run. The kind and target are opaque to
Inferay: domain libraries define their meaning. Current work builds the generic
harness using disposable local fixtures. Real posting, production accounts and
individual workflows are deferred.

## Implemented

A successful run can emit an `inferay.effect/1` JSON artifact. The native runtime
validates and captures it in the artifact transaction. `(project, key)` identifies
one intent; an identical retry reuses it, while changed contents under the same
key fail capture. This prevents duplicate proposals, **not duplicate delivery**.

History's **Needs review** inbox has a cursor independent of run pagination and
can filter by automation. Review displays the canonical database payload.
Dismissal requires its hash and retains the first decision across retries and
restarts. Dismissed proposals remain in their source run's history.

See [project files](reference/project-files.md#effect-intent-artifacts) for the
current artifact contract. Capture, inspection and dismissal do not execute a
handler. Delivery approval controls, handler binding and the outbox worker remain
unimplemented.

Existing outbox records and receipts remain readable. Cancellation turns queued
work into cancelled and marks in-flight attempts uncertain, retaining a durable
stop request. Startup marks in-flight records uncertain without resending.
History retains these states and cancellation controls. Production admission,
count reservations, delivery and reconciliation are not implemented.

The shared callable runner accepts explicit reviewed permissions and an owner-supplied
cancellation check. Direct automation tools, granted library tools and MCP tools
use that same boundary. Input validation and cancellation precede filesystem setup;
cancellation is checked again before launch and during execution. Native logs retain
the launched PID in `process.json`, so cleanup evidence does not depend on the child
writing a file. A local check executes with no automation snapshot or run row; this
prepares handler reuse but does not wire the delivery worker.

Tools can declare `effectHandler` with supported kinds and an explicit retry-safety
policy. Declared handlers are refused as ordinary automation tools and agent tool
grants. This admission rule does not prevent an agent with shell access from
running source directly. Handler binding, approval and execution remain planned;
the declaration alone never launches a process.

## Planned delivery contract

The following is the implementation target, not an available file format or API.
It extends the existing callable runner; effects do not introduce an unrestricted
script runner or a second provider session.

### Handler binding

A project binds an effect kind to a library tool with two operations: deliver and
reconcile. The tool uses the existing JSON invocation interface. The binding
identifies the library and tool by stable IDs. Both operations execute through
the native runner with its timeout, process cleanup, sandbox, logs and explicit
connection access. A handler is code; an agent's prose is never a receipt.

Review captures the complete resolved handler inputs, including library files,
pack revision, selected connections and permissions. The approval binds the
intent hash and handler input hash together. A changed handler, connection
revision or permission set requires another review before further execution.
A library approval alone does not authorize external effects.

The handler receives a stable delivery ID, intent key, target and payload. The
same delivery ID is used for reconciliation and any permitted retry. The handler
must declare how its destination supports idempotency and lookup. Merely accepting
an idempotency field in local code does not establish either guarantee.

### Limits and admission

A local approval specifies project, effect kind, exact allowed targets, maximum
count and rolling time window. It does not travel in copied plugin files.
Review shows these values before approval. A request cannot increase an existing
limit as a side effect of queueing work.

Queue admission atomically validates the reviewed intent and handler hashes,
refuses dismissed proposals and records the delivery authorization. Queueing the
same intent again returns the existing delivery rather than reserving another.
The intent's `notBefore` is an earliest eligible time, not permission to send.

Immediately before execution, the worker rechecks approval, handler inputs and
limits. It atomically reserves one count and records the attempt before invoking
the handler. Limits apply across all automations sharing the approved scope.
Queued work waiting for its eligible time does not consume a count. In-flight,
uncertain and delivered attempts do; an uncertain result cannot free capacity
for another attempt. A destination-confirmed absence can release a reservation
under the same transaction that records that evidence.

Count each delivery once across retries. A count limit is not a monetary budget;
spend-based limits need an explicit unit and amount contract before support can
be claimed.

### Durable states

| State | Meaning | Allowed next step |
|---|---|---|
| Pending review | Captured proposal, no delivery authorization | Approve or dismiss |
| Queued | Exact inputs approved, waiting for time or capacity | Claim or cancel |
| In flight | Attempt and reservation committed before handler launch | Receipt or uncertain outcome |
| Uncertain | Delivery may have happened; there is no authoritative receipt | Reconcile; do not blindly resend |
| Delivered | Destination receipt retained for this delivery ID and payload | Inspect receipt |
| Cancelled | Work was cancelled before delivery began | Inspect decision |
| Dismissed | Proposal declined before queue admission | Inspect decision |

Failure before an attempt begins is distinct from failure after launch. A handler
exit code, timeout, lost connection, or killed process after launch cannot prove
that nothing happened. On restart, every unfinished in-flight attempt becomes
uncertain; it does not return directly to the send queue.

Cancellation after launch requests process termination but cannot undo a remote
consequence. It remains uncertain until reconciliation establishes the result.
An input change also cannot erase an in-flight attempt or its reservation.

### Receipts and reconciliation

A delivered receipt identifies the delivery ID, intent hash, destination ID and
completion time. Receipt writes are idempotent. Conflicting receipts are refused
and retained as a visible error rather than overwriting earlier evidence.
Secrets and credential-bearing request headers never enter receipts or logs.

Reconciliation returns delivered with a receipt, confirmed absent, or unknown.
Unknown stays uncertain. A retry after confirmed absence is only safe when the
destination's idempotency guarantee also covers a late original attempt. Without
that guarantee, Inferay requires a human decision and does not automatically
retry. There is no general exactly-once guarantee for arbitrary third-party APIs.

## Planned local conformance gate

The fixture destination is a separate local process with its own durable ledger.
It accepts a stable delivery ID, refuses conflicting payloads for that ID and
supports lookup. Its ledger is independent of Inferay's database and survives an
Inferay restart. It never contacts an external service.

The production queue and runner must demonstrate:

1. No invocation from capture, opening History, or opening a review dialog.
2. Stale intent/handler approval and undeclared targets are refused.
3. Concurrent admissions obey the shared count limit.
4. `notBefore` prevents early execution.
5. A restart before invocation safely resumes queued work.
6. The destination commits an action, then drops its reply; restart reconciles
   the original receipt with exactly one destination ledger entry.
7. Unknown reconciliation remains uncertain without another deliver call.
8. A conflicting payload or receipt cannot replace the original.
9. Cancellation after launch preserves uncertainty and its reservation.
10. Connection changes block new execution; run folders contain no test key.

Passing a fixture gate establishes the tested kernel behavior. A later integration
must independently verify its destination's idempotency and reconciliation
semantics before unattended delivery is enabled.
