#!/usr/bin/env bash
set -euo pipefail

echo "==> Biome focused architecture lint"
bunx biome lint \
	src/components/chat/AgentChatView.tsx \
	src/components/chat/ChatMessageList.tsx \
	src/components/chat/useAgentChatComposerState.tsx \
	src/components/chat/useChatConnection.tsx \
	src/components/chat/useChatInputActions.tsx \
	src/components/chat/chat-state-utils.ts \
	src/features/chat/agent-chat-shared.ts \
	src/features/chat/chat-session-store.ts \
	src/features/file-watcher/useFileWatcher.tsx \
	src/features/git/useGitDiff.tsx \
	src/features/agent/agent-utils.ts \
	src/hooks/useShikiHighlighter.tsx \
	src/pages/EditorPage/editor-page-view.tsx \
	src/pages/EditorPage/index.tsx \
	src/pages/Agent/GitDiffView.tsx \
	src/pages/Agent/AgentGrid.tsx \
	src/pages/Agent/AgentPaneView.tsx \
	src/routes/_app/agent.tsx \
	tests/agent-chat-view-visibility.octane.tsx \
	tests/agent-inline-diff-parity.test.ts \
	tests/agent-stream-events.test.ts \
	tests/chat-behavior.test.ts \
	tests/chat-connection-behavior.octane.tsx \
	tests/chat-header-behavior.octane.tsx \
	tests/chat-input-actions-behavior.octane.tsx \
	tests/chat-message-list-memo.test.tsx \
	tests/chat-queue-behavior.octane.tsx \
	tests/chat-session-store.test.ts \
	tests/chat-sync-reconciler.test.ts \
	tests/git-diff-view-render.octane.tsx \
	tests/agent-and-git-behavior.octane.ts \
	tests/agent-pane-visibility.octane.tsx

echo
echo "==> TypeScript"
bunx tsc --noEmit

echo
echo "==> Focused architecture tests"
bun test \
	tests/agent-inline-diff-parity.test.ts \
	tests/chat-message-list-memo.test.tsx \
	tests/chat-behavior.test.ts \
	tests/agent-stream-events.test.ts \
	tests/chat-session-store.test.ts \
	tests/chat-sync-reconciler.test.ts

bun run test:renderer

echo
echo "==> Native Rust format"
cargo fmt --all -- --check

echo
echo "==> Native Rust lint"
cargo clippy --workspace --all-targets --all-features -- -D warnings

echo
echo "==> Native Rust tests"
cargo test --workspace

echo
echo "==> Renderer build"
bun run build:renderer

echo
echo "==> React runtime dependency audit"
if rg -n -P '^import\s+(?!type\b).*from "react|react-router-dom|@tanstack/react-virtual|@stylexjs/stylex' src; then
	echo "Unexpected React renderer dependency remains" >&2
	exit 1
fi
