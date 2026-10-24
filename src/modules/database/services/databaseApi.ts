import type {
	DatabaseCell,
	DatabaseCellQuery,
	DatabaseId,
	DatabaseInfo,
	DatabaseRows,
	DatabaseRowsQuery,
	DatabaseSchema,
} from "@contracts";
import { fetchJson } from "@shared/lib/native.tsx";

export function listDatabases(signal?: AbortSignal) {
	return fetchJson<DatabaseInfo[]>("/api/databases", { signal });
}
export function getDatabaseSchema(database: DatabaseId, signal?: AbortSignal) {
	return fetchJson<DatabaseSchema>(
		`/api/databases/schema?database=${encodeURIComponent(database)}`,
		{ signal },
	);
}
export function getDatabaseRows(
	query: DatabaseRowsQuery,
	signal?: AbortSignal,
) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query))
		if (value !== null) params.set(key, String(value));
	return fetchJson<DatabaseRows>(`/api/databases/rows?${params}`, { signal });
}
export function getDatabaseCell(
	query: DatabaseCellQuery,
	signal?: AbortSignal,
) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query))
		params.set(key, String(value));
	return fetchJson<DatabaseCell>(`/api/databases/cell?${params}`, { signal });
}
export function getDatabaseOpenApi(signal?: AbortSignal) {
	return fetchJson<unknown>("/api/openapi.json", { signal });
}
