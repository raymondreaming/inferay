import type {
	AutomationReview,
	ConnectionCommand,
	ConnectionInfo,
	DraftPreview,
	EffectDelivery,
	EffectInboxPage,
	EffectReviewRequest,
	PluginLibrary,
	PluginProposalReview,
	PluginReview,
	PluginTextFile,
	ProjectEffectIntent,
	ProjectFileCommand,
	ProjectProposalRequest,
	ProjectProposalView,
	ProjectWorkspace,
	TablePreview,
} from "@contracts";
import { fetchJson, postJson } from "@shared/lib/native.tsx";
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
	return postJson<
		Partial<AutomationReview> & {
			id?: string;
			path?: string;
			sourceHash?: string;
		}
	>("/api/projects/command", command, undefined, { server: true });
}

export function readProjectFile(
	directory: string,
	path: string,
	signal?: AbortSignal,
) {
	return fetchJson<{
		content: string;
		hash: string;
		table: TablePreview | null;
		tableError: string | null;
		draft: DraftPreview | null;
		draftError: string | null;
	}>(
		`/api/files/content?${new URLSearchParams({ cwd: directory, path })}`,
		{ signal },
		{ server: true },
	);
}

export function projectImageUrl(directory: string, path: string) {
	return `/api/file?${new URLSearchParams({ path: `${directory}/${path}` })}`;
}

export function projectVideoUrl(directory: string, path: string) {
	return `/api/video?${new URLSearchParams({ path: `${directory}/${path}` })}`;
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

export function projectDocumentUrl(projectId: string, path: string) {
	return `/api/projects/document?${new URLSearchParams({ projectId, path })}`;
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

export function reviewPluginProposal(
	command: ProjectFileCommand,
	signal?: AbortSignal,
) {
	return postJson<PluginProposalReview>(
		"/api/projects/proposal-review",
		command,
		{ signal },
		{ server: true },
	);
}

export function loadProjectConnections(projectId: string) {
	return fetchJson<{ connections: ConnectionInfo[] }>(
		`/api/projects/connections?${new URLSearchParams({ projectId })}`,
		undefined,
		{ server: true },
	);
}
export function changeProjectConnection(command: ConnectionCommand) {
	return postJson<{ connections: ConnectionInfo[] }>(
		"/api/projects/connections",
		command,
		undefined,
		{ server: true },
	);
}

export function dismissEffect(request: EffectReviewRequest) {
	return postJson<Pick<ProjectEffectIntent, "dismissedAt">>(
		"/api/projects/effects/dismiss",
		request,
		undefined,
		{ server: true },
	);
}

export function loadEffectInbox(
	projectId: string,
	automationId?: string,
	before?: string,
) {
	const query = new URLSearchParams({ projectId });
	if (automationId) query.set("automationId", automationId);
	if (before) query.set("before", before);
	return fetchJson<EffectInboxPage>(
		`/api/projects/effects?${query}`,
		undefined,
		{ server: true },
	);
}

export function cancelEffect(request: EffectReviewRequest) {
	return postJson<EffectDelivery>(
		"/api/projects/effects/cancel",
		request,
		undefined,
		{ server: true },
	);
}
