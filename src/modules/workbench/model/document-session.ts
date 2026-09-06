import { fetchJson } from "../../../adapters/backend/http.ts";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../adapters/storage/stored-values.ts";
import type { FileContentResponse } from "./workbench-model.ts";

type FileViewerSession = {
	readonly activePath: string | null;
	readonly openFiles: FileContentResponse[];
};

type PersistedFileViewerSession = {
	readonly cwd: string;
	readonly activePath: string | null;
	readonly paths: string[];
};

export const fileViewerSessions = new Map<string, FileViewerSession>();

export function readPersistedFileViewerSession(
	sessionId: string,
	cwd: string,
): PersistedFileViewerSession | null {
	const stored = readStoredJson<PersistedFileViewerSession | null>(
		`agent-workspace-files:${sessionId}`,
		null,
	);
	if (!stored || stored.cwd !== cwd || !Array.isArray(stored.paths))
		return null;
	return {
		cwd,
		activePath:
			typeof stored.activePath === "string" ? stored.activePath : null,
		paths: stored.paths.filter(
			(path, index, paths) =>
				typeof path === "string" && !!path && paths.indexOf(path) === index,
		),
	};
}

export function persistFileViewerSession(
	sessionId: string,
	cwd: string,
	session: FileViewerSession,
	restoring: boolean,
) {
	fileViewerSessions.set(sessionId, session);
	if (!restoring)
		writeStoredJson(`agent-workspace-files:${sessionId}`, {
			cwd,
			activePath: session.activePath,
			paths: session.openFiles.map((file) => file.path),
		});
}
export function readDocument(cwd: string, path: string) {
	return fetchJson<FileContentResponse>(
		`/api/files/content?${new URLSearchParams({ cwd, path })}`,
	);
}
export async function restoreDocumentFiles(cwd: string, paths: string[]) {
	const files = await Promise.all(
		paths.map((path) => readDocument(cwd, path).catch(() => null)),
	);
	return files.filter((file): file is FileContentResponse => file !== null);
}
export function mergeRestoredDocuments(
	current: FileContentResponse[],
	restored: FileContentResponse[],
	paths: string[],
) {
	const byPath = new Map(
		[...current, ...restored].map((file) => [file.path, file]),
	);
	return paths
		.map((path) => byPath.get(path))
		.filter((file): file is FileContentResponse => !!file);
}
