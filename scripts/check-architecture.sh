#!/usr/bin/env bash
set -euo pipefail

echo "==> Biome focused architecture lint"
bunx biome lint \
	src/modules/conversation/components/AgentChatView.tsx \
	src/modules/conversation/components/ChatMessageList.tsx \
	src/modules/conversation/hooks/useAgentChatComposerState.tsx \
	src/modules/conversation/hooks/useChatConnection.tsx \
	src/modules/conversation/hooks/useChatInputActions.tsx \
	src/modules/conversation/model/chat-state-utils.ts \
	src/modules/conversation/model/agent-chat-shared.ts \
	src/modules/conversation/model/chat-session-store.ts \
	src/modules/workbench/hooks/useFileWatcher.tsx \
	src/modules/repository/hooks/useGitDiff.tsx \
	src/modules/workspace/model/workspace-model.ts \
	src/shared/hooks/useShikiHighlighter.tsx \
	src/modules/workbench/diff/components/DiffViewer.tsx \
	src/modules/workspace/components/WorkspaceCanvas.tsx \
	src/modules/workspace/components/PaneView.tsx \
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
echo "==> Architecture boundaries"
if find src/components src/features src/pages src/hooks src/lib -type f 2>/dev/null | grep -q .; then
	echo "Legacy implementation buckets must stay empty" >&2
	exit 1
fi
if rg -n 'src/(components|features|pages|hooks|lib)/' src tests; then
	echo "Legacy implementation import remains" >&2
	exit 1
fi

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
