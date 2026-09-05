import { useEffect, useState } from "octane";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import {
	type AgentSavedState,
	type AgentShellChangeDetail,
	agentStateKey,
	loadAgentState,
	loadCanonicalAgentState,
} from "./workspace-model.ts";

export function useWorkspaceState(loadCanonical = true, selectFirst = true) {
	const load = (state: AgentSavedState | null = loadAgentState()) => {
		return {
			groups: state?.groups ?? [],
			selectedGroupId:
				state?.selectedGroupId ??
				(selectFirst ? state?.groups[0]?.id : null) ??
				null,
			key: state ? agentStateKey(state) : "",
		};
	};
	const [state, setState] = useState(load);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const stop = listenWindowEvent("agent-shell-change", (event) => {
			const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
			if (detail?.error) setError(detail.error);
			else if (detail?.saved) setError(null);
			if (detail?.reason === "session-title") {
				setState((current) => ({ ...current }));
				return;
			}
			if (detail?.source === "view" && !detail.stateKey) return;
			const next = load(detail?.state ?? loadAgentState());
			setState((current) =>
				current.key === next.key && !detail?.error ? current : next,
			);
		});
		if (loadCanonical) void loadCanonicalAgentState();
		return stop;
	}, [loadCanonical, selectFirst]);
	return [state, setState, error] as const;
}
