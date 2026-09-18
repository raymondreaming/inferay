import type { SidebarResize } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { useForgeAccounts } from "@repository/hooks/useForgeAccounts.tsx";
import { useAppInfo } from "@shared/hooks/useAppInfo.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
	CREATE_AGENT_CHAT_EVENT,
	type CreateAgentChatDetail,
	type CreateAgentChatTarget,
	domStyle,
	listenWindowEvent,
	openSettingsModal,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "@shared/lib/dom.tsx";
import {
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	loadDefaultChatSettings,
	loadSidebarCollapsed,
	project,
	readStoredValue,
	setAgentLayoutMode,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { IconSettings } from "@shared/ui/Icons/index.tsx";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { checkNativeUpdate } from "@workspace/services/workspaceApi.ts";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
} from "solid-js";
import {
	mutateAgentWorkspaceState,
	openAgentPane,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { SidebarAccountButton } from "./SidebarAccountButton.tsx";
import type { SidebarUpdateStatus } from "./SidebarFooter.tsx";
import { SidebarFooter } from "./SidebarFooter.tsx";
import { SidebarWorkspacesSection } from "./SidebarWorkspacesSection.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

const SIDEBAR_WIDTH_KEY = "main-sidebar-width";

export function useSidebarResize(collapsed: () => boolean) {
	let currentResize = project<SidebarResize>("sidebarResize", {
		stored: readStoredValue(SIDEBAR_WIDTH_KEY),
	});
	const [resizeState, setResizeState] = createSignal(currentResize);
	const commitResize = (next: SidebarResize) => {
		currentResize = next;
		setResizeState(next);
	};
	let resizeDisposed = false;
	const releaseResize = () => {
		window.removeEventListener("mousemove", moveResize);
		window.removeEventListener("mouseup", finishResize);
		window.removeEventListener("blur", cancelResize);
	};
	const updateResize = (action: string, facts: object = {}) =>
		project<SidebarResize>("sidebarResize", {
			state: currentResize,
			action,
			...facts,
		});
	const moveResize = (event: MouseEvent) =>
		commitResize(updateResize("move", { x: event.clientX }));
	const finishResize = () => {
		const next = updateResize("finish");
		commitResize(next);
		releaseResize();
		if (next.persist !== null)
			writeStoredValue(SIDEBAR_WIDTH_KEY, String(next.persist));
	};
	const cancelResize = () => {
		commitResize(updateResize("cancel"));
		releaseResize();
	};
	const resize = {
		width: () => resizeState().width,
		resizing: () => resizeState().resizing,
		start: (event: MouseEvent) => {
			const wasResizing = resizeState().resizing;
			const next = updateResize("start", {
				x: event.clientX,
				button: event.button,
				collapsed: collapsed(),
				disposed: resizeDisposed,
			});
			if (!next.resizing || wasResizing) return;
			commitResize(next);
			event.preventDefault();
			window.addEventListener("mousemove", moveResize);
			window.addEventListener("mouseup", finishResize);
			window.addEventListener("blur", cancelResize);
		},
	};
	createEffect(collapsed, (hidden) => {
		if (hidden) cancelResize();
	});
	onCleanup(() => {
		resizeDisposed = true;
		releaseResize();
	});
	return resize;
}

export function WorkspaceSidebar() {
	const navigate = useNavigate();
	const location = useLocation();
	const [collapsed, setCollapsed] = createSignal(loadSidebarCollapsed);
	const resize = useSidebarResize(collapsed);
	const [updateStatus, setUpdateStatus] =
		createSignal<SidebarUpdateStatus>("idle");
	const [updateError, setUpdateError] = createSignal<string>();
	const [layoutMode, setLayoutMode] = createSignal(loadAgentLayoutMode);
	const _source = useAppInfo();
	const _source2 = useForgeAccounts();
	const githubAccount = createMemo(
		() =>
			_source2.data.find((account) => account.active) ??
			_source2.data[0] ??
			null,
	);
	const showWorkspaceSidebar = createMemo(() => location.pathname === "/");
	onSettled(() => {
		return listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
			setCollapsed(
				(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
					.collapsed,
			);
		});
	});
	const [workspaces, setWorkspaces] = useWorkspaceState();
	onSettled(() => {
		return listenAgentLayoutMode(setLayoutMode);
	});
	const selectPane = (groupId: string, paneId: string) =>
		openAgentPane(groupId, paneId, () => {
			if (location.pathname !== "/") navigate("/");
		});
	const addChat = async (target: CreateAgentChatTarget) => {
		if (target === "new-repository") {
			await mutateAgentWorkspaceState({
				type: "addWorkspace",
			});
			navigate("/");
			return;
		}
		await mutateAgentWorkspaceState({
			type: "addPane",
			agentKind: loadDefaultChatSettings().agentKind,
			cwd: workspaces().repositories.activeWorkspace?.cwd,
		});
		navigate("/");
	};
	onSettled(() =>
		listenWindowEvent(CREATE_AGENT_CHAT_EVENT, (event) => {
			const { target } = (event as CustomEvent<CreateAgentChatDetail>).detail;
			void addChat(target);
		}),
	);
	const updateLayoutMode = (mode: "grid" | "rows") => {
		if (mode === layoutMode()) return;
		setLayoutMode(mode);
		setAgentLayoutMode(mode);
	};
	const updateSelectedGroupGrid = async (patch: {
		columns?: number;
		rows?: number;
	}) => {
		setWorkspaces((current) => {
			let changed = false;
			const groups = current.groups.map((group) => {
				if (group.id !== current.selectedGroupId) return group;
				const columns = patch.columns ?? group.columns;
				const rows = patch.rows ?? group.rows;
				if (columns === group.columns && rows === group.rows) return group;
				changed = true;
				return {
					...group,
					columns,
					rows,
				};
			});
			return changed
				? {
						...current,
						groups,
					}
				: current;
		});
		const groupId = workspaces().selectedGroupId;
		if (groupId)
			await mutateAgentWorkspaceState({
				type: "setGridDimensions",
				groupId,
				...patch,
			});
	};
	const updateInfo = createMemo(() => _source.data.update);
	const updateAvailable = createMemo(() => {
		const _updateInfoValue = updateInfo();
		return _updateInfoValue.available && !!_updateInfoValue.url;
	});
	let updateTimer: ReturnType<typeof setTimeout> | undefined;
	let updateRequest: AbortController | undefined;
	let updateDisposed = false;
	const checkUpdate = async (method: "GET" | "POST") => {
		clearTimeout(updateTimer);
		updateRequest?.abort();
		const request = new AbortController();
		updateRequest = request;
		try {
			const result = await checkNativeUpdate(method, request.signal);
			if (updateDisposed || request.signal.aborted) return;
			if (!["idle", "updating", "complete"].includes(result.status))
				throw new Error(
					"The updater did not report its status. Quit and reopen Inferay.",
				);
			setUpdateStatus(result.status);
			setUpdateError(undefined);
			if (result.status === "updating")
				updateTimer = setTimeout(() => void checkUpdate("GET"), 1000);
		} catch (error) {
			if (updateDisposed || request.signal.aborted) return;
			setUpdateStatus("error");
			setUpdateError(
				error instanceof Error ? error.message : "Could not reach the updater.",
			);
		}
	};
	onSettled(() => {
		void checkUpdate("GET");
		return () => {
			updateDisposed = true;
			clearTimeout(updateTimer);
			updateRequest?.abort();
		};
	});
	const openUpdate = () => {
		if (updateStatus() === "updating") return;
		setUpdateStatus("updating");
		setUpdateError(undefined);
		void checkUpdate("POST");
	};

	const shellProps = createMemo(() =>
		stylex.attrs(
			styles.shell,
			!showWorkspaceSidebar() || collapsed()
				? styles.shellHidden
				: styles.shellOpen,
			resize.resizing() && styles.shellResizing,
		),
	);
	const resizeHandleProps = createMemo(() => stylex.attrs(styles.resizeHandle));
	return (
		<aside
			aria-label="Workspace sidebar"
			{...shellProps()}
			class={`${APP_REGION_DRAG_CLASS} ${shellProps().class ?? ""}`}
			style={domStyle(
				!showWorkspaceSidebar() || collapsed()
					? undefined
					: inlineStyles.getWorkspaceSidebarAsideStyle(resize.width()),
			)}
		>
			{showWorkspaceSidebar() && !collapsed() && (
				<button
					type="button"
					aria-label="Resize sidebar"
					{...resizeHandleProps()}
					class={`${APP_REGION_NO_DRAG_CLASS} ${resizeHandleProps().class ?? ""}`}
					onMouseDown={resize.start}
				/>
			)}
			{showWorkspaceSidebar() && !collapsed() ? (
				<>
					<nav aria-label="Workspaces" {...stylex.attrs(styles.nav)}>
						<SidebarWorkspacesSection
							collapsed={collapsed()}
							workspaces={workspaces()}
							layoutMode={layoutMode()}
							onUpdateLayoutMode={updateLayoutMode}
							onUpdateGrid={updateSelectedGroupGrid}
							onSelectPane={selectPane}
							onExpandSidebar={() => setCollapsed(false)}
						/>
					</nav>
					<div {...stylex.attrs(styles.sidebarAccountArea)}>
						<SidebarFooter
							updateAvailable={updateAvailable()}
							updateInfo={updateInfo()}
							updateStatus={updateStatus()}
							updateError={updateError()}
							onUpdate={openUpdate}
						/>
						<button
							type="button"
							onClick={() => openSettingsModal()}
							{...stylex.attrs(styles.sidebarSettings)}
						>
							<IconSettings size={iconSize.md} />
							<span>Settings</span>
						</button>
						<SidebarAccountButton githubAccount={githubAccount()} />
					</div>
				</>
			) : null}
		</aside>
	);
}
