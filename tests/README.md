# Test Dictionary

This repository had no `tests/` directory before this audit, so no executable internals were already protected.

## Current Coverage

- `release-asset-selection.test.ts`
  - Protects release API URL mapping and GitHub asset selection in `packages/inferay/src/releases.js`.
- `chat-behavior.test.ts`
  - Protects chat history trimming, streamed message patching, local/server message merge behavior, slash-command expansion, and inline command completion.
- `agent-stream-events.test.ts`
  - Protects the shared agent stream contract where tool input included on `content_block_start` becomes tool message content. This specifically covers Codex synthetic `Edit` events that stop without later `input_json_delta` chunks.
- `agent-inline-diff-parity.test.ts`
  - Protects fake Claude-style streamed edit events and Codex-style immediate edit events against the same inline diff contract. Also covers edit grouping and sequential edit application for the chat diff card path.
- `agent-and-git-behavior.test.ts`
  - Protects agent group migration, pane append/title behavior, status mapping, and Git change ordering/classification.
- `prompt-and-storage-filters.test.ts`
  - Protects prompt search/category/source filtering. The migrated client-storage normalization and persistence contract is covered directly by `inferay-server` Rust tests.

## Audit By Feature/Process

- Deploy: release asset selection and endpoint mapping have focused coverage. Rust tooling tests protect release arguments, version changes, deterministic bundle hashing, and command planning; platform signing and publishing still require integration verification.
- Autobuild: `scripts/watch-*` and build wrappers are not covered. High-value tests would require extracting pure command planning from watcher/process code.
- Marketing: static Astro/site demo content has no worthwhile internals to test beyond data transforms if they become shared behavior.
- Social posting: no social posting workflow or service boundary was found in this codebase.
- Discovery/research: automation templates mention research, but no backend research service boundary was found. Avoid UI/template snapshot tests unless workflow execution logic moves server-side.
- App identity/path resolution: application metadata priority, update-check failure caching, semantic-version comparison, native-path authorization, updater PATH construction, command fallback order, agent state migration, and pane title derivation are covered by Rust tests.
- Convex/schema/type alignment: no Convex schema or generated Convex types were found.
- Filesystem/local config sync: file search/content, temporary image lifecycle, agent directory browsing/search/quick picks, config merge and base/local splitting, client-storage filtering, and client-storage atomic persistence now have native Rust route coverage.
- Backend routes/script runners: Git, prompt CRUD/usage, agent-context persistence, agent state normalization/actions, agent directory/process discovery and guarded termination, agent CLI/account discovery, GitHub account/repository/clone actions, one-shot Claude title/commit/automation execution, automation persistence, app identity/update/native-open actions, configuration, and client-storage routes have native Rust coverage.
- Platform aggregators: installer release asset mapping now has coverage. `platformInfo` and app candidate ordering are medium ROI if extracted to accept platform/env dependencies.
- Claude/Codex stream parity: initial tool input normalization and inline edit diff parity now have focused coverage, including Codex-style immediate `Edit` tool events and Claude-style streamed edit input. More adapter-level tests should target normalized event output before process spawning.
- Agent accounts: Claude/Codex candidate priority, NVM discovery, PATH prepend order, `CLAUDECODE` removal, availability caching, stdout/stderr version fallback, auth-config detection, and all three health summaries have native Rust coverage.
- Forge: GitHub auth parsing, logged-out detection, clone URL/repository-name rules, JavaScript-compatible limit behavior, AppleScript escaping, and request validation now have native Rust coverage.
- One-shot agents: title fallback/quote behavior, JavaScript UTF-16 limits, Claude NDJSON output precedence, automation normalization, real fake-CLI execution, and staged Git diff commit-message routing have native Rust coverage.
- Sessions and Files: Rust tests cover persisted session projection, image listing and deletion, and path safety while the Octane pages remain unchanged.
- Native chat boundary: Rust tests cover server-owned runtime dispatch, persisted reconnect snapshots, queue ordering, cancellation, checkpoint finalization, and the WebSocket service/client lifecycle.

## Missing Tests Ranked By ROI

High:

- Prompt merge priority, CRUD serialization, usage ranking, and built-in/custom conflict behavior: covered by native Rust store and route tests.
- Local path normalization and traversal rejection: covered in `native/core` and native server route tests.
- Config merge semantics: covered by the native Rust configuration store and route tests.
- Release asset mapping in `packages/inferay/src/releases.js`: covered. Protects deploy/install workflows from selecting the wrong artifact.
- Chat command/message behavior in `src/modules/conversation`: covered. Protects prompt expansion, streaming updates, reconnect merge behavior, and history limits.
- Agent stream tool input parity in `src/modules/conversation/agent-chat-shared.ts`: covered. Protects Codex inline diff rendering when complete tool input arrives in the start event.
- Inline edit diff rendering helpers in `src/modules/conversation/chat-edit-diff-utils.ts` and `src/modules/conversation/chat-message-render-utils.ts`: covered. Protects fake Claude and Codex edit streams from producing empty edit cards.
- Agent and Git data behavior in `src/modules/workspace/workspace-model.ts` and `src/modules/repository/git-file-utils.ts`: covered. Protects restored panes, status mapping, and change review ordering.
- Client-storage sync normalization: covered by native Rust route tests. Protects persisted local UI state from malformed renderer payloads.

Medium:

- Native folder chooser UI itself still needs manual platform verification; its path cleanup has native Rust coverage.
- `platformInfo` and existing app candidate priority in `packages/inferay/src/platform.js`: stable behavior, but current implementation reads live OS and filesystem state.
- Automation save/load normalization and one-shot execution are covered by native Rust unit and route tests.
- Rust release command execution against Apple signing, GitHub, and npm remains environment-dependent and should be exercised during release preflight.

Low/Defer:

- Octane UI behavior remains covered by renderer characterization tests; Rust tests own the server-side contracts beneath it.
- Static marketing copy and demo layout tests: likely to churn and not tied to core product stability.
- Watcher loops and renderer/native build scripts end to end: too environment-dependent for lightweight unit tests.
- Convex/schema/social posting tests: no corresponding implementation was found.
