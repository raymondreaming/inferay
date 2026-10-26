# Inferay GPUI

The native macOS renderer uses GPUI 0.3.9 and the existing Inferay Rust services. GPUI (`native/gpui`) is the supported target for all future UI features, fixes, and performance work. The Solid renderer (`src/`) and webview desktop host (`native/desktop-host`) are deprecated and retained temporarily as migration references. Do not implement new UI work in the deprecated version unless explicitly requested. Validate GPUI incrementally as features are used; deprecation does not mean feature parity is complete. Keep the shared Rust core, presentation, diff engine, and server.

The remaining-work inventory below records known gaps; test and resolve them incrementally in GPUI.

## Build and run

`bun run build:gpui` creates `build/gpui/Inferay Native.app`. `bun run dev:gpui` also opens it. The bundle has its own `com.inferay.gpui-preview` identity and is ad-hoc signed. Rust, Xcode command-line tools, and macOS are required.

When the shipping app is running, connect the preview to its existing local backend:

```sh
INFERAY_EXTERNAL_BACKEND_ADDR=127.0.0.1:<actual-port> bash scripts/dev-gpui.sh
```

The build script preserves this address in the preview bundle's environment. Without it, startup runs the shared Rust backend for the selected profile. A profile lock prevents two current backends owning the same profile; the preview also refuses embedded startup when an older host has tracked live agents. Do not start a second runtime against an active profile. `INFERAY_USER_DATA_DIR` selects an isolated profile for development and tests.

An older external backend may lack newer endpoints. In particular, the installed backend used during this audit returns 404 for Database. The current shared backend supports the database explorer and is verified using a temporary profile.

## Current behavior

- Restores active project tabs, repository bindings, chat grids, selected chat, sidebar dimensions, saved drafts, provider defaults, font, background, syntax theme, and graph columns. New chats get canonical saved pane identities and project associations. Draft edits are saved through the shared preferences service. Tab/chat selection, sidebar visibility, and completed sidebar width changes persist through the shared services; switching projects retains local selection and drafts. Project and Other chats grid split resizes persist through the shared dock service in order, using the same responsive three-column grid as the main app.
- Restores saved transcripts and subscribes to live updates using the shared epoch/revision replica, with reconnect repair and tail following that pauses when reading earlier messages. A latest-message button restores following; sidebar titles refresh on live summary events and reconnect. Variable-height native lists lay out visible transcript rows. Messages and the composer share the main app’s centered 624 px column, shrinking with narrow panes; composer text uses 20 px lines and grows to 120 px. Renders messages using the canonical server Markdown parser, syntax classifier, and core message presentation. Supports code, tables, nested emphasis, links, edit summaries, command/goal cards, and expandable tool timelines. Hidden messages remain hidden.
- The composer has a native animated border beam while focused or running. Markdown paragraphs, code blocks, and user text support drag selection and Cmd+C; selection across separate blocks remains unfinished. Active runs show the main app’s animated dot matrix, elapsed time from the backend start timestamp, and a Stop control above the composer. Native text sending and Stop use the authenticated live connection and saved conversation directory/provider settings. Enter sends, including follow-up messages during an active response through the backend’s existing steering/queue policy; the Stop button remains separate. Queued follow-ups and pending steering appear above the input in a scrollable 112 px region and refresh on reconnect. Waiting messages can be edited, saved, cancelled, or removed through the canonical queue service; failed saves retain the edit. Shift+Enter inserts a newline. Failed requests retain the draft, and edits made during request preparation are preserved. Native multiline editing supports clipboard, grapheme deletion, selection, vertical movement, undo/redo, and UTF-16 IME ranges. Opening Settings takes focus away from the composer; closing restores it.
- Repository history uses shared graph projection and virtualized rows, verified author images, branch-specific WIP rows, and stable repository identity when selecting another worktree. Current changes have staged/unstaged lists and per-file/group stage actions. Historical details put author/message left and files right; expanded mode uses a right sidebar. Split/unified diffs preserve syntax context and reuse already-open contents.
- Settings has Database, Appearance, GitHub, Providers, MCP connections, Skills, and Folders. Native controls use authenticated loopback APIs for reads and writes. Includes provider/model/reasoning defaults, global instructions, background scenes/custom images, font/code theme, GitHub repositories and clone actions, MCP connection controls, skill editing/duplication/deletion, and folder selection. Draft edits survive refreshes. The database explorer is read-only and provides table selection, records, pagination, first-column filtering, schema, and cell previews.
- Cmd+B toggles the sidebar, Cmd+, opens Settings, Escape returns, and Cmd+Q quits. In the repository, ↑/↓ selects commits/files, → opens files, and ← returns to the graph. Home/End and Alt+↑/↓ use shared graph navigation; Space/Shift+Space page the diff.

Native design tokens, icons, and syntax palettes live in `assets/` and `src/colors.rs`; no build-time extraction from the old renderer remains. Shared image/provider assets still live in `public/`. Markdown/highlighting are exported by `inferay-server`, not compiled again by source path. Keep `native/core`, `native/presentation`, `native/diff-engine`, and `native/server`: these own shared application behavior.

## Remaining migration work

| Surface | Still required |
|---|---|
| Workspace | Complete tab lifecycle, drag/drop, project management |
| Conversation | Full run-status presentation, attachments/mentions/command picker, approvals, complete rich cards, embedded apps/images; provider-backed send/stop UI verification |
| Repository | Commit flow, remaining Git actions, search/filter/context menus, column interaction, refresh lifecycle, broader geometry comparisons |
| Settings | Finish side-by-side interaction checks, range sliders, account/avatar presentation, richer database filtering/sorting and large-cell navigation |
| Files and project resources | Native explorer/editing, memory, plugins, automations, proposal flows |
| Browser/tool surfaces | Native integration and complete lifecycle |
| Rendering and input | More matched screenshots, complete keyboard/accessibility behavior, measured interaction performance |
| Packaging | Native-only build/release pipeline; removal of `src/`, `native/desktop-host`, and obsolete web build/dependency/test paths once their behaviors are replaced |

The old renderer has not been deleted. Removing it before the missing behaviors are implemented would remove working app functionality. Version control can preserve the old implementation once migration is complete.

## Verification

```sh
cargo test --locked --manifest-path native/gpui/Cargo.toml
cargo clippy --locked --manifest-path native/gpui/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native/gpui/Cargo.toml -- --check
```

Tests cover Enter/newline/IME behavior, stop request targeting and failure recovery, first-message visibility, long transcript virtualization and viewport resizing, profile restoration, draft isolation, focus restoration, dirty settings refresh, authenticated settings persistence, profile ownership, authenticated WebSocket snapshots/local-command updates, graph geometry, worktree isolation and staging, diff syntax, and rich transcript interpretation. Persistence tests use temporary profiles and staging tests use temporary repositories. UI checks also use a separately identified QA bundle for mutations. Native Enter-to-send was verified with the local `/help` command, including persisted history and an independent retained draft. Background-window captures sometimes retain an older presented frame until a resize; foreground/background redraw behavior still needs investigation.

`vendor/gpui-pre-apple` contains narrow CoreText weight, alpha-blending, and shadow-clipping fixes. `vendor/gpui-pre-macos` retains the native dark window material. See `NOTICE` and the included Apache license. Upstream Cocoa deprecation warnings remain in these framework dependencies.

Repository parity: linked worktree WIP rows stay beside their loaded HEAD instead of appearing at the top when that commit is outside the history page. Path/Tree controls, collapsible directories, and aggregate additions/deletions are available for current changes and commits. The repository left edge and lower detail panel (side panel when expanded) have resize handles. These sizes currently remain local to the open preview.
