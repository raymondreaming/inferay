import * as stylex from "@octanejs/stylex";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "octane";
import { wsClient } from "../../../adapters/backend/websocket.ts";
import {
	AGENT_MAIN_VIEW_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
} from "../../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../../adapters/storage/sync.ts";
import { loadAppThemeId } from "../../../app/model/appearance.ts";
import {
	type AgentMainView,
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
} from "../../../app/model/navigation.tsx";
import {
	color,
	controlSize,
	layer,
} from "../../../design-system/styles.stylex.ts";
import type { AgentChatHandle } from "../../../modules/conversation/components/AgentChatView.tsx";
import { clearAgentChatPaneState } from "../../../modules/conversation/model/chat-session-store.ts";
import {
	getVisibleRepositoryEntries,
	projectRepositoryWorkspaces,
} from "../../../modules/workspace/model/repository-workspaces.ts";
import {
	FOCUS_AGENT_CHAT_COMPOSER_EVENT,
	type FocusAgentChatComposerDetail,
} from "../../../modules/workspace/model/workspace-events.ts";
import {
	type AgentGroupsAction,
	type AgentKind,
	type AgentLayoutMode,
	type AgentSavedState,
	type AgentShellChangeDetail,
	agentStateKey,
	agentStateScore,
	cacheAgentState,
	createAgentPane,
	createAgentViewSwitchHealth,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	DEFAULT_ROWS,
	dispatchAgentShellChange,
	type GroupId,
	getInitialGroups,
	getPrimaryProductLoopContext,
	getThemeById,
	loadAgentLayoutMode,
	loadAgentState,
	loadCanonicalAgentState,
	migrateGroup,
	mutateAgentWorkspaceState,
	normalizeAgentState,
	REMOVE_AGENT_PANE_REQUEST_EVENT,
	type RemoveAgentPaneRequestDetail,
	reduceAgentGroups,
	saveSyncedAgentState,
	syncAgentLayoutMode,
	type ThemeId,
} from "../../../modules/workspace/model/workspace-model.ts";
import { hasId } from "../../../shared/lib/data.ts";
import {
	listenWindowEvent,
	setupAgentThemePanelShortcut,
} from "../../../shared/lib/react-events.ts";
import { useRepositoryWorkbench } from "../../workbench/hooks/useRepositoryWorkbench.tsx";
import { WorkspaceCanvas } from "./WorkspaceCanvas.tsx";

const Settings = lazy(() =>
	import("../../settings/components/Settings.tsx").then((module) => ({
		default: module.Settings,
	})),
);

type MutableRef<T> = {
	current: T;
};

type AgentAppearance = {
	readonly themeId: ThemeId;
	readonly fontSize: number;
	readonly fontFamily: string;
	readonly opacity: number;
};

type AgentPersistenceArgs = AgentAppearance & {
	readonly groups: AgentSavedState["groups"];
	readonly latestStateRef: MutableRef<AgentSavedState>;
	readonly mainView: AgentMainView;
	readonly mainViewHealthRef: MutableRef<{
		timestamp: number | null;
		view: AgentMainView;
	}>;
	readonly mainViewRef: MutableRef<AgentMainView>;
	readonly restoreSavedState: (state: AgentSavedState | null) => void;
	readonly selectedGroupId: GroupId | null;
	readonly setAppearance: (
		value: AgentAppearance | ((previous: AgentAppearance) => AgentAppearance),
	) => void;
	readonly setLayoutMode: (value: AgentLayoutMode) => void;
	readonly setMainView: (value: AgentMainView) => void;
	readonly setSelectedGroupId: (value: GroupId | null) => void;
};

function useAgentPersistence({
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
	setSelectedGroupId,
	themeId,
}: AgentPersistenceArgs): void {
	const pendingSaveRef = useRef(false);
	const startupRestoreCompleteRef = useRef(false);
	const canonicalShellKeyRef = useRef<string | null>(null);
	const latestStateKey = agentStateKey({
		groups,
		selectedGroupId,
		themeId,
		fontSize,
		fontFamily,
		opacity,
	});
	useEffect(() => {
		const nextState = {
			groups,
			selectedGroupId,
			themeId,
			fontSize,
			fontFamily,
			opacity,
		};
		const canonicalShellKey = canonicalShellKeyRef.current;
		if (
			canonicalShellKey &&
			agentStateKey(nextState) !== canonicalShellKey &&
			agentStateScore(nextState) < agentStateScore(latestStateRef.current)
		) {
			return;
		}
		latestStateRef.current = nextState;
		cacheAgentState(latestStateRef.current);
	}, [
		fontFamily,
		fontSize,
		groups,
		latestStateRef,
		opacity,
		selectedGroupId,
		themeId,
	]);
	useEffect(() => {
		void latestStateKey;
		pendingSaveRef.current = true;
		const id = setTimeout(() => {
			if (!startupRestoreCompleteRef.current) {
				pendingSaveRef.current = false;
				return;
			}
			const saved = loadAgentState();
			if (
				saved &&
				agentStateScore(latestStateRef.current) < agentStateScore(saved)
			) {
				pendingSaveRef.current = false;
				return;
			}
			saveSyncedAgentState(
				latestStateRef.current,
				"agent-page-save",
				"canonical",
			);
			pendingSaveRef.current = false;
		}, 100);
		return () => clearTimeout(id);
	}, [latestStateKey, latestStateRef]);
	useEffect(() => {
		writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, mainView);
		const previous = mainViewHealthRef.current;
		const timestamp = Date.now();
		if (previous.timestamp === null) {
			mainViewHealthRef.current = { timestamp, view: mainView };
			return;
		}
		if (previous.view === mainView) return;
		dispatchAgentShellChange({
			source: "view",
			reason: "main-view-switch",
			productHealth: createAgentViewSwitchHealth({
				context: getPrimaryProductLoopContext(latestStateRef.current),
				from: previous.view,
				previousTimestamp: previous.timestamp,
				timestamp,
				to: mainView,
			}),
		});
		mainViewHealthRef.current = { timestamp, view: mainView };
	}, [latestStateRef, mainView, mainViewHealthRef]);
	useEffect(
		() => () => {
			if (!startupRestoreCompleteRef.current) return;
			const saved = loadAgentState();
			if (
				saved &&
				agentStateScore(latestStateRef.current) < agentStateScore(saved)
			) {
				return;
			}
			saveSyncedAgentState(
				latestStateRef.current,
				"agent-page-unmount",
				"canonical",
			);
		},
		[latestStateRef],
	);
	useEffect(() => {
		let cancelled = false;
		const restoreCanonicalState = async () => {
			const canonicalState = await loadCanonicalAgentState();
			if (cancelled) return;
			if (!canonicalState) {
				startupRestoreCompleteRef.current = true;
				return;
			}
			const currentState = latestStateRef.current;
			const canonicalKey = agentStateKey(canonicalState);
			const currentKey = agentStateKey(currentState);
			if (
				canonicalKey !== currentKey &&
				agentStateScore(canonicalState) >= agentStateScore(currentState)
			) {
				canonicalShellKeyRef.current = canonicalKey;
				latestStateRef.current = canonicalState;
				restoreSavedState(canonicalState);
				saveSyncedAgentState(
					canonicalState,
					"startup-canonical-restore",
					"canonical",
				);
			}
			startupRestoreCompleteRef.current = true;
		};
		restoreCanonicalState().catch(() => {
			startupRestoreCompleteRef.current = true;
		});
		return () => {
			cancelled = true;
		};
	}, [latestStateRef, restoreSavedState]);
	const handleShellChange = useCallback(
		(event: Event) => {
			const currentState = latestStateRef.current;
			const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
			const requestedMainView = detail?.mainView ?? null;
			if (
				detail?.source === "view" &&
				detail.reason === "main-view" &&
				isAgentMainView(requestedMainView)
			) {
				if (requestedMainView !== mainViewRef.current) {
					setMainView(requestedMainView);
				}
				return;
			}
			const saved =
				normalizeAgentState(detail?.state) ??
				(detail?.source === "canonical" ? loadAgentState() : null);
			const savedState = saved;
			const isRegressiveSnapshot =
				savedState &&
				detail?.reason !== "remove-pane" &&
				detail?.reason !== "remove-workspace" &&
				detail?.reason !== "select-repository-workspace" &&
				agentStateScore(savedState) < agentStateScore(currentState);
			if (
				!isRegressiveSnapshot &&
				savedState?.selectedGroupId &&
				savedState.selectedGroupId !== currentState.selectedGroupId
			) {
				setSelectedGroupId(savedState.selectedGroupId);
				latestStateRef.current = {
					...latestStateRef.current,
					selectedGroupId: savedState.selectedGroupId,
				};
			}
			if (savedState && !isRegressiveSnapshot) {
				const savedShellKey = agentStateKey(savedState);
				const currentShellKey = agentStateKey(latestStateRef.current);
				if (savedShellKey !== currentShellKey) {
					latestStateRef.current = savedState;
					restoreSavedState(savedState);
					pendingSaveRef.current = false;
				}
			}
			if (pendingSaveRef.current) {
				return;
			}
			const storedView = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
			const nextMainView = isAgentMainView(storedView)
				? storedView
				: DEFAULT_AGENT_MAIN_VIEW;
			if (nextMainView !== mainViewRef.current) {
				setMainView(nextMainView);
			}
			syncAgentLayoutMode(setLayoutMode);
		},
		[
			latestStateRef,
			mainViewRef,
			restoreSavedState,
			setAppearance,
			setLayoutMode,
			setMainView,
			setSelectedGroupId,
		],
	);
	useEffect(() => {
		return listenWindowEvent("agent-shell-change", handleShellChange);
	}, [handleShellChange]);
}

const styles = stylex.create({
	appRoot: {
		display: "flex",
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	fullHeight: {
		height: "100%",
	},
	appFrame: {
		position: "relative",
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	appColumn: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	appBody: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	mainPane: {
		position: "relative",
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	surfaceLayer: {
		position: "absolute",
		inset: controlSize._0,
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
	},
	surfaceLayerVisible: {
		pointerEvents: "auto",
		visibility: "visible",
		zIndex: layer.content,
	},
	repositoryWorkbench: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	chatWorkspaceZen: {
		position: "fixed",
		zIndex: layer.appModal,
		inset: controlSize._0,
		backgroundColor: color.background,
	},
	chatDock: {
		display: "flex",
		minWidth: 300,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	chatDockZen: {
		width: 360,
		maxWidth: "28vw",
		flex: "0 0 auto",
	},
	emptyWorkspace: {
		flex: 1,
	},
});

type AgentViewState = {
	layoutMode: AgentLayoutMode;
	mainView: AgentMainView;
};

type AgentViewAction =
	| { type: "layoutModeChanged"; value: AgentLayoutMode }
	| { type: "mainViewChanged"; value: AgentMainView };

function getInitialAgentViewState(): AgentViewState {
	const stored = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
	return {
		layoutMode: loadAgentLayoutMode(),
		mainView: isAgentMainView(stored) ? stored : DEFAULT_AGENT_MAIN_VIEW,
	};
}

function agentViewReducer(
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

type AgentMainSurfaceProps = {
	readonly chatDiffPanel: unknown;
	readonly chatSidebar: unknown;
	readonly chatZenMode: boolean;
	readonly hasCurrentPanes: boolean;
	readonly setAppearance: AgentPersistenceArgs["setAppearance"];
	readonly setShowSettings: (value: boolean) => void;
	readonly showSettings: boolean;
	readonly agentGrid: unknown;
	readonly themeId: ThemeId;
};

type AgentPaneActionsArgs = {
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

function useAgentPaneActions({
	chatRefs,
	cleanupPane,
	dispatchAgentGroupAction,
	groups,
	selectedGroupId,
	withSelectedGroup,
}: AgentPaneActionsArgs) {
	const handleAddPane = useCallback(
		(agentKind: AgentKind) =>
			withSelectedGroup((groupId) => {
				const pane = createAgentPane(agentKind, undefined, true);
				dispatchAgentGroupAction(
					{
						type: "addPane",
						groupId,
						pane,
					},
					"add-pane",
				);
			}),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const removePane = useCallback(
		(paneId: string, force?: boolean) => {
			const group =
				groups.find((item) => item.panes.some(hasId.bind(null, paneId))) ??
				(selectedGroupId
					? groups.find(hasId.bind(null, selectedGroupId))
					: null);
			if (!group) return;
			cleanupPane(paneId);
			dispatchAgentGroupAction(
				{
					type: "removePane",
					groupId: group.id,
					paneId,
					force,
				},
				"remove-pane",
			);
		},
		[cleanupPane, dispatchAgentGroupAction, groups, selectedGroupId],
	);
	useEffect(
		() =>
			listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
				const paneId = (event as CustomEvent<RemoveAgentPaneRequestDetail>)
					.detail?.paneId;
				if (paneId) removePane(paneId);
			}),
		[removePane],
	);
	const reorderPanes = useCallback(
		(fromIndex: number, toIndex: number) =>
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction({
					type: "reorderPanes",
					groupId,
					fromIndex,
					toIndex,
				}),
			),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const handleSetPaneAgentKind = useCallback(
		(paneId: string, agentKind: AgentKind) =>
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{
						type: "setPaneAgentKind",
						groupId,
						paneId,
						agentKind,
					},
					"set-pane-agent-kind",
				),
			),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const handleDirectorySelected = useCallback(
		(paneId: string, path: string | null, referencePaths?: string[]) => {
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{
						type: "directorySelected",
						groupId,
						paneId,
						path,
						referencePaths,
					},
					"directory-selected",
				),
			);
		},
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const selectPane = useCallback(
		(paneId: string) =>
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{ type: "selectPane", groupId, paneId },
					"select-pane",
				),
			),
		[dispatchAgentGroupAction, withSelectedGroup],
	);
	const handleChatRef = useCallback(
		(paneId: string, handle: AgentChatHandle | null) => {
			if (handle) chatRefs.current?.set(paneId, handle);
			else chatRefs.current?.delete(paneId);
		},
		[chatRefs],
	);
	return {
		handleAddPane,
		handleChatRef,
		handleDirectorySelected,
		handleSetPaneAgentKind,
		removePane,
		reorderPanes,
		selectPane,
	};
}

function AgentMainSurface({
	chatDiffPanel,
	chatSidebar,
	chatZenMode,
	hasCurrentPanes,
	setAppearance,
	setShowSettings,
	showSettings,
	agentGrid,
	themeId,
}: AgentMainSurfaceProps) {
	return (
		<div {...stylex.props(styles.appRoot, styles.fullHeight)}>
			<div {...stylex.props(styles.appFrame)}>
				<div {...stylex.props(styles.appColumn)}>
					<div {...stylex.props(styles.appBody)}>
						<div {...stylex.props(styles.mainPane)}>
							{!hasCurrentPanes ? (
								<div {...stylex.props(styles.emptyWorkspace)} />
							) : (
								<div
									{...stylex.props(
										styles.surfaceLayer,
										styles.surfaceLayerVisible,
									)}
								>
									<div
										{...stylex.props(
											styles.repositoryWorkbench,
											chatZenMode && styles.chatWorkspaceZen,
										)}
									>
										<div
											{...stylex.props(
												styles.chatDock,
												chatZenMode && styles.chatDockZen,
											)}
										>
											{agentGrid}
										</div>
										{chatDiffPanel}
										{chatSidebar}
									</div>
								</div>
							)}
							{showSettings && (
								<Suspense fallback={null}>
									<Settings
										themeId={themeId}
										onThemeChange={(v: ThemeId) =>
											setAppearance((prev) => ({ ...prev, themeId: v }))
										}
										onClose={setShowSettings.bind(null, false)}
									/>
								</Suspense>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

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
	const initGroups = useMemo(() => getInitialGroups(), []);
	const [groups, groupsDispatch] = useReducer(reduceAgentGroups, initGroups);
	const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(
		() => initialState?.selectedGroupId ?? initGroups[0]?.id ?? null,
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
	const restoreSavedState = useCallback(
		(s: ReturnType<typeof loadAgentState>) => {
			const normalized = normalizeAgentState(s);
			if (!normalized) return;
			groupsDispatch({
				type: "replaceAll",
				groups: normalized.groups.map(migrateGroup),
			});
			setSelectedGroupId(normalized.selectedGroupId);
			setAppearance({
				themeId: loadAppThemeId(),
				fontSize: normalized.fontSize,
				fontFamily: normalized.fontFamily,
				opacity: normalized.opacity,
			});
		},
		[],
	);
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
			groupsDispatch(action);
			if (!reason) return;
			switch (action.type) {
				case "directorySelected":
				case "selectPane":
				case "setPaneAgentKind":
					void mutateAgentWorkspaceState(action, reason);
					return;
				case "addPane":
					if ("pane" in action) {
						void mutateAgentWorkspaceState(
							{
								type: "addPane",
								groupId: action.groupId,
								pane: action.pane,
							},
							reason,
						);
					}
					return;
				case "removePane":
					void mutateAgentWorkspaceState(
						{
							type: "removePane",
							groupId: action.groupId,
							paneId: action.paneId,
						},
						reason,
					);
					return;
			}
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
		setSelectedGroupId,
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
	);
}
