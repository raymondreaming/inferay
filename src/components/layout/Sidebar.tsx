import * as stylex from "@stylexjs/stylex";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import { isChatAgentKind } from "../../features/agents/agents.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import { SIDEBAR_NAV_ROUTES } from "../../lib/app-navigation.tsx";
import { loadAppThemeId } from "../../lib/app-theme.ts";
import {
	hasId,
	hasRole,
	lacksId,
	noop,
	toggleBoolean,
} from "../../lib/data.ts";
import { fetchJsonOr, postJson } from "../../lib/fetch-json.ts";
import {
	listenWindowEvent,
	setInputValue,
	stopPropagation,
	stopPropagationAndCall,
} from "../../lib/react-events.ts";
import { resolveServerUrl } from "../../lib/server-origin.ts";
import {
	readStoredBoolean,
	readStoredValue,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import {
	createGroupId,
	createPendingAgentChatPane,
	DEFAULT_COLUMNS,
	DEFAULT_ROWS,
	loadTerminalState,
	saveTerminalState,
	type TerminalPaneModel,
} from "../../features/terminal/terminal-utils.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import {
	loadStoredMessages,
	loadStoredSummary,
	saveStoredSummary,
} from "../../features/chat/chat-session-store.ts";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconChevronRight,
	IconPencil,
	IconPlus,
	IconSettings,
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

async function loadGithubAccount(): Promise<ForgeAccount | null> {
	const payload = await fetchJsonOr<{ accounts?: ForgeAccount[] }>(
		"/api/forge/accounts",
		{}
	);
	const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
	return accounts.find((item) => item.active) ?? accounts[0] ?? null;
}

const logoUrl = resolveServerUrl("/logo.png");
const DEFAULT_SIDEBAR_WIDTH = 192;
const MIN_SIDEBAR_WIDTH = 152;
const MAX_SIDEBAR_WIDTH = 340;

// Track which panes have a pending title request to avoid duplicates
const pendingTitleRequests = new Set<string>();

function getPaneBaseFolder(pane: TerminalPaneModel): string {
	return pane.cwd?.split("/").filter(Boolean).pop() || "No folder";
}

function loadSidebarWidth() {
	const stored = Number(readStoredValue("main-sidebar-width"));
	return Number.isFinite(stored)
		? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
		: DEFAULT_SIDEBAR_WIDTH;
}

function deriveSummary(paneId: string): string | null {
	const existing = loadStoredSummary(paneId);
	if (existing) return existing;
	// Try to derive from stored messages
	const messages = loadStoredMessages<{ role: string; content: string }>(
		paneId
	);
	const firstUser = messages.find(hasRole.bind(null, "user"));
	if (!firstUser?.content) return null;
	// Fire off AI title generation in background
	if (!pendingTitleRequests.has(paneId)) {
		pendingTitleRequests.add(paneId);
		postJson<{ title?: string }>("/api/generate-title", {
			message: firstUser.content,
		})
			.then((data) => {
				const title = data?.title?.trim();
				if (title) {
					saveStoredSummary(paneId, title);
					window.dispatchEvent(new Event("terminal-shell-change"));
				}
			})
			.catch(noop)
			.finally(() => pendingTitleRequests.delete(paneId));
	}
	// Return a temporary placeholder from the first line while AI generates
	const text = firstUser.content.trim().split("\n")[0] ?? "";
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
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
	const folderLabel = getPaneBaseFolder(pane);
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
					getAgentIcon(pane.agentKind, 12, "opacity-60")
				) : (
					<IconTerminal size={12} className="opacity-60" />
				)}
			</span>
			<div {...stylex.props(styles.paneSummaryText)}>
				<p {...stylex.props(styles.paneSummaryFolder)}>{folderLabel}</p>
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
	const [expanded, setExpanded] = useState(true);
	const [editing, setEditing] = useState(false);
	const [editValue, setEditValue] = useState(group.name);
	const [hovered, setHovered] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Auto-expand when workspace becomes active
	useEffect(() => {
		if (isActive) setExpanded(true);
	}, [isActive]);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

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
			setExpanded(toggleBoolean);
		} else {
			// Select this workspace and expand
			onSelect();
			setExpanded(true);
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
					<IconTerminal size={14} className="shrink-0" />
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
				{...stylex.props(
					styles.workspaceHeader,
					isActive ? styles.workspaceHeaderActive : styles.workspaceHeaderIdle
				)}
				onClick={handleClick}
			>
				<div {...stylex.props(styles.workspaceNameWrap)}>
					{editing ? (
						<input
							ref={inputRef}
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
							onDoubleClick={(e) => {
								e.stopPropagation();
								setEditValue(group.name);
								setEditing(true);
							}}
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
					className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
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

export function Sidebar() {
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(() => {
		return readStoredBoolean("sidebar-collapsed");
	});
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
	const [resizing, setResizing] = useState(false);
	const { data: githubAccount, refresh: refreshGithubAccount } =
		useAsyncResource(loadGithubAccount, null, []);
	const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const resizeWidthRef = useRef(sidebarWidth);

	const isDefault = loadAppThemeId() === "default";
	const logoImageStyle = useMemo(
		() => ({
			filter: "saturate(0.94) contrast(1.04) brightness(0.99)",
			opacity: isDefault ? 1 : 0.7,
		}),
		[isDefault]
	);

	// Workspace state
	const loadWorkspaces = useCallback(() => {
		const state = loadTerminalState();
		return {
			groups: state?.groups ?? [],
			selectedGroupId: state?.selectedGroupId ?? state?.groups[0]?.id ?? null,
		};
	}, []);

	const [workspaces, setWorkspaces] = useState(loadWorkspaces);

	useEffect(() => {
		const refresh = () => setWorkspaces(loadWorkspaces());
		return listenWindowEvent("terminal-shell-change", refresh);
	}, [loadWorkspaces]);

	const selectWorkspace = useCallback(
		(groupId: string) => {
			// Optimistic update — render immediately, then persist
			setWorkspaces((prev) => ({ ...prev, selectedGroupId: groupId as never }));
			const state = loadTerminalState();
			if (!state) return;
			saveTerminalState({ ...state, selectedGroupId: groupId as never });
			window.dispatchEvent(new Event("terminal-shell-change"));
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
			saveTerminalState({
				...state,
				selectedGroupId: gid,
				groups: state.groups.map((g) =>
					g.id === groupId ? { ...g, selectedPaneId: pid } : g
				),
			});
			setWorkspaces(loadWorkspaces);
			// When on editor view, also update the editor's selected pane
			writeStoredValue("editor-selected-pane", paneId);
			window.dispatchEvent(new Event("terminal-shell-change"));
			if (window.location.hash !== "#/terminal") {
				navigate("/terminal");
			}
		},
		[navigate, loadWorkspaces]
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
		saveTerminalState({
			...state,
			groups: [...state.groups, group],
			selectedGroupId: group.id,
		});
		window.dispatchEvent(new Event("terminal-shell-change"));
		navigate("/terminal");
	}, [navigate]);

	const removeWorkspace = useCallback((groupId: string) => {
		const state = loadTerminalState();
		if (!state) return;
		if (state.groups.length <= 1) return;
		const filtered = state.groups.filter(lacksId.bind(null, groupId));
		const newSelected =
			state.selectedGroupId === groupId
				? (filtered[0]?.id ?? null)
				: state.selectedGroupId;
		saveTerminalState({
			...state,
			groups: filtered,
			selectedGroupId: newSelected,
		});
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

	const renameWorkspace = useCallback((groupId: string, name: string) => {
		const state = loadTerminalState();
		if (!state) return;
		saveTerminalState({
			...state,
			groups: state.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
		});
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

	useEffect(() => {
		writeStoredValue("sidebar-collapsed", String(collapsed));
	}, [collapsed]);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			if (collapsed) return;
			event.preventDefault();
			setResizing(true);
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
				setSidebarWidth(nextWidth);
			};
			const handleUp = () => {
				resizeRef.current = null;
				setResizing(false);
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
	const shellProps = stylex.props(
		styles.shell,
		collapsed ? styles.shellCollapsed : styles.shellOpen,
		resizing && styles.shellResizing
	);
	const logoBarProps = stylex.props(styles.logoBar);
	const logoButtonProps = stylex.props(styles.logoButton);
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
	const footerProps = stylex.props(styles.footer);
	const resizeHandleProps = stylex.props(styles.resizeHandle);

	return (
		<aside
			{...shellProps}
			className={`electrobun-webkit-app-region-drag ${shellProps.className ?? ""}`}
			style={collapsed ? undefined : { width: sidebarWidth }}
		>
			{!collapsed && (
				<div
					{...resizeHandleProps}
					className={`electrobun-webkit-app-region-no-drag ${resizeHandleProps.className ?? ""}`}
					onMouseDown={handleResizeStart}
				/>
			)}
			<div
				className={`electrobun-webkit-app-region-drag ${logoBarProps.className ?? ""}`}
			>
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					{...logoButtonProps}
					className={`electrobun-webkit-app-region-no-drag ${logoButtonProps.className ?? ""}`}
				>
					<span {...stylex.props(styles.logoFrame)}>
						<img
							src={logoUrl}
							alt=""
							{...stylex.props(styles.logo)}
							style={logoImageStyle}
						/>
					</span>
				</button>
			</div>
			<nav {...stylex.props(styles.nav)}>
				{SIDEBAR_NAV_ROUTES.map((item) => {
					const Icon = item.icon;
					return (
						<NavLink
							key={item.path}
							to={item.path}
							className={({ isActive }) =>
								`electrobun-webkit-app-region-no-drag ${
									stylex.props(
										styles.navItem,
										isActive ? styles.navItemActive : styles.navItemIdle,
										collapsed ? styles.navItemCollapsed : styles.navItemOpen
									).className ?? ""
								}`
							}
							title={collapsed ? item.label : undefined}
						>
							<Icon size={14} className="shrink-0" />
							{!collapsed && <span>{item.label}</span>}
						</NavLink>
					);
				})}

				{/* Workspaces section */}
				<div
					className={`electrobun-webkit-app-region-no-drag ${workspaceSectionProps.className ?? ""}`}
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
								onClick={addWorkspace}
								variant="ghost"
								size="md"
								className="h-8 w-8"
								title="Add workspace"
							>
								<IconPlus size={14} className="shrink-0" />
							</IconButton>
						) : (
							<>
								<span {...stylex.props(styles.workspaceSectionLabel)}>
									Workspaces
								</span>
								<IconButton
									type="button"
									onClick={addWorkspace}
									variant="ghost"
									size="xs"
									title="New workspace"
								>
									<IconPlus size={12} />
								</IconButton>
							</>
						)}
					</div>
					{workspaces.groups.map((group) => (
						<WorkspaceItem
							key={group.id}
							group={group}
							isActive={group.id === workspaces.selectedGroupId}
							canDelete={workspaces.groups.length > 1}
							collapsed={collapsed}
							selectedPaneId={group.selectedPaneId ?? null}
							onSelect={() => selectWorkspace(group.id)}
							onSelectPane={(paneId) => selectPane(group.id, paneId)}
							onExpandSidebar={() => setCollapsed(false)}
							onDelete={() => removeWorkspace(group.id)}
							onRename={(name) => renameWorkspace(group.id, name)}
						/>
					))}
				</div>
			</nav>
			<div
				className={`electrobun-webkit-app-region-no-drag ${footerProps.className ?? ""}`}
			>
				<button
					type="button"
					onClick={() =>
						window.dispatchEvent(new Event("terminal-open-theme-panel"))
					}
					{...stylex.props(
						styles.footerButton,
						styles.footerButtonIdle,
						collapsed ? styles.footerButtonCollapsed : styles.footerButtonOpen
					)}
					title={collapsed ? "Settings" : undefined}
				>
					<IconSettings size={14} className="shrink-0" />
					{!collapsed ? <span>Settings</span> : null}
				</button>
				<NavLink
					to="/profile"
					className={
						stylex.props(
							styles.profileButton,
							collapsed
								? styles.profileButtonCollapsed
								: styles.profileButtonOpen
						).className ?? ""
					}
					title={collapsed ? githubLabel : undefined}
				>
					<SidebarAccountAvatar account={githubAccount} />
					{!collapsed ? (
						<span {...stylex.props(styles.profileLabel)}>{githubLabel}</span>
					) : null}
				</NavLink>
			</div>
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
		backgroundColor: color.accentWash,
		borderColor: color.accentBorder,
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
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		position: "relative",
		transitionDuration: "200ms",
		transitionProperty: "width",
		transitionTimingFunction: "ease",
		userSelect: "none",
	},
	shellCollapsed: {
		width: controlSize._12,
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
		cursor: "ew-resize",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: "120ms",
	},
	logoBar: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		height: controlSize._12,
		paddingInline: controlSize._3,
	},
	logoButton: {
		alignItems: "center",
		borderRadius: 6,
		display: "flex",
		flexShrink: 0,
		height: controlSize._7,
		justifyContent: "center",
		width: controlSize._7,
	},
	logoFrame: {
		alignItems: "center",
		borderRadius: 6,
		display: "flex",
		height: controlSize._7,
		justifyContent: "center",
		overflow: "hidden",
		position: "relative",
		width: controlSize._7,
	},
	logo: {
		borderRadius: 6,
		height: controlSize._7,
		objectFit: "cover",
		width: controlSize._7,
	},
	nav: {
		flex: 1,
		overflowY: "auto",
		paddingBlock: "0.375rem",
	},
	navItem: {
		alignItems: "center",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: controlSize._2,
		marginBlockEnd: controlSize._1,
		marginInline: "0.375rem",
		paddingInline: controlSize._2,
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
	},
	navItemOpen: {
		height: controlSize._7,
	},
	navItemCollapsed: {
		height: controlSize._7,
		marginInline: "0.375rem",
		paddingInline: controlSize._2,
		width: controlSize._8,
	},
	navItemIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
		borderColor: "transparent",
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	navItemActive: {
		backgroundColor: color.controlActive,
		borderColor: color.border,
		color: color.textMain,
	},
	workspaceSection: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		marginTop: controlSize._2,
		paddingTop: controlSize._2,
	},
	workspaceSectionHeader: {
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
		paddingInline: controlSize._2,
	},
	workspaceSectionLabel: {
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		letterSpacing: 0,
		textTransform: "uppercase",
	},
	footer: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		padding: "0.375rem",
	},
	footerButton: {
		alignItems: "center",
		borderColor: "transparent",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: controlSize._2,
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
	},
	footerButtonOpen: {
		height: controlSize._7,
		paddingInline: controlSize._2,
		width: "100%",
	},
	footerButtonCollapsed: {
		height: controlSize._7,
		marginInline: 0,
		paddingInline: controlSize._2,
		width: controlSize._8,
	},
	footerButtonIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	profileButton: {
		alignItems: "center",
		borderColor: "transparent",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: controlSize._1,
	},
	profileButtonOpen: {
		height: controlSize._7,
		paddingInline: "0.375rem",
		width: "100%",
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
