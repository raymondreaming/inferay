# Inferay performance

GPUI is the only desktop UI. Measure the native release build and shared backend together; the previous Solid/WebKit measurements belong to the pre-cutover implementation in Git history and do not establish GPUI performance.

## Current implementation

Opened repositories retain their graph, selection, and scroll state across tab switches. Refresh uses the status already prepared by the shared Git graph engine. Graph row images are decoded off the UI thread before publication; unchanged images are reused. `INFERAY_PROFILE_GIT=1` logs preparation, history, image, and total durations. These changes require live latency and frame verification; do not describe them as instant or fully verified.

Chat uses variable-height virtualized rows, retained transcripts, revision-based replica repair, and background parsing. Selection across separate blocks and broader rendering/input parity remain incomplete. See [GPUI capabilities](../native/gpui/README.md).

## Measurement rules

Use equivalent release builds/workloads, alternate baseline and candidate runs, exclude warmups, and report p50/p95 plus sample counts. Do not benchmark alongside compilation. Use disposable profiles and repositories, disable real providers and remote access, and verify output equivalence and failure behavior.

For macOS memory report physical footprint and peak RSS separately. Include backend and Git child CPU. Model or endpoint latency does not measure window rendering or input latency. Record first-open, repeat-open, tab-switch, resize, scroll, and active-stream behavior separately.
