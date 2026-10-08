import type { MemoryHit, MemoryNote, MemoryNoteInput } from "@contracts";
import { fetchJson, postJson } from "@shared/lib/native.tsx";

export type MemoryScope = { projectId?: string; paneId?: string };
export type MemoryListing = {
	projectId: string;
	listing: { hits: MemoryHit[]; total: number; errors: string[] };
};
export type MemoryNoteView = {
	note: MemoryNote;
	path: string;
	supersededBy: string | null;
	linksOut: MemoryHit[];
	linksIn: MemoryHit[];
};

function scopeQuery(scope: MemoryScope, extra: Record<string, string> = {}) {
	const query = new URLSearchParams(extra);
	if (scope.projectId) query.set("projectId", scope.projectId);
	if (scope.paneId) query.set("paneId", scope.paneId);
	return query;
}

export function searchMemory(scope: MemoryScope, q = "", tag = "") {
	return fetchJson<MemoryListing>(
		`/api/memory?${scopeQuery(scope, { q, tag, limit: "50" })}`,
		undefined,
		{ server: true },
	);
}

export function readMemoryNote(scope: MemoryScope, id: string) {
	return fetchJson<MemoryNoteView>(
		`/api/memory/note?${scopeQuery(scope, { id })}`,
		undefined,
		{ server: true },
	);
}

export function saveMemoryNote(scope: MemoryScope, note: MemoryNoteInput) {
	return postJson<{ projectId: string; note: MemoryNote }>(
		"/api/memory/save",
		{ ...scope, note },
		undefined,
		{ server: true },
	);
}

export function memoryTitle(text: string) {
	const line =
		text
			.split("\n")
			.map((row) =>
				row
					.replace(/^[#>*\-\s`]+/, "")
					.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
					.replace(/(\*\*|__|`|~~)/g, "")
					.trim(),
			)
			.find((row) => row.length > 0) ?? "Saved from chat";
	return line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
}

export type MemoryGraphNode = {
	id: string;
	kind: "note" | "image" | "file" | "source";
	title: string;
	source: string;
	created: string;
	path: string;
	tags: string[];
	superseded: boolean;
	size: number;
};
export type MemoryGraphEdge = {
	from: string;
	to: string;
	kind: "source" | "link" | "supersedes";
};
export type MemoryGraphData = {
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
	truncated: boolean;
};

export function loadMemoryGraph(projectId: string) {
	return fetchJson<MemoryGraphData>(
		`/api/memory/graph?${new URLSearchParams({ projectId })}`,
		undefined,
		{ server: true },
	);
}

export function deleteMemoryItem(
	projectId: string,
	item: { id?: string; path?: string },
) {
	return postJson<{ deleted: boolean }>(
		"/api/memory/delete",
		{ projectId, ...item },
		undefined,
		{ server: true },
	);
}
