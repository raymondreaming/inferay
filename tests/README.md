# Test Dictionary

This repository had no `tests/` directory before this audit, so no executable internals were already protected.

## Current Coverage

- `security-and-git-input.test.ts`
  - Protects local path normalization and traversal rejection in `src/server/security.ts`.
  - Protects Git route query normalization in `src/server/routes/git-route-input.ts`, including cwd/file/staged parsing, hash validation, and limit clamping.
- `prompts-and-config.test.ts`
  - Protects prompt merge priority in `src/server/routes/prompts.ts`, especially bundled built-ins retaining local usage stats by id or command.
  - Protects config merge semantics in `src/server/services/config-manager.ts`, where nested records merge and arrays/primitives replace.
- `release-asset-selection.test.ts`
  - Protects release API URL mapping and GitHub asset selection in `packages/inferay/src/releases.js`.
- `chat-behavior.test.ts`
  - Protects chat history trimming, streamed message patching, local/server message merge behavior, slash-command expansion, and inline command completion.
- `agent-stream-events.test.ts`
  - Protects the shared agent stream contract where tool input included on `content_block_start` becomes tool message content. This specifically covers Codex synthetic `Edit` events that stop without later `input_json_delta` chunks.
- `agent-inline-diff-parity.test.ts`
  - Protects fake Claude-style streamed edit events and Codex-style immediate edit events against the same inline diff contract. Also covers edit grouping and sequential edit application for the chat diff card path.
- `terminal-and-git-behavior.test.ts`
  - Protects terminal group migration, pane append/title behavior, status mapping, and Git change ordering/classification.
- `prompt-and-storage-filters.test.ts`
  - Protects prompt search/category/source filtering and renderer-to-backend client-storage sync normalization.
- `simulator-service.test.ts`
  - Protects simulator device normalization from `simctl list devices -j`, including Xcode/CoreSimulator JSON entries that omit `isAvailable`.

## Audit By Feature/Process

- Deploy: release asset selection and release endpoint mapping now have focused coverage. Release orchestration in `scripts/release.ts` remains mostly untested because it shells out to build, signing, GitHub, and system tools.
- Autobuild: `scripts/watch-*` and build wrappers are not covered. High-value tests would require extracting pure command planning from watcher/process code.
- Marketing: static Astro/site demo content has no worthwhile internals to test beyond data transforms if they become shared behavior.
- Social posting: no social posting workflow or service boundary was found in this codebase.
- Discovery/research: automation templates mention research, but no backend research service boundary was found. Avoid UI/template snapshot tests unless workflow execution logic moves server-side.
- App identity/path resolution: local path boundary coverage now exists. Terminal state migration and pane title derivation are also covered. `PROJECT_ROOT` and `userDataPath` platform branches are candidates for future extraction if path bugs appear.
- Convex/schema/type alignment: no Convex schema or generated Convex types were found.
- Filesystem/local config sync: config merge semantics and client-storage sync filtering now have pure coverage. File split behavior between base and local config remains untested because current paths are module constants.
- Backend routes/script runners: Git input helpers are covered. Automation run and prompt write queues remain candidates, but should be tested through extracted pure helpers or temp-file seams.
- Platform aggregators: installer release asset mapping now has coverage. `platformInfo` and app candidate ordering are medium ROI if extracted to accept platform/env dependencies.
- Claude/Codex stream parity: initial tool input normalization and inline edit diff parity now have focused coverage, including Codex-style immediate `Edit` tool events and Claude-style streamed edit input. More adapter-level tests should target normalized event output before process spawning.
- Simulator/apps panel: simulator device parsing now has focused coverage. The UI now surfaces simulator service errors instead of collapsing backend failures into an empty devices state.

## Missing Tests Ranked By ROI

High:

- Prompt merge priority in `src/server/routes/prompts.ts`: covered. Protects user usage stats and built-in/custom conflict behavior.
- Local path and Git input normalization in `src/server/security.ts` and `src/server/routes/git-route-input.ts`: covered. Protects filesystem and shell-adjacent boundaries.
- Config merge semantics in `src/server/services/config-manager.ts`: covered. Protects local config sync from silently dropping nested provider keys.
- Release asset mapping in `packages/inferay/src/releases.js`: covered. Protects deploy/install workflows from selecting the wrong artifact.
- Chat command/message behavior in `src/features/chat` and `src/components/chat`: covered. Protects prompt expansion, streaming updates, reconnect merge behavior, and history limits.
- Agent stream tool input parity in `src/features/chat/chat-stream-events.ts`: covered. Protects Codex inline diff rendering when complete tool input arrives in the start event.
- Inline edit diff rendering helpers in `src/components/chat/chat-edit-diff-utils.ts` and `src/components/chat/chat-message-render-utils.ts`: covered. Protects fake Claude and Codex edit streams from producing empty edit cards.
- Terminal and Git data behavior in `src/features/terminal/terminal-utils.ts` and `src/lib/git-file-utils.ts`: covered. Protects restored panes, status mapping, and change review ordering.
- Client-storage sync normalization in `src/server/routes/client-storage.ts`: covered. Protects persisted local UI state from malformed renderer payloads.
- Simulator device parsing in `src/server/services/simulator-service.ts`: covered. Protects the apps panel from dropping devices when `simctl` omits `isAvailable`.

Medium:

- Config update file split in `ConfigManager.update`: useful, but needs injectable config paths or a temp-backed manager to avoid touching real app config.
- Prompt create/update/delete write serialization: useful for partial-failure and idempotency, but needs temp-backed prompt paths or extracted store helpers.
- `platformInfo` and existing app candidate priority in `packages/inferay/src/platform.js`: stable behavior, but current implementation reads live OS and filesystem state.
- Automation save/load normalization in `src/server/routes/automations.ts`: cheap if extracted; current route imports app user-data paths.
- Release script command planning in `scripts/release.ts`: valuable if deploy failures recur, but requires extracting shell command plans from side-effectful steps.

Low/Defer:

- UI button/render tests for pages and components: mostly brittle and outside the requested stability surface.
- Static marketing copy and demo layout tests: likely to churn and not tied to core product stability.
- Watcher loops and renderer/native build scripts end to end: too environment-dependent for lightweight unit tests.
- Convex/schema/social posting tests: no corresponding implementation was found.
