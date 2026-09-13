#!/usr/bin/env bash
set -euo pipefail

forbidden_dependency() {
	local manifest="$1"
	local forbidden="$2"
	if rg -q "^${forbidden}[[:space:]]*=" "$manifest"; then
		echo "$manifest must not depend on $forbidden" >&2
		exit 1
	fi
}

# Inward native dependencies: server → engine/presentation → core.
forbidden_dependency native/core/Cargo.toml inferay-native-diff
forbidden_dependency native/core/Cargo.toml inferay-presentation
forbidden_dependency native/core/Cargo.toml inferay-server
forbidden_dependency native/core/Cargo.toml inferay-desktop
forbidden_dependency native/diff-engine/Cargo.toml inferay-presentation
forbidden_dependency native/diff-engine/Cargo.toml inferay-server
forbidden_dependency native/diff-engine/Cargo.toml inferay-desktop
forbidden_dependency native/presentation/Cargo.toml inferay-native-diff
forbidden_dependency native/presentation/Cargo.toml inferay-server
forbidden_dependency native/presentation/Cargo.toml inferay-desktop

# Framework, transport, and desktop code must not leak into the stable core.
if rg -n '(^|use )(?:axum|tokio|wry|tao|wasm_bindgen|inferay_server|inferay_native_diff)' native/core/src; then
	echo "native/core must remain independent of transport and rendering frameworks" >&2
	exit 1
fi

# Migrated models, transitions, and projections are independent of storage.
if rg -n '\b(fs|io|net|process|atomic_write|AgentStateStore|AgentContextStore|ConfigManager|AgentCommandResolver)\b|std::(env|path)::(current_dir|absolute)' \
	native/core/src/agent_state.rs native/core/src/agent_state native/core/src/workspace_action.rs \
	native/core/src/agent_context.rs native/core/src/config.rs native/core/src/agent_kind.rs native/core/src/agent_protocol.rs; then
	echo "Core models must not depend on filesystem, transport, process, or store implementations" >&2
	exit 1
fi

echo "Native dependency boundaries passed."
