import type { SidebarResize } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { useForgeAccounts } from "@repository/hooks/useForgeAccounts.tsx";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
	CREATE_AGENT_CHAT_EVENT,
	type CreateAgentChatDetail,
	type CreateAgentChatTarget,
	dispatchCreateAgentChat,
	listenWindowEvent,
	openSettingsModal,
	px,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "@shared/lib/dom.tsx";
import {
	loadDefaultChatSettings,
	loadSidebarCollapsed,
	project,
	readStoredValue,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconPlus, IconSettings, IconUser } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	checkNativeUpdate,
	loadAppInfo,
} from "@workspace/services/workspaceApi.ts";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
} from "solid-js";
import { showProjectView } from "../../hooks/useProjects.tsx";
import {
	mutateAgentWorkspaceState,
	openAgentPane,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { ProjectNavigation } from "../ProjectsPanel/ProjectNavigation.tsx";
import { SidebarChatList } from "./SidebarChatList.tsx";
import type { SidebarUpdateStatus } from "./SidebarFooter.tsx";
import { SidebarFooter } from "./SidebarFooter.tsx";
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
	const [collapsed, setCollapsed] = createSignal(loadSidebarCollapsed);
	const resize = useSidebarResize(collapsed);
	const [updateStatus, setUpdateStatus] =
		createSignal<SidebarUpdateStatus>("idle");
	const [updateError, setUpdateError] = createSignal<string>();
	const appInfo = useBackgroundQuery(() => ({
		queryKey: ["app-info"],
		queryFn: loadAppInfo,
	}));
	const _source2 = useForgeAccounts();
	const githubAccount = createMemo(
		() =>
			_source2.data.find((account) => account.active) ??
			_source2.data[0] ??
			null,
	);
	onSettled(() => {
		return listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
			setCollapsed(
				(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
					.collapsed,
			);
		});
	});
	const [workspaces] = useWorkspaceState();
	const selectPane = (_groupId: string, paneId: string) =>
		openAgentPane(paneId);
	const addChat = async (target: CreateAgentChatTarget) => {
		if (target === "new-repository") {
			await mutateAgentWorkspaceState({
				type: "addWorkspace",
			});
			showProjectView("code");
			return;
		}
		await mutateAgentWorkspaceState({
			type: "addPane",
			agentKind: loadDefaultChatSettings().agentKind,
		});
		showProjectView("chat");
	};
	onSettled(() =>
		listenWindowEvent(CREATE_AGENT_CHAT_EVENT, (event) => {
			const { target } = (event as CustomEvent<CreateAgentChatDetail>).detail;
			void addChat(target);
		}),
	);
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
			collapsed() ? styles.shellHidden : styles.shellOpen,
			resize.resizing() && styles.shellResizing,
		),
	);
	const resizeHandleProps = createMemo(() => stylex.attrs(styles.resizeHandle));
	return (
		<aside
			aria-label="Workspace sidebar"
			{...shellProps()}
			class={`${APP_REGION_DRAG_CLASS} ${shellProps().class ?? ""}`}
			style={
				collapsed()
					? undefined
					: {
							width: px(resize.width()),
						}
			}
		>
			{!collapsed() && (
				<button
					type="button"
					aria-label="Resize sidebar"
					{...resizeHandleProps()}
					class={`${APP_REGION_NO_DRAG_CLASS} ${resizeHandleProps().class ?? ""}`}
					onMouseDown={resize.start}
				/>
			)}
			{!collapsed() ? (
				<>
					<ProjectNavigation />
					<nav aria-label="Workspaces" {...stylex.attrs(styles.nav)}>
						<div {...stylex.attrs(styles.workspaceSection)}>
							<div {...stylex.attrs(styles.workspaceListScroll)}>
								<div {...stylex.attrs(styles.workspaceSectionHeader)}>
									<span {...stylex.attrs(styles.workspaceSectionTitle)}>
										Chats
									</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => dispatchCreateAgentChat()}
									>
										<IconPlus size={iconSize.md} /> New chat
									</Button>
								</div>
								<SidebarChatList
									workspaces={workspaces()}
									onSelectPane={selectPane}
								/>
							</div>
						</div>
					</nav>
					<div {...stylex.attrs(styles.sidebarAccountArea)}>
						<SidebarFooter
							updateInfo={appInfo.data?.update}
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
						<button
							type="button"
							onClick={() => openSettingsModal("github")}
							{...stylex.attrs(styles.sidebarAccount)}
							title="Account settings"
						>
							{githubAccount()?.avatarUrl ? (
								<img
									src={githubAccount()?.avatarUrl ?? undefined}
									alt=""
									{...stylex.attrs(styles.sidebarAvatar)}
								/>
							) : (
								<span {...stylex.attrs(styles.sidebarAvatarFallback)}>
									<IconUser size={iconSize.sm} />
								</span>
							)}
							<span {...stylex.attrs(styles.sidebarUsername)}>
								{githubAccount()?.login || "GitHub account"}
							</span>
						</button>
					</div>
				</>
			) : null}
		</aside>
	);
}
