import type {
	ExplorerEntry,
	ExplorerSearchResult,
} from "@explorer/model/files.ts";

export type {
	ExplorerEntry,
	ExplorerSearchResult,
} from "@explorer/model/files.ts";

import { fetchJson } from "@shared/lib/native.tsx";

export async function searchFiles(
	cwd: string,
	query: string,
	signal?: AbortSignal,
): Promise<ExplorerSearchResult[]> {
	const response = await fetchJson<{ results: ExplorerSearchResult[] }>(
		`/api/files/search?${new URLSearchParams({ cwd, q: query, limit: "24" })}`,
		{ signal },
	);
	return response.results.filter((result) => !result.isDir);
}

export async function listDirectory(
	cwd: string,
	path: string,
	signal?: AbortSignal,
): Promise<ExplorerEntry[]> {
	const response = await fetchJson<{ entries: ExplorerEntry[] }>(
		`/api/files/list?${new URLSearchParams({ cwd, path })}`,
		{ signal },
	);
	return response.entries;
}
