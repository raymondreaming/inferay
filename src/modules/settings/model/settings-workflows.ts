import { fetchJsonOr, sendJson } from "../../../adapters/backend/http.ts";
import type { AgentAccountProviderStatus } from "../../agents/model/agents.ts";
import type { GithubRepo } from "../../repository/model/types.ts";

export async function fetchAgentAccountStatuses() {
	const payload = await fetchJsonOr<{
		providers?: AgentAccountProviderStatus[];
	}>("/api/agents/account-status", {});
	return Array.isArray(payload.providers) ? payload.providers : [];
}

export async function pickCloneDirectory() {
	const payload = await fetchJsonOr<{ folder: string | null }>(
		"/api/config/pick-folder",
		{ folder: null },
		{ method: "POST" },
	);
	return payload.folder;
}

export async function fetchSearchFolders() {
	return (
		await fetchJsonOr<{ folders: string[] }>("/api/config/search-folders", {
			folders: [],
		})
	).folders;
}

export async function saveSearchFolders(folders: string[]) {
	await sendJson("/api/config/search-folders", { folders }, { method: "PUT" });
}

export async function cloneGithubRepo(
	repo: GithubRepo,
	cloneDirectory: string,
) {
	const response = await sendJson("/api/forge/clone", {
		gitUrl: repo.html_url,
		cloneDirectory,
	});
	const payload = (await response.json()) as {
		error?: string;
		displayPath?: string;
	};
	if (!response.ok) throw new Error(payload.error ?? "Clone failed");
	return `Cloned ${repo.full_name} to ${payload.displayPath}`;
}
