import type { WorkspaceSnapshot } from "@workspace/model/workspace.ts";
import {
	createWorkspaceSession,
	type WorkspaceMutation,
	type WorkspacePersistencePort,
	type WorkspaceSelectionPort,
	type WorkspaceSession,
} from "@workspace/services/workspaceSession.ts";

export type { AgentGroupsAction } from "@workspace/model/workspace.ts";

import type {
	Group,
	RepositoryWorkspaceIndex,
	WorkspaceAgentKind,
} from "@contracts";
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
let configuredSession: WorkspaceSession | undefined;
export function configureWorkspaceState(
	port: WorkspacePersistencePort,
	selection: WorkspaceSelectionPort,
	onSelection?: () => void,
) {
	if (configuredSession)
		throw new Error("Workspace state is already configured");
	configuredSession = createWorkspaceSession(
		port,
		selection,
		(next) =>
			setPublished(
				reconcile(next, (item) => item.id ?? item.cwd ?? item.pane?.id),
			),
		onSelection,
	);
}
function workspaceSession(): WorkspaceSession {
	if (!configuredSession)
		throw new Error("Configure workspace state before mounting the app");
	return configuredSession;
}
export const initializeAgentState = () => workspaceSession().initialize();
export const loadCanonicalAgentState = () => workspaceSession().load();
export const mutateAgentWorkspaceState = (action: WorkspaceMutation) =>
	workspaceSession().mutate(action);
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
		const session = workspaceSession();
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
