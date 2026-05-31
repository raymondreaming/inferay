import * as stylex from "@stylexjs/stylex";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconX } from "../../components/ui/Icons.tsx";
import { useAgentSessions } from "../../features/agents/useAgentSessions.ts";
import { wsClient } from "../../lib/websocket.ts";
import { EditorPage } from "../EditorPage/index.tsx";
import { InlineDirectoryPicker } from "./InlineDirectoryPicker.tsx";
import { NewSessionButtons } from "./NewSessionButtons.tsx";
import { TerminalGrid } from "./TerminalGrid.tsx";

import "@xterm/xterm/css/xterm.css";

import {
	type AgentKind,
	cacheTerminalState,
	createPendingAgentChatPane,
	createSimulatorPane,
	createTerminalPane,
	DEFAULT_CHAT_AGENT_KIND,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	DEFAULT_ROWS,
	type GroupId,
	getInitialGroups,
	getPaneTitle,
	getThemeById,
	loadTerminalLayoutMode,
	loadTerminalState,
	migrateGroup,
	saveTerminalState,
	syncTerminalLayoutMode,
	type TerminalGroupModel,
	type TerminalPaneModel,
	type ThemeId,
} from "../../features/terminal/terminal-utils.ts";
import {
	DEFAULT_TERMINAL_MAIN_VIEW,
	isTerminalMainView,
	type TerminalMainView,
} from "../../lib/app-navigation.tsx";
import {
	loadAppThemeId,
	mapAppThemeToTerminalTheme,
} from "../../lib/app-theme.ts";
import { hasId, lacksId } from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";

function paneShellKey(pane: TerminalPaneModel) {
	return {
		id: pane.id,
		agentKind: pane.agentKind,
		cwd: pane.cwd ?? null,
		pendingCwd: pane.pendingCwd ?? false,
		utilityPane: pane.utilityPane ?? null,
		title: pane.title,
	};
}

function groupShellKey(group: TerminalGroupModel) {
	return {
		id: group.id,
		name: group.name,
		selectedPaneId: group.selectedPaneId,
		columns: group.columns,
		rows: group.rows,
		panes: group.panes.map(paneShellKey),
	};
}

function shellStateKey(
	selectedGroupId: string | null,
	groups: TerminalGroupModel[]
) {
	return JSON.stringify({
		selectedGroupId,
		groups: groups.map(groupShellKey),
	});
}

const styles = stylex.create({
	panelRoot: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		backgroundColor: color.background,
	},
	appRoot: {
		display: "flex",
		flexDirection: "column",
		backgroundColor: color.background,
	},
	fullHeight: {
		height: "100%",
	},
	appFrame: {
		position: "relative",
		display: "flex",
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	appColumn: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	appBody: {
		display: "flex",
		flex: 1,
		overflow: "hidden",
	},
	mainPane: {
		position: "relative",
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minHeight: 0,
		minWidth: 0,
	},
	mainPaneHidden: {
		overflow: "hidden",
	},
	mainPaneScroll: {
		overflowY: "auto",
		overscrollBehavior: "none",
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
		fontSize: "0.875rem",
	},
	startHeader: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingBlock: "0.375rem",
		paddingInline: controlSize._3,
	},
	startTitle: {
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	spacer: {
		flex: 1,
	},
	startDock: {
		flexShrink: 0,
		paddingInline: controlSize._3,
		paddingBottom: controlSize._2,
	},
	startButtons: {
		display: "flex",
		alignItems: "center",
		gap: "0.375rem",
		overflowX: "auto",
		marginBottom: controlSize._1,
		paddingInline: controlSize._1,
	},
	chatWorkspace: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		height: "100%",
		minHeight: 0,
		overflow: "hidden",
	},
	chatGridSlot: {
		display: "flex",
		flex: 1,
		minHeight: 0,
		overflow: "hidden",
	},
});

function AgentStartPane({
	onStart,
	onClose,
}: {
	onStart: (
		agentKind: AgentKind,
		path: string | null,
		referencePaths?: string[]
	) => void;
	onClose?: () => void;
}) {
	const [agentKind, setAgentKind] = useState<AgentKind>(
		DEFAULT_CHAT_AGENT_KIND
	);
	return (
		<div {...stylex.props(styles.panelRoot)}>
			<div
				className={`electrobun-webkit-app-region-no-drag ${stylex.props(styles.startHeader).className ?? ""}`}
			>
				<span {...stylex.props(styles.startTitle)}>New Session</span>
				<span {...stylex.props(styles.spacer)} />
				{onClose && (
					<IconButton
						type="button"
						onClick={onClose}
						className="electrobun-webkit-app-region-no-drag"
						variant="danger"
						size="xs"
						title="Close"
					>
						<IconX size={8} />
					</IconButton>
				)}
			</div>
			<div {...stylex.props(styles.spacer)} />
			<div {...stylex.props(styles.startDock)}>
				<div {...stylex.props(styles.startButtons)}>
					<NewSessionButtons
						selectedKind={agentKind}
						onAddPane={(kind) => setAgentKind(kind)}
					/>
				</div>
				<InlineDirectoryPicker
					onSelect={(path) => {
						if (path) onStart(agentKind, path);
					}}
					multiSelect
					onMultiSelect={(paths) => {
						if (paths.length > 0) {
							onStart(agentKind, paths[0]!, paths.slice(1));
						}
					}}
				/>
			</div>
		</div>
	);
}

type GroupAction =
	| {
			type: "addPane";
			groupId: string;
			agentKind: AgentKind;
			cwd?: string;
			pendingCwd?: boolean;
			referencePaths?: string[];
	  }
	| { type: "addSimulatorPane"; groupId: string }
	| { type: "removePane"; groupId: string; paneId: string; force?: boolean }
	| { type: "selectPane"; groupId: string; paneId: string }
	| {
			type: "directorySelected";
			groupId: string;
			paneId: string;
			path: string | null;
			referencePaths?: string[];
	  }
	| { type: "removeGroup"; groupId: string }
	| {
			type: "reorderPanes";
			groupId: string;
			fromIndex: number;
			toIndex: number;
	  }
	| {
			type: "setPaneAgentKind";
			groupId: string;
			paneId: string;
			agentKind: AgentKind;
	  }
	| { type: "replaceAll"; groups: TerminalGroupModel[] };

function groupsReducer(
	state: TerminalGroupModel[],
	action: GroupAction
): TerminalGroupModel[] {
	switch (action.type) {
		case "addPane": {
			const pane = createTerminalPane(
				action.agentKind,
				action.cwd,
				action.pendingCwd
			);
			if (action.referencePaths) {
				pane.referencePaths = action.referencePaths;
			}
			return state.map((g) => {
				if (g.id !== action.groupId) return g;
				return { ...g, panes: [pane, ...g.panes], selectedPaneId: pane.id };
			});
		}
		case "addSimulatorPane": {
			const pane = createSimulatorPane();
			return state.map((g) => {
				if (g.id !== action.groupId) return g;
				return { ...g, panes: [pane, ...g.panes], selectedPaneId: pane.id };
			});
		}
		case "removePane": {
			return state.map((g) => {
				if (g.id !== action.groupId) return g;
				const panes = g.panes.filter(lacksId.bind(null, action.paneId));
				if (panes.length === 0) {
					const pane = createPendingAgentChatPane();
					return { ...g, panes: [pane], selectedPaneId: pane.id };
				}
				return {
					...g,
					panes,
					selectedPaneId:
						g.selectedPaneId === action.paneId
							? (panes[0]?.id ?? null)
							: g.selectedPaneId,
				};
			});
		}
		case "selectPane":
			return state.map((g) =>
				g.id === action.groupId
					? {
							...g,
							selectedPaneId:
								action.paneId as TerminalGroupModel["selectedPaneId"],
						}
					: g
			);
		case "directorySelected":
			return state.map((g) =>
				g.id === action.groupId
					? {
							...g,
							panes: g.panes.map((p) =>
								p.id === action.paneId
									? {
											...p,
											cwd: action.path ?? undefined,
											pendingCwd: false,
											referencePaths: action.referencePaths,
											title: getPaneTitle(
												p.agentKind,
												action.path ?? undefined
											),
										}
									: p
							),
						}
					: g
			);
		case "removeGroup":
			return state.filter(lacksId.bind(null, action.groupId));
		case "reorderPanes":
			return state.map((g) => {
				if (g.id !== action.groupId) return g;
				const panes = [...g.panes];
				const [moved] = panes.splice(action.fromIndex, 1);
				if (moved) panes.splice(action.toIndex, 0, moved);
				return { ...g, panes };
			});
		case "setPaneAgentKind":
			return state.map((g) =>
				g.id === action.groupId
					? {
							...g,
							panes: g.panes.map((p) =>
								p.id === action.paneId
									? ({
											...p,
											agentKind: action.agentKind,
											isClaude: action.agentKind === "claude",
											paneType: action.agentKind,
											title: getPaneTitle(action.agentKind, p.cwd),
										} as TerminalPaneModel)
									: p
							),
						}
					: g
			);
		case "replaceAll":
			return action.groups;
	}
}

export function TerminalPage() {
	useEffect(wsClient.connect.bind(wsClient), []);
	const [layoutMode, setLayoutMode] = useState(loadTerminalLayoutMode);
	const [mainView, setMainView] = useState<TerminalMainView>(() => {
		const stored = readStoredValue("terminal-main-view");
		return isTerminalMainView(stored) ? stored : DEFAULT_TERMINAL_MAIN_VIEW;
	});
	useEffect(() => {
		writeStoredValue("terminal-layout-mode", layoutMode);
	}, [layoutMode]);
	useEffect(() => {
		writeStoredValue("terminal-main-view", mainView);
	}, [mainView]);
	const initialState = useMemo(loadTerminalState, []);
	const initGroups = useMemo(() => getInitialGroups(), []);
	const [groups, groupsDispatch] = useReducer(groupsReducer, initGroups);
	const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(
		() => initialState?.selectedGroupId ?? initGroups[0]?.id ?? null
	);
	const [appearance, setAppearance] = useState(() => ({
		themeId: (initialState?.themeId ??
			mapAppThemeToTerminalTheme(loadAppThemeId())) as ThemeId,
		fontSize: initialState?.fontSize ?? DEFAULT_FONT_SIZE,
		fontFamily: initialState?.fontFamily ?? DEFAULT_FONT_FAMILY,
		opacity: initialState?.opacity ?? DEFAULT_OPACITY,
	}));
	const { themeId, fontSize, fontFamily, opacity } = appearance;
	const chatRefs = useRef<Map<string, AgentChatHandle>>(new Map());
	useAgentSessions();
	const theme = useMemo(() => getThemeById(themeId), [themeId]);
	const currentGroup = useMemo(
		() => groups.find(hasId.bind(null, selectedGroupId)),
		[groups, selectedGroupId]
	);
	const restoreSavedState = useCallback(
		(s: ReturnType<typeof loadTerminalState>) => {
			if (!s) return;
			groupsDispatch({
				type: "replaceAll",
				groups: s.groups.map(migrateGroup),
			});
			setSelectedGroupId(s.selectedGroupId);
			setAppearance({
				themeId: s.themeId,
				fontSize: s.fontSize,
				fontFamily: s.fontFamily,
				opacity: s.opacity,
			});
		},
		[]
	);
	const cleanupPane = useCallback((paneId: string) => {
		wsClient.send({ type: "terminal:destroy", paneId });
		chatRefs.current.delete(paneId);
	}, []);
	const withSelectedGroup = useCallback(
		(fn: (groupId: string) => void) => {
			if (selectedGroupId) fn(selectedGroupId);
		},
		[selectedGroupId]
	);
	const latestStateRef = useRef({
		groups,
		selectedGroupId,
		themeId,
		fontSize,
		fontFamily,
		opacity,
	});
	const pendingSaveRef = useRef(false);
	useEffect(() => {
		latestStateRef.current = {
			groups,
			selectedGroupId,
			themeId,
			fontSize,
			fontFamily,
			opacity,
		};
		cacheTerminalState(latestStateRef.current);
	}, [groups, selectedGroupId, themeId, fontSize, fontFamily, opacity]);
	useEffect(() => {
		pendingSaveRef.current = true;
		const id = setTimeout(() => {
			saveTerminalState(latestStateRef.current);
			pendingSaveRef.current = false;
			window.dispatchEvent(new Event("terminal-shell-change"));
		}, 100);
		return () => clearTimeout(id);
	});
	useEffect(
		() => () => {
			saveTerminalState(latestStateRef.current);
		},
		[]
	);
	useEffect(() => {
		const handleShellChange = () => {
			const saved = loadTerminalState();
			if (saved?.themeId && saved.themeId !== themeId) {
				setAppearance((prev) => ({ ...prev, themeId: saved.themeId }));
			}
			const savedState = saved;
			// Always allow selectedGroupId changes (workspace switching) even during pending saves
			if (
				savedState?.selectedGroupId &&
				savedState.selectedGroupId !== selectedGroupId
			) {
				setSelectedGroupId(savedState.selectedGroupId);
				// Sync the ref immediately so the pending save doesn't revert
				latestStateRef.current = {
					...latestStateRef.current,
					selectedGroupId: savedState.selectedGroupId,
				};
			}
			const savedSelectedGroup = savedState?.groups.find(
				hasId.bind(null, savedState.selectedGroupId)
			);
			if (savedSelectedGroup?.selectedPaneId) {
				const currentSavedGroup = latestStateRef.current.groups.find(
					hasId.bind(null, savedSelectedGroup.id)
				);
				if (
					currentSavedGroup &&
					currentSavedGroup.selectedPaneId !== savedSelectedGroup.selectedPaneId
				) {
					groupsDispatch({
						type: "selectPane",
						groupId: savedSelectedGroup.id,
						paneId: savedSelectedGroup.selectedPaneId,
					});
					latestStateRef.current = {
						...latestStateRef.current,
						groups: latestStateRef.current.groups.map((group) =>
							group.id === savedSelectedGroup.id
								? {
										...group,
										selectedPaneId: savedSelectedGroup.selectedPaneId,
									}
								: group
						),
					};
				}
			}
			// Skip full restore check if we have a pending save - this prevents undoing local changes
			if (pendingSaveRef.current) {
				return;
			}
			if (savedState) {
				const savedShellKey = shellStateKey(
					savedState.selectedGroupId,
					savedState.groups
				);
				const currentShellKey = shellStateKey(
					savedState.selectedGroupId,
					groups
				);
				if (savedShellKey !== currentShellKey) {
					restoreSavedState(savedState);
				}
			}
			const storedView = readStoredValue("terminal-main-view");
			const nextMainView = isTerminalMainView(storedView)
				? storedView
				: DEFAULT_TERMINAL_MAIN_VIEW;
			if (nextMainView !== mainView) {
				setMainView(nextMainView);
			}
			syncTerminalLayoutMode(setLayoutMode);
		};
		return listenWindowEvent("terminal-shell-change", handleShellChange);
	}, [groups, mainView, restoreSavedState, selectedGroupId, themeId]);
	const handleAddPane = useCallback(
		(agentKind: AgentKind) =>
			withSelectedGroup((groupId) =>
				groupsDispatch({
					type: "addPane",
					groupId,
					agentKind,
					pendingCwd: true,
				})
			),
		[withSelectedGroup]
	);
	const handleStartAgentPane = useCallback(
		(agentKind: AgentKind, path: string | null, referencePaths?: string[]) =>
			withSelectedGroup((groupId) =>
				groupsDispatch({
					type: "addPane",
					groupId,
					agentKind,
					cwd: path ?? undefined,
					pendingCwd: false,
					referencePaths,
				})
			),
		[withSelectedGroup]
	);
	useEffect(() => {
		const handleCreateSimulatorPane = () => {
			withSelectedGroup((groupId) =>
				groupsDispatch({ type: "addSimulatorPane", groupId })
			);
		};
		return listenWindowEvent(
			"inferay:create-simulator-pane",
			handleCreateSimulatorPane
		);
	}, [withSelectedGroup]);
	const removePane = useCallback(
		(paneId: string, force?: boolean) => {
			if (!selectedGroupId) return;
			const group = groups.find(hasId.bind(null, selectedGroupId));
			if (!group) return;
			if (group.panes.length <= 1 && groups.length > 1) {
				for (const pane of group.panes) cleanupPane(pane.id);
				groupsDispatch({ type: "removeGroup", groupId: selectedGroupId });
				setSelectedGroupId(
					groups.find(lacksId.bind(null, selectedGroupId))?.id ?? null
				);
				return;
			}
			cleanupPane(paneId);
			groupsDispatch({
				type: "removePane",
				groupId: selectedGroupId,
				paneId,
				force,
			});
		},
		[cleanupPane, groups, selectedGroupId]
	);
	const reorderPanes = useCallback(
		(fromIndex: number, toIndex: number) =>
			withSelectedGroup((groupId) =>
				groupsDispatch({ type: "reorderPanes", groupId, fromIndex, toIndex })
			),
		[withSelectedGroup]
	);
	const handleSetPaneAgentKind = useCallback(
		(paneId: string, agentKind: AgentKind) =>
			withSelectedGroup((groupId) =>
				groupsDispatch({
					type: "setPaneAgentKind",
					groupId,
					paneId,
					agentKind,
				})
			),
		[withSelectedGroup]
	);
	const handleDirectorySelected = useCallback(
		(paneId: string, path: string | null, referencePaths?: string[]) =>
			withSelectedGroup((groupId) =>
				groupsDispatch({
					type: "directorySelected",
					groupId,
					paneId,
					path,
					referencePaths,
				})
			),
		[withSelectedGroup]
	);
	const selectPane = useCallback(
		(paneId: string) =>
			withSelectedGroup((groupId) =>
				groupsDispatch({ type: "selectPane", groupId, paneId })
			),
		[withSelectedGroup]
	);
	const removeGroup = useCallback(
		(groupId: string) => {
			if (groups.length <= 1) return;
			const group = groups.find(hasId.bind(null, groupId));
			if (group) {
				for (const p of group.panes) cleanupPane(p.id);
			}
			groupsDispatch({ type: "removeGroup", groupId });
			if (selectedGroupId === groupId)
				setSelectedGroupId(
					groups.find(lacksId.bind(null, groupId))?.id ?? null
				);
		},
		[groups, selectedGroupId, cleanupPane]
	);
	const closeCurrentStartPane = useCallback(() => {
		if (!selectedGroupId || groups.length <= 1) return;
		removeGroup(selectedGroupId);
	}, [groups.length, removeGroup, selectedGroupId]);
	const handleChatRef = useCallback(
		(paneId: string, handle: AgentChatHandle | null) => {
			if (handle) chatRefs.current.set(paneId, handle);
			else chatRefs.current.delete(paneId);
		},
		[]
	);
	useEffect(
		() =>
			listenWindowEvent("inferay:agent-handover-request", (event) => {
				const detail = (
					event as CustomEvent<{
						targetPaneId?: string;
						sourcePaneId?: string;
						sourceMessageId?: string;
						prompt?: string;
						displayText?: string;
					}>
				).detail;
				if (!detail?.targetPaneId || !detail.prompt) return;
				chatRefs.current
					.get(detail.targetPaneId)
					?.sendMessage(detail.prompt, detail.displayText ?? "Hand off");
			}),
		[]
	);
	const editorViewKey = useMemo(() => {
		if (!currentGroup) return "none";
		return `${currentGroup.id}:${currentGroup.panes
			.map((pane) => `${pane.id}:${pane.cwd ?? ""}`)
			.join(",")}`;
	}, [currentGroup]);
	const startPane = (
		<AgentStartPane
			onStart={handleStartAgentPane}
			onClose={
				currentGroup && groups.length > 1 ? closeCurrentStartPane : undefined
			}
		/>
	);
	const terminalGrid = currentGroup ? (
		<TerminalGrid
			panes={currentGroup.panes}
			selectedPaneId={currentGroup.selectedPaneId}
			columns={currentGroup.columns}
			rows={currentGroup.rows ?? DEFAULT_ROWS}
			layoutMode={layoutMode}
			theme={theme}
			fontSize={fontSize}
			fontFamily={fontFamily}
			onSelectPane={selectPane}
			onClosePane={removePane}
			onDirectorySelect={handleDirectorySelected}
			onDirectoryCancel={removePane}
			onChatRef={handleChatRef}
			onReorderPanes={reorderPanes}
			onAddPane={handleAddPane}
			onSetPaneAgentKind={handleSetPaneAgentKind}
		/>
	) : null;
	const chatWorkspace = currentGroup ? (
		<div {...stylex.props(styles.chatWorkspace)}>
			<div {...stylex.props(styles.chatGridSlot)}>{terminalGrid}</div>
		</div>
	) : null;
	return (
		<div {...stylex.props(styles.appRoot, styles.fullHeight)}>
			<div {...stylex.props(styles.appFrame)}>
				<div {...stylex.props(styles.appColumn)}>
					<div {...stylex.props(styles.appBody)}>
						<div
							{...stylex.props(
								styles.mainPane,
								mainView === "editor" && layoutMode === "rows"
									? styles.mainPaneHidden
									: styles.mainPaneScroll
							)}
						>
							{!currentGroup || currentGroup.panes.length === 0 ? (
								startPane
							) : mainView === "editor" ? (
								<EditorPage
									key={editorViewKey}
									groups={groups}
									selectedGroupId={selectedGroupId}
									onSelectPane={selectPane}
									onDirectoryChange={handleDirectorySelected}
								/>
							) : mainView === "chat" ? (
								chatWorkspace
							) : (
								terminalGrid
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
