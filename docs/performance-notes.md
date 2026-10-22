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

## Bun toolchain comparison

The October 22, 2026 comparison measures Bun `1.4.3+c6da4a4d3` against the
pinned `1.4.4+38afee6c8` on the same working tree and generated presentation
module. The host is macOS arm64, Mac17,8, with 18 logical CPUs and 48 GiB RAM.
Each workload uses fresh processes, warm filesystem caches, two excluded
warmups per version and ten ABBA rounds (20 measured samples per version).
Times include process launch and exit; p95 uses nearest rank.

| Tooling workload | p50, 1.4.3 → 1.4.4 | p95, 1.4.3 → 1.4.4 | Interpretation |
|---|---|---|---|
| `bun test scripts/tests` | 1,263.8 → 1,232.4 ms | 1,303.7 → 1,270.1 ms | Median latency falls 2.5%; all runs pass the same 57 tests, including child-process checks. |
| Architecture boundary scan | 126.7 → 127.4 ms | 133.0 → 132.4 ms | Effectively unchanged. |
| Process plus actual renderer/WASM adapter import | 31.25 → 29.50 ms | 32.04 → 32.66 ms | Small, mixed change; excludes WebKit and desktop startup. |
| Warm offline dependency check | 15.51 → 11.77 ms | 17.20 → 12.48 ms | Median latency falls 24.1%, saving 3.74 ms. Uses a disposable dependency-tree clone, frozen lockfile and disabled lifecycle scripts; every run reports no changes. |

The separate production Vite bundle reference runs under Node `v22.23.1`:
p50 5.10 s, p95 5.99 s over ten measured builds after two warmups. This excludes
the already-built Rust/WASM presentation step; it is not a Bun A/B comparison.
All twelve bundles are byte-identical, and source/generated-input hashes and
lockfile remain unchanged throughout measurement.

The installed app and normal desktop session remain running; host load and
thermal conditions are not controlled. Small differences need independent
confirmation. These are tooling results, not evidence of faster scrolling,
tab switching, lower app memory or a 300–500% application-wide gain. The
desktop runtime remains Rust and WebKit, independent of the pinned Bun binary.

Replacing separate tooling with Bun's built-ins produces larger development-time
gains on the same host. This comparison uses Bun 1.4.4 and TypeScript 7.0.2,
two excluded warmups per arm, ten ABBA rounds and 20 measured samples per tool.
Both arms use the same source/configuration and exclude generated benchmark
artifacts from type checking. Times include process launch and exit.

| Tool replacement | p50, previous → Bun | p95, previous → Bun | Scope |
|---|---|---|---|
| `tsc --noEmit` → `bun check --no-script` | 2,368.2 → 584.9 ms | 2,556.0 → 616.0 ms | 75.3% less median time. Both enumerate the same 774 project files outside dependency libraries, accept the same valid native-contract/Solid fixture and reject eight deliberately invalid cases at matching locations. |
| Biome formatting check → `bun fmt --check` | 81.44 → 13.43 ms | 103.56 → 15.39 ms | 83.5% less median time on 258 identical files already accepted by both formatters. Excludes import organization, linting and the nine files whose formatting changes during migration. |

The migration preserves tabs, double quotes and trailing commas, and disables
Biome's formatter while retaining its import organization and CSS/JSON linting.
An isolated Git fixture verifies that the actual hook formats staged content,
preserves unstaged edits and still rejects CSS/JSON errors. The TypeScript editor
dependency matches Bun's built-in checker. These figures describe the individual
tool commands; the aggregate `check` now also runs type checking and is not an
equivalent before/after workload. The renderer rebuild produces 1,695 files
byte-identical to the pre-migration bundle. The production desktop stays running during
measurement, so these results do not establish application runtime gains.

## Native application comparison

A matched Tao/Wry/WebKit release comparison uses `66ecf730` (v0.1.112) and
`9bc26155`, with identical temporary lifecycle instrumentation. The disposable
profile has five workspaces, fourteen chats and 2,403 synthetic messages; six
chats are visible, containing 0/131/205/245/165/135 messages. Providers, forge
authentication and remote fonts are disabled. Initial migration/warmup launches
are excluded; each measured launch copies its build's initialized profile.
No builds run during measurement and the installed app is left running.

| Measurement | Baseline → candidate | Interpretation |
|---|---|---|
| Process launch → six restored composers accepting a synthetic input event; six ABBA rounds, twelve samples per build | p50 750.2 → 704.8 ms; nearest-rank p95 775.7 → 769.2 ms | Median improves 6.1%; tail latency is effectively unchanged. At this sample size p95 is the maximum. This includes the native host, server and WebKit; it excludes provider execution and does not establish completion of every asynchronous Markdown/highlight render. |
| Physical footprint after ten seconds settling and twenty seconds idle; one ABBA round | Combined native/GPU/network/WebContent 404.5–427.9 → 432.6–434.5 MiB; native alone 51.2–52.2 → 75.0–75.2 MiB | No overall memory gain demonstrated. Browser variation is substantial; the native increase repeats. Native default-zone live allocations fall from about 23.7 to 18.7 MiB while dirty free/fragmented space increases. This warrants allocation-lifetime investigation, not a leak diagnosis or allocator change by assumption. |
| Combined native/WebKit idle CPU in those twenty-second windows | 0.35–0.40% → 0.15–0.25% of one core | Both are nearly idle; two observations per build are insufficient for a broad CPU claim. |

The candidate's median native-main milestones are server ready 2.5 ms, window
built 69.1 ms, WebView built 105.4 ms, DOM loaded 476.4 ms, shell present 497.6 ms
and composer check complete 698.3 ms. Window construction is effectively
unchanged. These milestones locate the remaining startup cost but do not split
WebKit initialization, JavaScript execution, layout and paint individually.

## Verified results

These October 2026 comparisons describe individual changes against their
immediate baseline, not cumulative improvements over one release. All use macOS
arm64 release code. Fixture gains do not establish app-wide gains.

| Workload and scope | Before → after | Interpretation |
|---|---|---|
| Browser-notice transcript merge: Bun/JavaScriptCore with matched release WASM, before/after/after/before, 100 measured updates per arm after 20 warmups | 1,000 messages: p50 0.558–0.561 → 0.070–0.072 ms; 10,000 messages: p50 5.46–5.49 → 0.616–0.624 ms, p95 5.86–5.90 → 0.733–0.784 ms | Reuse the native replica's admitted IDs, transmit compact local IDs and notice descriptors, and return only browser insertion positions. Eliminates the second full-history input and full-order output. 1,000 differential cases match for reordered, removed and acknowledged rows. About 8.8× faster for the large fixture; excludes admission, transport, grouping, DOM and paint. No new persistent cache. |
| Streaming-tail height update: Bun/JavaScriptCore and release WASM, before/after/after/before, 200 measured updates per arm after 40 warmups | 10,000 rows: p50 0.0806–0.0812 → <0.001 ms | Native incremental index/height updates replace a full JS height-map traversal, WASM buffer copy and prefix rebuild. Includes viewport selection and padding lookup; excludes ResizeObserver delivery, DOM layout and paint. Small absolute saving despite the large ratio. Mixed-height, duplicate/invalid measurements, anchor correction and history shrink have native regression coverage. |
| Graph selection and history preparation: Bun/JavaScriptCore with release WASM, before/after/after/before, 100 measured updates per arm after 20 warmups | With 2,000 selected commits, p50 0.196–0.202 → 0.005–0.009 ms; with 10,000, 0.873–0.898 → 0.017–0.021 ms. Initial preparation plus 120 file-navigation changes invokes the history projection 121 → 1 times | Stable repository and selection memos prevent rebuilding retained commit maps and comparison descriptors on unrelated panel updates. History projection receives a count, hash and kind instead of the full selection and commit record. Includes signal propagation and native projection; excludes HTTP, DOM and paint. |
| Changes-panel file navigation: Bun/JavaScriptCore with release WASM, before/after/after/before, 100 measured updates per arm after 20 warmups | At 100/2,000/10,000 files, p50 approximately 0.063/1.09/5.58 → <0.01 ms; 120 navigation updates plus initial preparation invoke the projection 121 → 1 times | Memoize only the panel fields that affect ordering and history summaries. File updates and commit selections still refresh the model. Measures model preparation, excluding query transport, DOM and paint. |
| Chat wheel routing: WebKit before/after/after/before, 100 warm batches of 20 header-wheel events per arm, 10,000 descendant nodes | Per-event p50/p95 0.10/0.15 → <0.05/<0.05 ms | Replace full descendant enumeration with the chat's explicit scroll-area selector, preserving ancestor scrolling and boundary behavior. Actual handler with the unchanged native wheel decision stubbed; excludes WASM, scrolling and paint. Candidate batches fall below the browser's timer resolution. |
| Untracked patch construction: optimized native fixture, before/after/after/before, 60 measured samples per arm after five warmups | 10,000/100,000 lines: p50 approximately 0.52/4.7 → 0.21/1.9 ms | Append into one output buffer instead of allocating a string per line. The same change fixes phantom trailing lines and preserves missing-final-newline markers; Git applies empty/LF/CRLF/no-final-newline fixtures with exact contents. Isolated patch construction, excluding Git execution, HTTP and rendering. |
| Chat WebSocket publication: matched native release, two ABBA memory rounds, four observations per arm | Native footprint median 74.9 → 71.6 MiB; combined footprint ranges overlap | Serialize borrowed transcript rows directly and share encoded events across subscribers. Reconnect payloads, cursor handling, commands and error envelopes match; remove duplicate automatic ping replies. A later confirmation run had large startup outliers and an unavailable memory sample, so no additional startup or reliable whole-app memory improvement is claimed. |
| SQLite transcript restore: two ABBA rounds, 40 warm reads per run/case | 1,000 short/long messages and 10,000 short messages: median run p50 0.206/2.095/2.748 → 0.185/1.950/2.483 ms. Long-message Rust allocations/read 18.28 → 10.01 MB | Decode borrowed SQLite text without an intermediate owned string per row. Restored contents match. Includes worker dispatch and typed decoding; excludes seeding, rendering and SQLite's C allocations. Allocation volume falls; peak live memory is effectively unchanged. |
| Transcript event admission: matched release dependencies, two native ABBA rounds and one WebKit ABBA round | Native 1,000-event delta/status/stale batches: p50 3.127/1.886/2.000 → 2.366/1.230/1.504 ms; Rust allocation volume 11.26/6.08/8.35 → 8.41/3.60/6.25 MB. WebKit p50 4/3/3 → 4/2/2 ms | Keep admission and event plans typed until serialization. Normal outputs and 96 malformed headers match; 40 warm batches per run/mode. WebKit delta median is unchanged at its timer resolution. Excludes transport, DOM and paint. |
| Native chat row storage: two ABBA rounds, 20 warm restorations per run/case; 5,000 messages | Inline message size 2,008 → 880 bytes; text restoration p50/p95 1.176/1.242 → 0.738/0.765 ms; edit history 3.493/3.696 → 3.048/3.220 ms | Box rare approval payloads instead of reserving their storage in every row. Approval-heavy fixtures improve 9–13% despite one allocation per card. All 2,400 normalized transcript states and generated contracts match. A matched native-app ABBA round reduces native footprint from 75.4–76.3 to 73.2–73.5 MiB; six startup samples per arm remain noisy (p50 727.8 → 716.6 ms, maximum 740.9 → 763.0 ms). This does not resolve the original release's whole-app memory regression. |
| Edit-diff preparation: sparse/unchanged 10,000-line files, 900 changed lines and 400-token edits; two ABBA rounds, 40 warm calls per run/case | Allocated bytes/call fall 6–17%; sparse-file peak extra live allocations 1.326 → 1.006 MB | Typed operation variants remove optional indices; backtracking reverses its range in the existing vector instead of constructing another vector. All 14,641 exhaustive small-input comparisons and four larger fixtures match. Normal-allocator timing changes are small and mixed; no latency gain claimed. Allocation measurements use a separate instrumented pass and exclude rendering. |
| Chat restoration with edit groups: native release, two ABBA rounds, 20 warm samples per run | 5,000 edits in three-message groups: median-run p50/p95 15.64/15.95 → 3.58/3.65 ms; 1,000 edits p50 1.27 → 0.70 ms. Separately instrumented allocated bytes 3.31 → 3.21 MB and allocation calls 117,343 → 109,010 at 5,000 edits | Carry group indices instead of searching earlier history for every member; remove unused group-ID transport. 2,400 normalized transcript/update states match across restoration, streaming, duplicate rows and trimming, excluding the removed field and random IDs. Text, ordinary tools and one long edit group show no meaningful regression. Measures native restoration/descriptor work, excluding SQLite, IPC and UI; not whole-app memory or startup latency. |
| Changes-panel projection and adapter: WebKit ABBA, 40 warm batches per arm at 100/2,000/10,000 files | p50 0.30/5.8–6.0/30.0–30.5 → 0.15/3.0–3.2/15.5–16.0 ms; 10,000-file output 5.38 MB → 147 KB | Native ordering returns indices; the adapter preserves canonical file/detail objects. Opening the first graph file sends 266 bytes instead of 1.16 MB and falls from 6 ms below individual-call timing resolution. Equivalent model outputs and 20 actual panel states/screenshots match. Fixture includes commit details and JSON/adapter work, excludes Git, HTTP, and total rendering latency. |
| Background settings projection: WebKit ABBA, 25 warm batches of 1,000 calls per arm | Batch p50/p95 7/8 → 6/6 ms; appearance plus open settings storage listeners 5 → 3 | Background updates no longer construct the font/theme catalog. Constant theme state and duplicate controls are removed. 113 UI states/screenshots and 350 saved-setting/patch cases match. Small per-call gain; excludes persistence and whole-app latency. |
| Markdown cursor lifetime: WebKit before/after/after/before, four batches of 50 abandoned 256 KiB streams with renderer closures and returned blocks kept reachable | WebAssembly linear-memory high-water 54.72 → 2.82 MB after 200 streams; new implementation plateaus after the first batch | Allocate cursors only for streaming; free on final completion or renderer disposal after outstanding reads settle. Static readers allocate no cursor. Actual Solid hook mount/append/unmount and overlapping-read cleanup pass. Synthetic transport and intentionally retained closures isolate native ownership; this is not whole-app RSS or a claim that garbage collection never reclaimed old cursors. |
| Provider stderr tail, native release alternating runs: 4 MiB ASCII/Unicode/malformed-byte streams | Per-character retention → per-read retention: p50 5.20–5.23/3.71–3.82/4.81–4.99 → 3.02–3.62/3.25–3.46/4.49–4.63 ms. Shared `/btw` collection reduces peak live allocations from 19.64/14.11/24.15 MB to 0.25/0.31/0.53 MB | Keep 64,000 UTF-16 units after each 8 KiB read and decode UTF-8 chunks once. 138 output/error cases match, including partial diagnostics on read failure. Regular-agent peak allocations rise from 0.20/0.27/0.40 MB for faster chunk retention; `/btw` 32 KB reads rise from about 0.023 to 0.050–0.058 ms. Large valid `/btw` reads have comparable latency, malformed input improves. Fixtures exclude provider execution, OS pipes and UI; not whole-app memory or latency. |
| Graph-line projection through release WebAssembly: 40/60/90 visible rows, 3/8/12 lanes; Node ABBA, 140 warm batches of 100 calls per arm/workload | Mean run p50 0.285/0.839/1.781 → 0.230/0.693/1.473 ms (17–19% lower); 60-row output 65,310 → 53,880 bytes | Remove unused keys, per-row temporary vectors and JSON construction inside curve geometry. Six geometry fixtures and 14 actual SVG component states match; WebKit screenshots are identical. Measures projection and JSON transport, not browser frame time or whole-app latency. |
| Production stylesheet payload after unused-token removal | CSS 106,592 → 97,715 bytes; separately gzipped assets 22,526 → 21,150 bytes | Import/reference audit removes unused typed tokens. Browser CSSOM comparison preserves active declarations and retained property registrations; 90 unused custom-property declarations, 54 registrations and two unused utility classes disappear. Removed variables have no remaining CSS/JS consumers. This measures payload, not startup latency. |
| Syntax token reads: 20,000 lines, WebKit ABBA, 200 warm batches of 1,000 reads per arm/mode | Edit-input p50/p95 15/16 → <1/1 ms; source-input timing unchanged at <1/1 ms. Chromium retained JS heap after visiting all lines and GC 12.17 → 6.51 MB, stable on repeat | Memoize the input snapshot and let mounted rows own token slices instead of retaining a document-wide token map. Same token text; 25 actual source/diff/edit viewer states match in WebKit. Timing isolates the real hook with supplied classification, excluding native grammar, network and DOM work; heap is not whole-app memory. |
| Streamed responses: Codex translation, native transcript and publication; ABBA, 40 warm responses per arm/mode | 2,000-delta ASCII p50/p95 131.53/135.96 → 44.95/47.46 ms; Unicode 95.66/97.04 → 32.67/33.85 ms. Cumulative allocated bytes/ASCII response 794.81 → 3.74 MB | Append into owned strings instead of copying growing content on every delta. Separately instrumented allocation runs; timing uses the normal allocator. Over-limit 300-delta ASCII/Unicode p50 209.86/193.92 → 157.50/155.67 ms; output hashes match in every arm. Over-limit Unicode peak RSS was noisy; no reliable gain claimed. Excludes provider/network waits, persistence and rendering. |
| 2,000-note memory graph HTTP: ABBA, 60 measured reads per arm | Median run p50/p95 105.8/107.2 → 5.11/5.58 ms; payload unchanged at 811,868 bytes | Index the per-note supersession lookup, serialize native records directly and run reads off the async executor. Whole-fixture CPU 4.13 → 0.33 s and peak process RSS 25.0 → 20.1 MiB include startup, 35 graph reads and seven contract reads per run. Existing-database upgrade and response equality verified. |
| 500-node memory graph: WebKit, ABBA order, 200 ten-hover batches per arm | Median run p50/p95 56.5/64 → 37.5/41 ms | Direct node/edge rendering removes per-hover projections; script/DOM timing excludes paint. Fourteen interaction states match. Resize observers remaining after unmount: 1 → 0. |
| Transcript persistence: 10,000 messages, append updates and 64-message replacements; two release before/after/after/before rounds, 100 warm updates per mode/arm | Replacement p50 8.37 → 7.45 ms; allocated bytes/update 1.76 → 1.08 MB. Append allocations 588 → 505 KB | Indexed final-position lookup avoids counting history; complete replacements skip old-message reads, appends read prior content only, and validation consumes owned messages instead of cloning them. Restored transcripts match. Durable SQLite commits remain enabled; append and p95 latency changed little. Allocation volume is not peak memory; excludes providers and rendering. |
| Dynamic row styles: 1,000 mixed diff/graph rows, two WebKit before/after/after/before rounds, 100 warm updates per arm | Median update p50/p95 14/19.5 → 11/15 ms; median total 1,423.5 → 1,140 ms | Direct Solid CSS bindings remove 77 style-construction wrappers and the per-object property converter. Five DOM/style/layout states match; fixture includes real row components and styles, excludes provider/network work and frame-paced whole-app latency. |
| Workspace response: 1,000 chats across 100 groups/five repositories; 400 WebKit updates per arm | Payload 499 → 198 KB; update p50/p95 5/6 → 3/3 ms | Canonical pane records replace duplicate repository projections; includes JSON/WASM conversion and visible-chat lookup, excludes layout/paint. |
| Workspace selection/acknowledgement: 1,000 chats, WebKit before/after/after/before; 400 warm batches of ten cycles per arm | Per-cycle p50/p95 1.5/1.6 → 0.8/0.8 ms; WASM memory capacity 4.19 → 2.44 MiB | Shared typed snapshots and core selection rules replace duplicate JSON trees/rules. Includes JSON/WASM conversion, excludes DOM layout/paint and total app memory. Capacity is stable at 1,100 and 4,100 cycles. |
| Checkpoint capture and live edit preview: non-Git folder, 300 text files/33 MB; four before/after/after/before rounds, 40 warm previews per process | Median capture 27.47 → 21.44 ms; median preview p50/p95 0.73/0.77 → 0.13/0.14 ms; median peak process RSS 84.88 → 47.16 MiB | Immutable before-snapshots are shared across readers; non-Git capture walks and reads in one blocking job. Release service fixture includes finalize/revert/reopen assertions; excludes providers, HTTP and UI. |
| Checkpoint capture and live edit preview: Git repository, 25 pre-edited text files; four before/after/after/before rounds, 40 warm previews per process | Median capture 165.60 → 79.95 ms; median preview p50/p95 5.90/6.56 → 2.79/3.19 ms; peak RSS approximately 9.2 MiB in both | Checkpoints reuse the repository engine’s Apple Git launcher selection. Same release service fixture and restore assertions; excludes provider, HTTP and UI latency. |
| Checkpoint retention: 30 successive turns over a non-Git folder with 300 text files/33 MB; three before/after/after/before rounds, retaining ten checkpoints | Median peak process RSS 437.66 → 61.28 MiB; capture/finalize p50 approximately unchanged at 15–16/1.4 ms | Finalization releases the full working snapshot after retaining changed-file contents. Release service fixture verifies live/saved previews, history limit, restart and undo; excludes providers, HTTP and UI. |
| Renderer author avatars: 100 viewports of 100 distinct authors, before/after/after/before | Retained Chromium JS heap after GC 2.38 → 0.42 MB (0.46 MB after 20,000 authors); WebKit viewport p50/p95 unchanged at approximately 16/17 ms | Visible commit lookups belong to each graph; loaded author records reuse the bounded 500-entry cache. Actual hook with stubbed HTTP/storage, including cache serialization; excludes network, images, native caches and whole-app RSS. |
| Graph resize computation: 10,000 commits/13 lanes and 10,000 reachable IDs; two WebKit before/after/after/before rounds, 200 warm updates per arm | Median total 106.5 → 5 ms; JS-to-WASM inputs 4.548 MB → 88.8 KB | Actual Solid hook and release WASM; history lookups no longer depend on widths, native metadata replaces per-resize column arrays. Geometry matches across 45 scenarios. Stubbed viewport/avatar adapters; excludes DOM layout, paint, network and whole-app memory. |
| Repository selection computation: 10,000 commits; two WebKit before/after/after/before rounds, 200 warm selections per arm | Median total 93 ms → 0–1 ms per arm | Actual Solid selection memos use a snapshot-owned object lookup instead of a full ID-array WASM round trip. Eight state scenarios and 5,000-item retained selections preserve identity, refresh precedence and repository isolation. Excludes DOM layout/paint, HTTP and whole-app memory. |
| Diff prefetch target computation: 2,000 files; two WebKit before/after/after/before rounds, 200 warm selections per arm | Median total 186 ms → 0–1 ms per arm | Actual renderer projection and release WASM exchange scalar count/index instead of all file records. Neighbor order, wrapping, stage identity and Git-operation click/failure behavior match. Individual timings fall below WebKit resolution; excludes diff fetching and rendering. |
| Workspace store: 1,000 chats in 100 groups; before/after/after/before, 200 warm reads and title saves per arm | Read p50 0.64 → 0.32–0.34 ms; title-save p50 0.83–0.85 → 0.51–0.54 ms; allocated bytes/read 1.97 → 0.91 MB and/save 2.50 → 1.43 MB | Typed internal snapshots remove discarded JSON trees. Timings use the normal allocator; allocation totals come from a separate counting pass. Includes local file I/O, excludes HTTP/rendering; allocation volume is not peak memory. |
| Workspace HTTP read: 1,000 chats in 100 groups; two before/after/after/before rounds, 300 warm reads per arm | Median p50/p95 1.00/1.08 → 0.75/0.81 ms; response unchanged at 185,677 bytes; peak RSS approximately 25 MiB in both | Direct typed serialization removes the intermediate JSON tree. Real release HTTP server with disposable profile; workspace payload and 13 response/authentication cases match. Excludes providers, WebKit and whole-app latency. |
| Git status: 2,000 tracked edits (every third staged) and 100 untracked files; two alternating rounds of 25 warm reads per arm | Payload 799 → 590 KB; serialization p50 0.35 → 0.25 ms | Canonical files replace copied groups; typed revision hashing avoids JSON temporaries. Full Git status latency effectively unchanged. |
| Commit details/comparison: 12 changed files; before/after/after/before, 25 warm samples per arm | Details p50 10.56 → 6.63 ms; comparison 14.09 → 11.27 ms; native/Git CPU for 31 paired reads 1.11 → 0.55 s | One raw+numstat read, shared filename parsing and removal of unconsumed detail metadata. At 2,008 files, details 114.4 → 109.5 ms and comparison 116.4 → 113.4 ms; excludes renderer layout/paint. |
| Idle scheduler: 100 saved skills, before/after/after/before with 500 warm ticks per arm | Tick p50 0.130–0.138 → 0.013–0.018 ms; p95 0.153–0.183 → 0.016–0.022 ms | Idle ticks skip skill reads, copies and write transactions. Active phases share one blocking task and one skill snapshot, retaining separate lock scopes. Tight-loop fixture; the one-second cadence is unchanged and this does not measure whole-app idle CPU. |
| Skill store: 100 custom skills, before/after/after/before with 100 warm reads per arm | Read p50 0.42–0.47 → 0.08–0.09 ms; p95 0.51–0.59 → 0.084–0.105 ms | One owned SQLite connection replaces per-read opening/schema/migration work. Reads observe committed edits without waiting for a concurrent WAL writer. Small absolute latency gain; not total startup latency. |
| Directory discovery: 7,641 folders, before/after/after/before with 30 warm samples per query/arm | Search p50 112.8 → 103.3 ms; quick picks 111.1 → 101.1 ms; cumulative allocated bytes/search 10.83 → 8.17 MB | Shared ranking retains matching entries only; timestamps are read only for quick-pick repositories. Identical results across all rounds; allocation volume is not peak memory. Excludes HTTP and rendering. |
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
improve in the memory-focused passes. The native comparison above establishes
only its stated startup boundary and short idle observations. Realistic
long-session memory, trusted input-to-paint timing and provider/network latency
still need matched measurements; the isolated results do not establish those gains.

Earlier renderer experiments found no useful WebKit switching improvement from
CSS containment, transform-based hidden views or changing graph row positioning.
Visibility stacking regressed switching. Streaming WASM loading did not beat the
small synchronous load; `wasm-opt` reduced raw size without reducing gzip size.
Do not reintroduce these approaches without new workload evidence.

The October 21 streaming pass also removes the renderer's redundant finalization
map. Its native development fixture uses a separate profile and a synthetic
provider (180 mixed-height rows and 160 tail deltas). Streaming content and
restart restoration were observed, but full native scroll validation remains
incomplete: the UI automation repeatedly reported `noWindowsAvailable`; both the
preserved baseline and candidate showed a blank history region, and the candidate
painted its tail after focus changed. A trial percentage-height CSS change did not resolve it and was removed.
These results do not establish a 300–500% improvement across the application.
The pass adds 15 frontend lines and 56 Rust production lines, no production files;
it moves measurement rules into Rust but is not a net source-size reduction.
