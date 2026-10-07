# Performance notes

Where renderer and repository time goes, which approaches do not help, and where to look next. Chat-surface rules (inert hidden panes, scoped streaming updates) are in [src/modules/conversation/PERFORMANCE.md](../src/modules/conversation/PERFORMANCE.md).

## Current state

- A renderer pass cut main-thread blocking on a repository switch from 35–42 ms to about 4 ms and made scrolling and graph loading somewhat cheaper.
- It did not make the app feel faster: a repository still takes about 80–90 ms to appear after a click in WebKit, and differences under about 100 ms are hard to feel.
- Desktop launch over a real network and long-session responsiveness are not measured yet.

## Approaches that do not help (measured)

| Idea | Result |
| --- | --- |
| Load the WASM asynchronously or streaming | The synchronous path costs only 4–6 ms; streaming is slower |
| `wasm-opt` | −6% raw size, same gzip size, +15 s per build |
| Position-keyed commit rows (`<For keyed={false}>`) | Small scrolls update every row; slower in Chromium |
| `content-visibility: hidden` for inactive repositories | WebKit switch about 130 ms (worse) |
| `visibility: hidden` stacking | About 113 ms (worse; `visibility` restyles every descendant) |
| Stack all repositories, hide with an off-screen `transform` | No gain in headed WebKit |
| Take commit rows out of absolute positioning or transform | No gain |
| CSS containment on rows or the graph panel | No gain |
| Run the DOM/StyleX app through a GPU renderer (GPUIX) | About 4× slower switching (≈340 ms) and broken styling; `@gpuix/solid` supports Solid 1.9 only |

## Not yet investigated (most likely to be what feels slow)

1. **Backend latency.** `/api/git/graph`, `/api/git/diff`, `/api/git/statuses`, `/api/git/commit-details` and chat loads run `git` and `gh` processes and can take hundreds of milliseconds to seconds. Time each endpoint during launch and repository switching, then cache, parallelize or return less.
2. **Desktop launch in WebKit.** Trace with Safari Web Inspector (`bun run dev`, then Develop → inferay → Timelines).
3. **Long sessions.** Whether the app slows as chats grow or agents stream.
4. Only after those: commit graph rendering (canvas, or on-screen rows first). Expected gain about 1.5× on a switch.
