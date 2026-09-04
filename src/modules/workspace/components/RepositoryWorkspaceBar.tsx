import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../app/model/appearance.ts";
import {
	color,
	controlSize,
	font,
	iconSize,
	layer,
	radius,
	selectionAppearance,
} from "../../../design-system/styles.stylex.ts";
import { noop } from "../../../shared/lib/data.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import {
	IconFolder,
	IconGitBranch,
	IconMessageCircle,
	IconPanelLeft,
	IconPanelRight,
	IconPlus,
} from "../../../shared/ui/Icons.tsx";
import { dispatchToggleActiveGitSidebar } from "../../workbench/model/workbench-events.ts";
import {
	getRepositoryWorkspaceTarget,
	projectRepositoryWorkspaces,
	type RepositoryWorkspace,
} from "../model/repository-workspaces.ts";
import {
	loadSidebarCollapsed,
	setWorkspaceSidebarCollapsed,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "../model/sidebar-state.ts";
import {
	type CreateAgentChatTarget,
	dispatchCreateAgentChat,
} from "../model/workspace-events.ts";
import {
	agentStateKey,
	compactAgentState,
	type GroupId,
	loadAgentState,
	loadCanonicalAgentState,
	mutateAgentWorkspaceState,
} from "../model/workspace-model.ts";

function loadRepositoryBarState() {
	const state = loadAgentState();
	const compact = state
		? compactAgentState(state, { keepSelectedDraft: true })
		: null;
	return {
		groups: compact?.groups ?? [],
		selectedGroupId: compact?.selectedGroupId ?? null,
		key: compact ? agentStateKey(compact) : "",
	};
}

export function RepositoryWorkspaceBar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [state, setState] = useState(loadRepositoryBarState);
	const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsedState] =
		useState(loadSidebarCollapsed);
	const [newMenuOpen, setNewMenuOpen] = useState(false);
	const newMenuRef = useRef<HTMLDivElement | null>(null);
	const projection = useMemo(
		() => projectRepositoryWorkspaces(state.groups, state.selectedGroupId),
		[state.groups, state.selectedGroupId],
	);
	const refresh = useCallback(() => {
		const next = loadRepositoryBarState();
		setState((current) => (current.key === next.key ? current : next));
	}, []);

	useEffect(() => listenWindowEvent("agent-shell-change", refresh), [refresh]);
	useEffect(
		() =>
			listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
				setWorkspaceSidebarCollapsedState(
					(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
						.collapsed,
				);
			}),
		[],
	);
	useEffect(() => {
		let cancelled = false;
		loadCanonicalAgentState()
			.then(() => {
				if (!cancelled) refresh();
			})
			.catch(noop);
		return () => {
			cancelled = true;
		};
	}, [refresh]);
	useEffect(() => {
		if (!newMenuOpen) return;
		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!newMenuRef.current?.contains(event.target)
			) {
				setNewMenuOpen(false);
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setNewMenuOpen(false);
		};
		document.addEventListener("pointerdown", closeOnOutsidePointer);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsidePointer);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [newMenuOpen]);
	const createChat = useCallback((target: CreateAgentChatTarget) => {
		setNewMenuOpen(false);
		dispatchCreateAgentChat(target);
	}, []);

	const activateWorkspace = useCallback(
		(workspace: RepositoryWorkspace) => {
			const target = getRepositoryWorkspaceTarget(
				workspace,
				state.groups,
				state.selectedGroupId,
			);
			if (!target) return;
			setState((current) => ({
				...current,
				selectedGroupId: target.groupId as GroupId,
				groups: current.groups.map((group) =>
					group.id === target.groupId
						? { ...group, selectedPaneId: target.pane.id }
						: group,
				),
			}));
			void mutateAgentWorkspaceState(
				{
					type: "selectPane",
					groupId: target.groupId,
					paneId: target.pane.id,
				},
				"select-repository-workspace",
			);
			if (location.pathname !== "/agent") navigate({ to: "/agent" });
		},
		[location.pathname, navigate, state.groups, state.selectedGroupId],
	);
	const barProps = stylex.props(styles.bar);
	const tabsProps = stylex.props(styles.tabs);
	const newChatProps = stylex.props(styles.newChat);
	const newMenuRootProps = stylex.props(styles.newMenuRoot);
	const workspaceSidebarToggleProps = stylex.props(
		styles.panelToggle,
		styles.workspaceSidebarToggle,
	);
	const changesSidebarToggleProps = stylex.props(
		styles.panelToggle,
		styles.changesSidebarToggle,
	);

	return (
		<header
			{...barProps}
			className={`${APP_REGION_DRAG_CLASS} ${barProps.className ?? ""}`}
		>
			<button
				type="button"
				onClick={() => setWorkspaceSidebarCollapsed(!workspaceSidebarCollapsed)}
				aria-label={
					workspaceSidebarCollapsed
						? "Expand workspace sidebar"
						: "Collapse workspace sidebar"
				}
				title={
					workspaceSidebarCollapsed
						? "Expand workspace sidebar"
						: "Collapse workspace sidebar"
				}
				aria-pressed={!workspaceSidebarCollapsed}
				{...workspaceSidebarToggleProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${workspaceSidebarToggleProps.className ?? ""}`}
			>
				<IconPanelLeft size={iconSize.md} />
			</button>
			<div
				ref={newMenuRef}
				{...newMenuRootProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${newMenuRootProps.className ?? ""}`}
			>
				<button
					type="button"
					onClick={() => setNewMenuOpen((open) => !open)}
					aria-haspopup="menu"
					aria-expanded={newMenuOpen}
					title="Create a chat or open a repository"
					{...newChatProps}
				>
					<span>New</span>
					<IconPlus size={iconSize.sm} />
				</button>
				{newMenuOpen ? (
					<div
						role="menu"
						aria-label="Create new"
						{...stylex.props(styles.newMenu)}
					>
						<button
							type="button"
							role="menuitem"
							onClick={() => createChat("active-repository")}
							{...stylex.props(styles.newMenuItem)}
						>
							<IconMessageCircle size={iconSize.md} />
							<span {...stylex.props(styles.newMenuCopy)}>
								<strong {...stylex.props(styles.newMenuLabel)}>New chat</strong>
								<span {...stylex.props(styles.newMenuDescription)}>
									{projection.activeWorkspace
										? `In ${projection.activeWorkspace.name}`
										: "Choose a repository first"}
								</span>
							</span>
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => createChat("new-repository")}
							{...stylex.props(styles.newMenuItem)}
						>
							<IconFolder size={iconSize.md} />
							<span {...stylex.props(styles.newMenuCopy)}>
								<strong {...stylex.props(styles.newMenuLabel)}>
									Open repository
								</strong>
								<span {...stylex.props(styles.newMenuDescription)}>
									Choose another project folder
								</span>
							</span>
						</button>
					</div>
				) : null}
			</div>
			<div
				{...tabsProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${tabsProps.className ?? ""}`}
				role="tablist"
				aria-label="Repository workspaces"
			>
				{projection.workspaces.length > 0 ? (
					projection.workspaces.map((workspace) => {
						const active = workspace.cwd === projection.activePath;
						return (
							<button
								key={workspace.cwd}
								type="button"
								role="tab"
								aria-selected={active}
								title={workspace.cwd}
								onClick={() => activateWorkspace(workspace)}
								{...stylex.props(
									styles.tab,
									...selectionAppearance("repository", active),
								)}
							>
								<IconGitBranch size={iconSize.sm} />
								<span {...stylex.props(styles.tabLabel)}>{workspace.name}</span>
								<span {...stylex.props(styles.chatCount)}>
									{workspace.entries.length}
								</span>
							</button>
						);
					})
				) : (
					<span {...stylex.props(styles.emptyLabel)}>No repository open</span>
				)}
			</div>
			<button
				type="button"
				onClick={dispatchToggleActiveGitSidebar}
				disabled={!projection.activeWorkspace}
				aria-label="Toggle changes sidebar"
				title="Toggle changes sidebar"
				{...changesSidebarToggleProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${changesSidebarToggleProps.className ?? ""}`}
			>
				<IconPanelRight size={iconSize.md} />
			</button>
		</header>
	);
}

const styles = stylex.create({
	bar: {
		alignItems: "stretch",
		backgroundColor: color.background,
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		boxSizing: "border-box",
		display: "flex",
		flexShrink: 0,
		height: controlSize._10,
		paddingLeft: 76,
		position: "relative",
		zIndex: layer.titlebar,
	},
	tabs: {
		display: "flex",
		flex: "0 1 auto",
		minWidth: controlSize._0,
		overflowX: "auto",
		overflowY: "hidden",
	},
	panelToggle: {
		alignItems: "center",
		alignSelf: "stretch",
		backgroundColor: color.transparent,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		flexShrink: 0,
		justifyContent: "center",
		width: controlSize._10,
		":disabled": {
			cursor: "default",
			opacity: 0.45,
		},
	},
	workspaceSidebarToggle: {
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
	},
	changesSidebarToggle: {
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		marginLeft: "auto",
	},
	newMenuRoot: {
		display: "flex",
		flexShrink: 0,
		position: "relative",
	},
	newChat: {
		alignItems: "center",
		backgroundColor: color.transparent,
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		gap: controlSize._1,
		paddingInline: controlSize._3,
	},
	newMenu: {
		backgroundColor: color.popoverOpaque,
		borderColor: color.borderStrong,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "0 12px 36px rgba(0, 0, 0, 0.42)",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		left: controlSize._1,
		padding: controlSize._1,
		position: "absolute",
		top: "calc(100% + 6px)",
		width: 228,
		zIndex: layer.dropdownPopover,
	},
	newMenuItem: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
			":focus-visible": color.controlHover,
		},
		borderRadius: radius.md,
		color: color.textMuted,
		display: "flex",
		gap: controlSize._2_5,
		minHeight: controlSize._12,
		outline: "none",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2_5,
		textAlign: "left",
		width: "100%",
	},
	newMenuCopy: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: controlSize._0,
	},
	newMenuLabel: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	newMenuDescription: {
		color: color.textFaint,
		fontSize: font.size_1,
		fontWeight: font.weightRegular,
	},
	tab: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		maxWidth: 220,
		minWidth: 132,
		paddingInline: controlSize._3,
	},
	tabLabel: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	chatCount: {
		alignItems: "center",
		backgroundColor: color.controlHover,
		borderRadius: radius.pill,
		color: color.textFaint,
		display: "inline-flex",
		fontSize: font.size_1,
		height: controlSize._4,
		justifyContent: "center",
		minWidth: controlSize._4,
		paddingInline: controlSize._1,
	},
	emptyLabel: {
		alignItems: "center",
		color: color.textFaint,
		display: "flex",
		fontSize: font.size_1,
		paddingInline: controlSize._3,
	},
});
