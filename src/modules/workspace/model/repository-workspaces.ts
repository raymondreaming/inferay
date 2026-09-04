import type { AgentPaneModel } from "./workspace-model.ts";

export interface RepositoryWorkspaceSourceGroup {
	readonly id: string;
	readonly panes: readonly AgentPaneModel[];
	readonly selectedPaneId?: string | null;
}

export interface RepositoryWorkspaceEntry {
	readonly groupId: string;
	readonly pane: AgentPaneModel;
}

export interface RepositoryWorkspace {
	readonly cwd: string;
	readonly name: string;
	readonly entries: readonly RepositoryWorkspaceEntry[];
}

export interface RepositoryWorkspaceProjection {
	readonly workspaces: readonly RepositoryWorkspace[];
	readonly activePath: string | null;
	readonly activeWorkspace: RepositoryWorkspace | null;
	readonly unassignedEntries: readonly RepositoryWorkspaceEntry[];
}

function normalizeRepositoryPath(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "/") return trimmed;
	return trimmed.replace(/[\\/]+$/, "");
}

export function getRepositoryWorkspaceName(cwd: string): string {
	const normalized = normalizeRepositoryPath(cwd);
	return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

export function projectRepositoryWorkspaces(
	groups: readonly RepositoryWorkspaceSourceGroup[],
	selectedGroupId: string | null,
): RepositoryWorkspaceProjection {
	const entriesByPath = new Map<string, RepositoryWorkspaceEntry[]>();
	const unassignedEntries: RepositoryWorkspaceEntry[] = [];

	for (const group of groups) {
		for (const pane of group.panes) {
			const cwd = pane.cwd ? normalizeRepositoryPath(pane.cwd) : "";
			const entry = { groupId: group.id, pane };
			if (!cwd) {
				unassignedEntries.push(entry);
				continue;
			}
			const entries = entriesByPath.get(cwd);
			if (entries) entries.push(entry);
			else entriesByPath.set(cwd, [entry]);
		}
	}

	const workspaces = Array.from(entriesByPath, ([cwd, entries]) => ({
		cwd,
		name: getRepositoryWorkspaceName(cwd),
		entries,
	}));
	const selectedGroup =
		groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
	const selectedPane =
		selectedGroup?.panes.find(
			(pane) => pane.id === selectedGroup.selectedPaneId,
		) ??
		selectedGroup?.panes[0] ??
		null;
	const activePath = selectedPane?.cwd
		? normalizeRepositoryPath(selectedPane.cwd)
		: null;
	const activeWorkspace =
		workspaces.find((workspace) => workspace.cwd === activePath) ?? null;

	return { workspaces, activePath, activeWorkspace, unassignedEntries };
}

export function getRepositoryWorkspaceTarget(
	workspace: RepositoryWorkspace,
	groups: readonly RepositoryWorkspaceSourceGroup[],
	selectedGroupId: string | null,
): RepositoryWorkspaceEntry | null {
	const currentGroupEntry = workspace.entries.find(
		(entry) => entry.groupId === selectedGroupId,
	);
	if (currentGroupEntry) return currentGroupEntry;

	const selectedEntry = workspace.entries.find((entry) => {
		const group = groups.find((candidate) => candidate.id === entry.groupId);
		return group?.selectedPaneId === entry.pane.id;
	});
	return selectedEntry ?? workspace.entries[0] ?? null;
}

export function getVisibleRepositoryEntries(
	projection: RepositoryWorkspaceProjection,
	groupId?: string,
): readonly RepositoryWorkspaceEntry[] {
	const entries =
		projection.activeWorkspace?.entries ?? projection.unassignedEntries;
	return groupId
		? entries.filter((entry) => entry.groupId === groupId)
		: entries;
}
