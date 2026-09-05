#!/usr/bin/env bash
set -euo pipefail

echo "==> Biome focused architecture lint"
bunx biome lint \
	src/modules/conversation/components/AgentChatView/index.tsx \
	src/modules/conversation/components/ChatMessageList/index.tsx \
	src/modules/conversation/hooks/useAgentChatComposerState.tsx \
	src/modules/conversation/model/chat-session-store.ts \
	src/modules/conversation/hooks/useChatInputActions.tsx \
	src/modules/conversation/model/agent-chat-shared.ts \
	src/modules/conversation/model/agent-chat-shared.ts \
	src/modules/conversation/model/chat-session-store.ts \
	src/modules/repository/hooks/useGitDiff.tsx \
	src/modules/workspace/model/workspace-model.ts \
	src/shared/hooks/useShikiHighlighter.tsx \
	src/modules/workbench/diff/components/DiffViewer/index.tsx \
	src/modules/workspace/components/WorkspaceCanvas/index.tsx \
	src/modules/workspace/components/PaneView/index.tsx \
	src/routes/_app/agent.tsx

echo
echo "==> Component folder structure"
bun run check:components

echo "==> Architecture boundaries"
if find src/components src/features src/pages src/hooks src/lib -type f 2>/dev/null | grep -q .; then
	echo "Legacy implementation buckets must stay empty" >&2
	exit 1
fi
if rg -n 'src/(components|features|pages|hooks|lib)/' src; then
	echo "Legacy implementation import remains" >&2
	exit 1
fi

echo
echo "==> TypeScript"
bunx tsc --noEmit

echo
echo "==> Native Rust format"
cargo fmt --all -- --check

echo
echo "==> Native Rust lint"
cargo clippy --workspace --all-targets --all-features -- -D warnings

echo
echo "==> Renderer build"
bun run build:renderer

echo
echo "==> React runtime dependency audit"
if rg -n -P '^import\s+(?!type\b).*from "react|react-router-dom|@tanstack/react-virtual|@stylexjs/stylex' src; then
	echo "Unexpected React renderer dependency remains" >&2
	exit 1
fi
