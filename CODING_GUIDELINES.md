# Coding guidelines

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

Workspace actions are defined in `native/core/src/workspace_action.rs`, exported through `@contracts`, and matched by the transition code in `native/core/src/agent_state/actions.rs`. Do not recreate that union in TypeScript or dispatch workspace actions by indexing arbitrary JSON. The HTTP boundary deserializes the same Rust contract; server-only summary and provider-session updates use dedicated store methods. Persistence and default-provider selection stay outside the transition dispatcher.

`native/core/src/agent_state.rs` owns the workspace schema and invariants. Its `actions.rs` module owns transitions and pending-directory consumption; `queries.rs` owns pane lookup, active-directory ordering, and renderer projections. File reads, atomic saves, and reload orchestration belong to `native/server/src/workspace_store.rs`. The native boundary check rejects storage, transport, and process references in the workspace core. Persistence tests live beside the server store; core tests exercise transitions and contracts without a filesystem.

The same boundary applies to agent context and search-folder settings. Core `agent_context.rs` composes layers and activates skills from an in-memory state and caller-supplied project keys; `config.rs` owns settings vocabulary and defaults. Server `agent_context_store.rs` and `settings_store.rs` own file access, and the context adapter normalizes relative project paths before entering the core. Core code must not read the process's current directory to resolve a project key.

Core `agent_kind.rs` owns provider vocabulary. Binary discovery, environment construction, and command availability probing belong to server `agent_command.rs`. The server's `agent_protocol.rs` captures file snapshots and resolves reference roots before invoking the core protocol translator with `ProtocolFiles`. Protocol translation must not read files; tests can supply before/after contents directly.

Core `prompts.rs` owns skill vocabulary and validation. Its `prompts/library.rs`, `commands.rs`, `cards.rs`, and `tools.rs` modules operate on supplied values: editing and proposal decisions, command expansion, card parsing, and tool dispatch. Server `prompt_store.rs` loads the bundled/local libraries and persists accepted changes. Atomic file replacement and its platform dependencies belong to server `atomic_write.rs`. Read-only skill tools and proposal previews must never write the library.

Core `path_security.rs` normalizes paths against a caller-supplied working directory and checks containment without reading the filesystem. Server `path_resolution.rs` resolves route inputs against the process directory. Repository `diff-engine/src/path_access.rs` resolves real files and checks the resolved path against the same policy before reading content. Keep symlink and missing-file tests beside that adapter.

`native/core/clippy.toml` and its Cargo lint settings prohibit filesystem, process, network, environment, and terminal access throughout the core crate, including aliases and `Path` methods. Native boundary checks run this compiler-backed gate for every module; there is no migrated-file allowlist. Core tests use supplied facts, while platform integration tests belong to the owning adapter crate.

## Solid 2 reactivity

Use Solid's fine-grained graph directly. Derive values with `createMemo`; do not mirror a derived value into a signal through an effect. Use `createEffect` only to synchronize with an external system such as the DOM, a browser listener, timer, native subscription, or query observer, and return its cleanup from the same effect.

Keep a hook when it owns a cohesive browser or query lifecycle. Do not create a hook only to forward props, wrap a memo, or hide one event handler; place those directly in the owning component. Keep feature state and mutations together, and pass narrow accessors or callbacks to children instead of broad mutable state objects.

## Network boundary

`src/shared/lib/native.tsx` is the sole low-level browser HTTP client. It applies a timeout to every request. Do not use `fetch()` elsewhere. Keep endpoint-specific orchestration in services, and pass side-effecting operations into presentational children as callbacks. Services must check failed HTTP responses before reporting a mutation as saved.

Feature services own endpoint paths, request payloads, and response parsing. For example, `src/modules/settings/services/settingsApi.ts` is the settings HTTP adapter. UI code may depend on a feature service contract, never on a raw endpoint or the HTTP wrapper.

The architecture checker permits raw endpoint helpers only in a `services/` module, including shared native-compute services. It parses imports and re-exports and resolves both aliases and relative paths; namespace and dynamic imports cannot bypass this rule. There are no transport exceptions.

Persistence orchestration accepts an injected port. `modules/workspace/services/workspaceSession.ts` owns request ordering and optimistic selection without importing Solid or a live transport. Its tests instantiate the same service with a controlled persistence port and the native projection function.

Git action labels, response contracts, and post-action selection rules belong to `native/presentation/src/git_actions.rs`; server routes and renderer transport failures use that same model. `modules/repository/services/gitOperations.ts` sequences requests, refreshes, and selection callbacks through an injected transport configured in `app/bootstrap/workspace.ts`. Keep these operations out of the rendering controller. Working-tree keyboard navigation uses the Rust changes-panel model so its file order matches the sidebar.

`src/app/bootstrap/workspace.ts` wires production persistence and projection implementations for workspace state and panel sessions. Their hooks own Solid state and query lifecycles; the services accept ports and can be tested directly without loading the UI or a live backend.

## Module shape

Use feature folders under `src/modules`. Repository views and repository orchestration belong under `repository`; pane layout, workspace sessions, and docking belong under `workspace`. Keep reusable UI in `src/shared/ui`, browser-neutral helpers in `src/shared`, and generated contracts behind `src/adapters` or `@contracts`.

Use direct paths within a feature. For a cross-layer import, use the owning alias: `@shared`, `@design-system`, `@app`, `@repository`, `@workspace`, `@conversation`, `@agents`, `@context`, `@explorer`, `@settings`, or `@skills`. These aliases name folders only; they are not barrel APIs.

StyleX `styles.ts` modules are the exception: its compiler resolves theme definitions before Vite aliases, so they must keep a relative import of `src/design-system/styles.stylex.ts`.

Avoid barrel files unless repeated import churn demonstrates a stable public interface. Keep components under 500 lines. Existing oversized repository and workspace files are hotspots: extract new responsibilities rather than extending them.

The boundary checker rejects all source import cycles, including type-only cycles. There are no cycle exceptions. Put parent/child contracts in a local `types.ts` or the owning model instead of importing a parent component from its child.

## TypeScript and tests

Keep TypeScript strict: unused locals and parameters, implicit returns, switch fallthrough, and unintended overrides are errors. Do not add explicit `any`; use `unknown` plus narrowing, or a narrowly scoped suppression that states why it is safe.

Use the lowest useful test level. Write a small failing test before behavior changes: Bun unit tests for pure projections and state transitions; component tests for Solid behavior; browser tests for journeys. Copy-only, styling-only, dependency-only, and behavior-preserving moves may use `TEST_EXEMPT=1` during commit.

Run `bun run lint`, `bun run check:boundaries`, `bunx tsc --noEmit`, `bun test scripts/tests`, and the relevant Rust checks before completion. `bun run check:architecture` starts with Oxlint and includes the architecture, Solid, type, Rust, and renderer build checks.

Oxlint is the repository-wide JavaScript/TypeScript linter, configured in `.oxlintrc.json`. Correctness violations and warnings fail checks. Use `bun run lint:fix` for safe automatic fixes. Generated output, vendored icons, documentation, and the separate `site/` project are excluded. The Solid structural audit and architecture dependency checker remain authoritative for framework and layer rules; React hook rules do not apply to Solid. Intentional reactive property reads should use `void` so their tracking purpose is explicit. Underscore-prefixed callback parameters may be unused, and side-effecting ternaries and short-circuit expressions are allowed.

Oxlint replaces Biome's JavaScript/TypeScript linting, including the former focused architecture lint command. It enables correctness checks from the ESLint, TypeScript, Unicorn, Oxc, and JSX accessibility rule sets, plus explicit equality, const/var, eval, empty-block, redundant-code, and type-assertion checks. The previous accessibility exceptions for static element handlers, semantic tag preference, and click/key pairing remain. Suppress exceptional diagnostics narrowly with `oxlint-disable-next-line rule -- reason`.

Keep Biome only for formatting, import organization, and CSS/JSON linting, which Oxlint does not provide. React-specific hook and fragment rules are intentionally omitted for Solid. Existing TypeScript compiler checks and custom architecture/Solid checks remain; Oxlint's default rules are not a substitute for those checks or a one-to-one copy of Biome's recommendations. Pre-commit runs Oxlint on staged JavaScript/TypeScript and Biome on supported staged files. `bun run check` validates without rewriting files; `bun run format` formats renderer source.
