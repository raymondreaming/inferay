import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
} from "solid-js";
import type { RepositoryWorkspace } from "../../../../../build/presentation/contracts/RepositoryWorkspace.ts";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../../app/hooks/useAppAppearance.tsx";
import {
	iconSize,
	selectionAppearance,
} from "../../../../design-system/styles.stylex.ts";
import {
	ariaValue,
	type CreateAgentChatTarget,
	dispatchCreateAgentChat,
	dispatchToggleActiveGitSidebar,
	listenWindowEvent,
	setWorkspaceSidebarCollapsed,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "../../../../shared/lib/dom.tsx";
import { loadSidebarCollapsed } from "../../../../shared/lib/native.tsx";
import {
	IconFolder,
	IconGitBranch,
	IconMessageCircle,
	IconPanelLeft,
	IconPanelRight,
	IconPlus,
} from "../../../../shared/ui/Icons/index.tsx";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
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
	const [newMenuOpen, setNewMenuOpen] = createSignal(false);
	const newMenuRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const projection = createMemo(() => state().repositories);
	onSettled(() => {
		return listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
			setWorkspaceSidebarCollapsedState(
				(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
					.collapsed,
			);
		});
	});
	createEffect(
		() => [newMenuOpen()],
		() => {
			if (!newMenuOpen()) return;
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
		},
	);
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
	const tabsProps = createMemo(() => stylex.attrs(styles.tabs));
	const newChatProps = createMemo(() => stylex.attrs(styles.newChat));
	const newMenuRootProps = createMemo(() => stylex.attrs(styles.newMenuRoot));
	const workspaceSidebarToggleProps = createMemo(() =>
		stylex.attrs(styles.panelToggle, styles.workspaceSidebarToggle),
	);
	const changesSidebarToggleProps = createMemo(() =>
		stylex.attrs(styles.panelToggle, styles.changesSidebarToggle),
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
			<div
				ref={(element) => (newMenuRef.current = element)}
				{...newMenuRootProps()}
				class={`${APP_REGION_NO_DRAG_CLASS} ${newMenuRootProps().class ?? ""}`}
			>
				<button
					type="button"
					onClick={() => setNewMenuOpen((open) => !open)}
					aria-haspopup="menu"
					aria-expanded={ariaValue(newMenuOpen())}
					title="Create a chat or open a repository"
					{...newChatProps()}
				>
					<span>New</span>
					<IconPlus size={iconSize.sm} />
				</button>
				{newMenuOpen() ? (
					<div
						role="menu"
						aria-label="Create new"
						{...stylex.attrs(styles.newMenu)}
					>
						<button
							type="button"
							role="menuitem"
							onClick={() => createChat("active-repository")}
							{...stylex.attrs(styles.newMenuItem)}
						>
							<IconMessageCircle size={iconSize.md} />
							<span {...stylex.attrs(styles.newMenuCopy)}>
								<strong {...stylex.attrs(styles.newMenuLabel)}>New chat</strong>
								<span {...stylex.attrs(styles.newMenuDescription)}>
									{projection().activeWorkspace
										? `In ${projection().activeWorkspace?.name}`
										: "Choose a repository first"}
								</span>
							</span>
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => createChat("new-repository")}
							{...stylex.attrs(styles.newMenuItem)}
						>
							<IconFolder size={iconSize.md} />
							<span {...stylex.attrs(styles.newMenuCopy)}>
								<strong {...stylex.attrs(styles.newMenuLabel)}>
									Open repository
								</strong>
								<span {...stylex.attrs(styles.newMenuDescription)}>
									Choose another project folder
								</span>
							</span>
						</button>
					</div>
				) : null}
			</div>
			<div
				{...tabsProps()}
				class={`${APP_REGION_NO_DRAG_CLASS} ${tabsProps().class ?? ""}`}
				role="tablist"
				aria-label="Repository workspaces"
			>
				{projection().workspaces.length > 0 ? (
					<For each={projection().workspaces} keyed={(row) => row.cwd}>
						{(workspace) => {
							const active = createMemo(
								() => workspace().cwd === projection().activePath,
							);
							return (
								<button
									type="button"
									role="tab"
									aria-selected={ariaValue(active())}
									title={workspace().cwd}
									onClick={() => activateWorkspace(workspace())}
									{...stylex.attrs(
										...selectionAppearance("repository", active()),
										styles.tab,
									)}
								>
									<IconGitBranch size={iconSize.sm} />
									<span {...stylex.attrs(styles.tabLabel)}>
										{workspace().name}
									</span>
								</button>
							);
						}}
					</For>
				) : (
					<span {...stylex.attrs(styles.emptyLabel)}>No repository open</span>
				)}
			</div>
			<button
				type="button"
				onClick={dispatchToggleActiveGitSidebar}
				disabled={!projection().activeWorkspace}
				aria-label="Toggle changes sidebar"
				title="Toggle changes sidebar"
				{...changesSidebarToggleProps()}
				class={`${APP_REGION_NO_DRAG_CLASS} ${changesSidebarToggleProps().class ?? ""}`}
			>
				<IconPanelRight size={iconSize.md} />
			</button>
		</header>
	);
}
