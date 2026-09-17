import type {
	RepositoryTabDrag,
	RepositoryTabsSnapshot,
	RepositoryWorkspace,
} from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
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
	RepositoryTabs,
	setWorkspaceSidebarCollapsed,
} from "@shared/lib/native.tsx";
import { IconPanelLeft } from "@shared/ui/Icons/index.tsx";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import {
	panelQuery,
	usePanelVisibility,
} from "@workspace/hooks/useWorkspacePanelSession.tsx";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
} from "solid-js";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { NewWorkspaceMenu } from "./NewWorkspaceMenu.tsx";
import { RepositoryPanelControls } from "./RepositoryPanelControls.tsx";
import { RepositoryWorkspaceTabs } from "./RepositoryWorkspaceTabs.tsx";
import { styles } from "./styles.ts";

type RepositoryTabMove = {
	sequence: number;
	cwd: string;
	before: string | null;
};

function createRepositoryTabDrag(
	workspaces: () => RepositoryWorkspace[],
	persist: (cwd: string, beforeCwd: string | null) => Promise<unknown>,
) {
	const model = new RepositoryTabs();
	const [state, setState] = createSignal<RepositoryTabsSnapshot>(
		JSON.parse(model.snapshot()),
	);
	const ordered = createMemo(() => {
		const rows = workspaces();
		void state();
		return (
			JSON.parse(
				model.order(JSON.stringify(rows.map((row) => row.cwd))),
			) as number[]
		).map((index) => rows[index]!);
	});
	let container: HTMLDivElement | undefined;
	let cancel: (() => void) | undefined;
	let disposed = false;
	const sync = () =>
		setState(JSON.parse(model.snapshot()) as RepositoryTabsSnapshot);
	const persistMove = (serialized: string) => {
		const next = JSON.parse(serialized) as RepositoryTabMove | null;
		sync();
		if (!next) return;
		void persist(next.cwd, next.before)
			.then((saved) => {
				if (!disposed) {
					model.settle(next.sequence, Boolean(saved));
					sync();
				}
			})
			.catch(() => {
				if (!disposed) {
					model.settle(next.sequence, false);
					sync();
				}
			});
	};
	onCleanup(() => {
		disposed = true;
		cancel?.();
		model.free();
	});
	return {
		ordered,
		dragging: () => state().dragging,
		target: () => state().target,
		error: () => state().error,
		setContainer: (element: HTMLDivElement) => {
			container = element;
		},
		consumeClick: (event: MouseEvent) => model.consume_click(event.detail),
		onKeyDown: (event: KeyboardEvent, cwd: string) => {
			if (!event.altKey || !event.shiftKey) return;
			const direction =
				event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
			if (!direction) return;
			event.preventDefault();
			cancel?.();
			persistMove(
				model.keyboard(
					JSON.stringify(ordered().map((row) => row.cwd)),
					cwd,
					direction,
				),
			);
		},
		onPointerDown: (event: PointerEvent, cwd: string) => {
			if (event.button !== 0 || !event.isPrimary || !container) return;
			cancel?.();
			const tabs = container;
			const pointerId = event.pointerId;
			model.begin(cwd, event.clientX, event.clientY);
			let x = event.clientX;
			let y = event.clientY;
			let frame = 0;
			let lastTime = 0;
			const update = (elapsed = 0) => {
				const hit = JSON.parse(
					model.hit(
						JSON.stringify({
							rect: tabs.getBoundingClientRect(),
							x,
							y,
							cwd,
							elapsed,
							tabs: [
								...tabs.querySelectorAll<HTMLButtonElement>(
									"[data-repository-tab]",
								),
							].map((tab) => {
								const rect = tab.getBoundingClientRect();
								return {
									cwd: tab.dataset.repositoryTab,
									left: rect.left,
									width: rect.width,
								};
							}),
						}),
					),
				) as RepositoryTabDrag;
				tabs.scrollLeft += hit.scroll;
				sync();
			};
			const scroll = (time: number) => {
				update(lastTime ? Math.min(time - lastTime, 32) : 16);
				lastTime = time;
				frame = requestAnimationFrame(scroll);
			};
			const detach = () => {
				cancelAnimationFrame(frame);
				window.removeEventListener("pointermove", pointerMove);
				window.removeEventListener("pointerup", pointerUp);
				window.removeEventListener("pointercancel", pointerCancel);
				window.removeEventListener("keydown", onEscape);
				window.removeEventListener("blur", cleanup);
				cancel = undefined;
			};
			const cleanup = () => {
				detach();
				if (!disposed) {
					model.cancel();
					sync();
				}
			};
			const pointerMove = (next: PointerEvent) => {
				if (next.pointerId !== pointerId) return;
				x = next.clientX;
				y = next.clientY;
				const dragState = model.pointer_move(x, y);
				if (dragState === 0) return;
				next.preventDefault();
				if (dragState === 1) {
					sync();
					frame = requestAnimationFrame(scroll);
				}
				update();
			};
			const pointerUp = (next: PointerEvent) => {
				if (next.pointerId !== pointerId) return;
				x = next.clientX;
				y = next.clientY;
				if (model.active()) update();
				detach();
				persistMove(
					model.drop(JSON.stringify(ordered().map((row) => row.cwd))),
				);
			};
			const pointerCancel = (next: PointerEvent) => {
				if (next.pointerId === pointerId) cleanup();
			};
			const onEscape = (next: KeyboardEvent) => {
				if (next.key === "Escape") cleanup();
			};
			cancel = cleanup;
			window.addEventListener("pointermove", pointerMove, { passive: false });
			window.addEventListener("pointerup", pointerUp);
			window.addEventListener("pointercancel", pointerCancel);
			window.addEventListener("keydown", onEscape);
			window.addEventListener("blur", cleanup);
		},
	};
}
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
	const tabDrag = createRepositoryTabDrag(
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
			aria-label="Repository bar"
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
