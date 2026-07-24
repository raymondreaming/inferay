#!/usr/bin/env bash
set -euo pipefail

echo "==> Biome focused architecture files"
bunx biome check \
	scripts/build-renderer.ts \
	src/components/chat/AgentChatView.tsx \
	src/components/chat/ChatMessageList.tsx \
	src/components/chat/useAgentChatComposerState.ts \
	src/components/chat/useChatConnection.ts \
	src/components/chat/useChatInputActions.ts \
	src/components/chat/chat-state-utils.ts \
	src/features/chat/agent-chat-shared.ts \
	src/features/chat/chat-session-store.ts \
	src/features/file-watcher/useFileWatcher.ts \
	src/features/git/useGitDiff.ts \
	src/features/agent/agent-utils.ts \
	src/hooks/useShikiHighlighter.ts \
	src/pages/EditorPage/editor-page-view.tsx \
	src/pages/EditorPage/index.tsx \
	src/pages/Agent/GitDiffView.tsx \
	src/pages/Agent/AgentGrid.tsx \
	src/pages/Agent/AgentPaneView.tsx \
	src/pages/Agent/index.tsx \
	src/server/agents/events.ts \
	src/server/agents/registry.ts \
	src/server/app-server.ts \
	src/server/routes/api.ts \
	src/server/routes/git.ts \
	src/server/routes/simulator.ts \
	src/server/routes/agent.ts \
	src/server/services/agent-chat.ts \
	src/server/services/checkpoint.ts \
	src/server/services/native-core.ts \
	tests/agent-chat-view-visibility.test.tsx \
	tests/agent-inline-diff-parity.test.ts \
	tests/agent-stream-events.test.ts \
	tests/chat-behavior.test.ts \
	tests/chat-connection-behavior.test.tsx \
	tests/chat-header-behavior.test.tsx \
	tests/chat-input-actions-behavior.test.tsx \
	tests/app-server-smoke.test.ts \
	tests/chat-message-list-memo.test.tsx \
	tests/chat-queue-behavior.test.tsx \
	tests/chat-session-store.test.ts \
	tests/chat-sync-reconciler.test.ts \
	tests/chat-transcripts.test.ts \
	tests/git-diff-view-render.test.tsx \
	tests/prompts-and-config.test.ts \
	tests/simulator-service.test.ts \
	tests/agent-and-git-behavior.test.ts \
	tests/agent-pane-visibility.test.tsx

echo
echo "==> TypeScript"
bunx tsc --noEmit

echo
echo "==> Focused architecture tests"
bun test \
	tests/agent-chat-view-visibility.test.tsx \
	tests/agent-inline-diff-parity.test.ts \
	tests/prompts-and-config.test.ts \
	tests/agent-and-git-behavior.test.ts \
	tests/simulator-service.test.ts \
	tests/agent-pane-visibility.test.tsx \
	tests/chat-header-behavior.test.tsx \
	tests/chat-message-list-memo.test.tsx \
	tests/chat-behavior.test.ts \
	tests/chat-input-actions-behavior.test.tsx \
	tests/chat-transcripts.test.ts \
	tests/chat-queue-behavior.test.tsx \
	tests/agent-stream-events.test.ts \
	tests/git-diff-view-render.test.tsx \
	tests/chat-session-store.test.ts \
	tests/chat-sync-reconciler.test.ts \
	tests/chat-connection-behavior.test.tsx

echo
echo "==> Renderer build"
bun scripts/build-renderer.ts

echo
echo "==> App server renderer smoke"
bun test tests/app-server-smoke.test.ts

echo
echo "==> React Doctor diff"
bunx react-doctor@latest --verbose --diff
