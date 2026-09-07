import { type Accessor, createEffect, createMemo } from "solid-js";
import type { AgentSavedState } from "../../../../build/presentation/contracts/AgentSavedState.ts";
import type { Group } from "../../../../build/presentation/contracts/Group.ts";
import type { RepositoryWorkspaceIndex } from "../../../../build/presentation/contracts/RepositoryWorkspaceIndex.ts";
import type { WorkspaceAgentKind } from "../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { createExternalSignal, noop } from "../../../shared/lib/dom.tsx";
import {
	postJson,
	project as rustProject,
} from "../../../shared/lib/native.tsx";

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
const subscribers = new Set<() => void>();
const publish = (next: WorkspaceSnapshot) => {
	snapshot = next;
	for (const subscriber of subscribers) subscriber();
};
let queue: Promise<unknown> = Promise.resolve();
let read: Promise<AgentSavedState | null> | null = null;
let selectionRequest = 0;
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
	if (selection) {
		pendingSelection = { id: requestId, ...selection };
		const state = snapshot.state;
		if (state)
			publish({
				...snapshot,
				state: selected(state, selection.groupId, selection.paneId),
			});
	}
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
	queue = mutation.catch(noop);
	return mutation;
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
	const current = createExternalSignal(
		(subscribe) => {
			subscribers.add(subscribe);
			return () => subscribers.delete(subscribe);
		},
		() => snapshot,
	);
	const project = (s: AgentSavedState | null) => ({
		groups: s?.groups ?? [],
		repositories: s?.repositories ?? EMPTY,
		selectedGroupId:
			s?.selectedGroupId ?? (_selectFirst() ? s?.groups[0]?.id : null) ?? null,
	});
	createEffect(
		() => [_loadCanonical(), _selectFirst()],
		() => {
			if (_loadCanonical()) void loadCanonicalAgentState();
		},
	);
	const state = createMemo<SidebarWorkspaceState>(() =>
		project(current().state),
	);
	const setState = (
		update:
			| SidebarWorkspaceState
			| ((state: SidebarWorkspaceState) => SidebarWorkspaceState),
	) => {
		const _currentValue = current();
		const next = typeof update === "function" ? update(state()) : update;
		if (_currentValue.state)
			publish({
				..._currentValue,
				state: {
					..._currentValue.state,
					...next,
					selectedGroupId:
						next.selectedGroupId ?? _currentValue.state.selectedGroupId,
				},
			});
	};
	return [() => state(), setState, () => current().error] as const;
}
