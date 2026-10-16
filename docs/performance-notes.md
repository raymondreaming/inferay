# Inferay performance

Measure equivalent release builds against disposable workloads, verify behavior,
and distinguish native CPU/physical footprint from browser heap and WASM capacity.
Report repeated p50/p95 timings with scope and warmups; endpoint timing does not
include DOM layout or paint. Keep experiment scripts and raw reports untracked.

See [architecture.md](architecture.md) for runtime ownership and
[chat performance rules](../src/modules/conversation/PERFORMANCE.md) for renderer invariants.
