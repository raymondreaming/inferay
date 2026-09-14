import type {
	AgentDirectory,
	AgentSavedState,
	AgentWorkspaceAction,
	DirectoryQuickPicks,
} from "@contracts";
import {
	fetchJson,
	fetchJsonOr,
	postJson,
	sendJson,
} from "@shared/lib/native.tsx";
import type { WorkspacePanelPort } from "@workspace/hooks/useWorkspacePanelSession.tsx";

export function loadDirectoryQuickPicks() {
	return fetchJsonOr<DirectoryQuickPicks>(
		"/api/agent/directories?quickPicks=true",
		{ quickPicks: [], home: "" },
	);
}

export async function searchDirectories(
	query: string,
	signal?: AbortSignal,
): Promise<AgentDirectory[]> {
	if (!query) return [];
	const data = await fetchJsonOr<{
		directories?: AgentDirectory[];
	}>(
		`/api/agent/directories?${new URLSearchParams({ q: query })}`,
		{},
		{ signal },
	);
	return data.directories ?? [];
}

export async function initializeWorkspaceState(): Promise<AgentSavedState> {
	const { state } = await postJson<{ state: AgentSavedState }>(
		"/api/agent/state/initialize",
		{},
	);
	return state;
}

export function loadWorkspaceState(): Promise<AgentSavedState | null> {
	return fetchJson("/api/agent/state", undefined, {
		message: "Could not load workspace state",
	});
}

export async function saveWorkspaceAction(
	action: AgentWorkspaceAction,
): Promise<AgentSavedState> {
	const { state } = await postJson<{ state: AgentSavedState }>(
		"/api/agent/state/workspace-action",
		{ action },
	);
	return state;
}

export const saveWorkspacePanel: WorkspacePanelPort = (input) =>
	postJson("/api/workspace/panels", input);

export function saveWorkspaceDock<T>(input: object) {
	return postJson<T>("/api/workspace/dock", input);
}

export async function checkNativeUpdate(
	method: "GET" | "POST",
	signal: AbortSignal,
): Promise<{
	status: "idle" | "updating" | "error" | "complete";
	error?: string;
}> {
	const response = await sendJson("/api/native/update", undefined, {
		method,
		signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
	});
	const result = (await response.json()) as {
		status: "idle" | "updating" | "error" | "complete";
		error?: string;
	};
	if (!response.ok || result.status === "error")
		throw new Error(result.error || `Update failed (${response.status})`);
	return result;
}
