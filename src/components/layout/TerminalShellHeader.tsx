import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	loadDefaultChatSettings,
	type NEW_PANE_AGENT_KINDS,
} from "../../features/agents/agents.ts";
import {
	createTerminalPane,
	dispatchTerminalShellChange,
	listenTerminalLayoutMode,
	loadTerminalLayoutMode,
	loadTerminalState,
	mutateCanonicalTerminalState,
	mutateTerminalWorkspaceState,
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
import { Button } from "../ui/Button.tsx";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import {
	IconLayoutGrid,
	IconLayoutRows,
	IconPlus,
	IconWorkflow,
} from "../ui/Icons.tsx";

const GRID_SIZE_OPTIONS = [
	{ id: "1", label: "1" },
	{ id: "2", label: "2" },
	{ id: "3", label: "3" },
	{ id: "4", label: "4" },
];

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
}: {
	active: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			{...stylex.props(styles.viewTab, active ? styles.viewTabActive : null)}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

export function TerminalShellHeader() {
	const location = useLocation();
	const navigate = useNavigate();
	const [shellState, setShellState] = useState(loadShellState);
	const [layoutMode, setLayoutMode] = useState(loadTerminalLayoutMode);

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

	useEffect(() => {
		return listenTerminalLayoutMode(setLayoutMode);
	}, []);

	const updateMainView = useCallback(
		(view: TerminalMainView) => {
			if (shellState.mainView !== view) {
				writeStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY, view);
				setShellState((current) =>
					current.mainView === view ? current : { ...current, mainView: view }
				);
				dispatchTerminalShellChange({ source: "view", reason: "main-view" });
			}
			if (window.location.hash !== "#/terminal") navigate("/terminal");
		},
		[navigate, shellState.mainView]
	);

	const addPaneToSelectedGroup = useCallback(
		async (agentKind: (typeof NEW_PANE_AGENT_KINDS)[number]) => {
			const pane = createTerminalPane(agentKind, undefined, true);
			await mutateTerminalWorkspaceState(
				{ type: "addPane", pane },
				"add-pane",
				{ createIfMissing: true }
			);
			navigate("/terminal");
		},
		[navigate]
	);

	const selectedGroup =
		shellState.groups.find(
			(group) => group.id === shellState.selectedGroupId
		) ?? null;
	const isTerminalRoute = location.pathname === "/terminal";

	const updateLayoutMode = useCallback(
		(mode: "grid" | "rows") => {
			if (mode === layoutMode) return;
			writeStoredValue("terminal-layout-mode", mode);
			setLayoutMode(mode);
			dispatchTerminalShellChange({ source: "view", reason: "layout-mode" });
		},
		[layoutMode]
	);

	const updateSelectedGroupGrid = useCallback(
		async (patch: { columns?: number; rows?: number }) => {
			setShellState((current) => {
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
			await mutateCanonicalTerminalState((terminalState) => {
				if (!terminalState.selectedGroupId) return null;
				let changed = false;
				const groups = terminalState.groups.map((group) => {
					if (group.id !== terminalState.selectedGroupId) return group;
					const columns = patch.columns ?? group.columns;
					const rows = patch.rows ?? group.rows;
					if (columns === group.columns && rows === group.rows) return group;
					changed = true;
					return { ...group, columns, rows };
				});
				if (!changed) return null;
				return {
					...terminalState,
					groups,
				};
			}, "grid-size");
		},
		[]
	);

	return (
		<div
			className={`${APP_REGION_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
		>
			<div
				className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.viewTabs).className ?? ""}`}
			>
				{TERMINAL_MAIN_VIEWS.map((view) => {
					const Icon = view.icon;
					return (
						<ViewTab
							key={view.id}
							active={isTerminalRoute && shellState.mainView === view.id}
							icon={<Icon size={12} />}
							label={view.label}
							onClick={() => updateMainView(view.id)}
						/>
					);
				})}
				{SIDEBAR_NAV_ROUTES.map((route) => {
					const Icon = route.icon;
					return (
						<ViewTab
							key={route.id}
							active={location.pathname === route.path}
							icon={<Icon size={12} />}
							label={route.label}
							onClick={() => navigate(route.path)}
						/>
					);
				})}
				{AUTOMATIONS_ROUTE && (
					<ViewTab
						active={location.pathname === AUTOMATIONS_ROUTE.path}
						icon={<IconWorkflow size={12} />}
						label={AUTOMATIONS_ROUTE.label}
						onClick={() => navigate(AUTOMATIONS_ROUTE.path)}
					/>
				)}
			</div>
			{isTerminalRoute && (
				<>
					<div {...stylex.props(styles.spacer)} />
					<div
						className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.actions).className ?? ""}`}
					>
						{shellState.mainView === "chat" && (
							<>
								{layoutMode === "grid" && selectedGroup && (
									<>
										<div {...stylex.props(styles.gridControl)}>
											<span {...stylex.props(styles.gridLabel)}>Col</span>
											<DropdownButton
												value={String(selectedGroup.columns)}
												options={GRID_SIZE_OPTIONS}
												onChange={(id) =>
													updateSelectedGroupGrid({ columns: Number(id) })
												}
												minWidth={60}
											/>
										</div>
										<div {...stylex.props(styles.gridControl)}>
											<span {...stylex.props(styles.gridLabel)}>Row</span>
											<DropdownButton
												value={String(selectedGroup.rows)}
												options={GRID_SIZE_OPTIONS}
												onChange={(id) =>
													updateSelectedGroupGrid({ rows: Number(id) })
												}
												minWidth={60}
											/>
										</div>
									</>
								)}
								<div {...stylex.props(styles.segmented)}>
									<button
										type="button"
										onClick={() => updateLayoutMode("grid")}
										{...stylex.props(
											styles.segmentButton,
											layoutMode === "grid"
												? styles.segmentButtonActive
												: styles.segmentButtonIdle
										)}
										title="Grid layout"
									>
										<IconLayoutGrid size={13} />
									</button>
									<button
										type="button"
										onClick={() => updateLayoutMode("rows")}
										{...stylex.props(
											styles.segmentButton,
											layoutMode === "rows"
												? styles.segmentButtonActive
												: styles.segmentButtonIdle
										)}
										title="Row layout"
									>
										<IconLayoutRows size={13} />
									</button>
								</div>
							</>
						)}
						<div {...stylex.props(styles.shrink)}>
							<Button
								type="button"
								onClick={() =>
									addPaneToSelectedGroup(loadDefaultChatSettings().agentKind)
								}
								variant="secondary"
								size="sm"
							>
								<span>New</span>
								<IconPlus size={10} />
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

const styles = stylex.create({
	header: {
		alignItems: "center",
		backgroundColor: color.background,
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._3,
		height: controlSize._12,
		paddingInline: controlSize._3,
		userSelect: "none",
	},
	viewTabs: {
		alignItems: "center",
		display: "flex",
		flexShrink: 1,
		gap: controlSize._1,
		minWidth: 0,
		overflowX: "auto",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	spacer: {
		flex: 1,
		minWidth: 0,
	},
	actions: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: controlSize._3,
	},
	gridControl: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: "0.375rem",
	},
	gridLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	segmented: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexShrink: 0,
		height: controlSize._7,
		overflow: "hidden",
	},
	segmentButton: {
		alignItems: "center",
		display: "flex",
		height: "100%",
		justifyContent: "center",
		transitionDuration: "150ms",
		transitionProperty: "background-color, color",
		transitionTimingFunction: "ease",
		width: controlSize._7,
	},
	segmentButtonIdle: {
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
	segmentButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	shrink: {
		flexShrink: 0,
	},
	viewTab: {
		alignItems: "center",
		borderColor: "transparent",
		borderRadius: 8,
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
		height: controlSize._7,
		paddingInline: "0.625rem",
		transitionDuration: "150ms",
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: "ease",
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
	},
	viewTabActive: {
		backgroundColor: color.controlActive,
		borderColor: color.border,
		color: color.textMain,
	},
});
