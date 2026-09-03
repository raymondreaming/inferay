import * as stylex from "@octanejs/stylex";
import { useLocation, useNavigate } from "@octanejs/tanstack-router";
import { useCallback, useEffect, useState } from "octane";
import { fetchJsonOr } from "../adapters/backend/http.ts";
import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../adapters/storage/stored-values.ts";
import {
	type AgentMainView,
	APP_PAGE_ROUTES,
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
	SIDEBAR_NAV_ROUTES,
} from "../app/navigation.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../app/theme.ts";
import { iconSize } from "../design-system.ts";
import {
	dispatchOpenActiveGitGraph,
	dispatchToggleActiveGitSidebar,
} from "../modules/workbench/workbench-events.ts";
import {
	agentStateKey,
	dispatchAgentShellChange,
	loadAgentState,
} from "../modules/workspace/workspace-model.ts";
import { useQueryResource } from "../shared/hooks/useQueryResource.tsx";
import { listenWindowEvent } from "../shared/lib/react-events.ts";
import {
	IconGitBranch,
	IconMessageCircle,
	IconPanelLeft,
	IconUser,
	IconWorkflow,
} from "../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../tokens.stylex.ts";

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

export function AppHeader() {
	const location = useLocation();
	const navigate = useNavigate();
	const [shellState, setShellState] = useState(loadShellState);
	const [pendingNavigationTarget, setPendingNavigationTarget] = useState<
		string | null
	>(null);
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
	const selectedGroup = shellState.groups.find(
		(group) => group.id === shellState.selectedGroupId,
	);
	const workspaceCwd = selectedGroup?.panes.find(
		(pane) => pane.id === selectedGroup.selectedPaneId,
	)?.cwd;
	const openCommitGraph = useCallback(() => {
		if (!workspaceCwd) return;
		activateMainView("chat");
		requestAnimationFrame(dispatchOpenActiveGitGraph);
	}, [activateMainView, workspaceCwd]);

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
		>
			<nav aria-label="Primary views" {...stylex.props(styles.topTabs)}>
				<div {...stylex.props(styles.workspaceControls)}>
					<button
						type="button"
						onClick={() => navigate({ to: "/profile" })}
						{...stylex.props(styles.topAccountButton)}
						title={
							githubAccount?.login || githubAccount?.name || "Account settings"
						}
						aria-label="Account settings"
					>
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
					<button
						type="button"
						onClick={() =>
							window.dispatchEvent(new CustomEvent("toggle-main-sidebar"))
						}
						className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.topBarIconButton, styles.sidebarToggleButton).className ?? ""}`}
						title="Toggle workspace sidebar"
						aria-label="Toggle workspace sidebar"
					>
						<IconPanelLeft size={13.2} strokeWidth={2} />
					</button>
				</div>
				<span {...stylex.props(styles.accountSpacer)} />
				<ViewTab
					active={activeNavigationTarget === "view:chat"}
					icon={<IconMessageCircle size={iconSize.compact} />}
					label="Chat"
					onClick={() => activateMainView("chat")}
					top
				/>
				<ViewTab
					active={false}
					icon={<IconGitBranch size={iconSize.compact} />}
					label="Graph"
					onClick={openCommitGraph}
					top
				/>
				{SIDEBAR_NAV_ROUTES.map((route) => {
					const Icon = route.icon;
					return (
						<ViewTab
							key={route.id}
							active={activeNavigationTarget === `route:${route.path}`}
							icon={<Icon size={iconSize.compact} />}
							label={route.label}
							onClick={() => activateRoute(route.path)}
							top
						/>
					);
				})}
				{AUTOMATIONS_ROUTE ? (
					<ViewTab
						active={
							activeNavigationTarget === `route:${AUTOMATIONS_ROUTE.path}`
						}
						icon={<IconWorkflow size={iconSize.compact} />}
						label={AUTOMATIONS_ROUTE.label}
						onClick={() => activateRoute(AUTOMATIONS_ROUTE.path)}
						top
					/>
				) : null}
				<button
					type="button"
					onClick={dispatchToggleActiveGitSidebar}
					className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.topBarIconButton, styles.sidebarToggleButton, styles.topBarActionButton, styles.rightSidebarIcon).className ?? ""}`}
					title="Toggle changes sidebar"
					aria-label="Toggle changes sidebar"
				>
					<IconPanelLeft size={13.2} strokeWidth={2} />
				</button>
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
	topCreateWrap: {
		display: "inline-flex",
		width: 58,
		height: 26,
	},
	topCreateButton: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1,
		color: color.textSoft,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
	},
	workspaceControls: {
		display: "flex",
		alignItems: "flex-end",
		gap: controlSize._1,
		marginBottom: controlSize._1,
	},
	topAccountButton: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.circle,
		backgroundColor: color.transparent,
	},
	topBarIconButton: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
	},
	sidebarToggleButton: {
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		opacity: 1,
	},
	rightSidebarIcon: {
		transform: "scaleX(-1)",
	},
	topBarActionButton: {
		marginBottom: controlSize._1,
	},
	accountSpacer: {
		flex: 1,
	},
	railAccountButton: {
		display: "flex",
		width: controlSize._8,
		height: controlSize._8,
		marginTop: "auto",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.circle,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
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
});
