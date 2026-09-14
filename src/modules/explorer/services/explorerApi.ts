import type { ProjectFileEntry } from "@contracts";
import { fetchJson } from "@shared/lib/native.tsx";

export async function searchFiles(
	cwd: string,
	query: string,
	signal?: AbortSignal,
): Promise<ProjectFileEntry[]> {
	const response = await fetchJson<{ results: ProjectFileEntry[] }>(
		`/api/files/search?${new URLSearchParams({ cwd, q: query, limit: "24" })}`,
		{ signal },
	);
	return response.results;
}

export async function listDirectory(
	cwd: string,
	path: string,
	signal?: AbortSignal,
): Promise<ProjectFileEntry[]> {
	const response = await fetchJson<{ entries: ProjectFileEntry[] }>(
		`/api/files/list?${new URLSearchParams({ cwd, path })}`,
		{ signal },
	);
	return response.entries;
}
