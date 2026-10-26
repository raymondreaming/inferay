# Coding guidelines

## Default engineering decisions

Prefer the smallest coherent implementation that solves the real problem. These decisions apply to features, fixes, refactors, migrations, tooling, tests, and documentation in every language. Architecture should reduce complexity, not add sophistication.

- Try deletion, inlining, merging, reuse, specialization, and simplification before adding code. Follow deletion cascades through unused types, imports, tests, and empty files.
- Give each behavior one semantic owner. Keep validation, formatting, transitions, and persistence near the concept they serve. Merge related responsibilities; do not create unrelated god files or generic utility dumping grounds.
- Inline trivial one-use helpers and constants unless their names express important policy or a real boundary. Tests do not count as production consumers. Do not split files merely to shorten them.
- Prefer direct calls and standard platform functionality. Remove pass-through layers, duplicate representations, conversion chains, and unused configurability. Keep interfaces, traits, factories, classes, and generic systems only when their actual responsibilities justify them; testing convenience alone is insufficient.
- Preserve real runtime, API, security, transactional, and ownership boundaries. Do not invent intermediate layers or speculative extension points. A few repeated lines can be cheaper than an abstraction.
- Store authoritative facts and derive summaries. Keep mutation and persistence ownership explicit, validate at real trust boundaries, and normalize once. Importing an ordinary module must not unexpectedly start processes, connect services, or perform writes.
- Remove unused outputs and obsolete compatibility after checking actual consumers and persisted data requirements. Version control is the archive; finish migrations without leaving aliases or duplicate paths behind.
- Before porting code to Rust, delete dead behavior, consolidate duplicates, and simplify its owner. Migrate only what remains. Track TypeScript lines and file count as well as total size; moving code between frontend files is not a reduction.
- Optimize redundant work, serialization, allocation, and I/O before adding caches or infrastructure. Measure performance claims when practical.
- Keep public APIs small and semantic, implementation details private, control flow obvious, and reductions readable. Never pursue counts through minification, giant functions, or weakened verification.
- Test observable behavior and failure invariants rather than preserving unused APIs for tests. Fix the source of truth instead of adding compensating layers.
- Keep documentation canonical and current. Rewrite outdated descriptions instead of appending a history of corrections.

When choices are comparable, prefer fewer concepts, fewer execution paths, fewer representations, and fewer indirect calls. The surrounding code should be easier to trace, modify, and delete after the change.

## Formatting

Rust formatting is owned by `rustfmt.toml`. Run `bun run format` for both the shared Rust workspace and the separate GPUI crate; vendored dependencies are excluded. Use the standard formatter output instead of manually compressing code or adding formatting skips. Repository editor settings enable Rust format-on-save with rust-analyzer. The commit hook formats staged first-party Rust files without following their child modules, preserving lint-staged's handling of partially staged files. `bun run format:check` is the read-only gate and runs first in `bun run check`.

JavaScript, TypeScript, JSON, and CSS retain the existing Bun formatter and lint-staged configuration.

## Architecture

GPUI (`native/gpui`) is Inferay's only desktop UI. The Solid renderer and webview host were removed at the GPUI-only cutover. Implement future features, fixes, and performance work in GPUI and the existing shared Rust owners. Known feature gaps are tracked in `native/gpui/README.md`; validate changes incrementally without recreating a second UI.

Dependencies flow inward: GPUI → server/diff engine/presentation → core. Core remains pure: no filesystem, process, network, persistence, or renderer dependencies. Presentation owns pure layout and interaction models. Server owns authenticated APIs, persistence, provider processes, projects, and outbound network operations. GPUI owns native rendering, input, focus, viewport state, and background task lifetimes.

Keep Git work, parsing, image decoding, and I/O off the UI thread. Retain opened views and stable identities. Publish coherent background results, preserve drafts and scroll anchors, and cancel work when its owner no longer needs it. Do not duplicate canonical shared state in renderer-specific models.

Use the shared native button/menu surfaces, design tokens, and semantic feature owners. Keep menus floating outside document flow. Validate keyboard, clipboard, focus, resize, and accessibility behavior as part of interaction changes.

## Network boundary

Agents use local Git, GitHub CLI, and direct service connectors. Outbound HTTP belongs in `native/server`; GPUI's backend adapter communicates only with the authenticated loopback service. Never start two backend owners against one profile. Do not edit the user database directly.

## Verification

Run the smallest relevant Rust tests while changing an area, then `bun run check` for the cutover gates. `bun run code` counts production Rust source without tests or vendors. Build GPUI with `bun run build`; `bun run dev` builds and opens the development bundle. Keep product behavior and known limitations documented; compilation alone does not establish UI parity.
