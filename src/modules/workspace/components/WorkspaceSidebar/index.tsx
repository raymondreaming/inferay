import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { sendJson } from "../../../../adapters/backend/http.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../../app/model/appearance.ts";
import {
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
} from "../../../../app/model/navigation.tsx";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useAppInfo } from "../../../../shared/hooks/useAppInfo.ts";
import { useQueryResource } from "../../../../shared/hooks/useQueryResource.tsx";
import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";
import { IconSettings, IconUser } from "../../../../shared/ui/Icons/index.tsx";
import { loadDefaultChatSettings } from "../../../agents/model/agents.ts";
import {
	fetchForgeAccounts,
	getCachedForgeAccounts,
} from "../../../repository/adapters/forge-client.ts";
import { openSettingsModal } from "../../../settings/model/settings-events.ts";
import { projectRepositoryWorkspaces } from "../../model/repository-workspaces.ts";
import { useWorkspaceState } from "../../model/useWorkspaceState.ts";
import {
	CREATE_AGENT_CHAT_EVENT,
	type CreateAgentChatDetail,
	type CreateAgentChatTarget,
	dispatchFocusAgentChatComposer,
	loadSidebarCollapsed,
	resolveCreateAgentChatCwd,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "../../model/workspace-events.ts";
import {
	type AgentShellChangeDetail,
	dispatchAgentShellChange,
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	mutateAgentWorkspaceState,
} from "../../model/workspace-model.ts";
import { SidebarFooter } from "./SidebarFooter.tsx";
import { SidebarWorkspacesSection } from "./SidebarWorkspacesSection.tsx";
import type { SidebarUpdateStatus } from "./shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

type ReactMouseEvent<T = Element> = globalThis.MouseEvent & {
	currentTarget: T;
};

const MIN_SIDEBAR_WIDTH = 188;

const MAX_SIDEBAR_WIDTH = 340;

export function WorkspaceSidebar() {
	const location = useLocation();
	const navigate = useNavigate();
	const [collapsed, setCollapsed] = useState(loadSidebarCollapsed);
	const [sidebarWidth, setSidebarWidth] = useState(() => {
		const stored = readStoredValue("main-sidebar-width");
		const width = stored === null ? 292 : Number(stored);
		return Number.isFinite(width)
			? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
			: 292;
	});
	const [resizing, setResizing] = useState(false);
	const [updateStatus, setUpdateStatus] = useState<SidebarUpdateStatus>("idle");
	const [layoutMode, setLayoutMode] = useState(loadAgentLayoutMode);
	const { data: appInfo } = useAppInfo();
	const { data: forgeAccounts } = useQueryResource(
		() => fetchForgeAccounts(),
		getCachedForgeAccounts(),
		{
			queryKey: ["forge", "accounts"],
		},
	);
	const githubAccount =
		forgeAccounts.find((account) => account.active) ?? forgeAccounts[0] ?? null;
	const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const resizeWidthRef = useRef(sidebarWidth);
	const [mainView, setMainView] = useState(() => {
		const stored = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
		return isAgentMainView(stored) ? stored : DEFAULT_AGENT_MAIN_VIEW;
	});
	const showWorkspaceSidebar =
		location.pathname === "/agent" && mainView === "chat";

	useEffect(
		() =>
			listenWindowEvent("agent-shell-change", (event) => {
				const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
				if (detail?.source !== "view" || detail.reason !== "main-view") return;
				const stored = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
				setMainView(isAgentMainView(stored) ? stored : DEFAULT_AGENT_MAIN_VIEW);
			}),
		[],
	);
	useEffect(
		() =>
			listenWindowEvent(WORKSPACE_SIDEBAR_COLLAPSED_EVENT, (event) => {
				setCollapsed(
					(event as CustomEvent<WorkspaceSidebarCollapsedDetail>).detail
						.collapsed,
				);
			}),
		[],
	);
	const [workspaces, setWorkspaces] = useWorkspaceState();
	const repositoryProjection = useMemo(
		() =>
			projectRepositoryWorkspaces(
				workspaces.groups,
				workspaces.selectedGroupId,
			),
		[workspaces.groups, workspaces.selectedGroupId],
	);

	useEffect(() => listenAgentLayoutMode(setLayoutMode), []);

	const selectPane = useCallback(
		async (groupId: string, paneId: string) => {
			await mutateAgentWorkspaceState(
				{ type: "selectPane", groupId, paneId },
				"select-pane",
			);
			if (location.pathname !== "/agent") {
				navigate({ to: "/agent" });
			}
			requestAnimationFrame(() => {
				requestAnimationFrame(() => dispatchFocusAgentChatComposer(paneId));
			});
		},
		[location.pathname, navigate],
	);

	const addChat = useCallback(
		async (target: CreateAgentChatTarget) => {
			if (target === "new-repository") {
				await mutateAgentWorkspaceState(
					{ type: "addWorkspace" },
					"open-repository",
					{ createIfMissing: true },
				);
				navigate({ to: "/agent" });
				return;
			}
			const cwd = resolveCreateAgentChatCwd(
				target,
				repositoryProjection.activeWorkspace?.cwd,
			);
			await mutateAgentWorkspaceState(
				{
					type: "addPane",
					agentKind: loadDefaultChatSettings().agentKind,
					cwd,
				},
				"add-pane",
				{ createIfMissing: true },
			);
			navigate({ to: "/agent" });
		},
		[navigate, repositoryProjection.activeWorkspace?.cwd],
	);

	useEffect(() => {
		const stopChat = listenWindowEvent(CREATE_AGENT_CHAT_EVENT, (event) => {
			const { target } = (event as CustomEvent<CreateAgentChatDetail>).detail;
			void addChat(target);
		});
		return stopChat;
	}, [addChat]);

	const updateLayoutMode = useCallback(
		(mode: "grid" | "rows") => {
			if (mode === layoutMode) return;
			writeStoredValue("agent-layout-mode", mode);
			setLayoutMode(mode);
			dispatchAgentShellChange({ source: "view", reason: "layout-mode" });
		},
		[layoutMode],
	);

	const updateSelectedGroupGrid = useCallback(
		async (patch: { columns?: number; rows?: number }) => {
			setWorkspaces((current) => {
				let changed = false;
				const groups = current.groups.map((group) => {
					if (group.id !== current.selectedGroupId) return group;
					const columns = patch.columns ?? group.columns;
					const rows = patch.rows ?? group.rows;
					if (columns === group.columns && rows === group.rows) return group;
					changed = true;
					return { ...group, columns, rows };
				});
				return changed ? { ...current, groups } : current;
			});
			await mutateAgentWorkspaceState(
				(state) =>
					state.selectedGroupId
						? {
								type: "setGridDimensions",
								groupId: state.selectedGroupId,
								...patch,
							}
						: null,
				"grid-size",
			);
		},
		[],
	);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			if (collapsed) return;
			event.preventDefault();
			setResizing(true);
			resizeWidthRef.current = sidebarWidth;
			resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
			const handleMove = (moveEvent: MouseEvent) => {
				if (!resizeRef.current) return;
				const delta = moveEvent.clientX - resizeRef.current.startX;
				const nextWidth = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(MIN_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta),
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
		[collapsed, sidebarWidth],
	);

	const updateInfo = appInfo.update;
	const updateAvailable = updateInfo.available && !!updateInfo.url;
	const openUpdate = useCallback(() => {
		setUpdateStatus("updating");
		void sendJson("/api/native/update")
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Update request failed: ${response.status}`);
				}
			})
			.catch((error) => {
				if (error instanceof TypeError) return;
				console.error("[update] failed", error);
				setUpdateStatus("error");
			});
	}, []);
	const shellProps = stylex.props(
		styles.shell,
		!showWorkspaceSidebar || collapsed ? styles.shellHidden : styles.shellOpen,
		resizing && styles.shellResizing,
	);
	const resizeHandleProps = stylex.props(styles.resizeHandle);

	return (
		<aside
			{...shellProps}
			className={`${APP_REGION_DRAG_CLASS} ${shellProps.className ?? ""}`}
			style={
				!showWorkspaceSidebar || collapsed
					? undefined
					: inlineStyles.getWorkspaceSidebarAsideStyle(sidebarWidth)
			}
		>
			{showWorkspaceSidebar && !collapsed && (
				<button
					type="button"
					aria-label="Resize sidebar"
					{...resizeHandleProps}
					className={`${APP_REGION_NO_DRAG_CLASS} ${resizeHandleProps.className ?? ""}`}
					onMouseDown={handleResizeStart}
				/>
			)}
			{showWorkspaceSidebar && !collapsed ? (
				<>
					<nav {...stylex.props(styles.nav)}>
						<SidebarWorkspacesSection
							collapsed={collapsed}
							workspaces={workspaces}
							layoutMode={layoutMode}
							onUpdateLayoutMode={updateLayoutMode}
							onUpdateGrid={updateSelectedGroupGrid}
							onSelectPane={selectPane}
							onExpandSidebar={() => setCollapsed(false)}
						/>
					</nav>
					<div {...stylex.props(styles.sidebarAccountArea)}>
						<SidebarFooter
							updateAvailable={updateAvailable}
							updateInfo={updateInfo}
							updateStatus={updateStatus}
							onUpdate={openUpdate}
						/>
						<button
							type="button"
							onClick={() => openSettingsModal()}
							{...stylex.props(styles.sidebarSettings)}
						>
							<IconSettings size={iconSize.md} />
							<span>Settings</span>
						</button>
						<button
							type="button"
							onClick={() => openSettingsModal("github")}
							{...stylex.props(styles.sidebarAccount)}
							title="Account settings"
						>
							{githubAccount?.avatarUrl ? (
								<img
									src={githubAccount.avatarUrl}
									alt=""
									{...stylex.props(styles.sidebarAvatar)}
								/>
							) : (
								<span {...stylex.props(styles.sidebarAvatarFallback)}>
									<IconUser size={iconSize.sm} />
								</span>
							)}
							<span {...stylex.props(styles.sidebarUsername)}>
								{githubAccount?.login || "GitHub account"}
							</span>
						</button>
					</div>
				</>
			) : null}
		</aside>
	);
}
