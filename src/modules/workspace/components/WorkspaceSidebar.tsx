import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from "octane";

type ReactMouseEvent<T = Element> = globalThis.MouseEvent & {
	currentTarget: T;
};

import { createPortal } from "octane";
import { sendJson } from "../../../adapters/backend/http.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../../adapters/storage/keys.ts";
import {
	readStoredBoolean,
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
import { Explorer, FileSearch } from "../../../modules/explorer/index.ts";
import { dispatchDocumentOpen } from "../../../modules/explorer/model/explorer-events.ts";
import {
	type AgentPaneModel,
	type AgentShellChangeDetail,
	agentStateKey,
	compactAgentState,
	createAgentPane,
	dispatchAgentShellChange,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	loadAgentState,
	loadCanonicalAgentState,
	mutateAgentWorkspaceState,
	mutateCanonicalAgentState,
} from "../../../modules/workspace/model/workspace-model.ts";
import { type AppInfo, useAppInfo } from "../../../shared/hooks/useAppInfo.ts";
import { noop } from "../../../shared/lib/data.ts";
import {
	activateOnEnterOrSpacePreventDefault,
	listenWindowEvent,
	setInputValue,
	stopPropagation,
	stopPropagationAndCall,
} from "../../../shared/lib/react-events.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import { LiquidCreateMenu } from "../../../shared/ui/gooey/LiquidCreateMenu.tsx";
import { LiquidPanel } from "../../../shared/ui/gooey/LiquidPanel.tsx";
import { LiquidSegmentedRail } from "../../../shared/ui/gooey/LiquidSegmentedRail.tsx";
import { IconButton } from "../../../shared/ui/IconButton.tsx";
import {
	IconAgent,
	IconChevronRight,
	IconLayoutGrid,
	IconLayoutRows,
	IconPanelLeft,
	IconPencil,
	IconPlus,
	IconRefreshCw,
	IconSettings,
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
	loadSidebarUiState,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	type SidebarUpdateStatus,
	sidebarUiReducer,
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
	);
}

function WorkspaceItem({
	group,
	isActive,
	canDelete,
	collapsed,
	selectedPaneId,
	onSelect,
	onSelectPane,
	onExpandSidebar,
	onDelete,
	onRename,
}: {
	group: {
		id: string;
		name: string;
		panes: AgentPaneModel[];
		selectedPaneId: string | null;
	};
	isActive: boolean;
	canDelete: boolean;
	collapsed: boolean;
	selectedPaneId: string | null;
	onSelect: () => void;
	onSelectPane: (paneId: string) => void;
	onExpandSidebar: () => void;
	onDelete: () => void;
	onRename: (name: string) => void;
}) {
	const [collapsedGroupId, setCollapsedGroupId] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [editValue, setEditValue] = useState("");
	const [hovered, setHovered] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const previousPaneIdsRef = useRef<string[] | null>(null);
	const [emergingPaneId, setEmergingPaneId] = useState<string | null>(null);
	const expanded = collapsedGroupId !== group.id;
	const paneGroups = group.panes.reduce(
		(groups, pane) => {
			const cwd = pane.cwd || "";
			const current = groups.find((item) => item.cwd === cwd);
			if (current) current.panes.push(pane);
			else groups.push({ cwd, panes: [pane] });
			return groups;
		},
		[] as Array<{ cwd: string; panes: AgentPaneModel[] }>,
	);

	useLayoutEffect(() => {
		const nextIds = group.panes.map((pane) => pane.id);
		const previousIds = previousPaneIdsRef.current;
		previousPaneIdsRef.current = nextIds;
		if (!previousIds) return;
		const lastPane = group.panes.at(-1);
		if (!lastPane || previousIds.includes(lastPane.id)) return;
		setEmergingPaneId(lastPane.id);
		const frame = requestAnimationFrame(() => setEmergingPaneId(null));
		return () => cancelAnimationFrame(frame);
	}, [group.panes]);

	const handleEditInputRef = useCallback((node: HTMLInputElement | null) => {
		inputRef.current = node;
		if (node) {
			node.focus();
			node.select();
		}
	}, []);

	const startEditing = (event: ReactMouseEvent) => {
		event.stopPropagation();
		setEditValue(group.name);
		setEditing(true);
	};

	const commitRename = () => {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== group.name) {
			onRename(trimmed);
		}
		setEditing(false);
	};

	const handleClick = () => {
		if (isActive) {
			// Already active — toggle expand/collapse
			setCollapsedGroupId((current) =>
				current === group.id ? null : group.id,
			);
		} else {
			// Select this workspace and expand
			onSelect();
			setCollapsedGroupId(null);
		}
	};

	const handleCollapsedClick = () => {
		onSelect();
		onExpandSidebar();
	};

	if (collapsed) {
		return (
			<div
				{...stylex.props(
					styles.collapsedWorkspace,
					isActive
						? styles.collapsedWorkspaceActive
						: styles.collapsedWorkspaceIdle,
				)}
				onMouseEnter={setHovered.bind(null, true)}
				onMouseLeave={setHovered.bind(null, false)}
			>
				<button
					type="button"
					onClick={handleCollapsedClick}
					{...stylex.props(styles.collapsedWorkspaceButton)}
					title={group.name}
				>
					<IconAgent
						size={iconSize.lg}
						className={stylex.props(styles.noShrink).className}
					/>
				</button>
				{group.panes.length > 0 && (
					<span {...stylex.props(styles.collapsedWorkspaceCount)}>
						{group.panes.length}
					</span>
				)}
				{canDelete && hovered && (
					<button
						type="button"
						onClick={stopPropagationAndCall.bind(null, onDelete)}
						{...stylex.props(styles.collapsedWorkspaceDelete)}
						title="Delete workspace"
					>
						<IconX size={iconSize.micro} />
					</button>
				)}
			</div>
		);
	}

	return (
		<div
			{...stylex.props(styles.workspaceWrap)}
			onMouseEnter={setHovered.bind(null, true)}
			onMouseLeave={setHovered.bind(null, false)}
		>
			<div
				role="treeitem"
				aria-selected={isActive}
				tabIndex={0}
				{...stylex.props(
					styles.workspaceHeader,
					isActive ? styles.workspaceHeaderActive : styles.workspaceHeaderIdle,
				)}
				onClick={handleClick}
				onKeyDown={activateOnEnterOrSpacePreventDefault.bind(null, handleClick)}
			>
				<div {...stylex.props(styles.workspaceNameWrap)}>
					{editing ? (
						<input
							ref={handleEditInputRef}
							value={editValue}
							onInput={setInputValue.bind(null, setEditValue)}
							onBlur={commitRename}
							onClick={stopPropagation}
							onKeyDown={(e) => {
								if (e.key === "Enter") commitRename();
								if (e.key === "Escape") setEditing(false);
							}}
							{...stylex.props(styles.workspaceInput)}
						/>
					) : (
						<div
							{...stylex.props(styles.workspaceNameRow)}
							title="Double-click to rename workspace"
							onDoubleClick={startEditing}
						>
							<IconPencil
								size={iconSize._2xs}
								{...stylex.props(styles.workspaceEditHint)}
							/>
							<div {...stylex.props(styles.workspaceName)}>{group.name}</div>
						</div>
					)}
				</div>
				<span {...stylex.props(styles.workspaceCount)}>
					{group.panes.length}
				</span>
				<IconChevronRight
					size={iconSize.sm}
					className={
						stylex.props(
							styles.workspaceChevron,
							expanded && styles.workspaceChevronExpanded,
						).className
					}
				/>
				{canDelete && hovered && !editing && (
					<button
						type="button"
						onClick={stopPropagationAndCall.bind(null, onDelete)}
						{...stylex.props(styles.workspaceDelete)}
						title="Delete workspace"
					>
						<IconX size={iconSize._2xs} />
					</button>
				)}
			</div>
			{/* Expanded pane list */}
			{expanded && group.panes.length > 0 && (
				<div {...stylex.props(styles.workspacePaneList)}>
					{paneGroups.map((repository) => (
						<div key={repository.cwd || "no-repository"}>
							<div {...stylex.props(styles.repositoryHeading)}>
								{repository.cwd.split("/").filter(Boolean).pop() ||
									"No repository"}
							</div>
							{repository.panes.map((pane) => (
								<div
									key={pane.id}
									{...stylex.props(
										styles.workspacePaneItem,
										pane.id === emergingPaneId &&
											styles.workspacePaneItemEmerging,
									)}
								>
									<PaneSummaryItem
										pane={pane}
										isActive={isActive && pane.id === selectedPaneId}
										onClick={onSelectPane.bind(null, pane.id)}
									/>
								</div>
							))}
						</div>
					))}
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
	onSelectWorkspace,
	onSelectPane,
	onExpandSidebar,
	onRemoveWorkspace,
	onRenameWorkspace,
}: {
	collapsed: boolean;
	workspaces: SidebarWorkspaceState;
	layoutMode: "grid" | "rows";
	onUpdateLayoutMode: (mode: "grid" | "rows") => void;
	onUpdateGrid: (patch: { columns?: number; rows?: number }) => void;
	onSelectWorkspace: (groupId: string) => void;
	onSelectPane: (groupId: string, paneId: string) => void;
	onExpandSidebar: () => void;
	onRemoveWorkspace: (groupId: string) => void;
	onRenameWorkspace: (groupId: string, name: string) => void;
}) {
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
	const [sectionMode, setSectionMode] = useState<"chats" | "explorer">(() =>
		readStoredValue("workspace-sidebar-mode") === "explorer"
			? "explorer"
			: "chats",
	);
	const [createMenuOpen, setCreateMenuOpen] = useState(false);
	const createMenuRef = useRef<HTMLDivElement | null>(null);
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
	const selectedCwd = selectedGroup?.panes.find(
		(pane) => pane.id === selectedGroup.selectedPaneId,
	)?.cwd;
	const projectCwds = Array.from(
		new Set(
			[
				selectedCwd,
				...(selectedGroup?.panes.map((pane) => pane.cwd) ?? []),
			].filter((cwd): cwd is string => !!cwd),
		),
	);
	const selectSectionMode = (mode: "chats" | "explorer") => {
		setSectionMode(mode);
		writeStoredValue("workspace-sidebar-mode", mode);
	};
	const create = (eventName: string) => {
		setCreateMenuOpen(false);
		window.dispatchEvent(new CustomEvent(eventName));
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
		<div
			className={`${APP_REGION_NO_DRAG_CLASS} ${workspaceSectionProps.className ?? ""}`}
		>
			{!collapsed ? (
				<>
					<div {...stylex.props(styles.sidebarTopRow)}>
						<FileSearch
							cwd={projectCwds[0]}
							placement="panel"
							onSelect={(file) =>
								dispatchDocumentOpen({
									cwd: file.cwd ?? projectCwds[0]!,
									path: file.path,
								})
							}
						/>
						<div ref={createMenuRef} {...stylex.props(styles.sidebarCreate)}>
							<LiquidCreateMenu
								open={createMenuOpen}
								fill={runtimeColor.backgroundRaised}
								triggerWidth={58}
								triggerHeight={26}
								triggerRadius={8}
								detachedTrigger
								onNewChat={() => create("create-agent-chat")}
								onNewWorkspace={() => create("create-agent-workspace")}
								trigger={
									<button
										type="button"
										onClick={() => setCreateMenuOpen((open) => !open)}
										{...stylex.props(styles.sidebarCreateButton)}
									>
										<span>New</span>
										<IconPlus size={iconSize.sm} />
									</button>
								}
							/>
						</div>
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
							Explorer
						</button>
					</div>
				</>
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
					{workspaces.groups.map((group) => (
						<WorkspaceItem
							key={group.id}
							group={{ ...group, selectedPaneId: group.selectedPaneId ?? null }}
							isActive={group.id === workspaces.selectedGroupId}
							canDelete={workspaces.groups.length > 1}
							collapsed={collapsed}
							selectedPaneId={group.selectedPaneId ?? null}
							onSelect={() => onSelectWorkspace(group.id)}
							onSelectPane={(paneId) => onSelectPane(group.id, paneId)}
							onExpandSidebar={onExpandSidebar}
							onDelete={() => onRemoveWorkspace(group.id)}
							onRename={(name) => onRenameWorkspace(group.id, name)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function SidebarFooter({
	collapsed,
	sidebarWidth,
	updateAvailable,
	updateInfo,
	updateStatus,
	onUpdate,
}: {
	collapsed: boolean;
	sidebarWidth: number;
	updateAvailable: boolean;
	updateInfo: AppInfo["update"];
	updateStatus: SidebarUpdateStatus;
	onUpdate: () => void;
}) {
	if (!updateAvailable) return null;
	return createPortal(
		<div
			className={`${APP_REGION_NO_DRAG_CLASS} ${
				stylex.props(styles.footer, collapsed && styles.footerCollapsed)
					.className ?? ""
			}`}
			style={{
				left: collapsed ? 17 : 61,
				width: collapsed ? 32 : Math.max(32, sidebarWidth - 16),
			}}
		>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				onClick={onUpdate}
				disabled={updateStatus === "updating"}
				title={
					collapsed
						? `Update Inferay to ${updateInfo.latestVersion}`
						: undefined
				}
				aria-label={
					collapsed
						? `Update Inferay to ${updateInfo.latestVersion}`
						: undefined
				}
				className={
					stylex.props(
						styles.updateButton,
						updateStatus === "updating" && styles.updateButtonBusy,
						collapsed && styles.updateButtonCollapsed,
					).className
				}
			>
				<IconRefreshCw size={iconSize.md} />
				{!collapsed ? (
					<span {...stylex.props(styles.updateLabel)}>
						{updateStatus === "updating"
							? "Updating…"
							: updateStatus === "error"
								? "Try update again"
								: `Update Inferay to ${updateInfo.latestVersion}`}
					</span>
				) : null}
			</Button>
		</div>,
		document.body,
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

	const selectWorkspace = useCallback(
		async (groupId: string) => {
			setWorkspaces((prev) =>
				prev.selectedGroupId === groupId
					? prev
					: { ...prev, selectedGroupId: groupId as never },
			);
			const next = await mutateAgentWorkspaceState(
				{ type: "selectWorkspace", groupId },
				"select-workspace",
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
		},
		[location.pathname, navigate],
	);

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
		},
		[location.pathname, navigate],
	);

	const addWorkspace = useCallback(async () => {
		const next = await mutateAgentWorkspaceState(
			{ type: "addWorkspace" },
			"add-workspace",
			{ createIfMissing: true },
		);
		if (next) {
			setWorkspaces({
				groups: next.groups,
				selectedGroupId: next.selectedGroupId,
				key: agentStateKey(next),
			});
		}
		navigate({ to: "/agent" });
	}, [navigate]);

	const addChat = useCallback(async () => {
		const pane = createAgentPane(
			loadDefaultChatSettings().agentKind,
			undefined,
			true,
		);
		await mutateAgentWorkspaceState({ type: "addPane", pane }, "add-pane", {
			createIfMissing: true,
		});
		navigate({ to: "/agent" });
	}, [navigate]);

	useEffect(() => {
		const stopChat = listenWindowEvent("create-agent-chat", () => {
			void addChat();
		});
		const stopWorkspace = listenWindowEvent("create-agent-workspace", () => {
			void addWorkspace();
		});
		return () => {
			stopChat();
			stopWorkspace();
		};
	}, [addChat, addWorkspace]);

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

	const removeWorkspace = useCallback(async (groupId: string) => {
		const next = await mutateAgentWorkspaceState(
			{ type: "removeWorkspace", groupId },
			"remove-workspace",
		);
		if (next) {
			setWorkspaces({
				groups: next.groups,
				selectedGroupId: next.selectedGroupId,
				key: agentStateKey(next),
			});
		}
	}, []);

	const renameWorkspace = useCallback(async (groupId: string, name: string) => {
		const next = await mutateAgentWorkspaceState(
			{ type: "renameWorkspace", groupId, name },
			"rename-workspace",
		);
		if (next) {
			setWorkspaces({
				groups: next.groups,
				selectedGroupId: next.selectedGroupId,
				key: agentStateKey(next),
			});
		}
	}, []);

	useEffect(() => {
		writeStoredValue("sidebar-collapsed", String(collapsed));
	}, [collapsed]);

	useEffect(
		() =>
			listenWindowEvent("toggle-main-sidebar", () =>
				dispatchUi({ type: "collapsed", value: !collapsed }),
			),
		[collapsed],
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
		<>
			<aside
				{...shellProps}
				className={`${APP_REGION_DRAG_CLASS} ${shellProps.className ?? ""}`}
				style={
					!showWorkspaceSidebar || collapsed
						? undefined
						: { width: sidebarWidth }
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
								onSelectWorkspace={selectWorkspace}
								onSelectPane={selectPane}
								onExpandSidebar={() =>
									dispatchUi({ type: "collapsed", value: false })
								}
								onRemoveWorkspace={removeWorkspace}
								onRenameWorkspace={renameWorkspace}
							/>
						</nav>
						<button
							type="button"
							onClick={() => navigate({ to: "/profile" })}
							{...stylex.props(styles.sidebarSettings)}
						>
							<IconSettings size={iconSize.md} />
							<span>Settings</span>
						</button>
					</>
				) : null}
			</aside>
			{showWorkspaceSidebar && !collapsed ? (
				<SidebarFooter
					collapsed={collapsed}
					sidebarWidth={sidebarWidth}
					updateAvailable={updateAvailable}
					updateInfo={updateInfo}
					updateStatus={updateStatus}
					onUpdate={openUpdate}
				/>
			) : null}
		</>
	);
}

const styles = stylex.create({
	iconDim: {
		opacity: 0.6,
	},
	noShrink: {
		flexShrink: 0,
	},
	paneSummary: {
		alignItems: "flex-start",
		borderWidth: 0,
		borderRadius: radius.md,
		display: "flex",
		gap: controlSize._2,
		marginBottom: "0.125rem",
		paddingBlock: "0.375rem",
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
		width: "100%",
	},
	paneSummaryIdle: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	paneSummarySelected: {
		backgroundColor: color.transparent,
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
	paneSummaryTitle: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		lineHeight: 1.2,
		margin: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	repositoryHeading: {
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
		letterSpacing: "0.06em",
	},
	sidebarModeTabs: {
		display: "grid",
		gridTemplateColumns: "1fr 1fr",
		gap: controlSize._1,
		margin: controlSize._2,
		padding: controlSize._1,
		borderRadius: radius.md,
		backgroundColor: color.surfaceWhite04,
	},
	sidebarTopRow: {
		position: "relative",
		zIndex: layer.searchPopover,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		paddingInline: controlSize._3,
		marginBottom: controlSize._1,
		boxSizing: "border-box",
		minWidth: controlSize._0,
		width: "100%",
	},
	sidebarCreate: { width: 58, height: 26, flexShrink: 0 },
	sidebarCreateButton: {
		display: "flex",
		width: 58,
		height: 26,
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.px7,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
	},
	sidebarModeTab: {
		height: controlSize._7,
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
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
	},
	collapsedWorkspace: {
		alignItems: "center",
		borderColor: color.transparent,
		borderRadius: radius.circle,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		height: controlSize._7,
		marginBlockEnd: controlSize._1,
		marginInline: "0.375rem",
		position: "relative",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		width: controlSize._8,
	},
	collapsedWorkspaceIdle: {
		backgroundColor: color.transparent,
		color: color.textSoft,
	},
	collapsedWorkspaceActive: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		color: color.textSoft,
	},
	collapsedWorkspaceButton: {
		alignItems: "center",
		backgroundColor: color.transparent,
		borderWidth: 0,
		borderRadius: radius.circle,
		color: "inherit",
		display: "flex",
		height: "100%",
		justifyContent: "flex-start",
		outline: "none",
		paddingInline: controlSize._2,
		width: "100%",
	},
	collapsedWorkspaceCount: {
		alignItems: "center",
		backgroundColor: color.accentWash,
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		bottom: -4,
		color: color.textSoft,
		display: "flex",
		fontSize: font.size_0_5,
		fontWeight: font.weight_5,
		justifyContent: "center",
		lineHeight: 1,
		minWidth: controlSize._3_5,
		paddingInline: "0.125rem",
		position: "absolute",
		right: -4,
	},
	collapsedWorkspaceDelete: {
		alignItems: "center",
		backgroundColor: color.accentWash,
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		height: controlSize._3_5,
		justifyContent: "center",
		position: "absolute",
		right: -4,
		top: -4,
		transitionDuration: motion.durationBase,
		width: controlSize._3_5,
	},
	workspaceWrap: {
		marginBottom: controlSize._1,
		marginInline: "0.375rem",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color",
		transitionTimingFunction: "ease",
	},
	workspaceHeader: {
		alignItems: "center",
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		cursor: "pointer",
		display: "flex",
		fontSize: font.size_2_75,
		fontWeight: font.weight_5,
		gap: controlSize._2,
		height: controlSize._8,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
	},
	workspaceHeaderIdle: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		color: color.textSoft,
	},
	workspaceHeaderActive: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		color: color.textSoft,
	},
	workspaceNameWrap: {
		flex: 1,
		minWidth: controlSize._0,
		textAlign: "left",
	},
	workspaceInput: {
		backgroundColor: color.transparent,
		borderWidth: 0,
		color: color.textMain,
		fontSize: font.size_2_75,
		outline: "none",
		width: "100%",
	},
	workspaceName: {
		flex: 1,
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	workspaceNameRow: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1,
		minWidth: controlSize._0,
	},
	workspaceEditHint: {
		color: color.textSoft,
		flexShrink: 0,
		opacity: 0.55,
	},
	workspaceCount: {
		color: color.textSoft,
		flexShrink: 0,
		fontSize: font.size_1,
		marginLeft: controlSize._1,
	},
	workspaceChevron: {
		flexShrink: 0,
		transitionDuration: motion.durationBase,
		transitionProperty: "transform",
		transitionTimingFunction: "ease",
	},
	workspaceChevronExpanded: {
		transform: "rotate(90deg)",
	},
	workspaceDelete: {
		borderRadius: radius.sm,
		color: color.textSoft,
		flexShrink: 0,
		marginLeft: controlSize._1,
		padding: "0.125rem",
	},
	workspacePaneList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		marginTop: "0.125rem",
		paddingBottom: controlSize._1,
	},
	workspacePaneItem: {
		display: "flex",
		width: "100%",
		transitionDuration: motion.durationBase,
		transitionProperty: "transform, opacity",
	},
	workspacePaneItemEmerging: {
		opacity: 0,
		transform: "translateY(-12px)",
	},
	shell: {
		backdropFilter:
			"var(--inferay-panel-backdrop, blur(var(--inferay-glass-blur, 4px)) saturate(104%))",
		backgroundColor: "var(--inferay-glass-surface)",
		borderColor: color.surfaceWhite13,
		borderRadius: radius.px17,
		borderStyle: "solid",
		borderWidth: 1,
		boxSizing: "border-box",
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.055), 0 24px 64px rgba(0,0,0,0.5)",
		display: "flex",
		flexDirection: "column",
		marginTop: controlSize._0,
		overflow: "visible",
		position: "relative",
		transitionDuration: motion.durationSlow,
		transitionProperty: "width",
		transitionTimingFunction: "ease",
		userSelect: "none",
	},
	shellCollapsed: {
		width: controlSize._12,
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
		margin: controlSize._2,
		paddingInline: controlSize._3,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
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
	footer: {
		alignItems: "center",
		bottom: controlSize._5,
		display: "flex",
		position: "fixed",
		zIndex: layer.navigationPopover,
	},
	footerCollapsed: {
		width: controlSize._8,
	},
	updateButton: {
		borderWidth: 0,
		width: "100%",
	},
	updateButtonCollapsed: {
		borderRadius: radius.circle,
		height: controlSize._8,
		paddingInline: controlSize._0,
		width: controlSize._8,
	},
	updateButtonBusy: {
		cursor: "wait",
		opacity: 0.75,
	},
	updateLabel: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
});
