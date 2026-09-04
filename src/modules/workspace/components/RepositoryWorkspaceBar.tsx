import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useMemo, useState } from "octane";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../app/model/theme.ts";
import { iconSize } from "../../../design-system.ts";
import { noop } from "../../../shared/lib/data.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import {
	IconGitBranch,
	IconPanelLeft,
	IconPanelRight,
	IconPlus,
} from "../../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../../tokens.stylex.ts";
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
import { dispatchCreateAgentChat } from "../model/workspace-events.ts";
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
			<button
				type="button"
				onClick={dispatchCreateAgentChat}
				title={
					projection.activeWorkspace
						? `New chat in ${projection.activeWorkspace.name}`
						: "New chat"
				}
				{...newChatProps}
				className={`${APP_REGION_NO_DRAG_CLASS} ${newChatProps.className ?? ""}`}
			>
				<span>New</span>
				<IconPlus size={iconSize.sm} />
			</button>
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
								{...stylex.props(styles.tab, active && styles.tabActive)}
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
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
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
	newChat: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
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
	tab: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		maxWidth: 220,
		minWidth: 132,
		paddingInline: controlSize._3,
		transitionDuration: motion.durationFast,
		transitionProperty: "background-color, border-color, color",
	},
	tabActive: {
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
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
