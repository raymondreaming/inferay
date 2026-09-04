import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "octane";

type ReactMouseEvent<T = Element> = globalThis.MouseEvent & {
	currentTarget: T;
};

import { sendJson } from "../../../adapters/backend/http.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import {
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
} from "../../../app/model/navigation.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../app/model/theme.ts";
import { iconSize, runtimeColor } from "../../../design-system.ts";
import { getAgentIcon } from "../../../modules/agents/components/AgentIcon.tsx";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../../modules/agents/model/agents.ts";
import { deriveStoredSummary } from "../../../modules/conversation/model/chat-session-store.ts";
import { Explorer } from "../../../modules/explorer/index.ts";
import {
	fetchForgeAccounts,
	getCachedForgeAccounts,
} from "../../../modules/repository/adapters/forge-client.ts";
import { areForgeAccountsEqual } from "../../../modules/repository/model/forge-equality.ts";
import { openSettingsModal } from "../../../modules/settings/model/settings-events.ts";
import { dispatchOpenActiveGitGraph } from "../../../modules/workbench/model/workbench-events.ts";
import {
	CREATE_AGENT_CHAT_EVENT,
	type CreateAgentChatDetail,
	type CreateAgentChatTarget,
	dispatchFocusAgentChatComposer,
	resolveCreateAgentChatCwd,
} from "../../../modules/workspace/model/workspace-events.ts";
import {
	type AgentPaneModel,
	type AgentShellChangeDetail,
	agentStateKey,
	compactAgentState,
	createAgentPane,
	dispatchAgentShellChange,
	dispatchRemoveAgentPaneRequest,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	loadAgentState,
	loadCanonicalAgentState,
	mutateAgentWorkspaceState,
	mutateCanonicalAgentState,
} from "../../../modules/workspace/model/workspace-model.ts";
import { type AppInfo, useAppInfo } from "../../../shared/hooks/useAppInfo.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import { noop } from "../../../shared/lib/data.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import { LiquidPanel } from "../../../shared/ui/gooey/LiquidPanel.tsx";
import { LiquidSegmentedRail } from "../../../shared/ui/gooey/LiquidSegmentedRail.tsx";
import { IconButton } from "../../../shared/ui/IconButton.tsx";
import {
	IconAgent,
	IconFolder,
	IconGitBranch,
	IconLayoutGrid,
	IconLayoutRows,
	IconMessageCircle,
	IconPanelLeft,
	IconRefreshCw,
	IconSettings,
	IconUser,
	IconX,
} from "../../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../../tokens.stylex.ts";
import {
	getVisibleRepositoryEntries,
	projectRepositoryWorkspaces,
} from "../model/repository-workspaces.ts";
import {
	loadSidebarUiState,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	type SidebarUpdateStatus,
	sidebarUiReducer,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "../model/sidebar-state.ts";

interface SidebarWorkspaceGroup {
	id: string;
	name: string;
	panes: AgentPaneModel[];
	selectedPaneId?: string | null;
	columns: number;
	rows: number;
}

const GRID_DIMENSIONS = [1, 2, 3, 4] as const;

interface SidebarWorkspaceState {
	groups: SidebarWorkspaceGroup[];
	selectedGroupId: string | null;
	key: string;
}

function deriveSummary(paneId: string): string | null {
	return deriveStoredSummary(paneId, undefined, () =>
		dispatchAgentShellChange({
			source: "cache",
			reason: "session-title",
		}),
	);
}

function PaneSummaryItem({
	pane,
	isActive,
	onClick,
}: {
	pane: AgentPaneModel;
	isActive: boolean;
	onClick: () => void;
}) {
	const isChat = isChatAgentKind(pane.agentKind);
	const summary = isChat ? deriveSummary(pane.id) : null;
	const primaryLabel = isChat ? (summary ?? pane.title) : pane.title;

	return (
		<div {...stylex.props(styles.paneSummaryCard)}>
			<button
				type="button"
				onClick={onClick}
				{...stylex.props(
					styles.paneSummary,
					styles.paneSummaryIdle,
					isActive && styles.paneSummarySelected,
				)}
			>
				<span {...stylex.props(styles.paneSummaryIcon)}>
					{isChat ? (
						getAgentIcon(
							pane.agentKind,
							12,
							stylex.props(styles.iconDim).className,
						)
					) : (
						<IconAgent
							size={iconSize.md}
							className={stylex.props(styles.iconDim).className}
						/>
					)}
				</span>
				<div {...stylex.props(styles.paneSummaryText)}>
					<p {...stylex.props(styles.paneSummaryTitle)}>{primaryLabel}</p>
				</div>
			</button>
			<button
				type="button"
				onClick={() => dispatchRemoveAgentPaneRequest(pane.id)}
				{...stylex.props(styles.paneSummaryDelete)}
				title="Delete pane"
				aria-label={`Delete ${primaryLabel}`}
			>
				<IconX size={iconSize.xs} />
			</button>
		</div>
	);
}

function SidebarChatList({
	workspaces,
	onSelectPane,
}: {
	workspaces: SidebarWorkspaceState;
	onSelectPane: (groupId: string, paneId: string) => void;
}) {
	const repositoryProjection = projectRepositoryWorkspaces(
		workspaces.groups,
		workspaces.selectedGroupId,
	);
	const entries = getVisibleRepositoryEntries(repositoryProjection);

	return (
		<div {...stylex.props(styles.workspacePaneList)}>
			{entries.length > 0 ? (
				entries.map(({ groupId, pane }) => (
					<PaneSummaryItem
						key={pane.id}
						pane={pane}
						isActive={
							groupId === workspaces.selectedGroupId &&
							pane.id ===
								workspaces.groups.find((group) => group.id === groupId)
									?.selectedPaneId
						}
						onClick={() => onSelectPane(groupId, pane.id)}
					/>
				))
			) : (
				<div {...stylex.props(styles.repositoryEmptyState)}>
					No chats in this repository yet.
				</div>
			)}
		</div>
	);
}

function SidebarWorkspacesSection({
	collapsed,
	workspaces,
	layoutMode,
	onUpdateLayoutMode,
	onUpdateGrid,
	onSelectPane,
	onExpandSidebar,
}: {
	collapsed: boolean;
	workspaces: SidebarWorkspaceState;
	layoutMode: "grid" | "rows";
	onUpdateLayoutMode: (mode: "grid" | "rows") => void;
	onUpdateGrid: (patch: { columns?: number; rows?: number }) => void;
	onSelectPane: (groupId: string, paneId: string) => void;
	onExpandSidebar: () => void;
}) {
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
	const [sectionMode, setSectionMode] = useState<"chats" | "explorer">(() =>
		readStoredValue("workspace-sidebar-mode") === "explorer"
			? "explorer"
			: "chats",
	);
	const [gridMenuOpen, setGridMenuOpen] = useState(false);
	const [hoveredGridDimension, setHoveredGridDimension] = useState<{
		axis: "columns";
		value: number;
	} | null>(null);
	const gridMenuRef = useRef<HTMLDivElement | null>(null);
	const selectedGroup =
		workspaces.groups.find(
			(group) => group.id === workspaces.selectedGroupId,
		) ?? null;
	const repositoryProjection = projectRepositoryWorkspaces(
		workspaces.groups,
		workspaces.selectedGroupId,
	);
	const selectedCwd = repositoryProjection.activeWorkspace?.cwd;
	const projectCwds = selectedCwd ? [selectedCwd] : [];
	const selectSectionMode = (mode: "chats" | "explorer") => {
		setSectionMode(mode);
		writeStoredValue("workspace-sidebar-mode", mode);
	};
	useEffect(() => {
		if (!gridMenuOpen) return;
		const closeMenu = (event: MouseEvent) => {
			if (!gridMenuRef.current?.contains(event.target as Node)) {
				setGridMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", closeMenu);
		return () => document.removeEventListener("mousedown", closeMenu);
	}, [gridMenuOpen]);

	return (
		<div className={workspaceSectionProps.className}>
			{!collapsed ? (
				<div {...stylex.props(styles.sidebarToolbar)}>
					<div {...stylex.props(styles.sidebarRepositoryActions)}>
						<button
							type="button"
							onClick={dispatchOpenActiveGitGraph}
							disabled={!selectedCwd}
							{...stylex.props(styles.sidebarRepositoryAction)}
							title="Open commit graph"
						>
							<IconGitBranch size={iconSize.sm} />
							<span>Graph</span>
						</button>
					</div>
					<div {...stylex.props(styles.sidebarModeTabs)}>
						<button
							type="button"
							onClick={() => selectSectionMode("chats")}
							{...stylex.props(
								styles.sidebarModeTab,
								sectionMode === "chats" && styles.sidebarModeTabActive,
							)}
						>
							<IconMessageCircle size={iconSize.sm} />
							Chats
						</button>
						<button
							type="button"
							onClick={() => selectSectionMode("explorer")}
							{...stylex.props(
								styles.sidebarModeTab,
								sectionMode === "explorer" && styles.sidebarModeTabActive,
							)}
						>
							<IconFolder size={iconSize.sm} />
							Explorer
						</button>
					</div>
				</div>
			) : null}
			{sectionMode === "explorer" && !collapsed ? (
				<Explorer cwds={projectCwds} />
			) : (
				<div {...stylex.props(styles.workspaceListScroll)}>
					<div
						{...stylex.props(
							styles.workspaceSectionHeader,
							collapsed
								? styles.workspaceSectionHeaderCollapsed
								: styles.workspaceSectionHeaderOpen,
						)}
					>
						{collapsed ? (
							<IconButton
								type="button"
								onClick={onExpandSidebar}
								variant="ghost"
								size="md"
								className={stylex.props(styles.collapsedAddButton).className}
								title="Expand workspace sidebar"
							>
								<IconPanelLeft
									size={iconSize.lg}
									className={
										stylex.props(styles.noShrink, styles.flipHorizontal)
											.className
									}
								/>
							</IconButton>
						) : (
							<div
								ref={gridMenuRef}
								{...stylex.props(styles.workspaceLayoutControl)}
							>
								<LiquidSegmentedRail
									activeIndex={layoutMode === "grid" ? 0 : 1}
									itemCount={2}
									radius={14}
									itemSize={28}
									gap={4}
								/>
								<span {...stylex.props(styles.workspaceGridWrap)}>
									<button
										type="button"
										onClick={() => {
											onUpdateLayoutMode("grid");
											setGridMenuOpen((open) => !open);
										}}
										{...stylex.props(
											styles.workspaceLayoutButton,
											layoutMode === "grid"
												? styles.workspaceLayoutButtonActive
												: styles.workspaceLayoutButtonIdle,
										)}
										aria-label="Grid layout"
										aria-expanded={gridMenuOpen}
									>
										<IconLayoutGrid size={iconSize.lg} />
									</button>
									{gridMenuOpen && selectedGroup ? (
										<span {...stylex.props(styles.workspaceGridMenuAnchor)}>
											<LiquidPanel fill={runtimeColor.backgroundRaised}>
												<div {...stylex.props(styles.workspaceGridMenu)}>
													<span {...stylex.props(styles.workspaceGridMenuRow)}>
														<span
															{...stylex.props(styles.workspaceGridMenuLabel)}
														>
															Columns
														</span>
														<span
															{...stylex.props(styles.workspaceGridChoices)}
															onMouseLeave={() => setHoveredGridDimension(null)}
														>
															<LiquidSegmentedRail
																activeIndex={
																	(hoveredGridDimension?.axis === "columns"
																		? hoveredGridDimension.value
																		: selectedGroup.columns) - 1
																}
																itemCount={4}
																itemSize={24}
																gap={2}
																radius={12}
															/>
															{GRID_DIMENSIONS.map((value) => (
																<button
																	key={`columns-${value}`}
																	type="button"
																	onMouseEnter={() =>
																		setHoveredGridDimension({
																			axis: "columns",
																			value,
																		})
																	}
																	onClick={() => {
																		onUpdateLayoutMode("grid");
																		onUpdateGrid({ columns: value });
																	}}
																	{...stylex.props(
																		styles.workspaceGridChoice,
																		selectedGroup.columns === value
																			? styles.workspaceGridChoiceActive
																			: null,
																	)}
																>
																	{value}
																</button>
															))}
														</span>
													</span>
													<span {...stylex.props(styles.workspaceGridMenuHint)}>
														Drag pane dividers to fine-tune the layout.
													</span>
												</div>
											</LiquidPanel>
										</span>
									) : null}
								</span>
								<button
									type="button"
									onClick={() => {
										onUpdateLayoutMode("rows");
										setGridMenuOpen(false);
									}}
									{...stylex.props(
										styles.workspaceLayoutButton,
										layoutMode === "rows"
											? styles.workspaceLayoutButtonActive
											: styles.workspaceLayoutButtonIdle,
									)}
									aria-label="Row layout"
								>
									<IconLayoutRows size={iconSize.lg} />
								</button>
							</div>
						)}
					</div>
					<SidebarChatList
						workspaces={workspaces}
						onSelectPane={onSelectPane}
					/>
				</div>
			)}
		</div>
	);
}

function SidebarFooter({
	updateAvailable,
	updateInfo,
	updateStatus,
	onUpdate,
}: {
	updateAvailable: boolean;
	updateInfo: AppInfo["update"];
	updateStatus: SidebarUpdateStatus;
	onUpdate: () => void;
}) {
	if (!updateAvailable) return null;
	return (
		<button
			type="button"
			onClick={onUpdate}
			disabled={updateStatus === "updating"}
			{...stylex.props(
				styles.updateButton,
				updateStatus === "updating" && styles.updateButtonBusy,
			)}
		>
			<IconRefreshCw size={iconSize.md} />
			<span {...stylex.props(styles.updateLabel)}>
				{updateStatus === "updating"
					? "Updating…"
					: updateStatus === "error"
						? "Try update again"
						: `Update to ${updateInfo.latestVersion}`}
			</span>
		</button>
	);
}

export function WorkspaceSidebar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [uiState, dispatchUi] = useReducer(
		sidebarUiReducer,
		undefined,
		loadSidebarUiState,
	);
	const { collapsed, sidebarWidth, resizing, updateStatus } = uiState;
	const [layoutMode, setLayoutMode] = useState(loadAgentLayoutMode);
	const { data: appInfo } = useAppInfo();
	const { data: forgeAccounts } = useQueryResource(
		() => fetchForgeAccounts(),
		getCachedForgeAccounts(),
		{
			queryKey: ["forge", "accounts"],
			isEqual: areForgeAccountsEqual,
		},
	);
	const githubAccount =
		forgeAccounts.find((account) => account.active) ?? forgeAccounts[0] ?? null;
	const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const resizeWidthRef = useRef(sidebarWidth);
	const [mainView, setMainView] = useState(() => {
		const stored = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
		return isAgentMainView(stored) ? stored : DEFAULT_AGENT_MAIN_VIEW;
	});
	const showWorkspaceSidebar =
		location.pathname === "/agent" && mainView === "chat";

	useEffect(
		() =>
			listenWindowEvent("agent-shell-change", (event) => {
				const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
				if (detail?.source !== "view" || detail.reason !== "main-view") return;
				const stored = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
				setMainView(isAgentMainView(stored) ? stored : DEFAULT_AGENT_MAIN_VIEW);
			}),
		[],
	);
	useEffect(
		() =>
			listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
				dispatchUi({
					type: "collapsed",
					value: (event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
						.collapsed,
				});
			}),
		[],
	);
	// Workspace state
	const loadWorkspaces = useCallback(() => {
		const state = loadAgentState();
		const cleanState = state
			? compactAgentState(state, { keepSelectedDraft: true })
			: null;
		return {
			groups: cleanState?.groups ?? [],
			selectedGroupId:
				cleanState?.selectedGroupId ?? cleanState?.groups[0]?.id ?? null,
			key: cleanState ? agentStateKey(cleanState) : "",
		};
	}, []);

	const [workspaces, setWorkspaces] = useState(loadWorkspaces);
	const repositoryProjection = useMemo(
		() =>
			projectRepositoryWorkspaces(
				workspaces.groups,
				workspaces.selectedGroupId,
			),
		[workspaces.groups, workspaces.selectedGroupId],
	);

	useEffect(() => listenAgentLayoutMode(setLayoutMode), []);

	useEffect(() => {
		let cancelled = false;
		loadCanonicalAgentState()
			.then(() => {
				if (!cancelled) {
					const next = loadWorkspaces();
					setWorkspaces((current) =>
						current.key === next.key ? current : next,
					);
				}
			})
			.catch(noop);
		return () => {
			cancelled = true;
		};
	}, [loadWorkspaces]);

	useEffect(() => {
		const refresh = (event: Event) => {
			const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
			if (detail?.reason === "session-title") {
				setWorkspaces((current) => ({ ...current }));
				return;
			}
			if (detail?.source === "view" && !detail.stateKey) return;
			const next = loadWorkspaces();
			setWorkspaces((current) => (current.key === next.key ? current : next));
		};
		return listenWindowEvent("agent-shell-change", refresh);
	}, [loadWorkspaces]);

	const selectPane = useCallback(
		async (groupId: string, paneId: string) => {
			setWorkspaces((prev) => {
				let changed = prev.selectedGroupId !== groupId;
				const groups = prev.groups.map((group) => {
					if (group.id !== groupId) return group;
					if (group.selectedPaneId === paneId) return group;
					changed = true;
					return { ...group, selectedPaneId: paneId as never };
				});
				return changed
					? { ...prev, groups, selectedGroupId: groupId as never }
					: prev;
			});
			const next = await mutateAgentWorkspaceState(
				{ type: "selectPane", groupId, paneId },
				"select-pane",
			);
			if (next) {
				setWorkspaces({
					groups: next.groups,
					selectedGroupId: next.selectedGroupId,
					key: agentStateKey(next),
				});
			}
			if (location.pathname !== "/agent") {
				navigate({ to: "/agent" });
			}
			requestAnimationFrame(() => {
				requestAnimationFrame(() => dispatchFocusAgentChatComposer(paneId));
			});
		},
		[location.pathname, navigate],
	);

	const addChat = useCallback(
		async (target: CreateAgentChatTarget) => {
			const cwd = resolveCreateAgentChatCwd(
				target,
				repositoryProjection.activeWorkspace?.cwd,
			);
			const pane = createAgentPane(
				loadDefaultChatSettings().agentKind,
				cwd,
				!cwd,
			);
			await mutateAgentWorkspaceState({ type: "addPane", pane }, "add-pane", {
				createIfMissing: true,
			});
			navigate({ to: "/agent" });
		},
		[navigate, repositoryProjection.activeWorkspace?.cwd],
	);

	useEffect(() => {
		const stopChat = listenWindowEvent(CREATE_AGENT_CHAT_EVENT, (event) => {
			const { target } = (event as CustomEvent<CreateAgentChatDetail>).detail;
			void addChat(target);
		});
		return stopChat;
	}, [addChat]);

	const updateLayoutMode = useCallback(
		(mode: "grid" | "rows") => {
			if (mode === layoutMode) return;
			writeStoredValue("agent-layout-mode", mode);
			setLayoutMode(mode);
			dispatchAgentShellChange({ source: "view", reason: "layout-mode" });
		},
		[layoutMode],
	);

	const updateSelectedGroupGrid = useCallback(
		async (patch: { columns?: number; rows?: number }) => {
			setWorkspaces((current) => {
				let changed = false;
				const groups = current.groups.map((group) => {
					if (group.id !== current.selectedGroupId) return group;
					const columns = patch.columns ?? group.columns;
					const rows = patch.rows ?? group.rows;
					if (columns === group.columns && rows === group.rows) return group;
					changed = true;
					return { ...group, columns, rows };
				});
				return changed ? { ...current, groups } : current;
			});
			await mutateCanonicalAgentState((agentState) => {
				if (!agentState.selectedGroupId) return null;
				let changed = false;
				const groups = agentState.groups.map((group) => {
					if (group.id !== agentState.selectedGroupId) return group;
					const columns = patch.columns ?? group.columns;
					const rows = patch.rows ?? group.rows;
					if (columns === group.columns && rows === group.rows) return group;
					changed = true;
					return { ...group, columns, rows };
				});
				return changed ? { ...agentState, groups } : null;
			}, "grid-size");
		},
		[],
	);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			if (collapsed) return;
			event.preventDefault();
			dispatchUi({ type: "resizing", value: true });
			resizeWidthRef.current = sidebarWidth;
			resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
			const handleMove = (moveEvent: MouseEvent) => {
				if (!resizeRef.current) return;
				const delta = moveEvent.clientX - resizeRef.current.startX;
				const nextWidth = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(MIN_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta),
				);
				resizeWidthRef.current = nextWidth;
				dispatchUi({ type: "sidebarWidth", value: nextWidth });
			};
			const handleUp = () => {
				resizeRef.current = null;
				dispatchUi({ type: "resizing", value: false });
				writeStoredValue("main-sidebar-width", String(resizeWidthRef.current));
				window.removeEventListener("mousemove", handleMove);
				window.removeEventListener("mouseup", handleUp);
			};
			window.addEventListener("mousemove", handleMove);
			window.addEventListener("mouseup", handleUp);
		},
		[collapsed, sidebarWidth],
	);

	const updateInfo = appInfo.update;
	const updateAvailable = updateInfo.available && !!updateInfo.url;
	const openUpdate = useCallback(() => {
		dispatchUi({ type: "updateStatus", value: "updating" });
		void sendJson("/api/native/update")
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Update request failed: ${response.status}`);
				}
			})
			.catch((error) => {
				if (error instanceof TypeError) return;
				console.error("[update] failed", error);
				dispatchUi({ type: "updateStatus", value: "error" });
			});
	}, []);
	const shellProps = stylex.props(
		styles.shell,
		!showWorkspaceSidebar || collapsed ? styles.shellHidden : styles.shellOpen,
		resizing && styles.shellResizing,
	);
	const resizeHandleProps = stylex.props(styles.resizeHandle);

	return (
		<aside
			{...shellProps}
			className={`${APP_REGION_DRAG_CLASS} ${shellProps.className ?? ""}`}
			style={
				!showWorkspaceSidebar || collapsed ? undefined : { width: sidebarWidth }
			}
		>
			{showWorkspaceSidebar && !collapsed && (
				<button
					type="button"
					aria-label="Resize sidebar"
					{...resizeHandleProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${resizeHandleProps.className ?? ""}`}
					onMouseDown={handleResizeStart}
				/>
			)}
			{showWorkspaceSidebar && !collapsed ? (
				<>
					<nav {...stylex.props(styles.nav)}>
						<SidebarWorkspacesSection
							collapsed={collapsed}
							workspaces={workspaces}
							layoutMode={layoutMode}
							onUpdateLayoutMode={updateLayoutMode}
							onUpdateGrid={updateSelectedGroupGrid}
							onSelectPane={selectPane}
							onExpandSidebar={() =>
								dispatchUi({ type: "collapsed", value: false })
							}
						/>
					</nav>
					<div {...stylex.props(styles.sidebarAccountArea)}>
						<SidebarFooter
							updateAvailable={updateAvailable}
							updateInfo={updateInfo}
							updateStatus={updateStatus}
							onUpdate={openUpdate}
						/>
						<button
							type="button"
							onClick={() => openSettingsModal()}
							{...stylex.props(styles.sidebarSettings)}
						>
							<IconSettings size={iconSize.md} />
							<span>Settings</span>
						</button>
						<button
							type="button"
							onClick={() => openSettingsModal("github")}
							{...stylex.props(styles.sidebarAccount)}
							title="Account settings"
						>
							{githubAccount?.avatarUrl ? (
								<img
									src={githubAccount.avatarUrl}
									alt=""
									{...stylex.props(styles.sidebarAvatar)}
								/>
							) : (
								<span {...stylex.props(styles.sidebarAvatarFallback)}>
									<IconUser size={iconSize.sm} />
								</span>
							)}
							<span {...stylex.props(styles.sidebarUsername)}>
								{githubAccount?.login || "GitHub account"}
							</span>
						</button>
					</div>
				</>
			) : null}
		</aside>
	);
}

const styles = stylex.create({
	iconDim: {
		opacity: 0.6,
	},
	noShrink: {
		flexShrink: 0,
	},
	paneSummaryCard: {
		position: "relative",
	},
	paneSummary: {
		alignItems: "flex-start",
		borderWidth: 0,
		borderRadius: radius.md,
		display: "flex",
		gap: controlSize._2,
		marginBottom: "0.125rem",
		paddingBlock: "0.375rem",
		paddingLeft: controlSize._2,
		paddingRight: controlSize._8,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
		width: "100%",
	},
	paneSummaryIdle: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
		borderColor: color.transparent,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	paneSummarySelected: {
		backgroundColor: color.surfaceControlHover,
		borderColor: color.transparent,
		color: color.textMain,
	},
	paneSummaryIcon: {
		flexShrink: 0,
		marginTop: "0.125rem",
	},
	paneSummaryText: {
		flex: 1,
		minWidth: controlSize._0,
	},
	paneSummaryDelete: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.sm,
		color: {
			default: color.textFaint,
			":hover": color.textMain,
		},
		display: "flex",
		height: controlSize._5,
		justifyContent: "center",
		position: "absolute",
		right: controlSize._1,
		top: "50%",
		transform: "translateY(-50%)",
		width: controlSize._5,
	},
	paneSummaryTitle: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		lineHeight: 1.2,
		margin: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	repositoryEmptyState: {
		color: color.textFaint,
		fontSize: font.size_2,
		paddingBlock: controlSize._6,
		paddingInline: controlSize._2,
		textAlign: "center",
	},
	sidebarModeTabs: {
		display: "grid",
		gridTemplateColumns: "1fr 1fr",
		gap: controlSize._1,
		marginTop: controlSize._1,
	},
	sidebarToolbar: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		paddingBottom: controlSize._2,
		paddingInline: controlSize._3,
	},
	sidebarRepositoryActions: {
		display: "flex",
	},
	sidebarRepositoryAction: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._7,
		justifyContent: "center",
		":disabled": {
			color: color.textMuted,
			cursor: "default",
			opacity: 0.45,
		},
	},
	sidebarModeTab: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1,
		height: controlSize._7,
		justifyContent: "center",
		borderRadius: radius.sm,
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	sidebarModeTabActive: {
		backgroundColor: color.backgroundSubtle,
		color: color.textMain,
	},
	workspacePaneList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		marginTop: "0.125rem",
		paddingBottom: controlSize._1,
	},
	shell: {
		backdropFilter: "none",
		backgroundColor: color.background,
		borderRadius: radius.none,
		borderWidth: controlSize._0,
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
		boxSizing: "border-box",
		boxShadow: "none",
		display: "flex",
		flexDirection: "column",
		marginTop: controlSize._0,
		overflow: "visible",
		paddingTop: controlSize._0,
		position: "relative",
		transitionDuration: motion.durationSlow,
		transitionProperty: "width",
		transitionTimingFunction: "ease",
		userSelect: "none",
	},
	shellHidden: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		boxShadow: "none",
		width: controlSize._0,
	},
	shellOpen: {
		width: 233,
	},
	shellResizing: {
		transitionDuration: motion.durationInstant,
		transitionProperty: "none",
		userSelect: "none",
	},
	resizeHandle: {
		position: "absolute",
		top: controlSize._0,
		right: -2,
		bottom: controlSize._0,
		zIndex: layer.sticky,
		width: controlSize._1,
		borderWidth: 0,
		cursor: "ew-resize",
		padding: controlSize._0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
	},
	nav: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		overflow: "hidden",
		paddingLeft: controlSize._0,
		paddingBottom: controlSize._12,
		paddingBlock: controlSize._0,
	},
	sidebarSettings: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		height: controlSize._9,
		width: "100%",
		paddingInline: controlSize._2,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
	},
	sidebarAccountArea: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		marginBlock: controlSize._2,
		paddingInline: controlSize._3,
		width: "100%",
	},
	sidebarAccount: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.md,
		color: color.textSoft,
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		height: controlSize._9,
		minWidth: controlSize._0,
		paddingInline: controlSize._2,
		textAlign: "left",
		width: "100%",
	},
	sidebarAvatar: {
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		height: controlSize._5,
		objectFit: "cover",
		width: controlSize._5,
	},
	sidebarAvatarFallback: {
		alignItems: "center",
		backgroundColor: color.controlActive,
		borderRadius: radius.pill,
		display: "flex",
		flexShrink: 0,
		height: controlSize._5,
		justifyContent: "center",
		width: controlSize._5,
	},
	sidebarUsername: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	workspaceSection: {
		display: "flex",
		flex: 1,
		minHeight: controlSize._0,
		flexDirection: "column",
		marginTop: controlSize._0,
		paddingTop: controlSize._2,
		minWidth: controlSize._0,
		width: "100%",
	},
	workspaceListScroll: {
		minHeight: controlSize._0,
		overflowY: "auto",
		paddingInline: controlSize._3,
	},
	workspaceSectionHeader: {
		position: "relative",
		zIndex: layer.modal,
		alignItems: "center",
		display: "none",
		marginBlockEnd: controlSize._1,
		marginInline: "0.375rem",
	},
	workspaceSectionHeaderCollapsed: {
		justifyContent: "flex-start",
	},
	workspaceSectionHeaderOpen: {
		justifyContent: "space-between",
		paddingInline: controlSize._1,
	},
	collapsedAddButton: {
		borderRadius: radius.circle,
		height: controlSize._8,
		width: controlSize._8,
	},
	workspaceLayoutControl: {
		position: "relative",
		isolation: "isolate",
		display: "inline-flex",
		height: controlSize._7,
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 0,
		borderRadius: radius.none,
		backgroundColor: color.transparent,
		overflow: "visible",
	},
	workspaceGridWrap: {
		position: "relative",
		zIndex: layer.content,
		display: "inline-flex",
		height: "100%",
		width: controlSize._7,
		flexShrink: 0,
	},
	workspaceGridMenuAnchor: {
		position: "absolute",
		top: 42,
		left: controlSize._0,
		zIndex: layer.sidebarPopover,
		display: "flex",
		width: 188,
		pointerEvents: "auto",
		transformOrigin: "top left",
		animationName: stylex.keyframes({
			from: {
				opacity: 0,
				transform: "translateY(-10px) scale(0.97)",
			},
			to: {
				opacity: 1,
				transform: "translateY(0) scale(1)",
			},
		}),
		animationDuration: motion.durationDeliberate,
		animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
	},
	workspaceLayoutButton: {
		position: "relative",
		zIndex: layer.content,
		display: "inline-flex",
		height: "100%",
		width: controlSize._7,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.transparent,
		borderRadius: radius.circle,
	},
	workspaceLayoutButtonIdle: {
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	workspaceLayoutButtonActive: {
		color: color.textMain,
		backgroundColor: color.transparent,
		borderColor: color.border,
		boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
	},
	workspaceGridMenu: {
		boxSizing: "border-box",
		display: "flex",
		width: 188,
		flexDirection: "column",
		gap: controlSize._2,
		borderWidth: 0,
		borderRadius: radius.lg,
		backgroundColor: color.transparent,
		boxShadow: "none",
		padding: controlSize._2,
	},
	workspaceGridMenuRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._2,
	},
	workspaceGridMenuLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	workspaceGridMenuHint: {
		color: color.textFaint,
		fontSize: font.size_1,
		lineHeight: 1.4,
		paddingInline: controlSize._1,
	},
	workspaceGridChoices: {
		position: "relative",
		isolation: "isolate",
		display: "flex",
		gap: controlSize._0_5,
	},
	workspaceGridChoice: {
		position: "relative",
		zIndex: layer.content,
		display: "inline-flex",
		height: controlSize._6,
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.circle,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		fontSize: font.size_1,
	},
	workspaceGridChoiceActive: {
		color: color.textMain,
		backgroundColor: color.transparent,
	},
	flipHorizontal: {
		transform: "scaleX(-1)",
	},
	updateButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderRadius: radius.md,
		color: color.textSoft,
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		height: controlSize._9,
		paddingInline: controlSize._2,
		textAlign: "left",
		width: "100%",
	},
	updateButtonBusy: {
		cursor: "wait",
		opacity: 0.75,
	},
	updateLabel: {
		flex: 1,
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
});
