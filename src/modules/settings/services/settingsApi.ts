import {
	loadAgentContext,
	saveAgentContext,
} from "@context/services/contextApi.ts";
import type {
	AgentAccountProviderStatus,
	GithubRepo,
	McpAction,
	McpProviderStatus,
} from "@contracts";
import {
	fetchJson,
	fetchJsonOr,
	pickCloneDirectory as pickNativeDirectory,
	postJson,
	sendJson,
} from "@shared/lib/native.tsx";

export type SettingsApi = {
	uploadBackgroundImage(file: File): Promise<{ revision: number }>;
	loadGlobalInstructions(signal?: AbortSignal): Promise<string>;
	saveGlobalInstructions(instructions: string): Promise<void>;
	loadSearchFolders(): Promise<string[]>;
	saveSearchFolders(folders: string[]): Promise<void>;
	pickSearchFolder(): Promise<string | null>;
};

export const settingsApi: SettingsApi = {
	async uploadBackgroundImage(file) {
		const body = new FormData();
		body.append("file", file);
		return fetchJson<{ revision: number }>(
			"/api/config/background-image",
			{ method: "POST", body },
			{ server: true, message: "Could not import that image" },
		);
	},
	async loadGlobalInstructions(signal) {
		return (await loadAgentContext("global-settings", undefined, signal)).global
			.instructions;
	},
	async saveGlobalInstructions(instructions) {
		await saveAgentContext({
			scope: "global",
			instructions,
			mode: "inherit",
			paneId: "global-settings",
		});
	},
	async loadSearchFolders() {
		return (
			await fetchJsonOr<{ folders: string[] }>("/api/config/search-folders", {
				folders: [],
			})
		).folders;
	},
	async saveSearchFolders(folders) {
		const response = await sendJson(
			"/api/config/search-folders",
			{ folders },
			{ method: "PUT" },
		);
		if (!response.ok) throw new Error("Could not save search folders");
	},
	pickSearchFolder: pickNativeDirectory,
};

export async function fetchAgentAccountStatuses(signal?: AbortSignal) {
	const payload = await fetchJson<{
		providers?: AgentAccountProviderStatus[];
	}>("/api/agents/account-status", { signal });
	return Array.isArray(payload.providers) ? payload.providers : [];
}

export function fetchMcpStatus(
	provider: "codex" | "claude",
	signal?: AbortSignal,
	refresh = false,
) {
	return fetchJson<McpProviderStatus>(
		`/api/agents/mcp-status?provider=${provider}&refresh=${refresh}`,
		{ signal },
	);
}

export function updateMcpConnection(action: McpAction) {
	return postJson<{ message: string }>("/api/agents/mcp-action", action);
}

export async function connectGithub() {
	await postJson("/api/forge/connect", { provider: "github" });
}

export const pickCloneDirectory = pickNativeDirectory;

export async function cloneGithubRepo(
	repo: GithubRepo,
	cloneDirectory: string,
) {
	const payload = await postJson<{ displayPath?: string }>(
		"/api/forge/clone",
		{
			gitUrl: repo.html_url,
			cloneDirectory,
		},
		undefined,
		{ server: true, message: "Clone failed" },
	);
	return `Cloned ${repo.full_name} to ${payload.displayPath}`;
}
