import * as stylex from "@stylexjs/stylex";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
	type NEW_PANE_AGENT_KINDS,
} from "../../features/agents/agents.ts";
import { useAsyncResource } from "../../hooks/useAsyncResource.ts";
import {
	DEFAULT_TERMINAL_MAIN_VIEW,
	isTerminalMainView,
	SIDEBAR_NAV_ROUTES,
	TERMINAL_MAIN_VIEWS,
	type TerminalMainView,
} from "../../lib/app-navigation.tsx";
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
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { wsClient } from "../../lib/websocket.ts";
import {
	createGroupId,
	createPendingAgentChatPane,
	createTerminalPane,
	DEFAULT_COLUMNS,
	DEFAULT_ROWS,
	listenTerminalLayoutMode,
	loadTerminalLayoutMode,
	loadTerminalState,
	prependPaneToGroup,
	saveTerminalState,
	type TerminalPaneModel,
} from "../../features/terminal/terminal-utils.ts";
import {
	color,
	controlSize,
	effect,
	font,
	shadow,
} from "../../tokens.stylex.ts";
import {
	loadStoredMessages,
	loadStoredSummary,
	saveStoredSummary,
} from "../../features/chat/chat-session-store.ts";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconChevronRight,
	IconCode,
	IconCollapse,
	IconExpand,
	IconLayoutGrid,
	IconLayoutRows,
	IconMessageCircle,
	IconPencil,
	IconPlus,
	IconSearch,
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

const DEFAULT_SIDEBAR_WIDTH = 192;
const MIN_SIDEBAR_WIDTH = 152;
const MAX_SIDEBAR_WIDTH = 340;
const GRID_SIZE_OPTIONS = [
	{ id: "1", label: "1" },
	{ id: "2", label: "2" },
	{ id: "3", label: "3" },
	{ id: "4", label: "4" },
];

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
	onDelete,
}: {
	pane: TerminalPaneModel;
	isActive: boolean;
	onClick: () => void;
	onDelete: () => void;
}) {
	const [hovered, setHovered] = useState(false);
	const isChat = isChatAgentKind(pane.agentKind);
	const summary = isChat ? deriveSummary(pane.id) : null;
	const folderLabel = getPaneBaseFolder(pane);
	const primaryLabel = isChat ? (summary ?? pane.title) : pane.title;

	return (
		<div
			{...stylex.props(styles.paneSummaryWrap)}
			onMouseEnter={setHovered.bind(null, true)}
			onMouseLeave={setHovered.bind(null, false)}
		>
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
			{(hovered || isActive) && (
				<button
					type="button"
					onClick={stopPropagationAndCall.bind(null, onDelete)}
					{...stylex.props(styles.paneSummaryDelete)}
					title="Delete chat"
				>
					<IconX size={10} />
				</button>
			)}
		</div>
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
	onDeletePane,
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
	onDeletePane: (paneId: string) => void;
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
				{canDelete && (hovered || isActive) && (
					<button
						type="button"
						onClick={stopPropagationAndCall.bind(null, onDelete)}
						{...stylex.props(styles.collapsedWorkspaceDelete)}
						title="Delete workspace"
					>
						<IconX size={9} />
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
				{canDelete && (hovered || isActive) && !editing && (
					<button
						type="button"
						onClick={stopPropagationAndCall.bind(null, onDelete)}
						{...stylex.props(styles.workspaceDelete)}
						title="Delete workspace"
					>
						<IconX size={10} />
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
							onDelete={onDeletePane.bind(null, pane.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function Sidebar() {
	const navigate = useNavigate();
	const location = useLocation();
	const collapsed = false;
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
	const [resizing, setResizing] = useState(false);
	const [layoutMode, setLayoutMode] = useState(loadTerminalLayoutMode);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandQuery, setCommandQuery] = useState("");
	const [activeCommandIndex, setActiveCommandIndex] = useState(-1);
	const { data: githubAccount, refresh: refreshGithubAccount } =
		useAsyncResource(loadGithubAccount, null, []);
	const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const resizeWidthRef = useRef(sidebarWidth);

	// Workspace state
	const loadWorkspaces = useCallback(() => {
		const state = loadTerminalState();
		const mainView = readStoredValue("terminal-main-view");
		return {
			groups: state?.groups ?? [],
			selectedGroupId: state?.selectedGroupId ?? state?.groups[0]?.id ?? null,
			mainView: isTerminalMainView(mainView)
				? mainView
				: DEFAULT_TERMINAL_MAIN_VIEW,
			editorZenMode: readStoredValue("terminal-editor-zen") === "true",
		};
	}, []);

	const [workspaces, setWorkspaces] = useState(loadWorkspaces);

	useEffect(() => {
		const refresh = () => setWorkspaces(loadWorkspaces());
		return listenWindowEvent("terminal-shell-change", refresh);
	}, [loadWorkspaces]);

	useEffect(listenTerminalLayoutMode.bind(null, setLayoutMode), []);

	const openShellCommandMenu = useCallback(() => {
		setCommandQuery("");
		setActiveCommandIndex(-1);
		setCommandOpen(true);
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				openShellCommandMenu();
			} else if (event.key === "Escape" && commandOpen) {
				setCommandOpen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [commandOpen, openShellCommandMenu]);

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

	const updateMainView = useCallback(
		(view: TerminalMainView) => {
			writeStoredValue("terminal-main-view", view);
			setWorkspaces(loadWorkspaces);
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate("/terminal");
		},
		[loadWorkspaces, navigate]
	);

	const addPaneToSelectedGroup = useCallback(
		(agentKind: (typeof NEW_PANE_AGENT_KINDS)[number]) => {
			const state = loadTerminalState();
			if (!state) return;
			const selectedGroupId = state.selectedGroupId ?? state.groups[0]?.id;
			if (!selectedGroupId) return;
			const pane = createTerminalPane(agentKind, undefined, true);
			saveTerminalState({
				...state,
				groups: state.groups.map(
					prependPaneToGroup.bind(null, selectedGroupId, pane)
				),
			});
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate("/terminal");
		},
		[navigate]
	);

	const updateLayoutMode = useCallback((mode: "grid" | "rows") => {
		writeStoredValue("terminal-layout-mode", mode);
		setLayoutMode(mode);
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

	const updateSelectedGroupGrid = useCallback(
		(patch: { columns?: number; rows?: number }) => {
			const state = loadTerminalState();
			if (!state?.selectedGroupId) return;
			saveTerminalState({
				...state,
				groups: state.groups.map((group) =>
					group.id === state.selectedGroupId
						? {
								...group,
								columns: patch.columns ?? group.columns,
								rows: patch.rows ?? group.rows,
							}
						: group
				),
			});
			window.dispatchEvent(new Event("terminal-shell-change"));
		},
		[]
	);

	const updateEditorZenMode = useCallback((next: boolean) => {
		writeStoredValue("terminal-editor-zen", next ? "true" : "false");
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

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

	const removeWorkspacePane = useCallback((groupId: string, paneId: string) => {
		const state = loadTerminalState();
		if (!state) return;
		wsClient.send({ type: "terminal:destroy", paneId });
		saveTerminalState({
			...state,
			groups: state.groups.map((group) => {
				if (group.id !== groupId) return group;
				const panes = group.panes.filter(lacksId.bind(null, paneId));
				if (panes.length === 0) {
					const pane = createPendingAgentChatPane();
					return { ...group, panes: [pane], selectedPaneId: pane.id };
				}
				return {
					...group,
					panes,
					selectedPaneId:
						group.selectedPaneId === paneId
							? (panes[0]?.id ?? null)
							: group.selectedPaneId,
				};
			}),
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

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
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
		[sidebarWidth]
	);

	useEffect(
		() => listenWindowEvent("focus", () => void refreshGithubAccount()),
		[refreshGithubAccount]
	);

	const githubLabel = githubAccount?.login || githubAccount?.name || "Profile";
	const selectedGroup =
		workspaces.groups.find(hasId.bind(null, workspaces.selectedGroupId)) ??
		null;
	const isTerminalRoute = location.pathname === "/terminal";
	const shellCommands = useMemo(
		() => [
			{
				id: "new-chat",
				label: "New chat",
				detail: "Create a new chat pane",
				keywords: "add pane agent conversation",
				icon: <IconPlus size={13} />,
				run: () => addPaneToSelectedGroup(loadDefaultChatSettings().agentKind),
			},
			{
				id: "view-chat",
				label: "Open Chat",
				detail: "Switch to the chat workspace",
				keywords: "messages agents conversation",
				icon: <IconMessageCircle size={13} />,
				run: () => updateMainView("chat"),
			},
			{
				id: "view-editor",
				label: "Open Editor",
				detail: "Switch to the editor workspace",
				keywords: "code files workspace",
				icon: <IconCode size={13} />,
				run: () => updateMainView("editor"),
			},
			{
				id: "editor-zen",
				label: workspaces.editorZenMode ? "Exit editor zen" : "Editor zen",
				detail: "Toggle editor zen mode",
				keywords: "focus fullscreen writing",
				icon: workspaces.editorZenMode ? (
					<IconCollapse size={13} />
				) : (
					<IconExpand size={13} />
				),
				run: () => updateEditorZenMode(!workspaces.editorZenMode),
			},
		],
		[
			addPaneToSelectedGroup,
			updateEditorZenMode,
			updateLayoutMode,
			updateMainView,
			updateSelectedGroupGrid,
			workspaces.editorZenMode,
		]
	);
	const filteredShellCommands = useMemo(() => {
		const needle = commandQuery.trim().toLowerCase();
		if (!needle) return shellCommands;
		return shellCommands.filter((command) =>
			`${command.label} ${command.detail} ${command.keywords}`
				.toLowerCase()
				.includes(needle)
		);
	}, [commandQuery, shellCommands]);
	useEffect(() => {
		if (activeCommandIndex >= filteredShellCommands.length) {
			setActiveCommandIndex(-1);
		}
	}, [activeCommandIndex, filteredShellCommands.length]);
	const runShellCommand = useCallback((command: { run: () => void }) => {
		command.run();
		setCommandOpen(false);
	}, []);
	const shellProps = stylex.props(
		styles.shell,
		collapsed ? styles.shellCollapsed : styles.shellOpen,
		resizing && styles.shellResizing
	);
	const windowControlsProps = stylex.props(
		styles.windowControlsBar,
		collapsed ? styles.windowControlsCollapsed : styles.windowControlsOpen
	);
	const workspaceSectionProps = stylex.props(styles.workspaceSection);
	const footerProps = stylex.props(styles.footer);
	const resizeHandleProps = stylex.props(styles.resizeHandle);
	const commandBackdropProps = stylex.props(styles.commandBackdrop);
	const commandPalette = commandOpen
		? createPortal(
				<div
					{...commandBackdropProps}
					className={`electrobun-webkit-app-region-no-drag ${commandBackdropProps.className ?? ""}`}
					onMouseDown={() => setCommandOpen(false)}
				>
					<section
						{...stylex.props(styles.commandPanel)}
						onMouseDown={stopPropagation}
					>
						<div {...stylex.props(styles.commandSearchRow)}>
							<IconSearch
								size={13}
								{...stylex.props(styles.commandSearchIcon)}
							/>
							<input
								autoFocus
								value={commandQuery}
								onChange={(event) => {
									setCommandQuery(event.target.value);
									setActiveCommandIndex(-1);
								}}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setActiveCommandIndex((index) =>
											filteredShellCommands.length
												? index < 0
													? 0
													: (index + 1) % filteredShellCommands.length
												: 0
										);
									} else if (event.key === "ArrowUp") {
										event.preventDefault();
										setActiveCommandIndex((index) =>
											filteredShellCommands.length
												? index < 0
													? filteredShellCommands.length - 1
													: (index - 1 + filteredShellCommands.length) %
														filteredShellCommands.length
												: 0
										);
									} else if (event.key === "Enter") {
										event.preventDefault();
										const command = filteredShellCommands[activeCommandIndex];
										if (command) runShellCommand(command);
									} else if (event.key === "Escape") {
										setCommandOpen(false);
									}
								}}
								placeholder="Search actions, layout, rows, columns"
								{...stylex.props(styles.commandInput)}
							/>
							<span {...stylex.props(styles.commandShortcut)}>Cmd K</span>
						</div>
						<div {...stylex.props(styles.commandLayoutPanel)}>
							<div {...stylex.props(styles.commandLayoutHeader)}>
								<span {...stylex.props(styles.commandLayoutTitle)}>Layout</span>
								<span {...stylex.props(styles.commandLayoutHint)}>
									Chat workspace
								</span>
							</div>
							<div {...stylex.props(styles.commandLayoutModes)}>
								<button
									type="button"
									onClick={() => updateLayoutMode("grid")}
									{...stylex.props(
										styles.commandLayoutCard,
										layoutMode === "grid" && styles.commandLayoutCardActive
									)}
								>
									<span {...stylex.props(styles.commandLayoutPreviewGrid)}>
										<span {...stylex.props(styles.commandLayoutPreviewCell)} />
										<span {...stylex.props(styles.commandLayoutPreviewCell)} />
										<span {...stylex.props(styles.commandLayoutPreviewCell)} />
										<span {...stylex.props(styles.commandLayoutPreviewCell)} />
									</span>
									<span {...stylex.props(styles.commandLayoutCardText)}>
										<span {...stylex.props(styles.commandLayoutCardLabel)}>
											Grid
										</span>
										<span {...stylex.props(styles.commandLayoutCardDetail)}>
											Panes as tiles
										</span>
									</span>
								</button>
								<button
									type="button"
									onClick={() => updateLayoutMode("rows")}
									{...stylex.props(
										styles.commandLayoutCard,
										layoutMode === "rows" && styles.commandLayoutCardActive
									)}
								>
									<span {...stylex.props(styles.commandLayoutPreviewRows)}>
										<span {...stylex.props(styles.commandLayoutPreviewRow)} />
										<span {...stylex.props(styles.commandLayoutPreviewRow)} />
										<span {...stylex.props(styles.commandLayoutPreviewRow)} />
									</span>
									<span {...stylex.props(styles.commandLayoutCardText)}>
										<span {...stylex.props(styles.commandLayoutCardLabel)}>
											Rows
										</span>
										<span {...stylex.props(styles.commandLayoutCardDetail)}>
											Stacked panes
										</span>
									</span>
								</button>
							</div>
							<div {...stylex.props(styles.commandLayoutSizePanel)}>
								<div {...stylex.props(styles.commandLayoutSizeGroup)}>
									<span {...stylex.props(styles.commandLayoutSizeLabel)}>
										Columns
									</span>
									<div {...stylex.props(styles.commandLayoutSizeButtons)}>
										{GRID_SIZE_OPTIONS.map((option) => (
											<button
												type="button"
												key={`visual-columns-${option.id}`}
												onClick={() =>
													updateSelectedGroupGrid({
														columns: Number(option.id),
													})
												}
												{...stylex.props(
													styles.commandLayoutSizeButton,
													selectedGroup?.columns === Number(option.id) &&
														styles.commandLayoutSizeButtonActive
												)}
											>
												{option.label}
											</button>
										))}
									</div>
								</div>
								<div {...stylex.props(styles.commandLayoutSizeGroup)}>
									<span {...stylex.props(styles.commandLayoutSizeLabel)}>
										Rows
									</span>
									<div {...stylex.props(styles.commandLayoutSizeButtons)}>
										{GRID_SIZE_OPTIONS.map((option) => (
											<button
												type="button"
												key={`visual-rows-${option.id}`}
												onClick={() =>
													updateSelectedGroupGrid({
														rows: Number(option.id),
													})
												}
												{...stylex.props(
													styles.commandLayoutSizeButton,
													selectedGroup?.rows === Number(option.id) &&
														styles.commandLayoutSizeButtonActive
												)}
											>
												{option.label}
											</button>
										))}
									</div>
								</div>
							</div>
						</div>
						<div
							{...stylex.props(styles.commandResults)}
							onMouseLeave={() => setActiveCommandIndex(-1)}
						>
							{filteredShellCommands.length === 0 ? (
								<div {...stylex.props(styles.commandEmpty)}>
									No matching actions
								</div>
							) : (
								filteredShellCommands.map((command, index) => (
									<button
										key={command.id}
										type="button"
										onMouseEnter={() => setActiveCommandIndex(index)}
										onClick={() => runShellCommand(command)}
										{...stylex.props(
											styles.commandResult,
											index === activeCommandIndex && styles.commandResultActive
										)}
									>
										<span {...stylex.props(styles.commandResultIcon)}>
											{command.icon}
										</span>
										<span {...stylex.props(styles.commandResultText)}>
											<span {...stylex.props(styles.commandResultLabel)}>
												{command.label}
											</span>
											<span {...stylex.props(styles.commandResultDetail)}>
												{command.detail}
											</span>
										</span>
									</button>
								))
							)}
						</div>
					</section>
				</div>,
				document.body
			)
		: null;

	return (
		<>
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
					className={`electrobun-webkit-app-region-drag ${windowControlsProps.className ?? ""}`}
				/>
				<nav {...stylex.props(styles.nav)}>
					<div {...stylex.props(styles.primarySection)}>
						{TERMINAL_MAIN_VIEWS.map((view) => {
							const Icon = view.icon;
							const active = isTerminalRoute && workspaces.mainView === view.id;
							const viewItemProps = stylex.props(
								styles.navItem,
								active ? styles.navItemActive : styles.navItemIdle,
								collapsed ? styles.navItemCollapsed : styles.navItemOpen,
								view.id === "chat" && !collapsed && styles.navItemWithAction
							);
							if (view.id === "chat" && !collapsed) {
								return (
									<div
										key={view.id}
										{...stylex.props(styles.navItemActionWrap)}
									>
										<button
											type="button"
											onClick={() => updateMainView(view.id)}
											{...viewItemProps}
											className={`electrobun-webkit-app-region-no-drag ${
												viewItemProps.className ?? ""
											}`}
										>
											<Icon size={14} className="shrink-0" />
											<span>Chat</span>
										</button>
										<button
											type="button"
											onClick={() =>
												addPaneToSelectedGroup(
													loadDefaultChatSettings().agentKind
												)
											}
											{...stylex.props(styles.navItemInlineAction)}
											className={`electrobun-webkit-app-region-no-drag ${
												stylex.props(styles.navItemInlineAction).className ?? ""
											}`}
											title="New chat"
											aria-label="New chat"
										>
											<IconPlus size={11} />
										</button>
									</div>
								);
							}
							return (
								<button
									key={view.id}
									type="button"
									onClick={() => updateMainView(view.id)}
									{...viewItemProps}
									className={`electrobun-webkit-app-region-no-drag ${
										viewItemProps.className ?? ""
									}`}
									title={collapsed ? view.label : undefined}
								>
									<Icon size={14} className="shrink-0" />
									{!collapsed && <span>{view.label}</span>}
								</button>
							);
						})}
					</div>
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
								onExpandSidebar={noop}
								onDelete={() => removeWorkspace(group.id)}
								onDeletePane={(paneId) => removeWorkspacePane(group.id, paneId)}
								onRename={(name) => renameWorkspace(group.id, name)}
							/>
						))}
					</div>
				</nav>
				<div
					className={`electrobun-webkit-app-region-no-drag ${footerProps.className ?? ""}`}
				>
					<NavLink
						to="/profile"
						className={({ isActive }) =>
							stylex.props(
								styles.profileButton,
								collapsed
									? styles.profileButtonCollapsed
									: styles.profileButtonOpen,
								isActive ? styles.profileButtonActive : styles.profileButtonIdle
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
			{commandPalette}
		</>
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
	paneSummaryWrap: {
		position: "relative",
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
		paddingRight: controlSize._7,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
		width: "100%",
	},
	paneSummaryIdle: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: {
			default: "none",
			":hover": "none",
		},
		borderColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		boxShadow: {
			default: "none",
			":hover": "none",
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	paneSummarySelected: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.accentBorder,
		boxShadow: shadow.selectedRing,
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
	paneSummaryDelete: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		borderRadius: 6,
		boxShadow: {
			default: "none",
			":hover": shadow.controlDepth,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		display: "flex",
		height: controlSize._5,
		justifyContent: "center",
		position: "absolute",
		right: controlSize._1,
		top: controlSize._1,
		transitionDuration: "150ms",
		transitionProperty: "background-color, background-image, box-shadow, color",
		width: controlSize._5,
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
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
		width: controlSize._8,
	},
	collapsedWorkspaceIdle: {
		backgroundColor: color.transparent,
		backgroundImage: "none",
		borderColor: color.transparent,
		boxShadow: "none",
		color: color.textSoft,
	},
	collapsedWorkspaceActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
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
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		borderColor: color.border,
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: "none",
			":hover": shadow.controlDepth,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		display: "flex",
		height: 18,
		justifyContent: "center",
		position: "absolute",
		right: -4,
		top: -4,
		transitionDuration: "150ms",
		transitionProperty: "background-color, background-image, box-shadow, color",
		width: 18,
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
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
	},
	workspaceHeaderIdle: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: {
			default: "none",
			":hover": "none",
		},
		borderColor: color.transparent,
		boxShadow: {
			default: "none",
			":hover": "none",
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	workspaceHeaderActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
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
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		boxShadow: {
			default: "none",
			":hover": shadow.controlDepth,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		flexShrink: 0,
		marginLeft: controlSize._1,
		padding: controlSize._0_5,
		transitionDuration: "150ms",
		transitionProperty: "background-color, background-image, box-shadow, color",
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
	windowControlsBar: {
		alignItems: "center",
		display: "flex",
		height: controlSize._6,
		marginTop: controlSize._2,
	},
	windowControlsOpen: {
		justifyContent: "flex-start",
		paddingLeft: "4.75rem",
		paddingRight: controlSize._2,
	},
	windowControlsCollapsed: {
		justifyContent: "center",
		paddingInline: controlSize._1,
	},
	nav: {
		flex: 1,
		overflowY: "auto",
		paddingBlock: controlSize._0_5,
	},
	primarySection: {
		marginBottom: controlSize._1,
	},
	gridSelectRow: {
		display: "grid",
		gap: controlSize._1,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		marginInline: "0.375rem",
	},
	gridSizeButton: {
		"--dropdown-button-bg-color": color.transparent,
		"--dropdown-button-bg-image": "none",
		"--dropdown-button-border-color": color.transparent,
		"--dropdown-button-border-width": "1px",
		"--dropdown-button-hover-bg-color": color.transparent,
		"--dropdown-button-hover-bg-image": "none",
		"--dropdown-button-hover-shadow": "none",
		"--dropdown-button-open-bg-color": color.controlActive,
		"--dropdown-button-open-bg-image": effect.controlDepthHover,
		"--dropdown-button-open-border-color": color.borderStrong,
		"--dropdown-button-open-shadow": shadow.selectedRing,
		"--dropdown-button-shadow": "none",
		backgroundColor: color.transparent,
		backgroundImage: "none",
		borderColor: color.transparent,
		borderWidth: 1,
		boxShadow: "none",
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._7,
		paddingInline: controlSize._2,
		width: "100%",
	},
	gridSizeLabel: {
		color: "currentColor",
		fontVariantNumeric: "tabular-nums",
		whiteSpace: "nowrap",
	},
	layoutSegment: {
		display: "grid",
		gap: controlSize._1,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		marginInline: "0.375rem",
	},
	layoutSegmentCollapsed: {
		display: "flex",
		flexDirection: "column",
		marginInline: 0,
		width: controlSize._8,
	},
	layoutSegmentButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: {
			default: "none",
			":hover": "none",
		},
		borderColor: color.transparent,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: "none",
			":hover": "none",
		},
		color: color.textSoft,
		display: "flex",
		height: controlSize._7,
		justifyContent: "center",
		transitionDuration: "150ms",
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
		width: "100%",
	},
	layoutSegmentButtonIdle: {
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
	layoutSegmentButtonActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
		color: color.textMain,
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
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
		width: "calc(100% - 0.75rem)",
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
	navItemWithAction: {
		paddingRight: controlSize._8,
	},
	navItemActionWrap: {
		position: "relative",
		width: "100%",
	},
	navItemInlineAction: {
		alignItems: "center",
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		borderRadius: 6,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		display: "flex",
		height: controlSize._5,
		justifyContent: "center",
		position: "absolute",
		right: "0.75rem",
		top: controlSize._1,
		transitionDuration: "150ms",
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		width: controlSize._5,
		":hover": {
			backgroundColor: color.surfaceControl,
			color: color.textMain,
		},
	},
	navItemIdle: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: {
			default: "none",
			":hover": "none",
		},
		borderColor: color.transparent,
		boxShadow: {
			default: "none",
			":hover": "none",
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	navItemActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
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
	commandBackdrop: {
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.42)",
		display: "flex",
		inset: 0,
		justifyContent: "center",
		padding: controlSize._4,
		position: "fixed",
		zIndex: 140,
	},
	commandPanel: {
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		borderColor: color.border,
		borderRadius: 10,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.modal,
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		width: "min(34rem, calc(100vw - 2rem))",
	},
	commandSearchRow: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	commandSearchIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	commandInput: {
		backgroundColor: color.transparent,
		borderWidth: 0,
		color: color.textMain,
		flex: 1,
		fontSize: font.size_3,
		minWidth: 0,
		outline: "none",
		"::placeholder": {
			color: color.textMuted,
		},
	},
	commandShortcut: {
		color: color.textMuted,
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	commandLayoutPanel: {
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		padding: controlSize._3,
	},
	commandLayoutHeader: {
		alignItems: "center",
		display: "flex",
		justifyContent: "space-between",
	},
	commandLayoutTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	commandLayoutHint: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	commandLayoutModes: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	},
	commandLayoutCard: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: "none",
		borderColor: color.transparent,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "none",
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		gap: controlSize._2,
		minWidth: 0,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
	},
	commandLayoutCardActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
		color: color.textMain,
	},
	commandLayoutPreviewGrid: {
		display: "grid",
		flexShrink: 0,
		gap: 2,
		gridTemplateColumns: "repeat(2, 8px)",
		width: 18,
	},
	commandLayoutPreviewRows: {
		display: "grid",
		flexShrink: 0,
		gap: 2,
		width: 18,
	},
	commandLayoutPreviewCell: {
		backgroundColor: "currentColor",
		borderRadius: 2,
		height: 8,
		opacity: 0.74,
		width: 8,
	},
	commandLayoutPreviewRow: {
		backgroundColor: "currentColor",
		borderRadius: 2,
		height: 4,
		opacity: 0.74,
		width: 18,
	},
	commandLayoutCardText: {
		display: "flex",
		flexDirection: "column",
		gap: 1,
		minWidth: 0,
	},
	commandLayoutCardLabel: {
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	commandLayoutCardDetail: {
		color: color.textMuted,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	commandLayoutSizePanel: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	},
	commandLayoutSizeGroup: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		minWidth: 0,
	},
	commandLayoutSizeLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		textTransform: "uppercase",
	},
	commandLayoutSizeButtons: {
		display: "grid",
		gap: controlSize._1,
		gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
	},
	commandLayoutSizeButton: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: "none",
		borderColor: color.transparent,
		borderRadius: 6,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "none",
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		height: controlSize._6,
		transitionDuration: "150ms",
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
	},
	commandLayoutSizeButtonActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
		color: color.textMain,
	},
	commandResults: {
		maxHeight: "20rem",
		overflowY: "auto",
		paddingBlock: controlSize._1,
	},
	commandEmpty: {
		color: color.textMuted,
		fontSize: font.size_2,
		paddingBlock: controlSize._4,
		paddingInline: controlSize._3,
		textAlign: "center",
	},
	commandResult: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		borderWidth: 0,
		color: color.textSoft,
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "1.25rem minmax(0, 1fr)",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		width: "100%",
	},
	commandResultActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		color: color.textMain,
	},
	commandResultIcon: {
		alignItems: "center",
		color: "currentColor",
		display: "flex",
		height: controlSize._5,
		justifyContent: "center",
		opacity: 0.78,
		width: controlSize._5,
	},
	commandResultText: {
		display: "flex",
		flexDirection: "column",
		gap: 1,
		minWidth: 0,
	},
	commandResultLabel: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	commandResultDetail: {
		color: color.textMuted,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	profileButton: {
		alignItems: "center",
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: controlSize._1,
		transitionDuration: "150ms",
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color",
		transitionTimingFunction: "ease",
	},
	profileButtonIdle: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		backgroundImage: {
			default: "none",
			":hover": "none",
		},
		borderColor: color.transparent,
		boxShadow: {
			default: "none",
			":hover": "none",
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
	},
	profileButtonActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		borderColor: color.borderStrong,
		boxShadow: shadow.selectedRing,
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
