import type { Group } from "../../../../../build/presentation/contracts/Group.ts";
import type { Pane } from "../../../../../build/presentation/contracts/Pane.ts";
import type { RepositoryWorkspaceIndex } from "../../../../../build/presentation/contracts/RepositoryWorkspaceIndex.ts";
import { project } from "../../../../shared/lib/native.tsx";

export type WorkspaceView = {
	key: string;
	group: Group;
	cwd: string | null;
	panes: Pane[];
};
export const workspaceViewKey = (groupId: string, cwd: string | null) =>
	JSON.stringify([groupId, cwd]);

export function workspaceViews(
	groups: Group[],
	repositories: RepositoryWorkspaceIndex,
): WorkspaceView[] {
	return groups.flatMap((group) => {
		const paths = new Map<string | null, Set<string>>();
		for (const workspace of repositories.workspaces) {
			const ids = workspace.entries
				.filter((entry) => entry.groupId === group.id)
				.map((entry) => entry.pane.id);
			if (ids.length) paths.set(workspace.cwd, new Set(ids));
		}
		const unassigned = repositories.unassignedEntries
			.filter((entry) => entry.groupId === group.id)
			.map((entry) => entry.pane.id);
		if (unassigned.length || paths.size === 0)
			paths.set(null, new Set(unassigned));
		return [...paths].map(([cwd, ids]) => ({
			key: workspaceViewKey(group.id, cwd),
			group,
			cwd,
			panes: group.panes.filter((pane) => ids.has(pane.id)),
		}));
	});
}

/** Retain only visited views. The active view is never evicted, even if large. */
export function retainWorkspaceViews(
	previous: WorkspaceView[],
	available: WorkspaceView[],
	activeKey: string,
	maxViews = 8,
	maxPanes = 24,
): WorkspaceView[] {
	const byKey = new Map(available.map((view) => [view.key, view]));
	const keys = project<string[]>("retainedWorkspaces", {
		previous: previous.map((view) => view.key),
		available: available.map((view) => ({
			key: view.key,
			panes: view.panes.length,
		})),
		activeKey,
		maxViews,
		maxPanes,
	});
	return keys.map((key) => byKey.get(key)!);
}
