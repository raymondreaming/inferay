import type { Project } from "@contracts";
import { iconSize, selectionAppearance } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
	ariaValue,
	dispatchToggleActiveGitGraph,
	dispatchToggleActiveGitSidebar,
	listenWindowEvent,
	queryClient,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "@shared/lib/dom.tsx";
import {
	loadSidebarCollapsed,
	setWorkspaceSidebarCollapsed,
} from "@shared/lib/native.tsx";
import {
	IconFolder,
	IconPanelLeft,
	IconPlus,
	IconWrench,
} from "@shared/ui/Icons/index.tsx";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import {
	panelQuery,
	usePanelVisibility,
} from "@workspace/hooks/useWorkspacePanelSession.tsx";
import { createMemo, createSignal, onSettled } from "solid-js";
import {
	projects,
	reorderProject,
	selectProject,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import {
	openAgentPane,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { ProjectEditor } from "../ProjectsPanel/ProjectEditor.tsx";
import { RepositoryPanelControls } from "./RepositoryPanelControls.tsx";
import { SidebarChatFlyout } from "./SidebarChatFlyout.tsx";
import { styles } from "./styles.ts";

export function RepositoryWorkspaceBar() {
	const navigate = useNavigate();
	const location = useLocation();
	const [state] = useWorkspaceState(
		() => true,
		() => false,
	);
	const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsedState] =
		createSignal(loadSidebarCollapsed);
	const [editingProject, setEditingProject] = createSignal<
		Project | undefined
	>();
	const [creatingProject, setCreatingProject] = createSignal(false);
	const [draggedProject, setDraggedProject] = createSignal<string | null>(null);
	const [dropBefore, setDropBefore] = createSignal<string | null | undefined>(
		undefined,
	);
	const [chatFlyoutHovered, setChatFlyoutHovered] = createSignal(false);
	const projection = createMemo(() => state().repositories);
	const panelVisibility = usePanelVisibility();
	const panelState = useBackgroundQuery(
		() => ({
			...panelQuery(projects.repositoryPath() ?? ""),
			// The workbench owns loading and transitions; this observer only reflects its cache.
			enabled: false,
		}),
		() => queryClient,
	);
	onSettled(() => {
		return listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
			setWorkspaceSidebarCollapsedState(
				(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
					.collapsed,
			);
		});
	});
	const chatFlyoutOpen = createMemo(
		() =>
			chatFlyoutHovered() &&
			!creatingProject() &&
			(workspaceSidebarCollapsed() || location.pathname !== "/"),
	);
	const activePaneId = createMemo(
		() =>
			state().groups.find((group) => group.id === state().selectedGroupId)
				?.selectedPaneId ?? null,
	);
	const selectPane = (groupId: string, paneId: string) => {
		setChatFlyoutHovered(false);
		void openAgentPane(groupId, paneId, () => {
			if (location.pathname !== "/") navigate("/");
		});
	};
	const barProps = createMemo(() => stylex.attrs(styles.bar));
	const workspaceSidebarToggleProps = createMemo(() =>
		stylex.attrs(styles.panelToggle, styles.workspaceSidebarToggle),
	);
	const workspaceSidebarToggleRootProps = createMemo(() =>
		stylex.attrs(styles.workspaceSidebarToggleRoot),
	);
	return (
		<header
			aria-label="Workspace bar"
			{...barProps()}
			class={`${APP_REGION_DRAG_CLASS} ${barProps().class ?? ""}`}
		>
			<div
				{...workspaceSidebarToggleRootProps()}
				class={`${APP_REGION_NO_DRAG_CLASS} ${workspaceSidebarToggleRootProps().class ?? ""}`}
				onMouseEnter={() => {
					setChatFlyoutHovered(true);
				}}
				onMouseLeave={() => setChatFlyoutHovered(false)}
			>
				<button
					type="button"
					onClick={() =>
						setWorkspaceSidebarCollapsed(!workspaceSidebarCollapsed())
					}
					aria-label={ariaValue(
						workspaceSidebarCollapsed()
							? "Expand workspace sidebar"
							: "Collapse workspace sidebar",
					)}
					title={
						workspaceSidebarCollapsed()
							? "Expand workspace sidebar"
							: "Collapse workspace sidebar"
					}
					aria-pressed={ariaValue(!workspaceSidebarCollapsed())}
					aria-expanded={ariaValue(chatFlyoutOpen())}
					{...workspaceSidebarToggleProps()}
				>
					<IconPanelLeft size={iconSize.md} />
				</button>
				{chatFlyoutOpen() ? (
					<SidebarChatFlyout
						entries={projection().visibleEntries}
						activePaneId={activePaneId()}
						onSelectPane={selectPane}
					/>
				) : null}
			</div>
			<button
				type="button"
				aria-label="New project"
				title="New project"
				class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.newProject).class ?? ""}`}
				onClick={() => setCreatingProject(true)}
			>
				<span>New</span>
				<IconPlus size={iconSize.sm} />
			</button>
			{creatingProject() ? (
				<ProjectEditor close={() => setCreatingProject(false)} />
			) : null}
			<div
				role="tablist"
				aria-label="Projects"
				class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.tabs).class ?? ""}`}
			>
				{projects
					.list()
					.filter((p) => !p.archived)
					.map((project) => (
						<button
							type="button"
							role="tab"
							draggable="true"
							data-project-tab={project.id}
							title={`${project.name} · Drag to reorder`}
							onDragStart={(event) => {
								setDraggedProject(project.id);
								event.dataTransfer?.setData(
									"application/x-inferay-project",
									project.id,
								);
								if (event.dataTransfer)
									event.dataTransfer.effectAllowed = "move";
							}}
							onDragOver={(event) => {
								if (!draggedProject()) return;
								event.preventDefault();
								const bounds = event.currentTarget.getBoundingClientRect();
								const ids = projects
									.list()
									.filter((p) => !p.archived)
									.map((p) => p.id);
								setDropBefore(
									event.clientX < bounds.left + bounds.width / 2
										? project.id
										: (ids[ids.indexOf(project.id) + 1] ?? null),
								);
							}}
							onDrop={(event) => {
								event.preventDefault();
								const id = draggedProject();
								if (id && dropBefore() !== undefined)
									reorderProject(id, dropBefore() ?? null);
								setDraggedProject(null);
								setDropBefore(undefined);
							}}
							onDragEnd={() => {
								setDraggedProject(null);
								setDropBefore(undefined);
							}}
							aria-selected={ariaValue(projects.selectedId() === project.id)}
							tabindex={projects.selectedId() === project.id ? 0 : -1}
							{...stylex.attrs(
								styles.tab,
								draggedProject() === project.id && styles.draggingTab,
								dropBefore() === project.id && styles.dropBefore,
								dropBefore() === null &&
									projects
										.list()
										.filter((p) => !p.archived)
										.at(-1)?.id === project.id &&
									styles.dropAfter,
								...selectionAppearance(
									"repository",
									projects.selectedId() === project.id,
								),
							)}
							onClick={() => {
								if (projects.selectedId() !== project.id)
									void selectProject(project.id);
								else showProjectView("chat");
							}}
							onKeyDown={(event) => {
								if (
									!["ArrowLeft", "ArrowRight", "Home", "End"].includes(
										event.key,
									)
								)
									return;
								event.preventDefault();
								if (
									event.altKey &&
									event.shiftKey &&
									["ArrowLeft", "ArrowRight"].includes(event.key)
								) {
									const ids = projects
										.list()
										.filter((p) => !p.archived)
										.map((p) => p.id);
									const index = ids.indexOf(project.id);
									if (event.key === "ArrowLeft" && index > 0)
										reorderProject(project.id, ids[index - 1]!);
									if (event.key === "ArrowRight" && index < ids.length - 1)
										reorderProject(project.id, ids[index + 2] ?? null);
									return;
								}
								const tabs = Array.from(
									event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
										'[role="tab"]',
									),
								);
								const index = tabs.indexOf(event.currentTarget);
								const next =
									event.key === "Home"
										? 0
										: event.key === "End"
											? tabs.length - 1
											: (index +
													(event.key === "ArrowRight" ? 1 : -1) +
													tabs.length) %
												tabs.length;
								tabs[next]?.focus();
								tabs[next]?.click();
							}}
						>
							<IconFolder size={iconSize.sm} />
							<span {...stylex.attrs(styles.tabLabel)}>{project.name}</span>
						</button>
					))}
			</div>
			{projects.list().find((p) => p.id === projects.selectedId()) ? (
				<button
					type="button"
					aria-label="Edit project"
					title="Edit project"
					class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.panelToggle).class ?? ""}`}
					onClick={() =>
						setEditingProject(
							projects.list().find((p) => p.id === projects.selectedId()),
						)
					}
				>
					<IconWrench size={iconSize.sm} />
				</button>
			) : null}
			{editingProject() ? (
				<ProjectEditor
					project={editingProject()}
					close={() => setEditingProject(undefined)}
				/>
			) : null}
			{projects.view() === "code" ? (
				<>
					<span {...stylex.attrs(styles.emptyLabel)}>
						{projects.repositoryPath()?.split("/").at(-1)}
					</span>
					<RepositoryPanelControls
						hasActiveWorkspace={!!projects.repositoryPath()}
						graphVisible={
							panelState.data?.mainViewMode === "graph" &&
							panelVisibility().graphVisible
						}
						sidebarVisible={panelVisibility().sidebarVisible}
						onToggleGraph={dispatchToggleActiveGitGraph}
						onToggleSidebar={dispatchToggleActiveGitSidebar}
					/>
				</>
			) : null}
		</header>
	);
}
