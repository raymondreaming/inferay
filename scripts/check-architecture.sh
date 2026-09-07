#!/usr/bin/env bash
set -euo pipefail

echo "==> Build Rust renderer models and contracts"
bun run build:presentation

echo "==> Rust presentation usage"
bun scripts/check-presentation-usage.ts

echo "==> Biome focused architecture lint"
bunx biome lint \
	src/modules/conversation/components/AgentChatView/index.tsx \
	src/modules/conversation/components/ChatMessageList/index.tsx \
	src/modules/conversation/hooks/useAgentChatComposerState.tsx \
	src/modules/conversation/components/AgentChatView/useChatConnection.tsx \
	src/modules/conversation/hooks/useChatInputActions.tsx \
	src/modules/repository/hooks/useGitDiff.tsx \
	src/modules/workspace/hooks/useWorkspaceState.tsx \
	src/shared/hooks/useSyntaxHighlight.tsx \
	src/modules/workbench/diff/components/DiffViewer/index.tsx \
	src/modules/workspace/components/WorkspaceCanvas/index.tsx \
	src/modules/workspace/components/PaneView/index.tsx \
	src/app/components/RootComponent/index.tsx

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

echo "==> Solid principles audit"
bun scripts/check-solid-principles.ts

echo "==> Solid reactivity regression"

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
echo "==> Renderer runtime dependency audit"
if rg -n 'from ["\x27](react|react-dom|octane|@octanejs/|@tanstack/(react-|solid-router|router-))' src; then
	echo "Legacy renderer or router dependency remains" >&2
	exit 1
fi
