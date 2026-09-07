import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type { AgentSavedState } from "../../../../../build/presentation/contracts/AgentSavedState.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { wsClient } from "../../../../adapters/backend/http.ts";
import {
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
	clearAgentChatPaneState,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	setAgentLayoutMode,
} from "../../../../adapters/storage/stored-values.ts";
import {
	getThemeById,
	loadAppThemeId,
} from "../../../../app/hooks/useAppAppearance.tsx";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
	hasId,
	listenWindowEvent,
	type MutableRef,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
} from "../../../../shared/lib/data.ts";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { useRepositoryWorkbench } from "../../../workbench/hooks/useRepositoryWorkbench.tsx";
import {
	type AgentGroupsAction,
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { DEFAULT_ROWS, WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";
export type AgentPaneActionsArgs = {
	readonly chatRefs: MutableRef<Map<string, AgentChatHandle> | null>;
	readonly cleanupPane: (paneId: string) => void;
	readonly dispatchAgentGroupAction: (action: AgentGroupsAction) => void;
	readonly groups: AgentSavedState["groups"];
	readonly selectedGroupId: string | null;
};
export function AgentPage() {
	const [layoutMode, setLayoutMode] = useState(loadAgentLayoutMode);
	useEffect(() => listenAgentLayoutMode(setLayoutMode), []);
	useEffect(() => {
		setAgentLayoutMode(layoutMode);
	}, [layoutMode]);
	const [workspace, setWorkspace, workspaceError] = useWorkspaceState(
		false,
		false,
	);
	const { groups, selectedGroupId } = workspace;
	const [showSettings, setShowSettings] = useState(false);
	const [themeId, setThemeId] = useState(loadAppThemeId);
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (
					event as CustomEvent<{
						key?: string;
					}>
				).detail?.key;
				if (key !== APP_THEME_STORAGE_KEY) return;
				setThemeId(loadAppThemeId());
			}),
		[],
	);
	const chatRefs = useRef<Map<string, AgentChatHandle> | null>(null);
	if (chatRefs.current === null) {
		chatRefs.current = new Map();
	}
	const composerFocusFrameRef = useRef(0);
	const focusChatComposer = useCallback((paneId: string) => {
		if (composerFocusFrameRef.current) {
			cancelAnimationFrame(composerFocusFrameRef.current);
		}
		let attempts = 0;
		const focusComposer = () => {
			const handle = chatRefs.current?.get(paneId);
			if (handle) {
				composerFocusFrameRef.current = 0;
				const activeElement = document.activeElement;
				const activePaneId =
					activeElement instanceof Element
						? activeElement.closest<HTMLElement>("[data-agent-grid-pane-id]")
								?.dataset.agentGridPaneId
						: null;
				const targetControlIsFocused =
					activePaneId === paneId &&
					activeElement instanceof Element &&
					!!activeElement.closest(
						"button, input, textarea, select, a, [contenteditable='true']",
					);
				if (!targetControlIsFocused) {
					handle.focusInput(true);
					handle.highlightComposer();
				}
				return;
			}
			attempts += 1;
			if (attempts < 12) {
				composerFocusFrameRef.current = requestAnimationFrame(focusComposer);
			} else {
				composerFocusFrameRef.current = 0;
			}
		};
		composerFocusFrameRef.current = requestAnimationFrame(focusComposer);
	}, []);
	useEffect(() => {
		const stopListening = listenWindowEvent(
			FOCUS_AGENT_CHAT_COMPOSER_EVENT,
			(event) => {
				const { paneId } = (event as CustomEvent<FocusAgentChatComposerDetail>)
					.detail;
				focusChatComposer(paneId);
			},
		);
		return () => {
			stopListening();
			if (composerFocusFrameRef.current) {
				cancelAnimationFrame(composerFocusFrameRef.current);
			}
		};
	}, [focusChatComposer]);
	const theme = useMemo(() => getThemeById(themeId), [themeId]);
	const currentGroup = useMemo(
		() => groups.find(hasId.bind(null, selectedGroupId)),
		[groups, selectedGroupId],
	);
	const selectedPane =
		currentGroup?.panes.find(
			(pane) => pane.id === currentGroup.selectedPaneId,
		) ?? null;
	const currentRepositoryPanes = useMemo(() => {
		const visible = new Set(
			workspace.repositories.visibleEntries
				.filter((entry) => entry.groupId === currentGroup?.id)
				.map((entry) => entry.pane.id),
		);
		return currentGroup?.panes.filter((pane) => visible.has(pane.id)) ?? [];
	}, [currentGroup, workspace.repositories.visibleEntries]);
	const repositoryWorkbench = useRepositoryWorkbench({
		active: true,
		cwd: selectedPane?.cwd,
		workspaceId:
			workspace.repositories.activeWorkspace?.cwd ??
			currentGroup?.id ??
			"default",
	});
	const cleanupPane = useCallback((paneId: string) => {
		wsClient.send({
			type: "chat:destroy",
			paneId,
		});
		chatRefs.current?.delete(paneId);
		clearAgentChatPaneState(paneId);
	}, []);
	const dispatchAgentGroupAction = useCallback((action: AgentGroupsAction) => {
		if (action.type === "reorderPanes") {
			setWorkspace((current) => ({
				...current,
				groups: current.groups.map((group) => {
					if (group.id !== action.groupId) return group;
					const panes = [...group.panes];
					const [pane] = panes.splice(action.fromIndex, 1);
					if (pane) panes.splice(action.toIndex, 0, pane);
					return {
						...group,
						panes,
					};
				}),
			}));
		}
		void mutateAgentWorkspaceState(action);
	}, []);
	useEffect(() => {
		return listenWindowEvent("agent-open-theme-panel", () =>
			setShowSettings(true),
		);
	}, []);
	const {
		handleAddPane,
		handleChatRef,
		handleDirectorySelected,
		handleSetPaneAgentKind,
		removePane,
		reorderPanes,
		selectPane,
	} = useAgentPaneActions({
		chatRefs,
		cleanupPane,
		dispatchAgentGroupAction,
		groups,
		selectedGroupId,
	});
	const selectChatPane = useCallback(
		(paneId: string) => {
			const paneCwd = currentGroup?.panes.find(
				(pane) => pane.id === paneId,
			)?.cwd;
			repositoryWorkbench.focusWorkbench(paneCwd);
			selectPane(paneId);
		},
		[repositoryWorkbench.focusWorkbench, currentGroup?.panes, selectPane],
	);
	const agentGrid = currentGroup ? (
		<WorkspaceCanvas
			active
			panes={
				repositoryWorkbench.zenMode && selectedPane
					? [selectedPane]
					: currentRepositoryPanes
			}
			selectedPaneId={currentGroup.selectedPaneId}
			columns={repositoryWorkbench.zenMode ? 1 : currentGroup.columns}
			rows={
				repositoryWorkbench.zenMode ? 1 : (currentGroup.rows ?? DEFAULT_ROWS)
			}
			layoutMode={layoutMode}
			theme={theme}
			onSelectPane={selectChatPane}
			onFocusPane={focusChatComposer}
			onClosePane={removePane}
			onDirectorySelect={handleDirectorySelected}
			onDirectoryCancel={removePane}
			onChatRef={handleChatRef}
			onReorderPanes={reorderPanes}
			onAddPane={handleAddPane}
			onSetPaneAgentKind={handleSetPaneAgentKind}
			workspaceId={currentGroup.id}
			auxiliaryPanels={repositoryWorkbench.auxiliaryPanels}
		/>
	) : null;
	const hasCurrentPanes = currentRepositoryPanes.length > 0;
	return (
		<>
			{workspaceError ? <div role="alert">{workspaceError}</div> : null}
			<AgentMainSurface
				chatDiffPanel={repositoryWorkbench.diffPanel}
				chatSidebar={repositoryWorkbench.sidebar}
				chatZenMode={repositoryWorkbench.zenMode}
				hasCurrentPanes={hasCurrentPanes}
				onThemeChange={setThemeId}
				setShowSettings={setShowSettings}
				showSettings={showSettings}
				agentGrid={agentGrid}
				themeId={themeId}
			/>
		</>
	);
}

export function useAgentPaneActions({
	chatRefs,
	cleanupPane,
	dispatchAgentGroupAction,
	groups,
	selectedGroupId,
}: AgentPaneActionsArgs) {
	const removePane = useCallback(
		(paneId: string) => {
			const group =
				groups.find((g) => g.panes.some(hasId.bind(null, paneId))) ??
				groups.find(hasId.bind(null, selectedGroupId));
			if (group) {
				cleanupPane(paneId);
				dispatchAgentGroupAction({
					type: "removePane",
					groupId: group.id,
					paneId,
				});
			}
		},
		[cleanupPane, dispatchAgentGroupAction, groups, selectedGroupId],
	);
	useEffect(
		() =>
			listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
				const id = (event as CustomEvent<RemoveAgentPaneRequestDetail>).detail
					?.paneId;
				if (id) removePane(id);
			}),
		[removePane],
	);
	const actions = useMemo(() => {
		const send = (a: AgentGroupsAction) => {
				if (selectedGroupId) dispatchAgentGroupAction(a);
			},
			groupId = selectedGroupId ?? "";
		return {
			handleAddPane: (agentKind: WorkspaceAgentKind) =>
				send({ type: "addPane", groupId, agentKind }),
			reorderPanes: (fromIndex: number, toIndex: number) =>
				send({ type: "reorderPanes", groupId, fromIndex, toIndex }),
			handleSetPaneAgentKind: (paneId: string, agentKind: WorkspaceAgentKind) =>
				send({ type: "setPaneAgentKind", groupId, paneId, agentKind }),
			handleDirectorySelected: (
				paneId: string,
				path: string | null,
				referencePaths?: string[],
			) =>
				send({
					type: "directorySelected",
					groupId,
					paneId,
					path,
					referencePaths,
				}),
			selectPane: (paneId: string) =>
				send({ type: "selectPane", groupId, paneId }),
		};
	}, [dispatchAgentGroupAction, selectedGroupId]);
	const handleChatRef = useCallback(
		(id: string, handle: AgentChatHandle | null) => {
			handle ? chatRefs.current?.set(id, handle) : chatRefs.current?.delete(id);
		},
		[chatRefs],
	);
	return { ...actions, handleChatRef, removePane };
}
