import * as stylex from "@stylexjs/stylex";
import {
	startTransition,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
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
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { IconWorkflow } from "../ui/Icons.tsx";

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
	trailing = false,
}: {
	active: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
	trailing?: boolean;
}) {
	const tabProps = stylex.props(
		styles.viewTab,
		trailing ? styles.viewTabTrailing : null,
		active ? styles.viewTabActive : null
	);
	return (
		<button
			type="button"
			onClick={onClick}
			{...tabProps}
			className={`${APP_REGION_NO_DRAG_CLASS} ${tabProps.className ?? ""}`}
		>
			{icon}
			<span>{label}</span>
			{active ? (
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
	const isTerminalRoute = location.pathname === "/terminal";
	const resolvedNavigationTarget = isTerminalRoute
		? `view:${shellState.mainView}`
		: `route:${location.pathname}`;
	const activeNavigationTarget =
		pendingNavigationTarget ?? resolvedNavigationTarget;

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
			startTransition(() => navigate(path));
		},
		[navigate, resolvedNavigationTarget]
	);

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
		>
			<div {...stylex.props(styles.viewTabs)}>
				<div {...stylex.props(styles.tabGroup)}>
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
								/>
							);
						}
					)}
				</div>
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
			</div>
		</div>
	);
}

const styles = stylex.create({
	header: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 100,
		alignItems: "center",
		backgroundColor: color.background,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._2,
		height: 36,
		paddingLeft: controlSize._3,
		paddingRight: controlSize._3,
		userSelect: "none",
	},
	viewTabs: {
		alignItems: "flex-end",
		alignSelf: "stretch",
		display: "flex",
		flexGrow: 1,
		flexShrink: 1,
		marginLeft: 62,
		minWidth: 0,
		overflowX: "auto",
		paddingLeft: 10,
		paddingRight: 10,
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	tabGroup: {
		alignItems: "flex-end",
		alignSelf: "stretch",
		display: "flex",
		flexShrink: 0,
		gap: 6,
	},
	secondaryTabGroup: {
		marginLeft: "auto",
	},
	viewTab: {
		position: "relative",
		alignItems: "center",
		borderColor: "transparent",
		borderTopLeftRadius: 11,
		borderTopRightRadius: 11,
		borderBottomLeftRadius: 11,
		borderBottomRightRadius: 11,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: "0.375rem",
		height: 30,
		paddingInline: "0.625rem",
		transitionDuration: "80ms",
		transitionProperty: "color",
		transitionTimingFunction: "ease-out",
		backgroundColor: {
			default: "transparent",
			":hover": "transparent",
		},
	},
	viewTabTrailing: {
		marginRight: 2,
		paddingRight: "0.875rem",
	},
	viewTabActive: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.backgroundRaised,
		},
		borderColor: "transparent",
		borderBottomColor: color.backgroundRaised,
		borderBottomLeftRadius: 0,
		borderBottomRightRadius: 0,
		boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
		color: color.textMain,
		marginBottom: -1,
		zIndex: 1,
	},
	tabShoulder: {
		position: "absolute",
		bottom: 0,
		width: 10,
		height: 10,
		pointerEvents: "none",
		backgroundColor: color.backgroundRaised,
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
});
