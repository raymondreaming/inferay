import type {
	AgentSavedState,
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
import { noop } from "../../../shared/lib/dom.tsx";
import {
	postJson,
	project as rustProject,
} from "../../../shared/lib/native.tsx";
import { traceUi } from "../../../shared/lib/uiPerformance.ts";

type AgentWorkspaceAction =
	| {
			type: "selectWorkspace";
			groupId: string;
	  }
	| {
			type: "selectRepository";
			cwd: string;
	  }
	| {
			type: "selectPane";
			groupId: string;
			paneId: string;
	  }
	| {
			type: "addWorkspace";
	  }
	| {
			type: "removeWorkspace";
			groupId: string;
	  }
	| {
			type: "renameWorkspace";
			groupId: string;
			name: string;
	  }
	| {
			type: "addPane";
			groupId?: string;
			agentKind?: WorkspaceAgentKind;
			cwd?: string;
			referencePaths?: string[];
	  }
	| {
			type: "removePane";
			groupId: string;
			paneId: string;
	  }
	| {
			type: "directorySelected";
			groupId: string;
			paneId: string;
			path: string | null;
			referencePaths?: string[];
	  }
	| {
			type: "setPaneAgentKind";
			groupId: string;
			paneId: string;
			agentKind: WorkspaceAgentKind;
	  }
	| {
			type: "reorderPanes";
			groupId: string;
			fromIndex: number;
			toIndex: number;
	  }
	| {
			type: "setGridDimensions";
			groupId: string;
			columns?: number;
			rows?: number;
	  }
	| {
			type: "changePaneAgentKind";
			paneId: string;
			agentKind: WorkspaceAgentKind;
	  }
	| {
			type: "setTheme";
			themeId: string;
	  };
export type AgentGroupsAction = Exclude<
	AgentWorkspaceAction,
	{
		type: "addWorkspace" | "removeWorkspace" | "renameWorkspace";
	}
>;
const EMPTY: RepositoryWorkspaceIndex = {
	workspaces: [],
	unassignedEntries: [],
	activePath: null,
	activeWorkspace: null,
	visibleEntries: [],
};
type WorkspaceSnapshot = {
	state: AgentSavedState | null;
	error: string | null;
};
let snapshot: WorkspaceSnapshot = {
	state: null,
	error: null,
};
let canonicalState: AgentSavedState | null = null;
// One reconciled UI store preserves pane/repository identities across native
// snapshots. The queue keeps raw snapshots for synchronous mutation ordering.
const [published, setPublished] = createStore<WorkspaceSnapshot>(snapshot);
const publish = (next: WorkspaceSnapshot) => {
	snapshot = next;
	setPublished(reconcile(next, (item) => item.id ?? item.cwd ?? item.pane?.id));
};
let queue: Promise<unknown> = Promise.resolve();
let read: Promise<AgentSavedState | null> | null = null;
let selectionRequest = 0;
let queuedStructuralChanges = 0;
let pendingSelection: {
	id: number;
	groupId: string;
	paneId?: string;
} | null = null;
function selected(
	state: AgentSavedState,
	groupId: string,
	paneId?: string,
): AgentSavedState {
	return rustProject("workspaceSelection", {
		state,
		groupId,
		paneId,
	});
}
function loadAgentState() {
	return snapshot.state;
}
function accept(state: AgentSavedState, saved = false) {
	canonicalState = state;
	const pending = pendingSelection;
	publish({
		state: pending ? selected(state, pending.groupId, pending.paneId) : state,
		error: saved ? null : snapshot.error,
	});
}
export async function initializeAgentState() {
	const { state } = await postJson<{
		state: AgentSavedState;
	}>("/api/agent/state/initialize", {});
	accept(state, true);
	return state;
}
export function loadCanonicalAgentState(): Promise<AgentSavedState | null> {
	if (read) return read;
	const current = queue.then(async () => {
		try {
			const response = await fetch("/api/agent/state");
			if (!response.ok) throw 0;
			const state = (await response.json()) as AgentSavedState | null;
			if (state) accept(state, true);
			return loadAgentState();
		} catch {
			publish({
				...snapshot,
				error: "Saved workspaces could not be loaded.",
			});
			return snapshot.state;
		}
	});
	const tracked = current.finally(() => {
		if (read === tracked) read = null;
	});
	read = tracked;
	queue = read.catch(noop);
	return current;
}
export function mutateAgentWorkspaceState(
	action:
		| AgentWorkspaceAction
		| ((state: AgentSavedState) => AgentWorkspaceAction | null),
) {
	const requestId = ++selectionRequest;
	const selection =
		typeof action === "function"
			? null
			: action.type === "selectRepository" && snapshot.state
				? rustProject<{ groupId: string; paneId: string } | null>(
						"repositorySelection",
						{ state: snapshot.state, cwd: action.cwd },
					)
				: action.type === "selectPane" || action.type === "selectWorkspace"
					? {
							groupId: action.groupId,
							paneId: action.type === "selectPane" ? action.paneId : undefined,
						}
					: null;
	// Repeated focus clicks should not persist the same selection or delay a new
	// pane. A queued structural action may change selection, so keep ordering then.
	if (selection && queuedStructuralChanges === 0 && !snapshot.error) {
		const state = snapshot.state;
		const group = state?.groups.find((group) => group.id === selection.groupId);
		if (
			state?.selectedGroupId === selection.groupId &&
			group &&
			(selection.paneId === undefined ||
				group.selectedPaneId === selection.paneId)
		)
			return Promise.resolve(state);
	}
	const structural = selection === null;
	if (structural) queuedStructuralChanges++;
	if (selection) {
		pendingSelection = { id: requestId, ...selection };
		const state = snapshot.state;
		if (state)
			publish({
				...snapshot,
				state: selected(state, selection.groupId, selection.paneId),
			});
	}
	if (selection) traceUi("selection-published");
	const mutation = queue.then(async () => {
		const current = snapshot.state ?? (await initializeAgentState()),
			next = typeof action === "function" ? action(current) : action;
		if (!next) return null;
		try {
			const { state } = await postJson<{
				state: AgentSavedState;
			}>("/api/agent/state/workspace-action", {
				action: next,
			});
			if (pendingSelection?.id === requestId) pendingSelection = null;
			accept(state, true);
			return loadAgentState();
		} catch {
			if (pendingSelection?.id === requestId) pendingSelection = null;
			if (canonicalState) accept(canonicalState);
			publish({
				...snapshot,
				error: "Workspace changes could not be saved.",
			});
			return null;
		}
	});
	const settled = mutation.finally(() => {
		if (structural) queuedStructuralChanges--;
	});
	queue = settled.catch(noop);
	return settled;
}
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
		const current = snapshot.state;
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
		publish({
			...snapshot,
			state: {
				...current,
				...next,
				selectedGroupId: next.selectedGroupId ?? current.selectedGroupId,
			},
		});
	};
	return [() => state, setState, () => published.error] as const;
}
