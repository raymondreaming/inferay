import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { wsClient } from "../../../../adapters/backend/http.ts";
import {
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";
import { loadAppThemeId } from "../../../../app/model/appearance.ts";
import {
	hasId,
	listenWindowEvent,
	setupAgentThemePanelShortcut,
} from "../../../../shared/lib/data.ts";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { clearAgentChatPaneState } from "../../../conversation/model/chat-session-store.ts";
import { useRepositoryWorkbench } from "../../../workbench/hooks/useRepositoryWorkbench.tsx";
import type { MutableRef } from "../../model/workspace-model.ts";
import {
	type AgentGroupsAction,
	type AgentSavedState,
	DEFAULT_ROWS,
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
	type GroupId,
	getThemeById,
	getVisibleRepositoryEntries,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	mutateAgentWorkspaceState,
	projectRepositoryWorkspaces,
	useAgentPaneActions,
	useWorkspaceState,
} from "../../model/workspace-model.ts";
import { WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";
export type AgentPaneActionsArgs = {
	readonly chatRefs: MutableRef<Map<string, AgentChatHandle> | null>;
	readonly cleanupPane: (paneId: string) => void;
	readonly dispatchAgentGroupAction: (
		action: AgentGroupsAction,
		reason?: string,
	) => void;
	readonly groups: AgentSavedState["groups"];
	readonly selectedGroupId: GroupId | null;
};
export function AgentPage() {
	const [layoutMode, setLayoutMode] = useState(loadAgentLayoutMode);
	useEffect(() => listenAgentLayoutMode(setLayoutMode), []);
	useEffect(() => {
		writeStoredValue("agent-layout-mode", layoutMode);
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
	const repositoryProjection = useMemo(
		() => projectRepositoryWorkspaces(groups, selectedGroupId),
		[groups, selectedGroupId],
	);
	const currentRepositoryPanes = useMemo(
		() =>
			currentGroup
				? getVisibleRepositoryEntries(
						repositoryProjection,
						currentGroup.id,
					).map((entry) => entry.pane)
				: [],
		[currentGroup, repositoryProjection],
	);
	const repositoryWorkbench = useRepositoryWorkbench({
		active: true,
		cwd: selectedPane?.cwd,
		workspaceId:
			repositoryProjection.activeWorkspace?.cwd ??
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
	const dispatchAgentGroupAction = useCallback(
		(action: AgentGroupsAction, reason?: string) => {
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
			void mutateAgentWorkspaceState(action, reason);
		},
		[],
	);
	useEffect(() => {
		return setupAgentThemePanelShortcut(setShowSettings);
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
export { useAgentPaneActions } from "../../model/workspace-model.ts";
