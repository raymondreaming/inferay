import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "octane";
import { wsClient } from "../../../../adapters/backend/websocket.ts";
import {
	AGENT_MAIN_VIEW_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../../../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../../../adapters/storage/sync.ts";
import { loadAppThemeId } from "../../../../app/model/appearance.ts";
import {
	type AgentMainView,
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
} from "../../../../app/model/navigation.tsx";
import { hasId } from "../../../../shared/lib/data.ts";
import {
	listenWindowEvent,
	setupAgentThemePanelShortcut,
} from "../../../../shared/lib/react-events.ts";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { clearAgentChatPaneState } from "../../../conversation/model/chat-session-store.ts";
import { useRepositoryWorkbench } from "../../../workbench/hooks/useRepositoryWorkbench.tsx";
import {
	getVisibleRepositoryEntries,
	projectRepositoryWorkspaces,
} from "../../model/repository-workspaces.ts";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
} from "../../model/workspace-events.ts";
import {
	type AgentGroupsAction,
	type AgentLayoutMode,
	type AgentSavedState,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	DEFAULT_ROWS,
	type GroupId,
	getThemeById,
	loadAgentLayoutMode,
	loadAgentState,
	mutateAgentWorkspaceState,
	type ThemeId,
} from "../../model/workspace-model.ts";
import { WorkspaceCanvas } from "../WorkspaceCanvas/index.tsx";
import { AgentMainSurface } from "./AgentMainSurface.tsx";
import type { MutableRef } from "./shared.ts";
import { useAgentPaneActions } from "./useAgentPaneActions.ts";
import { useAgentPersistence } from "./useAgentPersistence.ts";

export type AgentViewState = {
	layoutMode: AgentLayoutMode;
	mainView: AgentMainView;
};

export type AgentViewAction =
	| { type: "layoutModeChanged"; value: AgentLayoutMode }
	| { type: "mainViewChanged"; value: AgentMainView };

export function getInitialAgentViewState(): AgentViewState {
	const stored = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
	return {
		layoutMode: loadAgentLayoutMode(),
		mainView: isAgentMainView(stored) ? stored : DEFAULT_AGENT_MAIN_VIEW,
	};
}

export function agentViewReducer(
	state: AgentViewState,
	action: AgentViewAction,
): AgentViewState {
	switch (action.type) {
		case "layoutModeChanged":
			return { ...state, layoutMode: action.value };
		case "mainViewChanged":
			return { ...state, mainView: action.value };
	}
}

export type AgentPaneActionsArgs = {
	readonly chatRefs: MutableRef<Map<string, AgentChatHandle> | null>;
	readonly cleanupPane: (paneId: string) => void;
	readonly dispatchAgentGroupAction: (
		action: AgentGroupsAction,
		reason?: string,
	) => void;
	readonly groups: AgentSavedState["groups"];
	readonly selectedGroupId: GroupId | null;
	readonly withSelectedGroup: (fn: (groupId: string) => void) => void;
};

export function AgentPage() {
	const [viewState, viewDispatch] = useReducer(
		agentViewReducer,
		undefined,
		getInitialAgentViewState,
	);
	const { layoutMode, mainView } = viewState;
	const setLayoutMode = useCallback(
		(value: AgentLayoutMode) =>
			viewDispatch({ type: "layoutModeChanged", value }),
		[],
	);
	const setMainView = useCallback(
		(value: AgentMainView) => viewDispatch({ type: "mainViewChanged", value }),
		[],
	);
	useEffect(() => {
		writeStoredValue("agent-layout-mode", layoutMode);
	}, [layoutMode]);
	const initialState = useMemo(() => loadAgentState(), []);
	const [groups, setGroups] = useState(() => initialState?.groups ?? []);
	const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(
		() => initialState?.selectedGroupId ?? null,
	);
	const [showSettings, setShowSettings] = useState(false);
	const [appearance, setAppearance] = useState(() => ({
		themeId: loadAppThemeId() as ThemeId,
		fontSize: initialState?.fontSize ?? DEFAULT_FONT_SIZE,
		fontFamily: initialState?.fontFamily ?? DEFAULT_FONT_FAMILY,
		opacity: initialState?.opacity ?? DEFAULT_OPACITY,
	}));
	const { themeId, fontSize, fontFamily, opacity } = appearance;
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key !== APP_THEME_STORAGE_KEY) return;
				const nextThemeId = loadAppThemeId();
				setAppearance((current) =>
					current.themeId === nextThemeId
						? current
						: { ...current, themeId: nextThemeId },
				);
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
	const restoreSavedState = useCallback((state: AgentSavedState | null) => {
		if (!state) return;
		setGroups(state.groups);
		setSelectedGroupId(state.selectedGroupId);
		setAppearance({
			themeId: loadAppThemeId(),
			fontSize: state.fontSize,
			fontFamily: state.fontFamily,
			opacity: state.opacity,
		});
	}, []);
	const applySelection = useCallback(
		(selection: { groupId: string; paneId?: string }) => {
			setSelectedGroupId(selection.groupId as GroupId);
			if (selection.paneId)
				setGroups((groups) =>
					groups.map((group) =>
						group.id === selection.groupId
							? {
									...group,
									selectedPaneId: selection.paneId as NonNullable<
										typeof group.selectedPaneId
									>,
								}
							: group,
					),
				);
		},
		[],
	);
	const [workspaceError, setWorkspaceError] = useState<string | null>(null);

	const cleanupPane = useCallback((paneId: string) => {
		wsClient.send({ type: "chat:destroy", paneId });
		chatRefs.current?.delete(paneId);
		clearAgentChatPaneState(paneId);
	}, []);
	const withSelectedGroup = useCallback(
		(fn: (groupId: string) => void) => {
			if (selectedGroupId) fn(selectedGroupId);
		},
		[selectedGroupId],
	);
	const dispatchAgentGroupAction = useCallback(
		(action: AgentGroupsAction, reason?: string) => {
			if (action.type === "reorderPanes") {
				setGroups((groups) =>
					groups.map((group) => {
						if (group.id !== action.groupId) return group;
						const panes = [...group.panes];
						const [pane] = panes.splice(action.fromIndex, 1);
						if (pane) panes.splice(action.toIndex, 0, pane);
						return { ...group, panes };
					}),
				);
			}
			void mutateAgentWorkspaceState(action, reason);
		},
		[],
	);

	const latestStateRef = useRef({
		groups,
		selectedGroupId,
		themeId,
		fontSize,
		fontFamily,
		opacity,
	});
	const mainViewRef = useRef(mainView);
	mainViewRef.current = mainView;
	const mainViewHealthRef = useRef<{
		timestamp: number | null;
		view: AgentMainView;
	}>({
		timestamp: null,
		view: mainView,
	});
	useAgentPersistence({
		applySelection,
		setWorkspaceError,
		fontFamily,
		fontSize,
		groups,
		latestStateRef,
		mainView,
		mainViewHealthRef,
		mainViewRef,
		opacity,
		restoreSavedState,
		selectedGroupId,
		setAppearance,
		setLayoutMode,
		setMainView,
		themeId,
	});
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
		withSelectedGroup,
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
			fontSize={fontSize}
			fontFamily={fontFamily}
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
				setAppearance={setAppearance}
				setShowSettings={setShowSettings}
				showSettings={showSettings}
				agentGrid={agentGrid}
				themeId={themeId}
			/>
		</>
	);
}
export { useAgentPaneActions } from "./useAgentPaneActions.ts";
