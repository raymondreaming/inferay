# Inferay performance

## Runtime and measurement boundaries

Inferay runs a Tao/Wry desktop host, embedded Tokio/Axum server and WebKit
renderer. Solid adapts native models; pure presentation logic also runs in WASM.
See [architecture.md](architecture.md) for ownership and caching contracts and
[chat performance rules](../src/modules/conversation/PERFORMANCE.md) for rendering invariants.

Measure the installed build separately from disposable fixtures. Use equivalent
release builds and workloads, alternate baseline/candidate runs, exclude warmups,
and report p50/p95 plus sample counts. Do not run benchmarks alongside builds.
Disable real providers and remote access in fixtures. Verify output equivalence
and failure behavior before keeping an optimization.

For macOS process memory, distinguish physical footprint, peak RSS, JavaScript
heap and WASM linear-memory capacity. Include Git children when measuring native
CPU and WebKit processes when measuring application CPU. Endpoint or model
latency excludes DOM layout and paint unless explicitly measured.

## Verified results

These October 2026 comparisons describe individual changes against their
immediate baseline, not cumulative improvements over one release. All use macOS
arm64 release code. Fixture gains do not establish app-wide gains.

| Workload and scope | Before → after | Interpretation |
|---|---|---|
| Plugin input capture: 20 automations, 100 × 32 KiB files; 15 samples | p50 553.4 → 26.7 ms | One request shares verified package inputs instead of rescanning for each automation. |
| Large plugin review: process peak RSS | 611.0 → 581.3 MiB | Move reviewed contents instead of cloning; review latency unchanged. |
| 10,000-message chat scroll: Chromium component, three runs of 120 frames | Scripting 495.4 → 395.2 ms | Less main-thread work; frame-paced wall time and heap unchanged. |
| Preferences: 20 workspace switches | Writes 105.6 → 0.391 MiB | SQLite updates changed keys instead of rewriting the collection. |
| Renderer startup preferences: legacy archive fixture | Payload 5.67 MB → 322 KB; WebKit fetch/decode 30 → 3 ms | Historical archives stay native; this is not total startup latency. |
| Slow provider-event consumer: isolated native process | Peak memory 47.27 → 5.48 MiB | Bounded queue preserves ordered delivery with backpressure. |
| Dense repository polling: 20,000 tracked files, 64 edits, 16 seconds | Native/Git CPU 3,471 → 2,489 ms | Navigation shares the active graph's status summary. |
| Eight large diff revisions: Chromium retained heap | 13.73 → 2.01 MiB | Release superseded, unobserved query snapshots; latency unchanged. |
| 10,000-commit graph: conditional transport | Response 9.918 MB → 13.2 KB | Changed summaries reuse unchanged history; full response remains the fallback. |
| Same graph, allocation pass: 60 changed reads, one run per arm | Native footprint 569.97 → 43.98 MiB | Release stale snapshots and reserve known buffer sizes; not total app memory. |
| Default 1,000-row graph: 60 changed reads, one run per arm | Native footprint 66.86 → 10.95 MiB | Retention improvement; latency effectively unchanged. |
| 10,000-row graph: WebKit service/query update, 32 samples per arm | p50/p95 111/114 → 102/105 ms; combined CPU/read 144.19 → 136.87 ms | Allocation/comparison changes on top of conditional transport; excludes layout/paint. |
| Same graph at three-second refresh cadence: 20 samples per arm | Native footprint 138.50 → 36.45 MiB; p50 135.58 → 131.25 ms | Memory improvement persists at normal polling cadence; latency gain is modest. |

The graph fixture has 10,000 commits, 200 tracked files, 20 tracked edits and
about 20 untracked files. Changed-count reads alternate one/two lines. The
normal-cadence comparison uses two alternating rounds of twelve reads per fresh
server, excluding two warmups. The WebKit query comparison uses four alternating
rounds of ten reads, excluding two warmups. Sustained memory checks use fresh
processes without forced reclamation or allocator overrides.

A separate 20-second observation of the then-installed older build showed about
0.59% of one CPU core and 339 MiB combined physical footprint, stable during that
window. It is an idle observation, not a before/after comparison or evidence of
the latest build's memory use.

## Regression protection

Behavior tests live beside the owning Rust model/service and in `scripts/tests`.
Graph tests cover delta reconstruction and scoped cache release with in-flight
readers; diff tests cover conditional responses and snapshot retention. Native
Git tests preserve staged, untracked, binary, rename and path handling. Chat
tests protect transcript ordering, navigation and Markdown patch validation.
Select checks using [CODING_GUIDELINES.md](../CODING_GUIDELINES.md). The plugin
review benchmark remains opt-in via `cargo test -p inferay-server
measure_plugin_approval_and_review -- --ignored --nocapture --test-threads=1`.
Avoid CI gates on small timing differences. Keep experiment scripts and raw
reports outside tracked source; document only lasting results and contracts.

## Limits and rejected approaches

Local Git refresh is not remote fetch. Revision checks still execute Git. Small
graph latency, full diff endpoint latency and review latency did not materially
improve in the memory-focused passes. Native startup-to-interactive, realistic
long-session memory and provider/network latency still need matched production
measurements; none of the fixture results establishes those gains.

Earlier renderer experiments found no useful WebKit switching improvement from
CSS containment, transform-based hidden views or changing graph row positioning.
Visibility stacking regressed switching. Streaming WASM loading did not beat the
small synchronous load; `wasm-opt` reduced raw size without reducing gzip size.
Do not reintroduce these approaches without new workload evidence.
