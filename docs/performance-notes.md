# Inferay performance

GPUI is the only desktop UI. Measure the native release build and shared backend together; the previous Solid/WebKit measurements belong to the pre-cutover implementation in Git history and do not establish GPUI performance.

## Current implementation

Opened repositories retain their graph, selection, and scroll state across tab switches. Refresh uses the status already prepared by the shared Git graph engine. Graph row images are decoded off the UI thread before publication; unchanged images are reused. `INFERAY_PROFILE_GIT=1` logs preparation, history, image, and total durations. These changes require live latency and frame verification; do not describe them as instant or fully verified.

Chat uses variable-height virtualized rows, retained transcripts, revision-based replica repair, and background parsing. Selection across separate blocks and broader rendering/input parity remain incomplete. See [GPUI capabilities](../native/gpui/README.md).

Native syntax preparation has one owner in `native/gpui/src/syntax.rs`, shared by chat and repository diffs. The classifier returns typed runs to native callers and flattens them only for HTTP serialization. Bundled palettes are prepared once rather than searched and decoded for every token. Selectable text merges ordered syntax spans with selection in one linear pass directly into GPUI's highlight iterator, without an intermediate highlight vector. Conversation initialization has one constructor, and the shared transcript replica owns its reconnect request; unused browser insertion merging and string adapters have been removed.

## Text selection benchmark

On Apple M5 Pro, macOS 27.0.1, Rust 1.95.0, the release benchmark compares the former quadratic style composition with the current linear iterator. Each workload uses identical spans and selection, two excluded warmups, and 12 measured samples per implementation in alternating order. The regression tests compare styles byte by byte, including Unicode and unstyled gaps, and exercise drag selection and clipboard copying through GPUI.

| Syntax spans, selection active | Before p50 / p95 | After p50 / p95 |
|---|---|---|
| 1,000 | 0.771 / 0.795 ms | 0.035 / 0.037 ms |
| 4,000 | 11.182 / 11.233 ms | 0.073 / 0.078 ms |
| 16,000 | 299.690 / 306.332 ms | 0.314 / 0.323 ms |

These measure style-range preparation, including output allocation and destruction. They exclude text shaping, layout, painting, input delivery, and provider latency; they do not establish a whole-application speedup. The no-selection workloads are also measured. Run without concurrent compilation or other benchmarks:

```sh
cargo test --locked --release --manifest-path native/gpui/Cargo.toml benchmark_selection_highlights -- --ignored --nocapture --test-threads=1
```

## Measurement rules

Use equivalent release builds/workloads, alternate baseline and candidate runs, exclude warmups, and report p50/p95 plus sample counts. Do not benchmark alongside compilation. Use disposable profiles and repositories, disable real providers and remote access, and verify output equivalence and failure behavior.

For macOS memory report physical footprint and peak RSS separately. Include backend and Git child CPU. Model or endpoint latency does not measure window rendering or input latency. Record first-open, repeat-open, tab-switch, resize, scroll, and active-stream behavior separately.
