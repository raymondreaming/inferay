import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "@app/hooks/useAppAppearance.tsx";
import type { RepositoryWorkspace } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import {
	ariaValue,
	type CreateAgentChatTarget,
	dispatchCreateAgentChat,
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
import { IconPanelLeft } from "@shared/ui/Icons/index.tsx";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import {
	panelQuery,
	usePanelVisibility,
} from "@workspace/hooks/useWorkspacePanelSession.tsx";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { NewWorkspaceMenu } from "./NewWorkspaceMenu.tsx";
import { RepositoryPanelControls } from "./RepositoryPanelControls.tsx";
import { RepositoryWorkspaceTabs } from "./RepositoryWorkspaceTabs.tsx";
import { styles } from "./styles.ts";
import { useRepositoryTabDrag } from "./useRepositoryTabDrag.ts";
export function RepositoryWorkspaceBar() {
	const navigate = useNavigate();
	const location = useLocation();
	const [state] = useWorkspaceState(
		() => true,
		() => false,
	);
	const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsedState] =
		createSignal(loadSidebarCollapsed);
	const [newMenuOpen, setNewMenuOpen] = createSignal(false);
	const newMenuRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const projection = createMemo(() => state().repositories);
	const panelVisibility = usePanelVisibility();
	const panelState = useBackgroundQuery(
		() => ({
			...panelQuery(projection().activePath ?? ""),
			// The workbench owns loading and transitions; this observer only reflects its cache.
			enabled: false,
		}),
		() => queryClient,
	);
	const tabDrag = useRepositoryTabDrag(
		() => projection().workspaces,
		(cwd, beforeCwd) =>
			mutateAgentWorkspaceState({ type: "reorderRepository", cwd, beforeCwd }),
	);
	onSettled(() => {
		return listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
			setWorkspaceSidebarCollapsedState(
				(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
					.collapsed,
			);
		});
	});
	createEffect(newMenuOpen, (isOpen) => {
		if (!isOpen) return;
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
	});
	const createChat = (target: CreateAgentChatTarget) => {
		setNewMenuOpen(false);
		dispatchCreateAgentChat(target);
	};
	const activateWorkspace = (workspace: RepositoryWorkspace) => {
		void mutateAgentWorkspaceState({
			type: "selectRepository",
			cwd: workspace.cwd,
		});
		if (location.pathname !== "/") navigate("/");
	};
	const barProps = createMemo(() => stylex.attrs(styles.bar));
	const workspaceSidebarToggleProps = createMemo(() =>
		stylex.attrs(styles.panelToggle, styles.workspaceSidebarToggle),
	);
	return (
		<header
			{...barProps()}
			class={`${APP_REGION_DRAG_CLASS} ${barProps().class ?? ""}`}
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
				{...workspaceSidebarToggleProps()}
				class={`${APP_REGION_NO_DRAG_CLASS} ${workspaceSidebarToggleProps().class ?? ""}`}
			>
				<IconPanelLeft size={iconSize.md} />
			</button>
			<NewWorkspaceMenu
				activeWorkspace={projection().activeWorkspace}
				menuRef={newMenuRef}
				open={newMenuOpen()}
				onCreateChat={createChat}
				onToggle={() => setNewMenuOpen((open) => !open)}
			/>
			<RepositoryWorkspaceTabs
				activePath={projection().activePath}
				hasWorkspaces={projection().workspaces.length > 0}
				onActivate={activateWorkspace}
				tabDrag={tabDrag}
			/>
			{tabDrag.error() ? (
				<span role="alert" {...stylex.attrs(styles.emptyLabel)}>
					{tabDrag.error()}
				</span>
			) : null}
			<RepositoryPanelControls
				hasActiveWorkspace={!!projection().activeWorkspace}
				graphVisible={
					panelState.data?.mainViewMode === "graph" &&
					panelVisibility().graphVisible
				}
				sidebarVisible={panelVisibility().sidebarVisible}
				onToggleGraph={dispatchToggleActiveGitGraph}
				onToggleSidebar={dispatchToggleActiveGitSidebar}
			/>
		</header>
	);
}
