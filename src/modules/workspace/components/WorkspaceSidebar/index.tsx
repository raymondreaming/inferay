import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../../app/hooks/useAppAppearance.tsx";
import { useAppInfo } from "../../../../app/hooks/useAppInfo.tsx";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	CREATE_AGENT_CHAT_EVENT,
	type CreateAgentChatDetail,
	type CreateAgentChatTarget,
	dispatchFocusAgentChatComposer,
	domStyle,
	listenWindowEvent,
	openSettingsModal,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "../../../../shared/lib/dom.tsx";
import {
	listenAgentLayoutMode,
	loadAgentLayoutMode,
	loadDefaultChatSettings,
	loadSidebarCollapsed,
	readStoredValue,
	sendJson,
	setAgentLayoutMode,
	writeStoredValue,
} from "../../../../shared/lib/native.tsx";
import { IconSettings } from "../../../../shared/ui/Icons/index.tsx";
import { useForgeAccounts } from "../../../repository/hooks/useForgeAccounts.tsx";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../hooks/useWorkspaceState.tsx";
import { SidebarAccountButton } from "./SidebarAccountButton.tsx";
import type { SidebarUpdateStatus } from "./SidebarFooter.tsx";
import { SidebarFooter } from "./SidebarFooter.tsx";
import { SidebarWorkspacesSection } from "./SidebarWorkspacesSection.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

type PointerMouseEvent<T = Element> = globalThis.MouseEvent & {
	currentTarget: T;
};
const MIN_SIDEBAR_WIDTH = 188;
const MAX_SIDEBAR_WIDTH = 340;
export function WorkspaceSidebar() {
	const navigate = useNavigate();
	const location = useLocation();
	const [collapsed, setCollapsed] = createSignal(loadSidebarCollapsed);
	const [sidebarWidth, setSidebarWidth] = createSignal(
		(() => {
			const stored = readStoredValue("main-sidebar-width");
			const width = stored === null ? 292 : Number(stored);
			return Number.isFinite(width)
				? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
				: 292;
		})(),
	);
	const [resizing, setResizing] = createSignal(false);
	const [updateStatus, setUpdateStatus] =
		createSignal<SidebarUpdateStatus>("idle");
	const [layoutMode, setLayoutMode] = createSignal(loadAgentLayoutMode);
	const _source = useAppInfo();
	const _source2 = useForgeAccounts();
	const githubAccount = createMemo(
		() =>
			_source2.data.find((account) => account.active) ??
			_source2.data[0] ??
			null,
	);
	const resizeRef = {
		current: null,
	} as {
		current: {
			startX: number;
			startWidth: number;
		} | null;
	};
	const resizeWidthRef = {
		current: sidebarWidth(),
	};
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
	const selectPane = async (groupId: string, paneId: string) => {
		await mutateAgentWorkspaceState({
			type: "selectPane",
			groupId,
			paneId,
		});
		if (location.pathname !== "/") {
			navigate("/");
		}
		requestAnimationFrame(() => {
			requestAnimationFrame(() => dispatchFocusAgentChatComposer(paneId));
		});
	};
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
	createEffect(
		() => [addChat],
		() => {
			const stopChat = listenWindowEvent(CREATE_AGENT_CHAT_EVENT, (event) => {
				const { target } = (event as CustomEvent<CreateAgentChatDetail>).detail;
				void addChat(target);
			});
			return stopChat;
		},
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
		await mutateAgentWorkspaceState((state) =>
			state.selectedGroupId
				? {
						type: "setGridDimensions",
						groupId: state.selectedGroupId,
						...patch,
					}
				: null,
		);
	};
	const handleResizeStart = (event: PointerMouseEvent<HTMLElement>) => {
		const _sidebarWidthValue = sidebarWidth();
		if (collapsed()) return;
		event.preventDefault();
		setResizing(true);
		resizeWidthRef.current = _sidebarWidthValue;
		resizeRef.current = {
			startX: event.clientX,
			startWidth: _sidebarWidthValue,
		};
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
	};
	const updateInfo = createMemo(() => _source.data.update);
	const updateAvailable = createMemo(() => {
		const _updateInfoValue = updateInfo();
		return _updateInfoValue.available && !!_updateInfoValue.url;
	});
	const openUpdate = () => {
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
	};
	const shellProps = createMemo(() =>
		stylex.attrs(
			styles.shell,
			!showWorkspaceSidebar() || collapsed()
				? styles.shellHidden
				: styles.shellOpen,
			resizing() && styles.shellResizing,
		),
	);
	const resizeHandleProps = createMemo(() => stylex.attrs(styles.resizeHandle));
	return (
		<aside
			{...shellProps()}
			class={`${APP_REGION_DRAG_CLASS} ${shellProps().class ?? ""}`}
			style={domStyle(
				!showWorkspaceSidebar() || collapsed()
					? undefined
					: inlineStyles.getWorkspaceSidebarAsideStyle(sidebarWidth()),
			)}
		>
			{showWorkspaceSidebar() && !collapsed() && (
				<button
					type="button"
					aria-label="Resize sidebar"
					{...resizeHandleProps()}
					class={`${APP_REGION_NO_DRAG_CLASS} ${resizeHandleProps().class ?? ""}`}
					onMouseDown={handleResizeStart}
				/>
			)}
			{showWorkspaceSidebar() && !collapsed() ? (
				<>
					<nav {...stylex.attrs(styles.nav)}>
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
