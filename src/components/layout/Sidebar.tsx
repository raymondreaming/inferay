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
import { isChatAgentKind } from "../../features/agents/agents.ts";
import { deriveStoredSummary } from "../../features/chat/chat-session-store.ts";
import {
	compactTerminalState,
	dispatchTerminalShellChange,
	loadCanonicalTerminalState,
	loadTerminalState,
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
	loadAppThemeId,
} from "../../lib/app-theme.ts";
import { noop } from "../../lib/data.ts";
import {
	fetchJsonOr,
	resolveServerUrl,
	sendJson,
} from "../../lib/fetch-json.ts";
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
}

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

const logoUrl = resolveServerUrl("/logo.png");
const DEFAULT_SIDEBAR_WIDTH = 192;
const MIN_SIDEBAR_WIDTH = 152;
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
	const isProfileActive = useLocation().pathname === "/profile";
	const profileButtonProps = stylex.props(
		styles.profileButton,
		isProfileActive ? styles.profileButtonActive : styles.profileButtonIdle,
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
			<SidebarAccountAvatar account={githubAccount} />
			{!collapsed ? (
				<span {...stylex.props(styles.profileLabel)}>{githubLabel}</span>
			) : null}
		</button>
	);
}

function SidebarWorkspacesSection({
	collapsed,
	workspaces,
	onAddWorkspace,
	onSelectWorkspace,
	onSelectPane,
	onExpandSidebar,
	onRemoveWorkspace,
	onRenameWorkspace,
}: {
	collapsed: boolean;
	workspaces: SidebarWorkspaceState;
	onAddWorkspace: () => void;
	onSelectWorkspace: (groupId: string) => void;
	onSelectPane: (groupId: string, paneId: string) => void;
	onExpandSidebar: () => void;
	onRemoveWorkspace: (groupId: string) => void;
	onRenameWorkspace: (groupId: string, name: string) => void;
}) {
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
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
						onClick={onAddWorkspace}
						variant="ghost"
						size="md"
						className={stylex.props(styles.collapsedAddButton).className}
						title="Add workspace"
					>
						<IconPlus
							size={14}
							className={stylex.props(styles.noShrink).className}
						/>
					</IconButton>
				) : (
					<>
						<span {...stylex.props(styles.workspaceSectionLabel)}>
							Workspaces
						</span>
						<IconButton
							type="button"
							onClick={onAddWorkspace}
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
	const navigate = useNavigate();
	const [uiState, dispatchUi] = useReducer(
		sidebarUiReducer,
		undefined,
		loadSidebarUiState
	);
	const { collapsed, sidebarWidth, resizing, updateStatus } = uiState;
	const { data: githubAccount, refresh: refreshGithubAccount } =
		useAsyncResource(loadGithubAccount, null, { isEqual: sameForgeAccount });
	const { data: appInfo } = useAppInfo();
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
		collapsed ? styles.shellCollapsed : styles.shellOpen,
		resizing && styles.shellResizing
	);
	const logoBarProps = stylex.props(styles.logoBar);
	const logoButtonProps = stylex.props(styles.logoButton);
	const resizeHandleProps = stylex.props(styles.resizeHandle);

	return (
		<aside
			{...shellProps}
			className={`${APP_REGION_DRAG_CLASS} ${shellProps.className ?? ""}`}
			style={collapsed ? undefined : { width: sidebarWidth }}
		>
			{!collapsed && (
				<button
					type="button"
					aria-label="Resize sidebar"
					{...resizeHandleProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${resizeHandleProps.className ?? ""}`}
					onMouseDown={handleResizeStart}
				/>
			)}
			<div
				className={`${APP_REGION_DRAG_CLASS} ${logoBarProps.className ?? ""}`}
			>
				<button
					type="button"
					onClick={() => dispatchUi({ type: "collapsed", value: !collapsed })}
					{...logoButtonProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${logoButtonProps.className ?? ""}`}
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
				<SidebarWorkspacesSection
					collapsed={collapsed}
					workspaces={workspaces}
					onAddWorkspace={addWorkspace}
					onSelectWorkspace={selectWorkspace}
					onSelectPane={selectPane}
					onExpandSidebar={() =>
						dispatchUi({ type: "collapsed", value: false })
					}
					onRemoveWorkspace={removeWorkspace}
					onRenameWorkspace={renameWorkspace}
				/>
			</nav>
			<SidebarFooter
				collapsed={collapsed}
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
	collapsedAddButton: {
		height: controlSize._8,
		width: controlSize._8,
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
		height: controlSize._7,
		paddingInline: "0.375rem",
		width: "100%",
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
	profileButtonIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	profileButtonActive: {
		backgroundColor: color.controlActive,
		borderColor: color.border,
		color: color.textMain,
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
