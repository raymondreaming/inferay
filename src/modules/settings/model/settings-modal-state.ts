import type { AgentAccountProviderStatus } from "../../agents/model/agent-account-status.ts";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type StateValue<T> = T | ((current: T) => T);

export interface SettingsModalUiState {
	error: string | null;
	connecting: boolean;
	repoQuery: string;
	cloneDirectory: string;
	cloneStatus: string | null;
	cloningRepo: string | null;
}

export type SettingsModalUiAction<
	K extends keyof SettingsModalUiState = keyof SettingsModalUiState,
> = {
	type: "fieldChanged";
	field: K;
	value: StateValue<SettingsModalUiState[K]>;
};

export const initialSettingsModalUiState: SettingsModalUiState = {
	error: null,
	connecting: false,
	repoQuery: "",
	cloneDirectory: "~/Desktop",
	cloneStatus: null,
	cloningRepo: null,
};

export function settingsModalUiReducer(
	state: SettingsModalUiState,
	action: SettingsModalUiAction,
): SettingsModalUiState {
	const current = state[action.field];
	const next =
		typeof action.value === "function"
			? (action.value as (value: typeof current) => typeof current)(current)
			: action.value;
	return Object.is(current, next) ? state : { ...state, [action.field]: next };
}

export function areAgentAccountStatusesEqual(
	previous: AgentAccountProviderStatus[],
	next: AgentAccountProviderStatus[],
) {
	return (
		previous.length === next.length &&
		previous.every((status, index) => {
			const candidate = next[index];
			return (
				candidate !== undefined &&
				status.kind === candidate.kind &&
				status.label === candidate.label &&
				status.installed === candidate.installed &&
				status.binaryPath === candidate.binaryPath &&
				status.version === candidate.version &&
				status.health === candidate.health &&
				status.summary === candidate.summary &&
				arraysEqual(status.authConfigPaths, candidate.authConfigPaths) &&
				arraysEqual(status.usageSignals, candidate.usageSignals)
			);
		})
	);
}

function arraysEqual(previous: string[], next: string[]) {
	return (
		previous.length === next.length &&
		previous.every((value, index) => value === next[index])
	);
}
