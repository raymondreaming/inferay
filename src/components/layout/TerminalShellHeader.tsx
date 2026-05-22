import * as stylex from "@stylexjs/stylex";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	loadDefaultChatSettings,
	type NEW_PANE_AGENT_KINDS,
} from "../../features/agents/agents.ts";
import {
	DEFAULT_TERMINAL_MAIN_VIEW,
	APP_PAGE_ROUTES,
	isTerminalMainView,
	TERMINAL_MAIN_VIEWS,
	type TerminalMainView,
} from "../../lib/app-navigation.tsx";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import {
	appendPaneToGroup,
	createTerminalPane,
	listenTerminalLayoutMode,
	loadTerminalLayoutMode,
	loadTerminalState,
	saveTerminalState,
} from "../../features/terminal/terminal-utils.ts";
import {
	listenDocumentEvent,
	listenWindowEvent,
} from "../../lib/react-events.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import {
	IconCollapse,
	IconExpand,
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
	const mainView = readStoredValue("terminal-main-view");

	return {
		groups: terminalState?.groups ?? [],
		selectedGroupId:
			terminalState?.selectedGroupId ?? terminalState?.groups[0]?.id ?? null,
		mainView: isTerminalMainView(mainView)
			? mainView
			: DEFAULT_TERMINAL_MAIN_VIEW,
		editorZenMode: readStoredValue("terminal-editor-zen") === "true",
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
	const [showNewMenu, setShowNewMenu] = useState(false);
	const newMenuRef = useRef<HTMLDivElement>(null);
	const [layoutMode, setLayoutMode] = useState(loadTerminalLayoutMode);

	const refreshShellState = useCallback(() => {
		setShellState(loadShellState());
	}, []);

	useEffect(
		listenWindowEvent.bind(null, "terminal-shell-change", refreshShellState),
		[refreshShellState]
	);

	useEffect(listenTerminalLayoutMode.bind(null, setLayoutMode), []);

	useEffect(() => {
		if (!showNewMenu) return;
		const handleClick = (event: MouseEvent) => {
			if (
				newMenuRef.current &&
				!newMenuRef.current.contains(event.target as Node)
			) {
				setShowNewMenu(false);
			}
		};
		return listenDocumentEvent("mousedown", handleClick);
	}, [showNewMenu]);

	const updateMainView = useCallback(
		(view: TerminalMainView) => {
			writeStoredValue("terminal-main-view", view);
			window.dispatchEvent(new Event("terminal-shell-change"));
			navigate("/terminal");
		},
		[navigate]
	);

	const addPaneToSelectedGroup = useCallback(
		(agentKind: (typeof NEW_PANE_AGENT_KINDS)[number]) => {
			const terminalState = loadTerminalState();
			if (!terminalState) return;
			const selectedGroupId =
				terminalState.selectedGroupId ?? terminalState.groups[0]?.id;
			if (!selectedGroupId) return;
			const pane = createTerminalPane(agentKind, undefined, true);
			saveTerminalState({
				...terminalState,
				groups: terminalState.groups.map(
					appendPaneToGroup.bind(null, selectedGroupId, pane)
				),
			});
			window.dispatchEvent(new Event("terminal-shell-change"));
			setShowNewMenu(false);
			navigate("/terminal");
		},
		[navigate]
	);

	const selectedGroup =
		shellState.groups.find(
			(group) => group.id === shellState.selectedGroupId
		) ?? null;
	const isTerminalRoute = location.pathname === "/terminal";

	const updateLayoutMode = useCallback((mode: "grid" | "rows") => {
		writeStoredValue("terminal-layout-mode", mode);
		setLayoutMode(mode);
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

	const updateSelectedGroupGrid = useCallback(
		(patch: { columns?: number; rows?: number }) => {
			const terminalState = loadTerminalState();
			if (!terminalState?.selectedGroupId) return;
			saveTerminalState({
				...terminalState,
				groups: terminalState.groups.map((group) =>
					group.id === terminalState.selectedGroupId
						? {
								...group,
								columns: patch.columns ?? group.columns,
								rows: patch.rows ?? group.rows,
							}
						: group
				),
			});
			window.dispatchEvent(new Event("terminal-shell-change"));
		},
		[]
	);

	const updateEditorZenMode = useCallback((next: boolean) => {
		writeStoredValue("terminal-editor-zen", next ? "true" : "false");
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

	return (
		<div
			className={`electrobun-webkit-app-region-drag ${stylex.props(styles.header).className ?? ""}`}
		>
			<div
				className={`electrobun-webkit-app-region-no-drag ${stylex.props(styles.viewTabs).className ?? ""}`}
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
						className={`electrobun-webkit-app-region-no-drag ${stylex.props(styles.actions).className ?? ""}`}
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
						{shellState.mainView === "editor" && (
							<IconButton
								type="button"
								onClick={() => updateEditorZenMode(!shellState.editorZenMode)}
								title={
									shellState.editorZenMode ? "Exit zen mode" : "Enter zen mode"
								}
								variant="ghost"
								size="md"
								className="h-7 w-7 border border-inferay-gray-border bg-inferay-dark-gray"
							>
								{shellState.editorZenMode ? (
									<IconCollapse size={12} />
								) : (
									<IconExpand size={12} />
								)}
							</IconButton>
						)}
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
		flexShrink: 0,
		gap: controlSize._1,
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
