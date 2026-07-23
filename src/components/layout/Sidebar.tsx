import * as stylex from "@stylexjs/stylex";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { deriveStoredSummary } from "../../features/chat/chat-session-store.ts";
import {
	compactTerminalState,
	createTerminalPane,
	dispatchTerminalShellChange,
	listenTerminalLayoutMode,
	loadCanonicalTerminalState,
	loadTerminalLayoutMode,
	loadTerminalState,
	mutateCanonicalTerminalState,
	mutateTerminalWorkspaceState,
	type TerminalPaneModel,
	type TerminalShellChangeDetail,
	terminalStateKey,
} from "../../features/terminal/terminal-utils.ts";
import { type AppInfo, useAppInfo } from "../../hooks/useAppInfo.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../lib/app-theme.ts";
import {
	DEFAULT_TERMINAL_MAIN_VIEW,
	isTerminalMainView,
} from "../../lib/app-navigation.tsx";
import { TERMINAL_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { noop } from "../../lib/data.ts";
import { fetchJsonOr, sendJson } from "../../lib/fetch-json.ts";
import {
	activateOnEnterOrSpacePreventDefault,
	listenWindowEvent,
	setInputValue,
	stopPropagation,
	stopPropagationAndCall,
} from "../../lib/react-events.ts";
import {
	readStoredBoolean,
	readStoredValue,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	effect,
	font,
	shadow,
} from "../../tokens.stylex.ts";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconChevronRight,
	IconLayoutGrid,
	IconLayoutRows,
	IconMessageCircle,
	IconPanelLeft,
	IconPencil,
	IconPlus,
	IconRefreshCw,
	IconTerminal,
	IconUser,
	IconX,
} from "../ui/Icons.tsx";

interface ForgeAccount {
	provider: "github";
	host: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	email: string | null;
	active: boolean;
}

interface SidebarWorkspaceGroup {
	id: string;
	name: string;
	panes: TerminalPaneModel[];
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

function sameForgeAccount(a: ForgeAccount | null, b: ForgeAccount | null) {
	return (
		a === b ||
		(!!a &&
			!!b &&
			a.provider === b.provider &&
			a.host === b.host &&
			a.login === b.login &&
			a.name === b.name &&
			a.avatarUrl === b.avatarUrl &&
			a.email === b.email &&
			a.active === b.active)
	);
}

async function loadGithubAccount(): Promise<ForgeAccount | null> {
	const payload = await fetchJsonOr<{ accounts?: ForgeAccount[] }>(
		"/api/forge/accounts",
		{}
	);
	const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
	return accounts.find((item) => item.active) ?? accounts[0] ?? null;
}

const DEFAULT_SIDEBAR_WIDTH = 292;
const MIN_SIDEBAR_WIDTH = 188;
const MAX_SIDEBAR_WIDTH = 340;

type UpdateStatus = "idle" | "updating" | "error";

interface SidebarUiState {
	collapsed: boolean;
	sidebarWidth: number;
	resizing: boolean;
	updateStatus: UpdateStatus;
}

type SidebarUiAction =
	| { type: "collapsed"; value: boolean }
	| { type: "sidebarWidth"; value: number }
	| { type: "resizing"; value: boolean }
	| { type: "updateStatus"; value: UpdateStatus };

function loadSidebarUiState(): SidebarUiState {
	const storedWidth = Number(readStoredValue("main-sidebar-width"));
	return {
		collapsed: readStoredBoolean("sidebar-collapsed"),
		sidebarWidth: Number.isFinite(storedWidth)
			? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, storedWidth))
			: DEFAULT_SIDEBAR_WIDTH,
		resizing: false,
		updateStatus: "idle",
	};
}

function sidebarUiReducer(
	state: SidebarUiState,
	action: SidebarUiAction
): SidebarUiState {
	switch (action.type) {
		case "collapsed":
			return state.collapsed === action.value
				? state
				: { ...state, collapsed: action.value };
		case "sidebarWidth":
			return state.sidebarWidth === action.value
				? state
				: { ...state, sidebarWidth: action.value };
		case "resizing":
			return state.resizing === action.value
				? state
				: { ...state, resizing: action.value };
		case "updateStatus":
			return state.updateStatus === action.value
				? state
				: { ...state, updateStatus: action.value };
	}
}

function deriveSummary(paneId: string): string | null {
	return deriveStoredSummary(paneId, undefined, () =>
		dispatchTerminalShellChange({
			source: "cache",
			reason: "session-title",
		})
	);
}

function PaneSummaryItem({
	pane,
	isActive,
	onClick,
}: {
	pane: TerminalPaneModel;
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
				isActive && styles.paneSummarySelected
			)}
		>
			<span {...stylex.props(styles.paneSummaryIcon)}>
				{isChat ? (
					getAgentIcon(
						pane.agentKind,
						12,
						stylex.props(styles.iconDim).className
					)
				) : (
					<IconTerminal
						size={12}
						className={stylex.props(styles.iconDim).className}
					/>
				)}
			</span>
			<div {...stylex.props(styles.paneSummaryText)}>
				<p {...stylex.props(styles.paneSummaryFolder)}>
					{pane.cwd?.split("/").filter(Boolean).pop() || "No folder"}
				</p>
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
		panes: TerminalPaneModel[];
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
	const inputRef = useRef<HTMLInputElement>(null);
	const expanded = collapsedGroupId !== group.id;

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
				current === group.id ? null : group.id
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
						: styles.collapsedWorkspaceIdle
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
					<IconTerminal
						size={14}
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
						<IconX size={7} />
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
					isActive ? styles.workspaceHeaderActive : styles.workspaceHeaderIdle
				)}
				onClick={handleClick}
				onKeyDown={activateOnEnterOrSpacePreventDefault.bind(null, handleClick)}
			>
				<div {...stylex.props(styles.workspaceNameWrap)}>
					{editing ? (
						<input
							ref={handleEditInputRef}
							value={editValue}
							onChange={setInputValue.bind(null, setEditValue)}
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
								size={9}
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
					size={10}
					className={
						stylex.props(
							styles.workspaceChevron,
							expanded && styles.workspaceChevronExpanded
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
						<IconX size={9} />
					</button>
				)}
			</div>
			{/* Expanded pane list */}
			{expanded && group.panes.length > 0 && (
				<div {...stylex.props(styles.workspacePaneList)}>
					{group.panes.map((pane) => (
						<PaneSummaryItem
							key={pane.id}
							pane={pane}
							isActive={isActive && pane.id === selectedPaneId}
							onClick={onSelectPane.bind(null, pane.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function SidebarProfileButton({
	collapsed,
	githubLabel,
	githubAccount,
}: {
	collapsed: boolean;
	githubLabel: string;
	githubAccount: ForgeAccount | null;
}) {
	const navigate = useNavigate();
	const profileButtonProps = stylex.props(
		styles.profileButton,
		collapsed ? styles.profileButtonCollapsed : styles.profileButtonOpen
	);

	return (
		<button
			type="button"
			onClick={() => navigate("/profile")}
			{...profileButtonProps}
			className={`${APP_REGION_NO_DRAG_CLASS} ${profileButtonProps.className ?? ""}`}
			title={collapsed ? githubLabel : undefined}
		>
			{!collapsed ? (
				<span {...stylex.props(styles.profileLabel)}>{githubLabel}</span>
			) : null}
			<SidebarAccountAvatar account={githubAccount} />
		</button>
	);
}

function SidebarWorkspacesSection({
	collapsed,
	workspaces,
	layoutMode,
	onAddWorkspace,
	onAddChat,
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
	onAddWorkspace: () => void;
	onAddChat: () => void;
	onUpdateLayoutMode: (mode: "grid" | "rows") => void;
	onUpdateGrid: (patch: { columns?: number; rows?: number }) => void;
	onSelectWorkspace: (groupId: string) => void;
	onSelectPane: (groupId: string, paneId: string) => void;
	onExpandSidebar: () => void;
	onRemoveWorkspace: (groupId: string) => void;
	onRenameWorkspace: (groupId: string, name: string) => void;
}) {
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
	const [createMenuOpen, setCreateMenuOpen] = useState(false);
	const [gridMenuOpen, setGridMenuOpen] = useState(false);
	const createMenuRef = useRef<HTMLSpanElement>(null);
	const selectedGroup =
		workspaces.groups.find(
			(group) => group.id === workspaces.selectedGroupId
		) ?? null;

	useEffect(() => {
		if (!createMenuOpen) return;
		const closeMenu = (event: MouseEvent) => {
			if (!createMenuRef.current?.contains(event.target as Node)) {
				setCreateMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", closeMenu);
		return () => document.removeEventListener("mousedown", closeMenu);
	}, [createMenuOpen]);

	const chooseCreateAction = (action: () => void) => {
		setCreateMenuOpen(false);
		action();
	};

	return (
		<div
			className={`${APP_REGION_NO_DRAG_CLASS} ${workspaceSectionProps.className ?? ""}`}
		>
			<div
				{...stylex.props(
					styles.workspaceSectionHeader,
					collapsed
						? styles.workspaceSectionHeaderCollapsed
						: styles.workspaceSectionHeaderOpen
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
							size={14}
							className={
								stylex.props(styles.noShrink, styles.flipHorizontal).className
							}
						/>
					</IconButton>
				) : (
					<>
						<div {...stylex.props(styles.workspaceLayoutControl)}>
							<span
								{...stylex.props(styles.workspaceGridWrap)}
								onMouseEnter={() => setGridMenuOpen(true)}
								onMouseLeave={() => setGridMenuOpen(false)}
							>
								<button
									type="button"
									onClick={() => onUpdateLayoutMode("grid")}
									{...stylex.props(
										styles.workspaceLayoutButton,
										layoutMode === "grid"
											? styles.workspaceLayoutButtonActive
											: styles.workspaceLayoutButtonIdle
									)}
									aria-label="Grid layout"
									aria-expanded={gridMenuOpen}
								>
									<IconLayoutGrid size={14} />
								</button>
								{gridMenuOpen && selectedGroup ? (
									<span {...stylex.props(styles.workspaceGridMenu)}>
										<span {...stylex.props(styles.workspaceGridMenuRow)}>
											<span {...stylex.props(styles.workspaceGridMenuLabel)}>
												Columns
											</span>
											<span {...stylex.props(styles.workspaceGridChoices)}>
												{GRID_DIMENSIONS.map((value) => (
													<button
														key={`columns-${value}`}
														type="button"
														onClick={() => {
															onUpdateLayoutMode("grid");
															onUpdateGrid({ columns: value });
														}}
														{...stylex.props(
															styles.workspaceGridChoice,
															selectedGroup.columns === value
																? styles.workspaceGridChoiceActive
																: null
														)}
													>
														{value}
													</button>
												))}
											</span>
										</span>
										<span {...stylex.props(styles.workspaceGridMenuRow)}>
											<span {...stylex.props(styles.workspaceGridMenuLabel)}>
												Rows
											</span>
											<span {...stylex.props(styles.workspaceGridChoices)}>
												{GRID_DIMENSIONS.map((value) => (
													<button
														key={`rows-${value}`}
														type="button"
														onClick={() => {
															onUpdateLayoutMode("grid");
															onUpdateGrid({ rows: value });
														}}
														{...stylex.props(
															styles.workspaceGridChoice,
															selectedGroup.rows === value
																? styles.workspaceGridChoiceActive
																: null
														)}
													>
														{value}
													</button>
												))}
											</span>
										</span>
									</span>
								) : null}
							</span>
							<button
								type="button"
								onClick={() => onUpdateLayoutMode("rows")}
								{...stylex.props(
									styles.workspaceLayoutButton,
									layoutMode === "rows"
										? styles.workspaceLayoutButtonActive
										: styles.workspaceLayoutButtonIdle
								)}
								aria-label="Row layout"
							>
								<IconLayoutRows size={14} />
							</button>
						</div>
						<span
							ref={createMenuRef}
							{...stylex.props(styles.workspaceCreateWrap)}
						>
							<button
								type="button"
								onClick={() => setCreateMenuOpen((open) => !open)}
								{...stylex.props(styles.workspaceNewButton)}
								title="Create"
								aria-label="Create"
								aria-expanded={createMenuOpen}
							>
								<IconPlus size={13} />
							</button>
							{createMenuOpen ? (
								<span {...stylex.props(styles.workspaceCreateMenu)}>
									<button
										type="button"
										onClick={() => chooseCreateAction(onAddChat)}
										{...stylex.props(styles.workspaceCreateItem)}
									>
										<IconMessageCircle size={12} />
										<span>New chat</span>
									</button>
									<button
										type="button"
										onClick={() => chooseCreateAction(onAddWorkspace)}
										{...stylex.props(styles.workspaceCreateItem)}
									>
										<IconPlus size={12} />
										<span>New workspace</span>
									</button>
								</span>
							) : null}
						</span>
					</>
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
	);
}

function SidebarFooter({
	collapsed,
	updateAvailable,
	updateInfo,
	updateStatus,
	githubLabel,
	githubAccount,
	onUpdate,
}: {
	collapsed: boolean;
	updateAvailable: boolean;
	updateInfo: AppInfo["update"];
	updateStatus: UpdateStatus;
	githubLabel: string;
	githubAccount: ForgeAccount | null;
	onUpdate: () => void;
}) {
	const footerProps = stylex.props(styles.footer);
	return (
		<div
			className={`${APP_REGION_NO_DRAG_CLASS} ${footerProps.className ?? ""}`}
		>
			{updateAvailable ? (
				<button
					type="button"
					onClick={onUpdate}
					disabled={updateStatus === "updating"}
					{...stylex.props(
						styles.updateButton,
						updateStatus === "updating" && styles.updateButtonBusy,
						collapsed ? styles.updateButtonCollapsed : styles.updateButtonOpen
					)}
					title={
						collapsed ? `Update to ${updateInfo.latestVersion}` : undefined
					}
				>
					<IconRefreshCw size={12} />
					{!collapsed ? (
						<span {...stylex.props(styles.updateLabel)}>
							{updateStatus === "updating"
								? "Updating..."
								: updateStatus === "error"
									? "Update failed"
									: `Update to ${updateInfo.latestVersion}`}
						</span>
					) : null}
				</button>
			) : null}
			<SidebarProfileButton
				collapsed={collapsed}
				githubLabel={githubLabel}
				githubAccount={githubAccount}
			/>
		</div>
	);
}

export function Sidebar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [uiState, dispatchUi] = useReducer(
		sidebarUiReducer,
		undefined,
		loadSidebarUiState
	);
	const { collapsed, sidebarWidth, resizing, updateStatus } = uiState;
	const [layoutMode, setLayoutMode] = useState(loadTerminalLayoutMode);
	const { data: githubAccount, refresh: refreshGithubAccount } =
		useAsyncResource(loadGithubAccount, null, { isEqual: sameForgeAccount });
	const { data: appInfo } = useAppInfo();
	const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const resizeWidthRef = useRef(sidebarWidth);
	const [mainView, setMainView] = useState(() => {
		const stored = readStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY);
		return isTerminalMainView(stored) ? stored : DEFAULT_TERMINAL_MAIN_VIEW;
	});
	const showWorkspaceSidebar =
		location.pathname === "/terminal" &&
		(mainView === "chat" || mainView === "editor");

	useEffect(
		() =>
			listenWindowEvent("terminal-shell-change", (event) => {
				const detail = (event as CustomEvent<TerminalShellChangeDetail>).detail;
				if (detail?.source !== "view" || detail.reason !== "main-view") return;
				const stored = readStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY);
				setMainView(
					isTerminalMainView(stored) ? stored : DEFAULT_TERMINAL_MAIN_VIEW
				);
			}),
		[]
	);

	// Workspace state
	const loadWorkspaces = useCallback(() => {
		const state = loadTerminalState();
		const cleanState = state
			? compactTerminalState(state, { keepSelectedDraft: true })
			: null;
		return {
			groups: cleanState?.groups ?? [],
			selectedGroupId:
				cleanState?.selectedGroupId ?? cleanState?.groups[0]?.id ?? null,
			key: cleanState ? terminalStateKey(cleanState) : "",
		};
	}, []);

	const [workspaces, setWorkspaces] = useState(loadWorkspaces);

	useEffect(() => listenTerminalLayoutMode(setLayoutMode), []);

	useEffect(() => {
		let cancelled = false;
		loadCanonicalTerminalState()
			.then(() => {
				if (!cancelled) {
					const next = loadWorkspaces();
					setWorkspaces((current) =>
						current.key === next.key ? current : next
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
			const detail = (event as CustomEvent<TerminalShellChangeDetail>).detail;
			if (detail?.reason === "session-title") {
				setWorkspaces((current) => ({ ...current }));
				return;
			}
			if (detail?.source === "view" && !detail.stateKey) return;
			const next = loadWorkspaces();
			setWorkspaces((current) => (current.key === next.key ? current : next));
		};
		return listenWindowEvent("terminal-shell-change", refresh);
	}, [loadWorkspaces]);

	const selectWorkspace = useCallback(
		async (groupId: string) => {
			setWorkspaces((prev) =>
				prev.selectedGroupId === groupId
					? prev
					: { ...prev, selectedGroupId: groupId as never }
			);
			const next = await mutateTerminalWorkspaceState(
				{ type: "selectWorkspace", groupId },
				"select-workspace"
			);
			if (next) {
				setWorkspaces({
					groups: next.groups,
					selectedGroupId: next.selectedGroupId,
					key: terminalStateKey(next),
				});
			}
			if (window.location.hash !== "#/terminal") {
				navigate("/terminal");
			}
		},
		[navigate]
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
			const next = await mutateTerminalWorkspaceState(
				{ type: "selectPane", groupId, paneId },
				"select-pane"
			);
			if (next) {
				setWorkspaces({
					groups: next.groups,
					selectedGroupId: next.selectedGroupId,
					key: terminalStateKey(next),
				});
			}
			if (window.location.hash !== "#/terminal") {
				navigate("/terminal");
			}
		},
		[navigate]
	);

	const addWorkspace = useCallback(async () => {
		const next = await mutateTerminalWorkspaceState(
			{ type: "addWorkspace" },
			"add-workspace",
			{ createIfMissing: true }
		);
		if (next) {
			setWorkspaces({
				groups: next.groups,
				selectedGroupId: next.selectedGroupId,
				key: terminalStateKey(next),
			});
		}
		navigate("/terminal");
	}, [navigate]);

	const addChat = useCallback(async () => {
		const pane = createTerminalPane(
			loadDefaultChatSettings().agentKind,
			undefined,
			true
		);
		await mutateTerminalWorkspaceState({ type: "addPane", pane }, "add-pane", {
			createIfMissing: true,
		});
		navigate("/terminal");
	}, [navigate]);

	const updateLayoutMode = useCallback(
		(mode: "grid" | "rows") => {
			if (mode === layoutMode) return;
			writeStoredValue("terminal-layout-mode", mode);
			setLayoutMode(mode);
			dispatchTerminalShellChange({ source: "view", reason: "layout-mode" });
		},
		[layoutMode]
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
			await mutateCanonicalTerminalState((terminalState) => {
				if (!terminalState.selectedGroupId) return null;
				let changed = false;
				const groups = terminalState.groups.map((group) => {
					if (group.id !== terminalState.selectedGroupId) return group;
					const columns = patch.columns ?? group.columns;
					const rows = patch.rows ?? group.rows;
					if (columns === group.columns && rows === group.rows) return group;
					changed = true;
					return { ...group, columns, rows };
				});
				return changed ? { ...terminalState, groups } : null;
			}, "grid-size");
		},
		[]
	);

	const removeWorkspace = useCallback(async (groupId: string) => {
		const next = await mutateTerminalWorkspaceState(
			{ type: "removeWorkspace", groupId },
			"remove-workspace"
		);
		if (next) {
			setWorkspaces({
				groups: next.groups,
				selectedGroupId: next.selectedGroupId,
				key: terminalStateKey(next),
			});
		}
	}, []);

	const renameWorkspace = useCallback(async (groupId: string, name: string) => {
		const next = await mutateTerminalWorkspaceState(
			{ type: "renameWorkspace", groupId, name },
			"rename-workspace"
		);
		if (next) {
			setWorkspaces({
				groups: next.groups,
				selectedGroupId: next.selectedGroupId,
				key: terminalStateKey(next),
			});
		}
	}, []);

	useEffect(() => {
		writeStoredValue("sidebar-collapsed", String(collapsed));
	}, [collapsed]);

	useEffect(
		() =>
			listenWindowEvent("toggle-main-sidebar", () =>
				dispatchUi({ type: "collapsed", value: !collapsed })
			),
		[collapsed]
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
					Math.max(MIN_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta)
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
		[collapsed, sidebarWidth]
	);

	useEffect(
		() => listenWindowEvent("focus", () => void refreshGithubAccount()),
		[refreshGithubAccount]
	);

	const githubLabel = githubAccount?.login || githubAccount?.name || "Profile";
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
		resizing && styles.shellResizing
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
				<nav {...stylex.props(styles.nav)}>
					<SidebarWorkspacesSection
						collapsed={collapsed}
						workspaces={workspaces}
						layoutMode={layoutMode}
						onAddWorkspace={addWorkspace}
						onAddChat={addChat}
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
			) : null}
			<SidebarFooter
				collapsed={false}
				updateAvailable={updateAvailable}
				updateInfo={updateInfo}
				updateStatus={updateStatus}
				githubLabel={githubLabel}
				githubAccount={githubAccount}
				onUpdate={openUpdate}
			/>
		</aside>
	);
}

function SidebarAccountAvatar({ account }: { account: ForgeAccount | null }) {
	if (account?.avatarUrl) {
		return (
			<img
				src={account.avatarUrl}
				alt=""
				{...stylex.props(styles.accountAvatar)}
			/>
		);
	}

	return (
		<span {...stylex.props(styles.accountFallback)}>
			{account?.login ? account.login.slice(0, 2) : <IconUser size={10} />}
		</span>
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
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "transparent",
		borderRadius: 6,
		display: "flex",
		gap: controlSize._2,
		marginBottom: "0.125rem",
		paddingBlock: "0.375rem",
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
		width: "100%",
	},
	paneSummaryIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.accentWash,
		},
		borderColor: {
			default: "transparent",
			":hover": color.border,
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	paneSummarySelected: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		color: color.textMain,
	},
	paneSummaryIcon: {
		flexShrink: 0,
		marginTop: "0.125rem",
	},
	paneSummaryText: {
		flex: 1,
		minWidth: 0,
	},
	paneSummaryFolder: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		lineHeight: 1.15,
		margin: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	paneSummaryTitle: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		lineHeight: 1.2,
		margin: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	collapsedWorkspace: {
		alignItems: "center",
		borderColor: "transparent",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		height: controlSize._7,
		marginBlockEnd: controlSize._1,
		marginInline: "0.375rem",
		position: "relative",
		transitionDuration: "150ms",
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		width: controlSize._8,
	},
	collapsedWorkspaceIdle: {
		backgroundColor: "transparent",
		color: color.textSoft,
	},
	collapsedWorkspaceActive: {
		backgroundColor: "transparent",
		borderColor: "transparent",
		color: color.textSoft,
	},
	collapsedWorkspaceButton: {
		alignItems: "center",
		backgroundColor: "transparent",
		borderWidth: 0,
		borderRadius: 8,
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
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		bottom: -4,
		color: color.textSoft,
		display: "flex",
		fontSize: "0.5rem",
		fontWeight: font.weight_5,
		justifyContent: "center",
		lineHeight: 1,
		minWidth: 14,
		paddingInline: "0.125rem",
		position: "absolute",
		right: -4,
	},
	collapsedWorkspaceDelete: {
		alignItems: "center",
		backgroundColor: color.accentWash,
		borderColor: color.border,
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		height: 14,
		justifyContent: "center",
		position: "absolute",
		right: -4,
		top: -4,
		transitionDuration: "150ms",
		width: 14,
	},
	workspaceWrap: {
		marginBottom: controlSize._1,
		marginInline: "0.375rem",
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color",
		transitionTimingFunction: "ease",
	},
	workspaceHeader: {
		alignItems: "center",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		cursor: "pointer",
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: controlSize._2,
		height: controlSize._8,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
	},
	workspaceHeaderIdle: {
		backgroundColor: "transparent",
		borderColor: "transparent",
		color: color.textSoft,
	},
	workspaceHeaderActive: {
		backgroundColor: "transparent",
		borderColor: "transparent",
		color: color.textSoft,
	},
	workspaceNameWrap: {
		flex: 1,
		minWidth: 0,
		textAlign: "left",
	},
	workspaceInput: {
		backgroundColor: "transparent",
		borderWidth: 0,
		color: color.textMain,
		fontSize: "0.6875rem",
		outline: "none",
		width: "100%",
	},
	workspaceName: {
		flex: 1,
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	workspaceNameRow: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1,
		minWidth: 0,
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
		transitionDuration: "150ms",
		transitionProperty: "transform",
		transitionTimingFunction: "ease",
	},
	workspaceChevronExpanded: {
		transform: "rotate(90deg)",
	},
	workspaceDelete: {
		borderRadius: 4,
		color: color.textSoft,
		flexShrink: 0,
		marginLeft: controlSize._1,
		padding: "0.125rem",
	},
	workspacePaneList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		marginTop: "0.125rem",
		paddingBottom: controlSize._1,
	},
	shell: {
		backgroundColor: color.background,
		borderColor: "rgba(255,255,255,0.13)",
		borderRadius: 17,
		borderTopLeftRadius: 0,
		borderBottomLeftRadius: 0,
		borderLeftColor: "transparent",
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.055), 0 24px 64px rgba(0,0,0,0.5)",
		display: "flex",
		flexDirection: "column",
		marginTop: 0,
		overflow: "visible",
		position: "relative",
		transitionDuration: "200ms",
		transitionProperty: "width",
		transitionTimingFunction: "ease",
		userSelect: "none",
	},
	shellCollapsed: {
		width: controlSize._12,
	},
	shellHidden: {
		backgroundColor: "transparent",
		borderColor: "transparent",
		boxShadow: "none",
		width: 0,
	},
	shellOpen: {
		width: 192,
	},
	shellResizing: {
		transitionDuration: "0ms",
		transitionProperty: "none",
		userSelect: "none",
	},
	resizeHandle: {
		position: "absolute",
		top: 0,
		right: -2,
		bottom: 0,
		zIndex: 30,
		width: controlSize._1,
		borderWidth: 0,
		cursor: "ew-resize",
		padding: 0,
		backgroundColor: {
			default: "transparent",
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: "120ms",
	},
	nav: {
		flex: 1,
		overflowY: "auto",
		paddingBlock: 0,
	},
	workspaceSection: {
		marginTop: 0,
		paddingTop: controlSize._2,
	},
	workspaceSectionHeader: {
		position: "relative",
		zIndex: 50,
		alignItems: "center",
		display: "flex",
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
		height: controlSize._8,
		width: controlSize._8,
	},
	workspaceLayoutControl: {
		position: "relative",
		display: "inline-flex",
		height: controlSize._7,
		alignItems: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 8,
		backgroundColor: color.backgroundRaised,
		overflow: "visible",
	},
	workspaceGridWrap: {
		position: "relative",
		display: "inline-flex",
		height: "100%",
	},
	workspaceLayoutButton: {
		display: "inline-flex",
		height: "100%",
		width: controlSize._7,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 7,
	},
	workspaceLayoutButtonIdle: {
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
	},
	workspaceLayoutButtonActive: {
		color: color.textMain,
		backgroundColor: color.backgroundRaised,
	},
	workspaceGridMenu: {
		position: "absolute",
		top: "calc(100% + 4px)",
		left: 0,
		zIndex: 100,
		display: "flex",
		width: 188,
		flexDirection: "column",
		gap: controlSize._2,
		transform: "none",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 8,
		backgroundColor: color.backgroundRaised,
		boxShadow: shadow.popover,
		padding: controlSize._2,
		"::before": {
			content: "",
			position: "absolute",
			left: 0,
			right: 0,
			top: -5,
			height: 5,
		},
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
	workspaceGridChoices: {
		display: "flex",
		gap: controlSize._0_5,
	},
	workspaceGridChoice: {
		display: "inline-flex",
		height: controlSize._6,
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 6,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		fontSize: font.size_1,
	},
	workspaceGridChoiceActive: {
		color: color.textMain,
		backgroundColor: color.backgroundRaised,
	},
	workspaceCreateWrap: {
		position: "relative",
		display: "inline-flex",
	},
	workspaceNewButton: {
		display: "inline-flex",
		height: controlSize._7,
		width: controlSize._7,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 8,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		padding: 0,
	},
	workspaceCreateMenu: {
		position: "absolute",
		top: "calc(100% + 4px)",
		right: 0,
		zIndex: 100,
		display: "flex",
		width: 152,
		flexDirection: "column",
		gap: controlSize._0_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 8,
		backgroundColor: color.backgroundRaised,
		boxShadow: shadow.popover,
		padding: controlSize._1,
	},
	workspaceCreateItem: {
		display: "flex",
		height: controlSize._7,
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		borderRadius: 6,
		paddingInline: controlSize._2,
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		textAlign: "left",
	},
	flipHorizontal: {
		transform: "scaleX(-1)",
	},
	footer: {
		position: "fixed",
		top: 6,
		right: 12,
		zIndex: 140,
		alignItems: "center",
		backgroundColor: "transparent",
		borderWidth: 0,
		display: "flex",
		flexDirection: "row",
		gap: controlSize._1,
		marginLeft: 0,
		padding: 0,
		width: "auto",
	},
	updateButton: {
		alignItems: "center",
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.controlDepth,
		color: color.textMain,
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_6,
		gap: controlSize._1,
		justifyContent: "center",
		padding: 0,
		transitionDuration: "150ms",
		transitionProperty: "background-color, box-shadow, color",
		transitionTimingFunction: "ease",
	},
	updateButtonBusy: {
		cursor: "wait",
		opacity: 0.75,
	},
	updateButtonOpen: {
		height: 30,
		paddingInline: "0.375rem",
		width: "auto",
	},
	updateButtonCollapsed: {
		height: controlSize._7,
		width: controlSize._9,
	},
	updateLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	profileButton: {
		alignItems: "center",
		appearance: "none",
		backgroundColor: "transparent",
		borderColor: "transparent",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		cursor: "pointer",
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: controlSize._1,
		textAlign: "left",
	},
	profileButtonOpen: {
		height: 30,
		paddingInline: "0.375rem",
		width: "auto",
	},
	profileButtonCollapsed: {
		height: controlSize._7,
		marginInline: 0,
		paddingInline: controlSize._1_5,
		width: controlSize._9,
	},
	profileLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	accountAvatar: {
		borderColor: color.border,
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		flexShrink: 0,
		height: controlSize._5,
		objectFit: "cover",
		width: controlSize._5,
	},
	accountFallback: {
		alignItems: "center",
		backgroundColor: color.controlActive,
		borderColor: color.border,
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_2,
		fontWeight: "600",
		height: controlSize._5,
		justifyContent: "center",
		textTransform: "uppercase",
		width: controlSize._5,
	},
});
