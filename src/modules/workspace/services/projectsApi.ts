import type { ProjectCatalog, ProjectCommand } from "@contracts";
import { fetchJson, postJson } from "@shared/lib/native.tsx";

export function loadProjects(projectId = "", before?: string) {
	const query = new URLSearchParams({ projectId });
	if (before !== undefined) query.set("before", String(before));
	return fetchJson<ProjectCatalog>(`/api/projects?${query}`, undefined, {
		server: true,
	});
}
export function changeProject(command: ProjectCommand) {
	return postJson<{ id?: string; path?: string }>(
		"/api/projects/command",
		command,
		undefined,
		{ server: true },
	);
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
