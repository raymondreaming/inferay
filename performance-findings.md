# Performance findings

Measurements taken on 2026-09-23 against base `f070dc6a`.

## Bottom line

- The initial renderer pass changed **57 files, +203 / −282 lines**, plus one new test file.
- They cut the **main-thread blocking** of a repository switch from 35–42 ms to about 4 ms,
  and made scrolling and graph loading somewhat cheaper.
- They did **not** make the app feel noticeably faster. A repository still takes about
  80–90 ms to appear after a click in WebKit, and differences under ~100 ms are hard to feel.
- Real-network desktop launch and long-session responsiveness remain unmeasured in this pass.
  Earlier WebKit launch varied from 0.8–5.3 s against 0.33 s in Chromium on the same data.

## What changed in the code

### Repository switching and scrolling

| Change | File | Effect (measured) |
| --- | --- | --- |
| Removed a synchronous `clientHeight` read when a chat list becomes active; its `ResizeObserver` already reports the height before paint | `conversation/components/ChatMessageList/index.tsx` | Main-thread time per switch 35–42 ms → 4 ms (WebKit, A/B, 3 × 22 switches) |
| Chat composer re-measures its height only when its text changed | `conversation/components/ChatComposer/index.tsx` | Removed one forced layout per composer per switch |
| Chat scroll: no capture while hiding (the Rust model ignored it); first restore pass before paint instead of mid-effect | `conversation/components/ChatMessageList/useChatViewport.tsx` | Scroll position after switching away and back unchanged (verified) |
| Hidden commit graph no longer records a 0 px height and rebuilds every row on return | `repository/components/graph/components/CommitGraph/useGraphViewport.tsx` | Chromium switch script ~15 → ~8 ms |
| Removed an eager `getBoundingClientRect()` in `observeResponsiveGridColumns` | `workspace/components/WorkspaceCanvas/index.tsx` | One forced layout fewer |
| Commit rows bind `class` directly instead of spreading `stylex.attrs(...)` (20 elements) | `CommitGraph/*.tsx` | Chromium scroll script −15% |
| Commit graph overscan 12 → 6 rows each side | `native/presentation/src/graph.rs` | Chromium scroll script 206–232 → 184 ms |
| Commit avatars requested at 64 px instead of 460 × 460 | `native/server/src/forge.rs` | ~1.7 KB per avatar; no full-size decode per row |
| MCP icons refetch every 15 s only while a shown server has no icon | `conversation/components/ChatMessageList/McpSourceMark.tsx` | Fewer background requests |
| Web Inspector enabled in debug host builds | `native/desktop-host/src/main.rs` | Safari → Develop → inferay works with `bun run dev` |

### Models

- Added Opus 5.5 (new Claude default), GPT-6 Sol and GPT-6 Luna.
- Codex reasoning is now per model: Max and Ultra are offered only where the Codex CLI
  supports them; a saved level above a model's cap clamps to the cap
  (`native/core/src/provider_config.rs`, `native/presentation/src/composer.rs`,
  test in `native/core/tests/provider_config.rs`).
- Removed the eight Codex models the CLI no longer lists. Saved chats only used GPT-5.5 and
  GPT-6 Astra, which remain.

### Removed code

- 4 unused exports (`runtimeFont`, `runtimeLayer`, `MutableRef`, duplicate `scrollPreferencesKey`).
- 43 exports made module-private (only used in their own file).
- 12 dead StyleX entries and style functions (87 lines) and the empty
  `BorderBeamOverlay/styles.ts`.
- Dead onboarding `card` branch and the refs only it used (fixed a `tsc` error).
- Unused dependencies: `yaml`, `@babel/generator`, `@playwright/test`.
- `electrobun-webkit-app-region-*` classes renamed to `inferay-app-region-*`.

## Measurements

Measured on a copy of real user data with the release dev server, in Playwright Chromium
(CPU profiles) and WebKit (headless and headed). Numbers are medians.

| Measurement | Before | After |
| --- | ---: | ---: |
| WebKit: main-thread time per repository switch | 35–42 ms | 4 ms |
| WebKit: click → second frame, repository switch | 82–92 ms | 81–94 ms |
| WebKit: floor (clicking the already-active tab) | 14 ms | 14 ms |
| Chromium: script per repository switch | ~15 ms | ~8 ms |
| Chromium: script across 40 graph scroll steps | 255–293 ms | 184 ms |
| WebKit: graph scroll frame time p50 / p95 | 22–26 / 39–46 ms | 21 / 35–36 ms |

### Git follow-up

On the existing 10,000-commit offline fixture, release-mode native measurements (20 warm
runs per version) show graph preparation at **73.19 → 24.96 ms p50** and commit-details
construction at **49.22 → 29.80 ms p50**. Graph preparation now derives the current
worktree and HEAD from its worktree listing, avoiding three Git subprocesses on the
normal path, and overlaps its independent refs, operation, and status reads. Commit
details reads independent refs, file changes, and provider metadata concurrently. On
the same fixture, a release server returned unchanged graph HTTP requests in **54.51 →
28.05 ms p50** over 20 warm requests per build. These results do not establish the
same change in WebKit interaction time or explain the reported three-second
commit-details outlier.

### Launch font dependency

The HTML head loaded Google Fonts as a render-blocking stylesheet. In headless WebKit,
delaying that stylesheet by 3 seconds delayed app DOM rendering to **3,069–3,075 ms**.
Loading it with print media and applying it on load let the app render in **65–83 ms**
under the same delayed response; the font stylesheet applied after about 3,020 ms.
This isolates the blocking dependency under a simulated slow font response. It does
not establish a new real-network or desktop-launch p95.

### Desktop app checks

- On the first launch, graph avatars appeared about 3.5 seconds after the graph. On a
  later launch, cached avatars were present in the first visible graph frame.
- After the graph settled, eight rapid Down key presses moved the selection eight
  rows. The intermittent keyboard stall reported during loading was not reproduced
  or timed.
- A TypeScript diff showed highlighted code in a screenshot captured about 1.05
  seconds after clicking. This is not a precise click-to-highlight measurement.
- The diff now starts a highlighted preview before the full result mounts and keeps
  plain code hidden while highlighting is pending. Avatar matches use exact email
  identity, and successfully loaded images are cached across launches.

### Where a repository switch spends its time now (WebKit)

- JavaScript ≈ 5 ms in total: Rust/wasm < 1 ms, forced layout ≈ 1 ms, frame callbacks ≈ 2 ms.
- Everything else is WebKit rendering the repository view:
  - commit graph rows ≈ 25 ms
  - chat ≈ 10–20 ms
  - the rest (changes panel, headers, bars)

A visible repository contains about 1,850 DOM nodes; the commit graph is about 45% of them
(51–63 rows × 13 nodes).

## Tried and rejected (measured, reverted)

| Idea | Result |
| --- | --- |
| Load the WASM asynchronously / streaming | The synchronous path costs only 4–6 ms; streaming was slower |
| `wasm-opt` | −6% raw size, same gzip size, +15 s per build |
| Position-keyed commit rows (`<For keyed={false}>`) | Small scrolls update every row; slower in Chromium |
| `content-visibility: hidden` for inactive repositories | WebKit switch ~130 ms (worse) |
| `visibility: hidden` stacking | ~113 ms (worse; `visibility` restyles every descendant) |
| Stack all repositories, hide with an off-screen `transform` | No gain in headed WebKit |
| Take commit rows out of absolute positioning / transform | No gain |
| CSS containment on rows or the graph panel | No gain |

## Assumptions that turned out wrong

- **Startup WASM:** listed as the biggest startup win; it costs 4–6 ms.
- **Absolute positioning of graph rows:** not the cause of graph cost.
- **GPUIX renderer migration:** running the existing DOM/StyleX app through GPUIX made
  switching ~4× slower (≈ 340 ms) and broke styling. That work is saved in `git stash stash@{0}`.
  The official `@gpuix/solid` supports Solid 1.9 only; Inferay uses Solid 2.

## Not yet investigated (most likely to be what feels slow)

1. **End-to-end backend latency.** How long `/api/git/graph`, `/api/git/diff`, `/api/git/statuses`,
   `/api/git/commit-details` and chat loads take on real repositories. These run `git` and `gh`
   processes and can take hundreds of milliseconds to seconds. None of the numbers above include them.
2. **Real desktop launch in WebKit.** The render-blocking font dependency is fixed, but
   the earlier first-usable-screen spread of 0.8–5.3 s needs a new controlled run.
3. **Long-running sessions.** Whether the app slows down as chats grow or agents stream.

## Recommended next steps

1. Time every backend request during launch and repository switching (server-side timings per
   endpoint), then fix the slowest: caching, parallelizing `git` calls, or returning less data.
2. Trace launch in WebKit with Safari Web Inspector (`bun run dev`, then Develop → inferay → Timelines).
3. Only then consider the commit graph rendering change (canvas, or rendering on-screen rows
   first). Expected gain: switch ~85 → ~50–60 ms, about 1.5×.

## Verification

`tsc` (except the gitignored local fixture `scripts/tests/fixtures/solid-runtime.tsx`), oxlint,
Biome on changed files, architecture boundaries, `bun test scripts/tests` (29 passing),
`cargo test --workspace` (126 passing), release app build.
