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

`src/shared` is the TypeScript common library. It must not import app, feature, or adapter code. Put shared contracts there before passing values between native-client storage and a feature. `src/app` composes modules; modules must not depend on route entries or `client.tsx`.

Keep domain-shaped behavior in Rust pure models where it is shared with the native server and WebAssembly renderer. Solid hooks adapt signals, browser events, and query lifecycles; components render and translate interactions. Pass context-derived values into pure functions instead of reading browser state from them.

## Solid 2 reactivity

Use Solid's fine-grained graph directly. Derive values with `createMemo`; do not mirror a derived value into a signal through an effect. Use `createEffect` only to synchronize with an external system such as the DOM, a browser listener, timer, native subscription, or query observer, and return its cleanup from the same effect.

Keep a hook when it owns a cohesive browser or query lifecycle. Do not create a hook only to forward props, wrap a memo, or hide one event handler; place those directly in the owning component. Keep feature state and mutations together, and pass narrow accessors or callbacks to children instead of broad mutable state objects.

## Network boundary

`src/shared/lib/native.tsx` is the sole low-level browser HTTP client. It applies a timeout to every request. Do not use `fetch()` elsewhere. Keep endpoint-specific orchestration in feature hooks or adapters, and pass side-effecting operations into presentational children as callbacks.

Feature services own endpoint paths, request payloads, and response parsing. For example, `src/modules/settings/services/settingsApi.ts` is the settings HTTP adapter. UI code may depend on a feature service contract, never on a raw endpoint or the HTTP wrapper.

The architecture checker permits raw endpoint helpers only in a `services/` module. Its named transport-debt baseline covers remaining legacy callers and rejects any new caller; remove an entry as its endpoint moves into the matching feature service.

## Module shape

Use feature folders under `src/modules`. Repository views and repository orchestration belong under `repository`; pane layout, workspace sessions, and docking belong under `workspace`. Keep reusable UI in `src/shared/ui`, browser-neutral helpers in `src/shared`, and generated contracts behind `src/adapters` or `@contracts`.

Use direct paths within a feature. For a cross-layer import, use the owning alias: `@shared`, `@design-system`, `@app`, `@repository`, `@workspace`, `@conversation`, `@agents`, `@context`, `@explorer`, `@settings`, or `@skills`. These aliases name folders only; they are not barrel APIs.

StyleX `styles.ts` modules are the exception: its compiler resolves theme definitions before Vite aliases, so they must keep a relative import of `src/design-system/styles.stylex.ts`.

Avoid barrel files unless repeated import churn demonstrates a stable public interface. Keep components under 500 lines. Existing oversized repository and workspace files are hotspots: extract new responsibilities rather than extending them.

The boundary checker freezes the current cyclic-import origins as a named debt baseline and rejects every new cycle. Remove an entry from that baseline when extracting a stable parent/child interface; do not add new exemptions for feature work.

## TypeScript and tests

Keep TypeScript strict: unused locals and parameters, implicit returns, switch fallthrough, and unintended overrides are errors. Do not add explicit `any`; use `unknown` plus narrowing, or a narrowly scoped suppression that states why it is safe.

Use the lowest useful test level. Write a small failing test before behavior changes: Bun unit tests for pure projections and state transitions; component tests for Solid behavior; browser tests for journeys. Copy-only, styling-only, dependency-only, and behavior-preserving moves may use `TEST_EXEMPT=1` during commit.

Run `bun run check:boundaries`, `bunx tsc --noEmit`, `bun test scripts/tests`, and the relevant Rust checks before completion. Use Biome, not Prettier: this repository already uses Biome as its formatter and linter.
