import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	dispatchTerminalShellChange,
	loadTerminalState,
	terminalStateKey,
} from "../../features/terminal/terminal-utils.ts";
import {
	APP_PAGE_ROUTES,
	DEFAULT_TERMINAL_MAIN_VIEW,
	isTerminalMainView,
	SIDEBAR_NAV_ROUTES,
	TERMINAL_MAIN_VIEWS,
	type TerminalMainView,
} from "../../lib/app-navigation.tsx";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../lib/app-theme.ts";
import { TERMINAL_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	readStoredBoolean,
	readStoredValue,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { IconPanelLeft, IconWorkflow } from "../ui/Icons.tsx";

const AUTOMATIONS_ROUTE = APP_PAGE_ROUTES.find(
	(route) => route.id === "automations"
);
function loadShellState() {
	const terminalState = loadTerminalState();
	const mainView = readStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY);

	return {
		groups: terminalState?.groups ?? [],
		selectedGroupId:
			terminalState?.selectedGroupId ?? terminalState?.groups[0]?.id ?? null,
		mainView: isTerminalMainView(mainView)
			? mainView
			: DEFAULT_TERMINAL_MAIN_VIEW,
		key: terminalState ? terminalStateKey(terminalState) : "",
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
	icon: ReactNode;
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
		active && top ? styles.viewTabTopActive : null
	);
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
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
			{active && top ? (
				<>
					<span
						aria-hidden="true"
						{...stylex.props(styles.tabShoulder, styles.tabShoulderLeft)}
					/>
					<span
						aria-hidden="true"
						{...stylex.props(styles.tabShoulder, styles.tabShoulderRight)}
					/>
				</>
			) : null}
		</button>
	);
}

export function TerminalShellHeader() {
	const location = useLocation();
	const navigate = useNavigate();
	const [shellState, setShellState] = useState(loadShellState);
	const [pendingNavigationTarget, setPendingNavigationTarget] = useState<
		string | null
	>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
		readStoredBoolean("sidebar-collapsed")
	);
	const isTerminalRoute = location.pathname === "/terminal";
	const resolvedNavigationTarget = isTerminalRoute
		? `view:${shellState.mainView}`
		: `route:${location.pathname}`;
	const activeNavigationTarget =
		pendingNavigationTarget ?? resolvedNavigationTarget;
	const workspaceNavigationActive =
		isTerminalRoute &&
		(shellState.mainView === "chat" || shellState.mainView === "editor") &&
		!sidebarCollapsed;

	const refreshShellState = useCallback(() => {
		const next = loadShellState();
		setShellState((current) =>
			current.key === next.key && current.mainView === next.mainView
				? current
				: next
		);
	}, []);

	useEffect(() => {
		return listenWindowEvent("terminal-shell-change", refreshShellState);
	}, [refreshShellState]);

	useEffect(
		() =>
			listenWindowEvent("toggle-main-sidebar", () =>
				setSidebarCollapsed((current) => !current)
			),
		[]
	);

	const updateMainView = useCallback(
		(view: TerminalMainView) => {
			if (shellState.mainView !== view) {
				writeStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY, view);
				setShellState((current) =>
					current.mainView === view ? current : { ...current, mainView: view }
				);
				dispatchTerminalShellChange({
					source: "view",
					reason: "main-view",
					mainView: view,
				});
			}
			if (window.location.hash !== "#/terminal") navigate("/terminal");
		},
		[navigate, shellState.mainView]
	);

	useEffect(() => {
		setPendingNavigationTarget((current) =>
			current === resolvedNavigationTarget ? null : current
		);
	}, [resolvedNavigationTarget]);

	const activateMainView = useCallback(
		(view: TerminalMainView) => {
			const target = `view:${view}`;
			if (target !== resolvedNavigationTarget) {
				setPendingNavigationTarget(target);
			}
			updateMainView(view);
		},
		[resolvedNavigationTarget, updateMainView]
	);

	const activateRoute = useCallback(
		(path: string) => {
			const target = `route:${path}`;
			if (target !== resolvedNavigationTarget) {
				setPendingNavigationTarget(target);
			}
			navigate(path);
		},
		[navigate, resolvedNavigationTarget]
	);

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
		>
			<nav aria-label="Primary views" {...stylex.props(styles.topTabs)}>
				{TERMINAL_MAIN_VIEWS.filter((view) => view.id !== "graph").map(
					(view) => {
						const Icon = view.icon;
						return (
							<ViewTab
								key={view.id}
								active={activeNavigationTarget === `view:${view.id}`}
								icon={<Icon size={12} />}
								label={view.label}
								onClick={() => activateMainView(view.id)}
								top
							/>
						);
					}
				)}
			</nav>
			<nav
				aria-label="Application views"
				{...stylex.props(
					styles.viewTabs,
					workspaceNavigationActive && styles.viewTabsAttached
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
					onClick={() =>
						window.dispatchEvent(new CustomEvent("toggle-main-sidebar"))
					}
				>
					<IconPanelLeft size={14} />
				</button>
				<span aria-hidden="true" {...stylex.props(styles.railDivider)} />
				<div {...stylex.props(styles.tabGroup, styles.secondaryTabGroup)}>
					{TERMINAL_MAIN_VIEWS.filter((view) => view.id === "graph").map(
						(view) => {
							const Icon = view.icon;
							return (
								<ViewTab
									key={view.id}
									active={activeNavigationTarget === `view:${view.id}`}
									icon={<Icon size={12} />}
									label={view.label}
									onClick={() => activateMainView(view.id)}
								/>
							);
						}
					)}
					{SIDEBAR_NAV_ROUTES.map((route) => {
						const Icon = route.icon;
						return (
							<ViewTab
								key={route.id}
								active={activeNavigationTarget === `route:${route.path}`}
								icon={<Icon size={12} />}
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
							icon={<IconWorkflow size={12} />}
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
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		zIndex: 120,
		pointerEvents: "none",
		userSelect: "none",
	},
	topTabs: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 2,
		alignItems: "flex-end",
		backgroundColor: color.background,
		display: "flex",
		gap: 6,
		height: 36,
		paddingLeft: 84,
		paddingRight: 10,
		pointerEvents: "auto",
	},
	viewTabs: {
		position: "absolute",
		top: 36,
		left: 12,
		bottom: 12,
		alignItems: "center",
		backgroundColor: color.background,
		borderColor: "rgba(255,255,255,0.13)",
		borderRadius: 15,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255,255,255,0.055), 0 18px 50px rgba(0,0,0,0.46)",
		display: "flex",
		flexDirection: "column",
		gap: 5,
		padding: 5,
		pointerEvents: "auto",
		width: 42,
	},
	viewTabsAttached: {
		borderTopRightRadius: 0,
		borderBottomRightRadius: 0,
		borderRightColor: "transparent",
	},
	tabGroup: {
		alignItems: "center",
		display: "flex",
		flexDirection: "column",
		gap: 3,
		width: "100%",
	},
	secondaryTabGroup: {
		marginTop: 0,
	},
	viewTab: {
		position: "relative",
		alignItems: "center",
		borderColor: "transparent",
		borderRadius: 10,
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
		height: 32,
		padding: 0,
		transitionDuration: "120ms",
		transitionProperty: "color, background-color, border-color, transform",
		transitionTimingFunction: "ease-out",
		width: 32,
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(255,255,255,0.07)",
		},
		":hover": {
			transform: "translateX(1px)",
		},
	},
	viewTabTrailing: {
		marginTop: 0,
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
		transitionDuration: "80ms",
		transitionProperty: "color",
		width: "auto",
		backgroundColor: {
			default: "transparent",
			":hover": "transparent",
		},
		":hover": {
			transform: "none",
		},
	},
	viewTabTopActive: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.backgroundRaised,
		},
		borderColor: "transparent",
		borderBottomColor: color.backgroundRaised,
		borderBottomLeftRadius: 0,
		borderBottomRightRadius: 0,
		boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
		marginBottom: -1,
		zIndex: 1,
	},
	viewTabLabel: {
		display: "inline",
	},
	viewTabActive: {
		backgroundColor: {
			default: "rgba(255,255,255,0.105)",
			":hover": "rgba(255,255,255,0.13)",
		},
		borderColor: "rgba(255,255,255,0.14)",
		boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
		color: color.textMain,
	},
	viewTabTooltip: {
		position: "absolute",
		left: 42,
		top: "50%",
		zIndex: 10,
		backgroundColor: "rgba(23,23,25,0.96)",
		borderColor: "rgba(255,255,255,0.12)",
		borderRadius: 7,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: "0 8px 24px rgba(0,0,0,0.38)",
		color: color.textMain,
		opacity: {
			default: 0,
			":hover": 1,
		},
		paddingBlock: 5,
		paddingInline: 8,
		pointerEvents: "none",
		transform: "translateY(-50%) translateX(-4px)",
		transitionDuration: "100ms",
		transitionProperty: "opacity, transform",
		whiteSpace: "nowrap",
	},
	activeSignal: {
		position: "absolute",
		left: -6,
		top: "50%",
		backgroundColor: "rgba(255,255,255,0.8)",
		borderRadius: 99,
		height: 10,
		transform: "translateY(-50%)",
		width: 2,
	},
	tabShoulder: {
		position: "absolute",
		bottom: 0,
		backgroundColor: color.backgroundRaised,
		height: 10,
		pointerEvents: "none",
		width: 10,
	},
	tabShoulderLeft: {
		left: -9,
		WebkitMaskImage:
			"radial-gradient(circle 10px at 0% 0%, transparent 10px, black 10.5px)",
		maskImage:
			"radial-gradient(circle 10px at 0% 0%, transparent 10px, black 10.5px)",
	},
	tabShoulderRight: {
		right: -9,
		WebkitMaskImage:
			"radial-gradient(circle 10px at 100% 0%, transparent 10px, black 10.5px)",
		maskImage:
			"radial-gradient(circle 10px at 100% 0%, transparent 10px, black 10.5px)",
	},
	railDivider: {
		backgroundColor: "rgba(255,255,255,0.1)",
		height: 1,
		marginBlock: 2,
		width: 20,
	},
	sidebarToggle: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": "rgba(255,255,255,0.07)",
		},
		borderColor: "transparent",
		borderRadius: 9,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		height: 32,
		justifyContent: "center",
		marginBottom: 5,
		padding: 0,
		width: 32,
	},
});
