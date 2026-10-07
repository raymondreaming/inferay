import type {
	PluginLibrary,
	PluginReview,
	PluginTextFile,
	ProjectDocument,
	ProjectFileCommand,
	ProjectProposalRequest,
	ProjectProposalView,
	ProjectWorkspace,
} from "@contracts";
import { fetchJson, postJson, request } from "@shared/lib/native.tsx";
import { projectWorkspaceView } from "../model/projectFiles.ts";

export async function loadProjects(projectId = "", before?: string) {
	const query = new URLSearchParams({ projectId });
	if (before !== undefined) query.set("before", String(before));
	return projectWorkspaceView(
		await fetchJson<ProjectWorkspace>(`/api/projects?${query}`, undefined, {
			server: true,
		}),
	);
}
export function changeProject(command: ProjectFileCommand) {
	return postJson<{
		id?: string;
		path?: string;
		sourceHash?: string;
		inputsHash?: string;
	}>("/api/projects/command", command, undefined, { server: true });
}

export function readProjectFile(directory: string, path: string) {
	return fetchJson<{ content: string; hash: string }>(
		`/api/files/content?${new URLSearchParams({ cwd: directory, path })}`,
		undefined,
		{ server: true },
	);
}

export function openRunChat(id: string) {
	return postJson<{ paneId: string }>(
		"/api/projects/run-chat",
		{ id },
		undefined,
		{ server: true },
	);
}

export function importProjectDocument(projectId: string, file: File) {
	const body = new FormData();
	body.append("file", file);
	return fetchJson<{ path: string; sourceHash: string }>(
		`/api/projects/documents?${new URLSearchParams({ projectId })}`,
		{ method: "POST", body },
		{ server: true },
	);
}

export function listProjectDocuments(projectId: string, signal?: AbortSignal) {
	return fetchJson<ProjectDocument[]>(
		`/api/projects/documents?${new URLSearchParams({ projectId })}`,
		{ signal },
		{ server: true },
	);
}
export function projectDocumentUrl(projectId: string, path: string) {
	return `/api/projects/document?${new URLSearchParams({ projectId, path })}`;
}
export async function readProjectDocument(
	projectId: string,
	path: string,
	signal?: AbortSignal,
) {
	const response = await request(projectDocumentUrl(projectId, path), {
		signal,
	});
	if (!response.ok)
		throw new Error(
			"Document could not be read. Refresh the library and try again.",
		);
	return response.text();
}

export function reviewProjectPlugin(id: string) {
	return postJson<PluginReview>(
		"/api/projects/command",
		{ type: "reviewPlugin", id },
		undefined,
		{ server: true },
	);
}

export function readPluginLibrary(id: string) {
	return postJson<PluginLibrary>(
		"/api/projects/command",
		{ type: "readPlugin", id },
		undefined,
		{ server: true },
	);
}
export function readPluginTextFile(id: string, path: string) {
	return postJson<PluginTextFile>(
		"/api/projects/command",
		{ type: "readPlugin", id, path },
		undefined,
		{ server: true },
	);
}

export type PluginImportFile = { path: string; file: File };

export function importPluginLibrary(
	projectId: string,
	name: string,
	files: PluginImportFile[],
) {
	const body = new FormData();
	for (const { path, file } of files) body.append(path, file, file.name);
	return fetchJson<{ id: string }>(
		`/api/projects/plugin-import?${new URLSearchParams({ projectId, name })}`,
		{ method: "POST", body },
		{ server: true },
	);
}

export function projectProposal(
	request: ProjectProposalRequest,
	signal?: AbortSignal,
) {
	return postJson<ProjectProposalView>(
		"/api/projects/proposal",
		request,
		{ signal },
		{ server: true },
	);
}
