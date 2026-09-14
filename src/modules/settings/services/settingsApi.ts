import type {
	AgentAccountProviderStatus,
	EffectiveAgentContext,
	GithubRepo,
} from "@contracts";
import {
	fetchJson,
	fetchJsonOr,
	pickCloneDirectory as pickNativeDirectory,
	postJson,
	request,
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
		const response = await request("/api/config/background-image", {
			method: "POST",
			body,
		});
		if (!response.ok) {
			const failure = await response.json().catch(() => null);
			throw new Error(failure?.error || "Could not import that image");
		}
		return response.json() as Promise<{ revision: number }>;
	},
	async loadGlobalInstructions(signal) {
		const context = await fetchJson<EffectiveAgentContext>(
			"/api/agent-context?paneId=global-settings",
			{ signal },
		);
		return context.global.instructions;
	},
	async saveGlobalInstructions(instructions) {
		const response = await sendJson(
			"/api/agent-context",
			{
				scope: "global",
				instructions,
				mode: "inherit",
				paneId: "global-settings",
			},
			{ method: "PUT" },
		);
		if (!response.ok) throw new Error("Could not save agent instructions");
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

export async function connectGithub() {
	await postJson("/api/forge/connect", { provider: "github" });
}

export async function pickCloneDirectory() {
	return pickNativeDirectory();
}

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
