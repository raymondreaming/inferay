import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../../app/model/appearance.ts";
import {
	iconSize,
	selectionAppearance,
} from "../../../../design-system/styles.stylex.ts";
import { listenWindowEvent } from "../../../../shared/lib/data.ts";
import {
	IconFolder,
	IconGitBranch,
	IconMessageCircle,
	IconPanelLeft,
	IconPanelRight,
	IconPlus,
} from "../../../../shared/ui/Icons/index.tsx";
import { dispatchToggleActiveGitSidebar } from "../../../workbench/model/workbench-model.ts";
import {
	type CreateAgentChatTarget,
	dispatchCreateAgentChat,
	loadSidebarCollapsed,
	mutateAgentWorkspaceState,
	projectRepositoryWorkspaces,
	type RepositoryWorkspace,
	setWorkspaceSidebarCollapsed,
	useWorkspaceState,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "../../model/workspace-model.ts";
import { styles } from "./styles.ts";
export function RepositoryWorkspaceBar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [state] = useWorkspaceState(true, false);
	const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsedState] =
		useState(loadSidebarCollapsed);
	const [newMenuOpen, setNewMenuOpen] = useState(false);
	const newMenuRef = useRef<HTMLDivElement | null>(null);
	const projection = useMemo(
		() => projectRepositoryWorkspaces(state),
		[state.groups, state.selectedGroupId],
	);
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
			void mutateAgentWorkspaceState({
				type: "selectRepository",
				cwd: workspace.cwd,
			});
			if (location.pathname !== "/")
				navigate({
					to: "/",
				});
		},
		[location.pathname, navigate],
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
