# Inferay performance

GPUI is the only desktop UI. Measure the native release build and shared backend together; the previous Solid/WebKit measurements belong to the pre-cutover implementation in Git history and do not establish GPUI performance.

## Current implementation

Opened repositories retain their graph, selection, and scroll state across tab switches. Refresh uses the status already prepared by the shared Git graph engine. Graph row images are decoded off the UI thread before publication; unchanged images are reused. `INFERAY_PROFILE_GIT=1` logs preparation, history, image, and total durations. These changes require live latency and frame verification; do not describe them as instant or fully verified.

Chat uses variable-height virtualized rows, retained transcripts, revision-based replica repair, and background parsing. The transcript owns message/preparation correspondence and viewport publication. Prepared text shares immutable content, styles, and links across redraws; native rendering no longer reconstructs inline Markdown or hashes code-block bodies. Queued suffix updates coalesce before preparation, while activity transitions stay ordered so a queued turn gets its own clock. Theme jobs reuse prepared Markdown and retain source identity, preventing an older recolor from overwriting a newer streaming row. Repository theme preparation also runs in the background and shares the original diff and unified patch. Selection across separate blocks and broader rendering/input parity remain incomplete. See [GPUI capabilities](../native/gpui/README.md).

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

## Retained text and streaming benchmarks

The same release harness uses two excluded warmups and 12 paired samples in alternating order. It compares repeated inline preparation with retained projection, sequential preparation of eight queued suffixes with their coalesced preparation, and complete GPUI test frames at a 624 × 600 viewport. The fixtures verify equivalent visible text or final transcript contents before timing.

| Workload | Before p50 / p95 | After p50 / p95 |
|---|---|---|
| Eight-update stream burst | 1.175 / 1.209 ms | 0.147 / 0.153 ms |
| GPUI test frame, retained rich text | 1.092 / 2.172 ms | 0.970 / 1.460 ms |

Burst preparation improves about 8× in this workload; complete test-frame time improves about 13% at the median. The frame test uses GPUI's test platform, not physical display presentation. Neither figure establishes a whole-application 5× improvement. The inline projection series also reports separate preparation costs; those microsecond/nanosecond results must not be presented as whole-frame latency.

```sh
cargo test --locked --release --manifest-path native/gpui/Cargo.toml benchmark_ -- --ignored --nocapture --test-threads=1
```

## Measurement rules

Use equivalent release builds/workloads, alternate baseline and candidate runs, exclude warmups, and report p50/p95 plus sample counts. Do not benchmark alongside compilation. Use disposable profiles and repositories, disable real providers and remote access, and verify output equivalence and failure behavior.

For macOS memory report physical footprint and peak RSS separately. Include backend and Git child CPU. Model or endpoint latency does not measure window rendering or input latency. Record first-open, repeat-open, tab-switch, resize, scroll, and active-stream behavior separately.
