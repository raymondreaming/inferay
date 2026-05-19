import {
	type AgentKind,
	type ChatAgentKind,
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../agents/agents.ts";

import { sendJson } from "../../lib/fetch-json.ts";
import { hasId, noop } from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";

import {
	readStoredJson,
	readStoredValue,
	writeStoredJson,
} from "../../lib/stored-json.ts";

export type { AgentKind } from "../agents/agents.ts";

export type HexColor = `#${string}`;

export interface TerminalTheme {
	readonly id: ThemeId;
	readonly name: string;
	readonly bg: HexColor;
	readonly fg: HexColor;
	readonly cursor: HexColor;
	readonly separator: HexColor;
}

const THEME_IDS = {
	default: "default",
	midnight: "midnight",
	dracula: "dracula",
	monokai: "monokai",
	nord: "nord",
	solarized: "solarized",
	github: "github",
	gruvbox: "gruvbox",
	tokyo: "tokyo",
	onedark: "onedark",
	ocean: "ocean",
	rose: "rose",
	githubLight: "githubLight",
	solarizedLight: "solarizedLight",
	custom: "custom",
} as const;

export type ThemeId = (typeof THEME_IDS)[keyof typeof THEME_IDS];
export type TerminalLayoutMode = "grid" | "rows";

export function loadTerminalLayoutMode(): TerminalLayoutMode {
	return readStoredValue("terminal-layout-mode") === "grid" ? "grid" : "rows";
}

export function syncTerminalLayoutMode(
	setLayoutMode: (mode: TerminalLayoutMode) => void
): void {
	setLayoutMode(loadTerminalLayoutMode());
}

export function listenTerminalLayoutMode(
	setLayoutMode: (mode: TerminalLayoutMode) => void
): () => void {
	return listenWindowEvent(
		"terminal-shell-change",
		syncTerminalLayoutMode.bind(null, setLayoutMode)
	);
}

export function appendPaneToGroup(
	selectedGroupId: string,
	pane: TerminalPaneModel,
	group: TerminalGroupModel
): TerminalGroupModel {
	return group.id === selectedGroupId
		? {
				...group,
				panes: [...group.panes, pane],
				selectedPaneId: pane.id,
			}
		: group;
}

// Compact: [id, name, bg, fg, cursor, separator]
// prettier-ignore
const TERM_THEME_DATA: [
	ThemeId,
	string,
	HexColor,
	HexColor,
	HexColor,
	HexColor,
][] = [
	["default", "Black", "#000000", "#e5e5e5", "#007AFF", "#111111"],
	["midnight", "Midnight", "#0c0c0f", "#e8e8ec", "#5A8CFF", "#151518"],
	["dracula", "Dracula", "#282a36", "#f8f8f2", "#f078a0", "#3a3c48"],
	["monokai", "Monokai", "#272822", "#f8f8f2", "#f8f8f2", "#3a3a35"],
	["nord", "Nord", "#2e3440", "#d8dee9", "#88c0d0", "#3e4450"],
	["solarized", "Solarized Dark", "#002b36", "#839496", "#268bd2", "#0a3b46"],
	["github", "GitHub Dark", "#0d1117", "#e3e8ef", "#588cf5", "#1e2228"],
	["gruvbox", "Gruvbox", "#282828", "#ebdbb2", "#fabd2f", "#3a3a3a"],
	["tokyo", "Tokyo Night", "#1a1b27", "#a9b1d6", "#7982b4", "#2c2d3a"],
	["onedark", "One Dark", "#2b303b", "#abb2bf", "#88bffa", "#3c414c"],
	["ocean", "Ocean", "#0d1b2a", "#edf6f9", "#00b4d8", "#1b2838"],
	["rose", "Rose Pine", "#191724", "#e0def4", "#c4a7e7", "#26233a"],
	["githubLight", "GitHub Light", "#ffffff", "#1f2328", "#0969da", "#e1e4e8"],
	[
		"solarizedLight",
		"Solarized Light",
		"#fdf6e3",
		"#073642",
		"#268bd2",
		"#eee8d5",
	],
];

const TERMINAL_THEMES: readonly TerminalTheme[] = TERM_THEME_DATA.map(
	([id, name, bg, fg, cursor, separator]) => ({
		id,
		name,
		bg,
		fg,
		cursor,
		separator,
	})
);

const TERMINAL_FONTS = [
	"SF Mono",
	"Menlo",
	"Monaco",
	"Courier New",
	"JetBrains Mono",
	"Fira Code",
	"Source Code Pro",
] as const;

export type TerminalFont = (typeof TERMINAL_FONTS)[number];

export type PaneId = string & { readonly __brand: "PaneId" };

export type GroupId = string & { readonly __brand: "GroupId" };

function createPaneId(): PaneId {
	return crypto.randomUUID() as PaneId;
}

export function createGroupId(): GroupId {
	return crypto.randomUUID() as GroupId;
}

export type PaneType = AgentKind;

export interface TerminalPaneModel {
	readonly id: PaneId;
	title: string;
	readonly agentKind: AgentKind;
	readonly isClaude: boolean;
	readonly paneType?: PaneType;
	cwd?: string;
	pendingCwd?: boolean;
	referencePaths?: string[];
	summary?: string;
}

export interface TerminalGroupModel {
	readonly id: GroupId;
	name: string;
	panes: TerminalPaneModel[];
	selectedPaneId: PaneId | null;
	columns: number;
	rows: number;
}

export interface TerminalSavedState {
	groups: TerminalGroupModel[];
	selectedGroupId: GroupId | null;
	themeId: ThemeId;
	fontSize: number;
	fontFamily: string;
	opacity: number;
}

const TERMINAL_STORAGE_KEY = "inferay-terminal-state" as const;

const CUSTOM_THEME_KEY = "inferay-custom-theme" as const;

const DEFAULT_THEME_ID: ThemeId = "default";

export const DEFAULT_FONT_SIZE = 13 as const;

export const DEFAULT_FONT_FAMILY: TerminalFont = "SF Mono";

export const DEFAULT_OPACITY = 1 as const;

export const DEFAULT_COLUMNS = 2 as const;

export const DEFAULT_ROWS = 1 as const;

export const DEFAULT_CHAT_AGENT_KIND: ChatAgentKind = "codex";

function isValidTerminalState(value: unknown): value is TerminalSavedState {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		Array.isArray(obj.groups) &&
		obj.groups.length > 0 &&
		typeof obj.themeId === "string" &&
		typeof obj.fontSize === "number" &&
		typeof obj.fontFamily === "string" &&
		typeof obj.opacity === "number"
	);
}
let _cachedTerminalState: TerminalSavedState | null = null;
export function cacheTerminalState(state: TerminalSavedState): void {
	_cachedTerminalState = state;
}

export function loadTerminalState(): TerminalSavedState | null {
	if (_cachedTerminalState) return _cachedTerminalState;
	const parsed = readStoredJson<unknown>(TERMINAL_STORAGE_KEY, null);
	const state = parsed && isValidTerminalState(parsed) ? parsed : null;
	_cachedTerminalState = state;
	return state;
}

export function saveTerminalState(state: TerminalSavedState): void {
	_cachedTerminalState = state;
	writeStoredJson(TERMINAL_STORAGE_KEY, state);
	sendJson("/api/terminal/state", state).catch(noop);
}

/**
 * Change a pane's agent kind directly via localStorage + event.
 * No prop-drilling needed — call from any component.
 */
export function changePaneAgentKind(
	paneId: string,
	agentKind: AgentKind
): void {
	const state = loadTerminalState();
	if (!state) return;
	saveTerminalState({
		...state,
		groups: state.groups.map((g) => ({
			...g,
			panes: g.panes.map((p) =>
				p.id !== paneId
					? p
					: { ...p, agentKind, isClaude: agentKind === "claude" }
			),
		})),
	});
	window.dispatchEvent(new Event("terminal-shell-change"));
}

export function getPaneTitle(pane: TerminalPaneModel): string;

export function getPaneTitle(agentKind: AgentKind, cwd?: string): string;

export function getPaneTitle(
	paneOrAgentKind: TerminalPaneModel | AgentKind,
	cwd?: string
): string {
	const agentKind =
		typeof paneOrAgentKind === "string"
			? paneOrAgentKind
			: paneOrAgentKind.agentKind;
	const dir = typeof paneOrAgentKind === "string" ? cwd : paneOrAgentKind.cwd;
	const dirName = dir ? dir.split("/").pop() || dir : undefined;
	if (dirName) return dirName;
	return getAgentDefinition(agentKind).paneTitle;
}

export function createTerminalPane(
	agentKind: AgentKind,
	cwd?: string,
	pendingCwd?: boolean
): TerminalPaneModel {
	return {
		id: createPaneId(),
		title: getPaneTitle(agentKind, cwd),
		agentKind,
		isClaude: agentKind === "claude",
		paneType: agentKind,
		cwd,
		pendingCwd,
	};
}

export function createPendingAgentChatPane(
	agentKind: ChatAgentKind = loadDefaultChatSettings().agentKind
): TerminalPaneModel {
	return createTerminalPane(agentKind, undefined, true);
}

function createDefaultGroup(): TerminalGroupModel {
	const pane = createPendingAgentChatPane();
	return {
		id: createGroupId(),
		name: "Default",
		panes: [pane],
		selectedPaneId: pane.id,
		columns: DEFAULT_COLUMNS,
		rows: DEFAULT_ROWS,
	};
}

export function migrateGroup(
	group: Partial<TerminalGroupModel> & {
		id: GroupId;
		name: string;
		panes: TerminalPaneModel[];
		selectedPaneId: PaneId | null;
	}
): TerminalGroupModel {
	const panes =
		group.panes.length > 0 ? group.panes : [createPendingAgentChatPane()];
	const selectedPaneId = panes.some(hasId.bind(null, group.selectedPaneId))
		? group.selectedPaneId
		: (panes[0]?.id ?? null);
	return {
		...group,
		panes: panes.map((pane) => ({
			...pane,
			agentKind:
				pane.agentKind ??
				(pane.paneType === "codex"
					? "codex"
					: pane.isClaude
						? "claude"
						: "terminal"),
			isClaude: pane.agentKind ? pane.agentKind === "claude" : pane.isClaude,
			paneType: pane.paneType ?? (pane.isClaude ? "claude" : "terminal"),
		})),
		selectedPaneId,
		columns: group.columns ?? DEFAULT_COLUMNS,
		rows: group.rows ?? DEFAULT_ROWS,
	};
}

export function getInitialGroups(): TerminalGroupModel[] {
	return (
		loadTerminalState()?.groups.map(migrateGroup) ?? [createDefaultGroup()]
	);
}

const BASE_STATUSES = {
	idle: "idle",
	thinking: "thinking",
	responding: "responding",
	error: "error",
} as const;

type BaseStatus = (typeof BASE_STATUSES)[keyof typeof BASE_STATUSES];

export type StatusIconType =
	| "circle"
	| "sparkles"
	| "message"
	| "alert"
	| "wrench"
	| "terminal";

export interface StatusInfo {
	readonly label: string;
	readonly color: string;
	readonly textColor: string;
	readonly iconColor: string;
	readonly iconType: StatusIconType;
	readonly isActive: boolean;
	readonly toolName?: string;
}

const STATUS_CONFIG: Record<BaseStatus, Omit<StatusInfo, "toolName">> = {
	idle: {
		label: "Idle",
		color: "bg-zinc-500",
		textColor: "text-zinc-400",
		iconColor: "text-zinc-400",
		iconType: "circle",
		isActive: false,
	},
	thinking: {
		label: "Thinking...",
		color: "bg-yellow-500 animate-pulse",
		textColor: "text-yellow-500",
		iconColor: "text-yellow-500",
		iconType: "sparkles",
		isActive: true,
	},
	responding: {
		label: "Responding...",
		color: "bg-blue-500 animate-pulse",
		textColor: "text-blue-400",
		iconColor: "text-blue-400",
		iconType: "message",
		isActive: true,
	},
	error: {
		label: "Error",
		color: "bg-red-500",
		textColor: "text-red-400",
		iconColor: "text-red-500",
		iconType: "alert",
		isActive: false,
	},
};

const TOOL_STATUS_CONFIG: Omit<StatusInfo, "toolName" | "label"> = {
	color: "bg-orange-500 animate-pulse",
	textColor: "text-orange-400",
	iconColor: "text-orange-400",
	iconType: "wrench",
	isActive: true,
};

export function getStatusInfo(status: string): StatusInfo {
	if (status in BASE_STATUSES) return STATUS_CONFIG[status as BaseStatus];
	if (status.startsWith("tool:"))
		return {
			...TOOL_STATUS_CONFIG,
			label: `Running ${status.slice(5)}`,
			toolName: status.slice(5),
		};
	return {
		label: status,
		color: "bg-zinc-500",
		textColor: "text-zinc-400",
		iconColor: "text-zinc-400",
		iconType: "circle",
		isActive: false,
	};
}

export interface CustomThemeColors {
	bg: HexColor;
	fg: HexColor;
	cursor: HexColor;
	separator: HexColor;
}

const DEFAULT_CUSTOM_COLORS: CustomThemeColors = {
	bg: "#1a1a2e" as HexColor,
	fg: "#e0e0e0" as HexColor,
	cursor: "#ff6f61" as HexColor,
	separator: "#2e2e42" as HexColor,
};

export function loadCustomTheme(): CustomThemeColors {
	try {
		const parsed = readStoredJson<Partial<CustomThemeColors> | null>(
			CUSTOM_THEME_KEY,
			null
		);
		if (parsed) return { ...DEFAULT_CUSTOM_COLORS, ...parsed };
	} catch {}
	return DEFAULT_CUSTOM_COLORS;
}

export function saveCustomTheme(colors: CustomThemeColors): void {
	writeStoredJson(CUSTOM_THEME_KEY, colors);
}

export function getThemeById(themeId: string): TerminalTheme {
	if (themeId === "custom") {
		const c = loadCustomTheme();
		return { id: "custom" as ThemeId, name: "Custom", ...c };
	}
	return (
		TERMINAL_THEMES.find(hasId.bind(null, themeId)) ??
		TERMINAL_THEMES.find(hasId.bind(null, DEFAULT_THEME_ID)) ??
		TERMINAL_THEMES[0]
	);
}
