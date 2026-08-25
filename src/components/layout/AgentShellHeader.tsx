import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useRef, useState } from "octane";
import { iconSize, runtimeColor } from "../../design-system.ts";
import {
	agentStateKey,
	dispatchAgentShellChange,
	loadAgentState,
} from "../../features/agent/agent-utils.ts";
import { dispatchWorkspaceFileOpen } from "../../features/files/workspace-file-events.ts";
import { useQueryResource } from "../../hooks/useQueryResource.tsx";
import {
	AGENT_MAIN_VIEWS,
	type AgentMainView,
	APP_PAGE_ROUTES,
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
	SIDEBAR_NAV_ROUTES,
} from "../../lib/app-navigation.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../lib/app-theme.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { fetchJsonOr } from "../../lib/fetch-json.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	readStoredBoolean,
	readStoredValue,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { WorkspaceFileSearch } from "../file/WorkspaceFileSearch.tsx";
import { LiquidAction } from "../ui/gooey/LiquidAction.tsx";
import { LiquidCreateMenu } from "../ui/gooey/LiquidCreateMenu.tsx";
import { LiquidSegmentedRail } from "../ui/gooey/LiquidSegmentedRail.tsx";
import {
	IconPanelLeft,
	IconPlus,
	IconUser,
	IconWorkflow,
} from "../ui/Icons.tsx";

interface ForgeAccount {
	provider: "github";
	host: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	email: string | null;
	active: boolean;
}

function sameForgeAccount(a: ForgeAccount | null, b: ForgeAccount | null) {
	return (
		a === b ||
		(!!a &&
			!!b &&
			a.host === b.host &&
			a.login === b.login &&
			a.name === b.name &&
			a.avatarUrl === b.avatarUrl &&
			a.active === b.active)
	);
}

async function loadGithubAccount(): Promise<ForgeAccount | null> {
	const payload = await fetchJsonOr<{ accounts?: ForgeAccount[] }>(
		"/api/forge/accounts",
		{},
	);
	const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
	return accounts.find((item) => item.active) ?? accounts[0] ?? null;
}

const AUTOMATIONS_ROUTE = APP_PAGE_ROUTES.find(
	(route) => route.id === "automations",
);
function loadShellState() {
	const agentState = loadAgentState();
	const mainView = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);

	return {
		groups: agentState?.groups ?? [],
		selectedGroupId:
			agentState?.selectedGroupId ?? agentState?.groups[0]?.id ?? null,
		mainView: isAgentMainView(mainView) ? mainView : DEFAULT_AGENT_MAIN_VIEW,
		key: agentState ? agentStateKey(agentState) : "",
	};
}

function ViewTab({
	active,
	icon,
	label,
	onClick,
	top = false,
	trailing = false,
}: {
	active: boolean;
	icon: unknown;
	label: string;
	onClick: () => void;
	top?: boolean;
	trailing?: boolean;
}) {
	const tabProps = stylex.props(
		styles.viewTab,
		top ? styles.viewTabTop : null,
		trailing ? styles.viewTabTrailing : null,
		active ? styles.viewTabActive : null,
		active && top ? styles.viewTabTopActive : null,
	);
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onPointerDown={(event) => {
				if (event.button === 0 && event.isPrimary) onClick();
			}}
			onClick={(event) => {
				// Pointer activation already ran on press; detail 0 preserves
				// keyboard and assistive-technology activation.
				if (event.detail === 0) onClick();
			}}
			{...tabProps}
			className={`${APP_REGION_NO_DRAG_CLASS} ${tabProps.className ?? ""}`}
		>
			{icon}
			{top ? (
				<span {...stylex.props(styles.viewTabLabel)}>{label}</span>
			) : (
				<span {...stylex.props(styles.viewTabTooltip)}>{label}</span>
			)}
			{active && !top ? (
				<span aria-hidden="true" {...stylex.props(styles.activeSignal)} />
			) : null}
		</button>
	);
}

export function AgentShellHeader() {
	const location = useLocation();
	const navigate = useNavigate();
	const [shellState, setShellState] = useState(loadShellState);
	const [pendingNavigationTarget, setPendingNavigationTarget] = useState<
		string | null
	>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
		readStoredBoolean("sidebar-collapsed"),
	);
	const [createMenuOpen, setCreateMenuOpen] = useState(false);
	const createMenuRef = useRef<HTMLDivElement | null>(null);
	const { data: githubAccount, refresh: refreshGithubAccount } =
		useQueryResource(loadGithubAccount, null, {
			queryKey: ["forge", "active-account"],
			isEqual: sameForgeAccount,
		});
	const isAgentRoute = location.pathname === "/agent";
	const resolvedNavigationTarget = isAgentRoute
		? `view:${shellState.mainView}`
		: `route:${location.pathname}`;
	const activeNavigationTarget =
		pendingNavigationTarget ?? resolvedNavigationTarget;
	const workspaceNavigationActive =
		isAgentRoute && shellState.mainView === "chat" && !sidebarCollapsed;

	const refreshShellState = useCallback(() => {
		const next = loadShellState();
		setShellState((current) =>
			current.key === next.key && current.mainView === next.mainView
				? current
				: next,
		);
	}, []);

	useEffect(() => {
		return listenWindowEvent("agent-shell-change", refreshShellState);
	}, [refreshShellState]);

	useEffect(
		() =>
			listenWindowEvent("toggle-main-sidebar", () =>
				setSidebarCollapsed((current) => !current),
			),
		[],
	);
	useEffect(() => {
		if (!createMenuOpen) return;
		const closeMenu = (event: MouseEvent) => {
			if (!createMenuRef.current?.contains(event.target as Node)) {
				setCreateMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", closeMenu);
		return () => document.removeEventListener("mousedown", closeMenu);
	}, [createMenuOpen]);

	const createFromRail = (eventName: string) => {
		setCreateMenuOpen(false);
		window.dispatchEvent(new CustomEvent(eventName));
	};
	useEffect(
		() => listenWindowEvent("focus", () => void refreshGithubAccount()),
		[refreshGithubAccount],
	);

	const updateMainView = useCallback(
		(view: AgentMainView) => {
			if (shellState.mainView !== view) {
				writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, view);
				setShellState((current) =>
					current.mainView === view ? current : { ...current, mainView: view },
				);
				dispatchAgentShellChange({
					source: "view",
					reason: "main-view",
					mainView: view,
				});
			}
			if (!isAgentRoute) navigate({ to: "/agent" });
		},
		[isAgentRoute, navigate, shellState.mainView],
	);

	useEffect(() => {
		setPendingNavigationTarget((current) =>
			current === resolvedNavigationTarget ? null : current,
		);
	}, [resolvedNavigationTarget]);

	const activateMainView = useCallback(
		(view: AgentMainView) => {
			const target = `view:${view}`;
			if (target !== resolvedNavigationTarget) {
				setPendingNavigationTarget(target);
			}
			updateMainView(view);
		},
		[resolvedNavigationTarget, updateMainView],
	);

	const activateRoute = useCallback(
		(path: string) => {
			const target = `route:${path}`;
			if (target !== resolvedNavigationTarget) {
				setPendingNavigationTarget(target);
			}
			navigate({ to: path });
		},
		[navigate, resolvedNavigationTarget],
	);
	const railCreateOffset = sidebarCollapsed ? 1 : 0;
	const mainViewIndex = AGENT_MAIN_VIEWS.findIndex(
		(view) => activeNavigationTarget === `view:${view.id}`,
	);
	const routeIndex = SIDEBAR_NAV_ROUTES.findIndex(
		(route) => activeNavigationTarget === `route:${route.path}`,
	);
	const railActiveIndex =
		sidebarCollapsed && createMenuOpen
			? 0
			: mainViewIndex >= 0
				? railCreateOffset + mainViewIndex
				: routeIndex >= 0
					? railCreateOffset + AGENT_MAIN_VIEWS.length + routeIndex
					: AUTOMATIONS_ROUTE &&
							activeNavigationTarget === `route:${AUTOMATIONS_ROUTE.path}`
						? railCreateOffset +
							AGENT_MAIN_VIEWS.length +
							SIDEBAR_NAV_ROUTES.length
						: -1;
	const railItemCount =
		railCreateOffset +
		AGENT_MAIN_VIEWS.length +
		SIDEBAR_NAV_ROUTES.length +
		(AUTOMATIONS_ROUTE ? 1 : 0);
	const selectedGroup = shellState.groups.find(
		(group) => group.id === shellState.selectedGroupId,
	);
	const workspaceCwd = selectedGroup?.panes.find(
		(pane) => pane.id === selectedGroup.selectedPaneId,
	)?.cwd;

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
		>
			<nav aria-label="Primary views" {...stylex.props(styles.topTabs)}>
				{isAgentRoute ? (
					<div
						{...stylex.props(styles.fileSearch)}
						className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.fileSearch).className ?? ""}`}
					>
						<WorkspaceFileSearch
							cwd={workspaceCwd}
							onSelect={(file) =>
								dispatchWorkspaceFileOpen({
									cwd: file.cwd ?? workspaceCwd!,
									path: file.path,
								})
							}
						/>
					</div>
				) : null}
				<span {...stylex.props(styles.accountSpacer)} />
				<LiquidAction fill={runtimeColor.surfaceGlassStrong}>
					<button
						type="button"
						onPointerDown={(event) => {
							if (event.button === 0 && event.isPrimary)
								navigate({ to: "/profile" });
						}}
						onClick={(event) => {
							if (event.detail === 0) navigate({ to: "/profile" });
						}}
						className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.accountButton).className ?? ""}`}
						title="Account settings"
					>
						<span {...stylex.props(styles.accountLabel)}>
							{githubAccount?.login || githubAccount?.name || "Account"}
						</span>
						{githubAccount?.avatarUrl ? (
							<img
								src={githubAccount.avatarUrl}
								alt=""
								{...stylex.props(styles.accountAvatar)}
							/>
						) : (
							<span {...stylex.props(styles.accountFallback)}>
								{githubAccount?.login ? (
									githubAccount.login.slice(0, 2)
								) : (
									<IconUser size={iconSize.sm} />
								)}
							</span>
						)}
					</button>
				</LiquidAction>
			</nav>
			<nav
				aria-label="Application views"
				{...stylex.props(
					styles.viewTabs,
					workspaceNavigationActive && styles.viewTabsAttached,
				)}
			>
				<button
					type="button"
					aria-label={
						sidebarCollapsed
							? "Expand workspace sidebar"
							: "Collapse workspace sidebar"
					}
					title={
						sidebarCollapsed
							? "Expand workspace sidebar"
							: "Collapse workspace sidebar"
					}
					{...stylex.props(styles.sidebarToggle)}
					className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.sidebarToggle).className ?? ""}`}
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary)
							window.dispatchEvent(new CustomEvent("toggle-main-sidebar"));
					}}
					onClick={(event) => {
						if (event.detail === 0)
							window.dispatchEvent(new CustomEvent("toggle-main-sidebar"));
					}}
				>
					<IconPanelLeft size={iconSize.lg} />
				</button>
				<span aria-hidden="true" {...stylex.props(styles.railDivider)} />
				<div {...stylex.props(styles.tabGroup, styles.secondaryTabGroup)}>
					<LiquidSegmentedRail
						activeIndex={railActiveIndex}
						itemCount={railItemCount}
						direction="vertical"
						fill="rgba(255,255,255,0.105)"
						radius={16}
						itemSize={32}
						gap={3}
					/>
					{sidebarCollapsed ? (
						<div ref={createMenuRef} {...stylex.props(styles.railCreateWrap)}>
							<LiquidCreateMenu
								open={createMenuOpen}
								fill={runtimeColor.backgroundRaised}
								fullWidth
								onNewChat={() => createFromRail("create-agent-chat")}
								onNewWorkspace={() => createFromRail("create-agent-workspace")}
								trigger={
									<ViewTab
										active={createMenuOpen}
										icon={<IconPlus size={iconSize._2md} />}
										label="Create"
										onClick={() => setCreateMenuOpen((open) => !open)}
									/>
								}
							/>
						</div>
					) : null}
					{AGENT_MAIN_VIEWS.map((view) => {
						const Icon = view.icon;
						return (
							<ViewTab
								key={view.id}
								active={activeNavigationTarget === `view:${view.id}`}
								icon={<Icon size={iconSize.md} />}
								label={view.label}
								onClick={() => activateMainView(view.id)}
							/>
						);
					})}
					{SIDEBAR_NAV_ROUTES.map((route) => {
						const Icon = route.icon;
						return (
							<ViewTab
								key={route.id}
								active={activeNavigationTarget === `route:${route.path}`}
								icon={<Icon size={iconSize.md} />}
								label={route.label}
								onClick={() => activateRoute(route.path)}
							/>
						);
					})}
					{AUTOMATIONS_ROUTE && (
						<ViewTab
							active={
								activeNavigationTarget === `route:${AUTOMATIONS_ROUTE.path}`
							}
							icon={<IconWorkflow size={iconSize.md} />}
							label={AUTOMATIONS_ROUTE.label}
							onClick={() => activateRoute(AUTOMATIONS_ROUTE.path)}
							trailing
						/>
					)}
				</div>
			</nav>
		</div>
	);
}

const styles = stylex.create({
	header: {
		position: "absolute",
		top: controlSize._0,
		left: controlSize._0,
		right: controlSize._0,
		bottom: controlSize._0,
		zIndex: layer.searchPopover,
		pointerEvents: "none",
		userSelect: "none",
	},
	topTabs: {
		position: "absolute",
		top: controlSize._0,
		left: controlSize._0,
		right: controlSize._0,
		zIndex: layer.titlebarMenu,
		alignItems: "flex-end",
		backgroundColor: color.transparent,
		display: "flex",
		gap: controlSize._1_5,
		height: controlSize._9,
		paddingLeft: 84,
		paddingRight: controlSize._2_5,
		pointerEvents: "auto",
	},
	topViewGroup: {
		position: "relative",
		isolation: "isolate",
		display: "flex",
		alignItems: "flex-end",
		gap: controlSize._1_5,
		height: 30,
	},
	fileSearch: {
		display: "flex",
		alignItems: "flex-end",
		minWidth: controlSize._0,
	},
	accountSpacer: {
		flex: 1,
	},
	accountButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
		borderColor: color.transparent,
		borderRadius: radius.px9,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		height: controlSize._7,
		marginBottom: controlSize._1,
		paddingInline: controlSize._2,
	},
	accountLabel: {
		maxWidth: 160,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	accountAvatar: {
		borderColor: color.border,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		height: controlSize._5,
		objectFit: "cover",
		width: controlSize._5,
	},
	accountFallback: {
		alignItems: "center",
		backgroundColor: color.controlActive,
		borderRadius: radius.pill,
		display: "flex",
		height: controlSize._5,
		justifyContent: "center",
		textTransform: "uppercase",
		width: controlSize._5,
	},
	viewTabs: {
		position: "absolute",
		top: controlSize._9,
		left: controlSize._3,
		bottom: controlSize._3,
		alignItems: "center",
		backdropFilter: "blur(var(--inferay-glass-blur, 4px)) saturate(104%)",
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-black) 46%, transparent)",
		borderColor: color.surfaceWhite13,
		borderRadius: radius.px15,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.055), 0 18px 50px rgba(0,0,0,0.46)",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1_25,
		padding: controlSize._1_25,
		pointerEvents: "auto",
		width: 42,
	},
	viewTabsAttached: {
		backdropFilter: "none",
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		boxShadow: "none",
	},
	tabGroup: {
		position: "relative",
		isolation: "isolate",
		alignItems: "center",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_75,
		width: "100%",
	},
	secondaryTabGroup: {
		marginTop: controlSize._0,
	},
	railCreateWrap: {
		position: "relative",
	},
	viewTab: {
		position: "relative",
		zIndex: layer.content,
		alignItems: "center",
		borderColor: color.transparent,
		borderRadius: radius.circle,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		justifyContent: "center",
		height: controlSize._8,
		padding: controlSize._0,
		transitionDuration: motion.durationFast,
		transitionProperty: "color, background-color, border-color, transform",
		transitionTimingFunction: "ease-out",
		width: controlSize._8,
		backgroundColor: {
			default: color.transparent,
			":hover": "rgba(255,255,255,0.07)",
		},
		":hover": {
			transform: "translateX(1px)",
		},
	},
	viewTabTrailing: {
		marginTop: controlSize._0,
	},
	viewTabTop: {
		borderTopLeftRadius: 11,
		borderTopRightRadius: 11,
		borderBottomLeftRadius: 11,
		borderBottomRightRadius: 11,
		fontSize: font.size_3,
		gap: "0.375rem",
		height: 30,
		paddingInline: "0.625rem",
		transitionDuration: motion.durationQuick,
		transitionProperty: "color",
		width: 70,
		backgroundColor: {
			default: color.transparent,
			":hover": color.transparent,
		},
		":hover": {
			transform: "none",
		},
	},
	viewTabTopActive: {
		backdropFilter: "none",
		backgroundColor: {
			default: color.shellFrame,
			":hover": color.shellFrame,
		},
		borderColor: color.shellFrame,
		borderTopColor: color.surfaceWhite075,
		borderBottomColor: color.shellFrame,
		borderBottomLeftRadius: 0,
		borderBottomRightRadius: 0,
		boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.045)",
		marginBottom: -1,
		zIndex: layer.content,
	},
	viewTabLabel: {
		display: "inline",
	},
	viewTabActive: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
		borderColor: color.shellFrame,
		boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
		color: color.textMain,
	},
	viewTabTooltip: {
		position: "absolute",
		left: 42,
		top: "50%",
		zIndex: layer.control,
		backgroundColor: color.headerPopoverOpaque,
		borderColor: color.surfaceWhite12,
		borderRadius: radius.px7,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "0 8px 24px rgba(0,0,0,0.38)",
		color: color.textMain,
		opacity: {
			default: 0,
			":hover": 1,
		},
		paddingBlock: controlSize._1_25,
		paddingInline: controlSize._2,
		pointerEvents: "none",
		transform: "translateY(-50%) translateX(-4px)",
		transitionDuration: motion.durationSnappy,
		transitionProperty: "opacity, transform",
		whiteSpace: "nowrap",
	},
	activeSignal: {
		position: "absolute",
		left: -6,
		top: "50%",
		backgroundColor: color.surfaceWhite80,
		borderRadius: radius.pill,
		height: controlSize._2_5,
		transform: "translateY(-50%)",
		width: controlSize._0_5,
	},
	railDivider: {
		backgroundColor: color.surfaceWhite10,
		height: controlSize._0_25,
		marginBlock: controlSize._0_5,
		width: controlSize._5,
	},
	sidebarToggle: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": "rgba(255,255,255,0.07)",
		},
		borderColor: color.transparent,
		borderRadius: radius.circle,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		height: controlSize._8,
		justifyContent: "center",
		marginBottom: controlSize._1_25,
		padding: controlSize._0,
		width: controlSize._8,
	},
});
