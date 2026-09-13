import type { WorkspaceSnapshot } from "@workspace/model/workspace.ts";
import { createWorkspaceSession } from "@workspace/services/workspaceSession.ts";

export type { AgentGroupsAction } from "@workspace/model/workspace.ts";

import type {
	Group,
	RepositoryWorkspaceIndex,
	WorkspaceAgentKind,
} from "@contracts";
import { project as rustProject } from "@shared/lib/native.tsx";
import { traceUi } from "@shared/lib/uiPerformance.ts";
import {
	initializeWorkspaceState,
	loadWorkspaceState,
	saveWorkspaceAction,
} from "@workspace/services/workspaceApi.ts";
import {
	type Accessor,
	createEffect,
	createStore,
	reconcile,
	snapshot as storeSnapshot,
} from "solid-js";

const EMPTY: RepositoryWorkspaceIndex = {
	workspaces: [],
	unassignedEntries: [],
	activePath: null,
	activeWorkspace: null,
	visibleEntries: [],
};
const [published, setPublished] = createStore<WorkspaceSnapshot>({
	state: null,
	error: null,
});
const session = createWorkspaceSession(
	{
		initialize: initializeWorkspaceState,
		load: loadWorkspaceState,
		save: saveWorkspaceAction,
	},
	rustProject,
	(next) =>
		setPublished(
			reconcile(next, (item) => item.id ?? item.cwd ?? item.pane?.id),
		),
	() => traceUi("selection-published"),
);
export const initializeAgentState = session.initialize;
export const loadCanonicalAgentState = session.load;
export const mutateAgentWorkspaceState = session.mutate;
export const changePaneAgentKind = (
	paneId: string,
	agentKind: WorkspaceAgentKind,
) => {
	void mutateAgentWorkspaceState({
		type: "changePaneAgentKind",
		paneId,
		agentKind,
	});
};
export interface SidebarWorkspaceState {
	repositories: RepositoryWorkspaceIndex;
	groups: Group[];
	selectedGroupId: string | null;
}
export function useWorkspaceState(
	_loadCanonical: Accessor<boolean> = () => true,
	_selectFirst: Accessor<boolean> = () => true,
) {
	const emptyGroups: Group[] = [];
	const state: SidebarWorkspaceState = {
		get groups() {
			return published.state?.groups ?? emptyGroups;
		},
		get repositories() {
			return published.state?.repositories ?? EMPTY;
		},
		get selectedGroupId() {
			return (
				published.state?.selectedGroupId ??
				(_selectFirst() ? published.state?.groups[0]?.id : null) ??
				null
			);
		},
	};
	createEffect(_loadCanonical, (load) => {
		if (load) void loadCanonicalAgentState();
	});
	const setState = (
		update:
			| SidebarWorkspaceState
			| ((state: SidebarWorkspaceState) => SidebarWorkspaceState),
	) => {
		const current = session.snapshot.state;
		if (!current) return;
		const next = storeSnapshot(
			typeof update === "function"
				? update({
						groups: current.groups,
						repositories: current.repositories,
						selectedGroupId: current.selectedGroupId,
					})
				: update,
		);
		session.publish({
			...session.snapshot,
			state: {
				...current,
				...next,
				selectedGroupId: next.selectedGroupId ?? current.selectedGroupId,
			},
		});
	};
	return [() => state, setState, () => published.error] as const;
}
