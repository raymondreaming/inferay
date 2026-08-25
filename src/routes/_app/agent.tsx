import * as stylex from "@octanejs/stylex";
import { createFileRoute } from "@octanejs/tanstack-router";
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
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { IconGitBranch } from "../../components/ui/Icons.tsx";
import { useChatWorkspaceTools } from "../../components/workspace/ChatWorkspaceTools.tsx";
import { iconSize } from "../../design-system.ts";
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
	reduceAgentGroups,
	saveSyncedAgentState,
	syncAgentLayoutMode,
	type ThemeId,
} from "../../features/agent/agent-utils.ts";
import { clearAgentChatPaneState } from "../../features/chat/chat-session-store.ts";
import { useGitStatus } from "../../features/git/useGitStatus.tsx";
import {
	type AgentMainView,
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
} from "../../lib/app-navigation.tsx";
import {
	loadAppThemeId,
	mapAppThemeToAgentTheme,
} from "../../lib/app-theme.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { hasId, isNonEmptyString } from "../../lib/data.ts";
import {
	listenWindowEvent,
	setupAgentThemePanelShortcut,
} from "../../lib/react-events.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { wsClient } from "../../lib/websocket.ts";
import { AgentGrid } from "../../pages/Agent/AgentGrid.tsx";
import { color, controlSize, font, layer } from "../../tokens.stylex.ts";

export const Route = createFileRoute("/_app/agent")({ component: AgentPage });

const EMPTY_GRAPH_CWDS: string[] = [];

const ProjectFileGraphView = lazy(() =>
	import("../../components/graph/ProjectFileGraphView.tsx").then((module) => ({
		default: module.ProjectFileGraphView,
	})),
);
const AgentSettingsPanel = lazy(() =>
	import("../../pages/Agent/AgentSettingsPanel.tsx").then((module) => ({
		default: module.AgentSettingsPanel,
	})),
);

type GraphSelection = {
	readonly cwd: string | null;
	readonly source: "pane" | "user";
};

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

function getGraphCwds(
	panes: readonly { readonly cwd?: string }[] = [],
): string[] {
	const seen = new Set<string>();
	const cwds: string[] = [];
	for (const pane of panes) {
		if (!isNonEmptyString(pane.cwd) || seen.has(pane.cwd)) continue;
		seen.add(pane.cwd);
		cwds.push(pane.cwd);
	}
	return cwds;
}

function getSelectedPaneCwd(
	group: {
		readonly panes: readonly { readonly id: string; readonly cwd?: string }[];
		readonly selectedPaneId: string | null;
	} | null,
): string | null {
	return (
		group?.panes.find((pane) => pane.id === group.selectedPaneId)?.cwd ?? null
	);
}

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
			if (saved?.themeId && saved.themeId !== currentState.themeId) {
				setAppearance((prev) => ({ ...prev, themeId: saved.themeId }));
			}
			const savedState = saved;
			const isRegressiveSnapshot =
				savedState &&
				detail?.reason !== "remove-pane" &&
				detail?.reason !== "remove-workspace" &&
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

function GraphEmptyState({ message }: { message: string }) {
	return (
		<div {...stylex.props(styles.centerState, styles.centerPad)}>
			<div {...stylex.props(styles.centerTextBox)}>
				<div {...stylex.props(styles.iconBox)}>
					<IconGitBranch size={iconSize._2xl} />
				</div>
				<p {...stylex.props(styles.centerMessage)}>{message}</p>
			</div>
		</div>
	);
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
	surfaceLayerHidden: {
		contentVisibility: "hidden",
		pointerEvents: "none",
		visibility: "hidden",
		zIndex: layer.base,
	},
	chatWorkspace: {
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
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	chatDockZen: {
		width: 360,
		maxWidth: "28vw",
		flex: "0 0 auto",
	},
	centerState: {
		display: "flex",
		height: "100%",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	centerPad: {
		padding: controlSize._6,
	},
	centerTextBox: {
		maxWidth: "24rem",
		textAlign: "center",
	},
	iconBox: {
		display: "flex",
		width: controlSize._12,
		height: controlSize._12,
		alignItems: "center",
		justifyContent: "center",
		marginInline: "auto",
		marginBottom: controlSize._4,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
	},
	centerMessage: {
		color: color.textMain,
		fontSize: font.size_5,
	},
	spacer: {
		flex: 1,
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
	readonly graphView: unknown;
	readonly hasCurrentPanes: boolean;
	readonly mainView: AgentMainView;
	readonly setAppearance: AgentPersistenceArgs["setAppearance"];
	readonly setShowSettings: (value: boolean) => void;
	readonly showSettings: boolean;
	readonly agentGrid: unknown;
	readonly themeId: ThemeId;
};

type AgentPaneActionsArgs = {
	readonly chatRefs: MutableRef<Map<string, AgentChatHandle> | null>;
	readonly cleanupPane: (paneId: string) => void;
	readonly currentGroup: AgentSavedState["groups"][number] | undefined;
	readonly dispatchAgentGroupAction: (
		action: AgentGroupsAction,
		reason?: string,
	) => void;
	readonly groups: AgentSavedState["groups"];
	readonly selectedGroupId: GroupId | null;
	readonly setGraphSelection: (selection: GraphSelection) => void;
	readonly withSelectedGroup: (fn: (groupId: string) => void) => void;
};

function useAgentPaneActions({
	chatRefs,
	cleanupPane,
	currentGroup,
	dispatchAgentGroupAction,
	groups,
	selectedGroupId,
	setGraphSelection,
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
			if (path) {
				setGraphSelection({ cwd: path, source: "pane" });
			}
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
		[dispatchAgentGroupAction, setGraphSelection, withSelectedGroup],
	);
	const selectPane = useCallback(
		(paneId: string) => {
			const pane =
				currentGroup?.panes.find((item) => item.id === paneId) ?? null;
			if (pane?.cwd) {
				setGraphSelection({ cwd: pane.cwd, source: "pane" });
			}
			withSelectedGroup((groupId) =>
				dispatchAgentGroupAction(
					{ type: "selectPane", groupId, paneId },
					"select-pane",
				),
			);
		},
		[
			currentGroup,
			dispatchAgentGroupAction,
			setGraphSelection,
			withSelectedGroup,
		],
	);
	const handleChatRef = useCallback(
		(paneId: string, handle: AgentChatHandle | null) => {
			if (handle) chatRefs.current?.set(paneId, handle);
			else chatRefs.current?.delete(paneId);
		},
		[chatRefs],
	);
	const handleSelectGraphCwd = useCallback(
		(cwd: string) => setGraphSelection({ cwd, source: "user" }),
		[setGraphSelection],
	);
	return {
		handleAddPane,
		handleChatRef,
		handleDirectorySelected,
		handleSelectGraphCwd,
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
	graphView,
	hasCurrentPanes,
	mainView,
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
								<>
									<div
										{...stylex.props(
											styles.surfaceLayer,
											mainView === "chat"
												? styles.surfaceLayerVisible
												: styles.surfaceLayerHidden,
										)}
										aria-hidden={mainView !== "chat"}
									>
										<div
											{...stylex.props(
												styles.chatWorkspace,
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
									{mainView === "graph" && (
										<div
											{...stylex.props(
												styles.surfaceLayer,
												styles.surfaceLayerVisible,
											)}
										>
											<Suspense fallback={null}>{graphView}</Suspense>
										</div>
									)}
								</>
							)}
							{showSettings && (
								<Suspense fallback={null}>
									<AgentSettingsPanel
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
		themeId: (initialState?.themeId ??
			mapAppThemeToAgentTheme(loadAppThemeId())) as ThemeId,
		fontSize: initialState?.fontSize ?? DEFAULT_FONT_SIZE,
		fontFamily: initialState?.fontFamily ?? DEFAULT_FONT_FAMILY,
		opacity: initialState?.opacity ?? DEFAULT_OPACITY,
	}));
	const { themeId, fontSize, fontFamily, opacity } = appearance;
	const chatRefs = useRef<Map<string, AgentChatHandle> | null>(null);
	if (chatRefs.current === null) {
		chatRefs.current = new Map();
	}
	const theme = useMemo(() => getThemeById(themeId), [themeId]);
	const currentGroup = useMemo(
		() => groups.find(hasId.bind(null, selectedGroupId)),
		[groups, selectedGroupId],
	);
	const graphCwds = useMemo(
		() => getGraphCwds(currentGroup?.panes),
		[currentGroup],
	);
	const selectedPaneCwd = getSelectedPaneCwd(currentGroup ?? null);
	const selectedPane =
		currentGroup?.panes.find(
			(pane) => pane.id === currentGroup.selectedPaneId,
		) ?? null;
	const chatWorkspace = useChatWorkspaceTools({
		active: mainView === "chat",
		cwd: selectedPane?.cwd,
		workspaceId: currentGroup?.id ?? "default",
	});
	const [graphSelection, setGraphSelection] = useState<GraphSelection>({
		cwd: null,
		source: "pane",
	});
	const activeGraphCwd = useMemo(() => {
		if (graphSelection.cwd && graphCwds.includes(graphSelection.cwd)) {
			return graphSelection.cwd;
		}
		if (selectedPaneCwd && graphCwds.includes(selectedPaneCwd)) {
			return selectedPaneCwd;
		}
		return graphCwds[0] ?? null;
	}, [graphCwds, graphSelection.cwd, selectedPaneCwd]);
	const graphStatusCwds = mainView === "graph" ? graphCwds : EMPTY_GRAPH_CWDS;
	const { projectMap } = useGitStatus(graphStatusCwds, {
		enabled: mainView === "graph" && graphCwds.length > 0,
	});
	const activeGraphProject = activeGraphCwd
		? (projectMap.get(activeGraphCwd) ?? null)
		: null;
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
				themeId: normalized.themeId,
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
		handleSelectGraphCwd,
		handleSetPaneAgentKind,
		removePane,
		reorderPanes,
		selectPane,
	} = useAgentPaneActions({
		chatRefs,
		cleanupPane,
		currentGroup,
		dispatchAgentGroupAction,
		groups,
		selectedGroupId,
		setGraphSelection,
		withSelectedGroup,
	});
	const selectChatPane = useCallback(
		(paneId: string) => {
			chatWorkspace.focusChatWorkspace();
			selectPane(paneId);
		},
		[chatWorkspace.focusChatWorkspace, selectPane],
	);
	const agentGrid = currentGroup ? (
		<AgentGrid
			active={mainView === "chat"}
			panes={
				chatWorkspace.zenMode && selectedPane
					? [selectedPane]
					: currentGroup.panes
			}
			selectedPaneId={currentGroup.selectedPaneId}
			columns={chatWorkspace.zenMode ? 1 : currentGroup.columns}
			rows={chatWorkspace.zenMode ? 1 : (currentGroup.rows ?? DEFAULT_ROWS)}
			layoutMode={layoutMode}
			theme={theme}
			fontSize={fontSize}
			fontFamily={fontFamily}
			onSelectPane={selectChatPane}
			onClosePane={removePane}
			onDirectorySelect={handleDirectorySelected}
			onDirectoryCancel={removePane}
			onChatRef={handleChatRef}
			onReorderPanes={reorderPanes}
			onAddPane={handleAddPane}
			onSetPaneAgentKind={handleSetPaneAgentKind}
			workspaceId={currentGroup.id}
			auxiliaryPanels={chatWorkspace.auxiliaryPanels}
		/>
	) : null;
	const hasCurrentPanes = !!currentGroup && currentGroup.panes.length > 0;
	const graphView =
		graphCwds.length === 0 ? (
			<GraphEmptyState message="Open a project directory in one of this group's panes to populate the file graph." />
		) : (
			<ProjectFileGraphView
				cwds={graphCwds}
				activeCwd={activeGraphCwd}
				onSelectCwd={handleSelectGraphCwd}
				project={activeGraphProject}
			/>
		);
	return (
		<AgentMainSurface
			chatDiffPanel={chatWorkspace.diffPanel}
			chatSidebar={chatWorkspace.sidebar}
			chatZenMode={chatWorkspace.zenMode}
			graphView={graphView}
			hasCurrentPanes={hasCurrentPanes}
			mainView={mainView}
			setAppearance={setAppearance}
			setShowSettings={setShowSettings}
			showSettings={showSettings}
			agentGrid={agentGrid}
			themeId={themeId}
		/>
	);
}
