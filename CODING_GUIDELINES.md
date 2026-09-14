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

## Architecture

Inferay has a local Rust backend and a Solid renderer. Dependencies flow inward:

```text
src/shared/                         reusable browser-neutral primitives and contracts
  ↓
native/core/                        stable vocabulary, state, protocol, path policy
native/presentation/, diff-engine/  pure projection and repository engine
native/server/                      HTTP, persistence, process and application orchestration
  ↓
src/adapters/                       generated/native contract adapters
  ↓
src/modules/                        feature hooks and rendering components
  ↓
src/app/, src/router.tsx, client.tsx composition root
```

`native/core` must not depend on the server, desktop host, renderer, or Solid. Pure Rust projections and engines must not reach into HTTP, persistence, or UI. Cargo owns Rust crate acyclicity; do not add reverse dependencies to make a local import convenient.

`src/shared` contains reusable primitives, contracts, UI, and browser/native adapters. It must not import app or feature code. Generated native types may enter through `@contracts`. `src/app` composes modules; modules must not import it, route entries, or `client.tsx`.

Within a feature, `model/` owns vocabulary and framework-independent rules; `services/` owns native adapters and persistence orchestration; `hooks/` adapts those operations to Solid; `components/` renders and translates input. Models must not import hooks, components, services, or browser/native runtime adapters. Shared model code follows the same rule. Keep appearance settings in `modules/settings`, and window-host constants in `shared/lib/windowChrome.ts`, so features never need to reach into the composition root.

Keep domain-shaped behavior in Rust pure models where it is shared with the native server and WebAssembly renderer. Solid hooks adapt signals, browser events, and query lifecycles; components render and translate interactions. Pass context-derived values into pure functions instead of reading browser state from them.

Reuse serialized Rust types through `@contracts` instead of redeclaring their fields in TypeScript. Derive renderer subsets with `Pick`, `Omit`, or `Extract`. Dock resizing and decorated-text segmentation run in the Rust presentation engine; the browser supplies pointer coordinates and text and renders the result. Check `bun run code` after each reduction pass and report both frontend and total changes without changing counting exclusions.

Native diff responses include viewer metadata prepared by the Rust presentation model. Render it through the generated `HunkDiff` contract; do not serialize diff contents back into WebAssembly to derive the same metadata. Change navigation uses the existing change ranges. Directory search and quick picks likewise share the native `AgentDirectory` contract instead of parallel renderer models and per-result conversions.

Workspace actions are defined in `native/core/src/workspace_action.rs`, exported through `@contracts`, and matched by the transition code in `native/core/src/agent_state/actions.rs`. Do not recreate that union in TypeScript or dispatch workspace actions by indexing arbitrary JSON. The HTTP boundary deserializes the same Rust contract; server-only summary and provider-session updates use dedicated store methods. Persistence and default-provider selection stay outside the transition dispatcher.

`native/core/src/agent_state.rs` owns the workspace schema and invariants. Its `actions.rs` module owns transitions and pending-directory consumption; `queries.rs` owns pane lookup, active-directory ordering, and renderer projections. File reads, atomic saves, and reload orchestration belong to `native/server/src/workspace_store.rs`. The native boundary check rejects storage, transport, and process references in the workspace core. Persistence tests live beside the server store; core tests exercise transitions and contracts without a filesystem.

The same boundary applies to agent context and search-folder settings. Core `agent_context.rs` composes layers and activates skills from an in-memory state and caller-supplied project keys; `config.rs` owns settings vocabulary and defaults. Server `agent_context_store.rs` and `settings_store.rs` own file access, and the context adapter normalizes relative project paths before entering the core. Core code must not read the process's current directory to resolve a project key.

Core `agent_kind.rs` owns provider vocabulary. Binary discovery, environment construction, and command availability probing belong to server `agent_command.rs`. The server's `agent_protocol.rs` captures file snapshots and resolves reference roots before invoking the core protocol translator with `ProtocolFiles`. Protocol translation must not read files; tests can supply before/after contents directly.

Core `prompts.rs` owns skill vocabulary and validation. Its `prompts/library.rs`, `commands.rs`, `cards.rs`, and `tools.rs` modules operate on supplied values: editing and proposal decisions, command expansion, card parsing, and tool dispatch. Server `prompt_store.rs` loads the bundled/local libraries and persists accepted changes. Atomic file replacement and its platform dependencies belong to server `atomic_write.rs`. Read-only skill tools and proposal previews must never write the library.

Core `path_security.rs` normalizes paths against a caller-supplied working directory and checks containment without reading the filesystem. Server `path_resolution.rs` resolves route inputs against the process directory. Repository `diff-engine/src/path_access.rs` resolves real files and checks the resolved path against the same policy before reading content. Keep symlink and missing-file tests beside that adapter.

`native/core/clippy.toml` and its Cargo lint settings prohibit filesystem, process, network, environment, and terminal access throughout the core crate, including aliases and `Path` methods. Native boundary checks run this compiler-backed gate for every module; there is no migrated-file allowlist. Core tests use supplied facts, while platform integration tests belong to the owning adapter crate.

## Floating surfaces

Use `surfaceStyles.overlay` from the design system on the visible container of dialogs, modals, menus, and popovers. It owns the background, border, shadow, and `effect.floatingSurfaceBlur`; local styles own layout and radius. The root appearance mode sets `--inferay-overlay-blur` (56px in glass mode, none otherwise). Do not override those surface properties in individual dialogs or introduce modal-specific blur tokens. Use `shared/ui/Modal` for full-window dialogs such as Settings and Skills; it owns the native dialog lifecycle, focus restoration, backdrop dismissal, close control, and glass surface. Callers supply layout, content, and guarded dismissal. Backdrops only dim the workspace. Never put a filtered or translucent-opacity ancestor around a glass surface: it creates a backdrop root that prevents the surface from blurring the underlying workspace. Use an alpha background color for dimming instead.

## Solid 2 reactivity

Use Solid's fine-grained graph directly. Derive values with `createMemo`; do not mirror a derived value into a signal through an effect. Use `createEffect` only to synchronize with an external system such as the DOM, a browser listener, timer, native subscription, or query observer, and return its cleanup from the same effect.

Keep a hook when it owns a cohesive browser or query lifecycle. Do not create a hook only to forward props, wrap a memo, or hide one event handler; place those directly in the owning component. Keep feature state and mutations together, and pass narrow accessors or callbacks to children instead of broad mutable state objects.

## Network boundary

Inferay's agents use local Git, the GitHub CLI, and direct service connectors such as Linear MCP. Agent launches disable the inherited GitKraken MCP server without modifying the user's global provider configuration. Keep integration failures specific to the actual service; do not route authentication through GitKraken. Historical chat can still display past GitKraken tool calls.

`src/shared/lib/native.tsx` is the sole low-level browser HTTP client. It applies a timeout to every request. Do not use `fetch()` elsewhere. Keep endpoint-specific orchestration in services, and pass side-effecting operations into presentational children as callbacks. Services must check failed HTTP responses before reporting a mutation as saved.

Feature services own endpoint paths, request payloads, and response parsing. For example, `src/modules/settings/services/settingsApi.ts` is the settings HTTP adapter. UI code may depend on a feature service contract, never on a raw endpoint or the HTTP wrapper.

The architecture checker permits raw endpoint helpers only in a `services/` module, including shared native-compute services. It parses imports and re-exports and resolves both aliases and relative paths; namespace and dynamic imports cannot bypass this rule. There are no transport exceptions.

Persistence orchestration accepts an injected port. `modules/workspace/services/workspaceSession.ts` owns request ordering and publishes optimistic selection without importing Solid or a live transport. The Rust workspace replica owns selection intent, repeated-selection suppression, optimistic state, and acknowledgement rollback. The service retains the asynchronous persistence queue. Tests supply controlled persistence and exercise the same native rules.

Git action labels, response contracts, and post-action selection rules belong to `native/presentation/src/git_actions.rs`; server routes and renderer transport failures use that same model. `modules/repository/services/gitOperations.ts` sequences requests, refreshes, and selection callbacks through an injected transport configured in `app/bootstrap/workspace.ts`. Keep these operations out of the rendering controller. Working-tree keyboard navigation uses the Rust changes-panel model so its file order matches the sidebar.

`src/app/bootstrap/workspace.ts` wires production persistence for workspace state and panel sessions. Rust panel replicas replay pending actions over acknowledged sessions; file bodies remain in the browser cache. Their hooks own Solid state and query lifecycles; services can be tested without loading the UI or a live backend.

Rust workbench models also resolve retained workspace views from the active and previously visited keys. The renderer receives group and pane indices into its current state, preserving object identity without constructing every possible view or duplicating pane records. Only visited views count toward the eight-view/twenty-four-pane budget; an oversized active view remains mounted.

## Module shape

Use feature folders under `src/modules`. Repository views and repository orchestration belong under `repository`; pane layout, workspace sessions, and docking belong under `workspace`. Keep reusable UI in `src/shared/ui`, browser-neutral helpers in `src/shared`, and generated contracts behind `src/adapters` or `@contracts`.

Use direct paths within a feature. For a cross-layer import, use the owning alias: `@shared`, `@design-system`, `@app`, `@repository`, `@workspace`, `@conversation`, `@agents`, `@context`, `@explorer`, `@settings`, or `@skills`. These aliases name folders only; they are not barrel APIs.

StyleX `styles.ts` modules are the exception: its compiler resolves theme definitions before Vite aliases, so they must keep a relative import of `src/design-system/styles.stylex.ts`.

Avoid barrel files unless repeated import churn demonstrates a stable public interface. Keep components under 500 lines. Existing oversized repository and workspace files are hotspots: extract new responsibilities rather than extending them.

The boundary checker rejects all source import cycles, including type-only cycles. There are no cycle exceptions. Put parent/child contracts in a local `types.ts` or the owning model instead of importing a parent component from its child.

## TypeScript and tests

Keep TypeScript strict: unused locals and parameters, implicit returns, switch fallthrough, and unintended overrides are errors. Do not add explicit `any`; use `unknown` plus narrowing, or a narrowly scoped suppression that states why it is safe.

Refactors are implementation-first. Establish the new direction, ownership, and public surface before modifying tests. Existing tests are evidence about behavior, not constraints on architecture. Do not preserve a wrapper, helper, export, compatibility path, or duplicate implementation merely because a test uses it. Preserve required user behavior and real external contracts; an intentional behavior change should be explicit.

Once the direction is settled, reconcile tests in one pass: delete tests for removed behavior and implementation details, consolidate duplicate coverage, and update the small set that protects the resulting behavior. Behavior-preserving moves, extractions, and deletions do not require new tests or unrelated test edits. Do not write tests that reconstruct the implementation to compute their expected result.

Keep tests proportional to risk. Prioritize data integrity, persistence failures, request ordering, cancellation, path access, and meaningful user interactions. Prefer one authoritative test at the lowest useful level; add another level only when it covers a distinct integration failure. A manual app smoke test is useful for visible flows, while failure and ordering cases need focused automated coverage. Test count and coverage percentage are not goals.

For features and bug fixes, add or update the smallest behavior regression when it adds useful protection. During refactors, run focused checks after the implementation settles, or earlier when a concrete failure needs diagnosis. Do not repeatedly run the full suite and build after each small edit. Run broader verification once at the end of a batch when its affected surface warrants it.

Select verification commands for the changed surface: `bun run lint`, `bun run check:boundaries`, `bunx tsc --noEmit`, targeted `bun test` files, and relevant Rust tests or compiler checks. `bun test scripts/tests`, `cargo test --workspace`, and `bun run check:architecture` are broader completion gates for changes spanning those surfaces. Documentation and test-only cleanup do not require rebuilding the app or running unrelated suites. Pre-commit formats and lints changed files; it does not require a token test-file change or enforce when tests were written.

Oxlint is the repository-wide JavaScript/TypeScript linter, configured in `.oxlintrc.json`. Correctness violations and warnings fail checks. Use `bun run lint:fix` for safe automatic fixes. Generated output, vendored icons, documentation, and the separate `site/` project are excluded. The Solid structural audit and architecture dependency checker remain authoritative for framework and layer rules; React hook rules do not apply to Solid. Intentional reactive property reads should use `void` so their tracking purpose is explicit. Underscore-prefixed callback parameters may be unused, and side-effecting ternaries and short-circuit expressions are allowed.

Oxlint replaces Biome's JavaScript/TypeScript linting, including the former focused architecture lint command. It enables correctness checks from the ESLint, TypeScript, Unicorn, Oxc, and JSX accessibility rule sets, plus explicit equality, const/var, eval, empty-block, redundant-code, and type-assertion checks. The previous accessibility exceptions for static element handlers, semantic tag preference, and click/key pairing remain. Suppress exceptional diagnostics narrowly with `oxlint-disable-next-line rule -- reason`.

Keep Biome only for formatting, import organization, and CSS/JSON linting, which Oxlint does not provide. React-specific hook and fragment rules are intentionally omitted for Solid. Existing TypeScript compiler checks and custom architecture/Solid checks remain; Oxlint's default rules are not a substitute for those checks or a one-to-one copy of Biome's recommendations. Pre-commit runs Oxlint on staged JavaScript/TypeScript and Biome on supported staged files. `bun run check` validates without rewriting files; `bun run format` formats renderer source.
