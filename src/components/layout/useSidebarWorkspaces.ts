import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type NEW_PANE_AGENT_KINDS } from "../../features/agents/agents.ts";
import {
	createGroupId,
	createPendingAgentChatPane,
	createTerminalPane,
	DEFAULT_COLUMNS,
	DEFAULT_ROWS,
	destroySyncedPane,
	loadTerminalState,
	prependPaneToGroup,
	saveSyncedTerminalState,
	type TerminalGroupModel,
} from "../../features/terminal/terminal-utils.ts";
import {
	DEFAULT_TERMINAL_MAIN_VIEW,
	isTerminalMainView,
	type TerminalMainView,
} from "../../lib/app-navigation.tsx";
import { flushPendingClientStorageSync } from "../../lib/client-storage-sync.ts";
import { hasId, lacksId } from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import {
	dispatchTerminalShellChange,
	TERMINAL_SHELL_CHANGE_EVENT,
} from "../../lib/terminal-shell-events.ts";

export interface SidebarWorkspacesState {
	groups: TerminalGroupModel[];
	selectedGroupId: TerminalGroupModel["id"] | null;
	mainView: TerminalMainView;
	editorZenMode: boolean;
}

function loadSidebarWorkspaces(): SidebarWorkspacesState {
	const state = loadTerminalState();
	const mainView = readStoredValue("terminal-main-view");
	return {
		groups: state?.groups ?? [],
		selectedGroupId: state?.selectedGroupId ?? state?.groups[0]?.id ?? null,
		mainView: isTerminalMainView(mainView)
			? mainView
			: DEFAULT_TERMINAL_MAIN_VIEW,
		editorZenMode: readStoredValue("terminal-editor-zen") === "true",
	};
}

export function useSidebarWorkspaces() {
	const navigate = useNavigate();
	const [workspaces, setWorkspaces] = useState(loadSidebarWorkspaces);

	useEffect(() => {
		const refresh = () => setWorkspaces(loadSidebarWorkspaces());
		return listenWindowEvent(TERMINAL_SHELL_CHANGE_EVENT, refresh);
	}, []);

	const selectWorkspace = useCallback(
		(groupId: string) => {
			setWorkspaces((prev) => ({ ...prev, selectedGroupId: groupId as never }));
			const state = loadTerminalState();
			if (!state) return;
			saveSyncedTerminalState(
				{ ...state, selectedGroupId: groupId as never },
				"select-workspace"
			);
			if (window.location.hash !== "#/terminal") {
				navigate("/terminal");
			}
		},
		[navigate]
	);

	const selectPane = useCallback(
		(groupId: string, paneId: string) => {
			const state = loadTerminalState();
			if (!state) return;
			const gid = groupId as never;
			const pid = paneId as never;
			writeStoredValue("editor-selected-pane", paneId);
			saveSyncedTerminalState(
				{
					...state,
					selectedGroupId: gid,
					groups: state.groups.map((group) =>
						group.id === groupId ? { ...group, selectedPaneId: pid } : group
					),
				},
				"select-pane"
			);
			setWorkspaces(loadSidebarWorkspaces);
			if (window.location.hash !== "#/terminal") {
				navigate("/terminal");
			}
		},
		[navigate]
	);

	const addWorkspace = useCallback(() => {
		const state = loadTerminalState();
		if (!state) return;
		const selectedGroup =
			state.groups.find(hasId.bind(null, state.selectedGroupId)) ??
			state.groups[0];
		const pane = createPendingAgentChatPane();
		const group = {
			id: createGroupId(),
			name: `Workspace ${state.groups.length + 1}`,
			panes: [pane],
			selectedPaneId: pane.id,
			columns: selectedGroup?.columns ?? DEFAULT_COLUMNS,
			rows: selectedGroup?.rows ?? DEFAULT_ROWS,
		};
		saveSyncedTerminalState(
			{
				...state,
				groups: [...state.groups, group],
				selectedGroupId: group.id,
			},
			"add-workspace"
		);
		navigate("/terminal");
	}, [navigate]);

	const updateMainView = useCallback(
		(view: TerminalMainView) => {
			writeStoredValue("terminal-main-view", view);
			flushPendingClientStorageSync();
			setWorkspaces(loadSidebarWorkspaces);
			dispatchTerminalShellChange({ source: "local", reason: "main-view" });
			navigate("/terminal");
		},
		[navigate]
	);

	const addPaneToSelectedGroup = useCallback(
		(agentKind: (typeof NEW_PANE_AGENT_KINDS)[number]) => {
			const state = loadTerminalState();
			if (!state) return;
			const selectedGroupId = state.selectedGroupId ?? state.groups[0]?.id;
			if (!selectedGroupId) return;
			const pane = createTerminalPane(agentKind, undefined, true);
			saveSyncedTerminalState(
				{
					...state,
					groups: state.groups.map(
						prependPaneToGroup.bind(null, selectedGroupId, pane)
					),
				},
				"add-pane"
			);
			navigate("/terminal");
		},
		[navigate]
	);

	const updateSelectedGroupGrid = useCallback(
		(patch: { columns?: number; rows?: number }) => {
			const state = loadTerminalState();
			if (!state?.selectedGroupId) return;
			saveSyncedTerminalState(
				{
					...state,
					groups: state.groups.map((group) =>
						group.id === state.selectedGroupId
							? {
									...group,
									columns: patch.columns ?? group.columns,
									rows: patch.rows ?? group.rows,
								}
							: group
					),
				},
				"workspace-grid"
			);
		},
		[]
	);

	const updateEditorZenMode = useCallback((next: boolean) => {
		writeStoredValue("terminal-editor-zen", next ? "true" : "false");
		flushPendingClientStorageSync();
		dispatchTerminalShellChange({ source: "local", reason: "editor-zen" });
	}, []);

	const removeWorkspace = useCallback((groupId: string) => {
		const state = loadTerminalState();
		if (!state) return;
		if (state.groups.length <= 1) return;
		const removedGroup = state.groups.find(hasId.bind(null, groupId));
		for (const pane of removedGroup?.panes ?? []) {
			destroySyncedPane(pane.id);
		}
		const filtered = state.groups.filter(lacksId.bind(null, groupId));
		const newSelected =
			state.selectedGroupId === groupId
				? (filtered[0]?.id ?? null)
				: state.selectedGroupId;
		saveSyncedTerminalState(
			{
				...state,
				groups: filtered,
				selectedGroupId: newSelected,
			},
			"remove-workspace"
		);
	}, []);

	const removeWorkspacePane = useCallback((groupId: string, paneId: string) => {
		const state = loadTerminalState();
		if (!state) return;
		destroySyncedPane(paneId);
		saveSyncedTerminalState(
			{
				...state,
				groups: state.groups.map((group) => {
					if (group.id !== groupId) return group;
					const panes = group.panes.filter(lacksId.bind(null, paneId));
					if (panes.length === 0) {
						const pane = createPendingAgentChatPane();
						return { ...group, panes: [pane], selectedPaneId: pane.id };
					}
					return {
						...group,
						panes,
						selectedPaneId:
							group.selectedPaneId === paneId
								? (panes[0]?.id ?? null)
								: group.selectedPaneId,
					};
				}),
			},
			"remove-pane"
		);
	}, []);

	const renameWorkspace = useCallback((groupId: string, name: string) => {
		const state = loadTerminalState();
		if (!state) return;
		saveSyncedTerminalState(
			{
				...state,
				groups: state.groups.map((group) =>
					group.id === groupId ? { ...group, name } : group
				),
			},
			"rename-workspace"
		);
	}, []);

	const reorderWorkspacePane = useCallback(
		(groupId: string, sourcePaneId: string, targetPaneId: string) => {
			const state = loadTerminalState();
			if (!state) return;
			const groups = state.groups.map((group) => {
				if (group.id !== groupId) return group;
				const fromIndex = group.panes.findIndex(hasId.bind(null, sourcePaneId));
				const toIndex = group.panes.findIndex(hasId.bind(null, targetPaneId));
				if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return group;
				const panes = [...group.panes];
				const [moved] = panes.splice(fromIndex, 1);
				if (moved) panes.splice(toIndex, 0, moved);
				return { ...group, panes };
			});
			saveSyncedTerminalState({ ...state, groups }, "reorder-pane");
			setWorkspaces(loadSidebarWorkspaces);
		},
		[]
	);

	const selectedGroup =
		workspaces.groups.find(hasId.bind(null, workspaces.selectedGroupId)) ??
		null;

	return {
		workspaces,
		selectedGroup,
		selectWorkspace,
		selectPane,
		addWorkspace,
		updateMainView,
		addPaneToSelectedGroup,
		updateSelectedGroupGrid,
		updateEditorZenMode,
		removeWorkspace,
		removeWorkspacePane,
		renameWorkspace,
		reorderWorkspacePane,
	};
}
