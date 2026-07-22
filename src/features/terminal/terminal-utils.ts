import { flushPendingClientStorageSync } from "../../lib/client-storage-sync.ts";
import { hasId, lacksId, noop } from "../../lib/data.ts";
import { postJson, sendJson } from "../../lib/fetch-json.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	readStoredJson,
	readStoredValue,
	writeStoredJson,
} from "../../lib/stored-json.ts";
import {
	type AgentKind,
	type ChatAgentKind,
	getAgentDefinition,
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../agents/agents.ts";

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
	if (group.id !== selectedGroupId) return group;
	const panes =
		group.panes.length === 1 &&
		isEmptyPendingPane(group.panes[0]!) &&
		!isEmptyPendingPane(pane)
			? [pane]
			: [...group.panes, pane];
	return { ...group, panes, selectedPaneId: pane.id };
}

export type TerminalWorkspaceAction =
	| { type: "selectWorkspace"; groupId: string }
	| { type: "selectPane"; groupId: string; paneId: string }
	| { type: "addWorkspace" }
	| { type: "removeWorkspace"; groupId: string }
	| { type: "renameWorkspace"; groupId: string; name: string }
	| { type: "addPane"; pane: TerminalPaneModel; groupId?: string }
	| { type: "removePane"; groupId: string; paneId: string }
	| {
			type: "directorySelected";
			groupId: string;
			paneId: string;
			path: string | null;
			referencePaths?: string[];
	  }
	| {
			type: "setPaneAgentKind";
			groupId: string;
			paneId: string;
			agentKind: AgentKind;
	  }
	| { type: "ensureChatPane" };

export function reduceTerminalWorkspaceState(
	state: TerminalSavedState,
	action: TerminalWorkspaceAction
): TerminalSavedState | null {
	switch (action.type) {
		case "selectWorkspace":
			if (!state.groups.some(hasId.bind(null, action.groupId))) return state;
			return compactTerminalState(
				{ ...state, selectedGroupId: action.groupId as GroupId },
				{ keepSelectedDraft: true }
			);
		case "selectPane":
			return compactTerminalState(
				{
					...state,
					selectedGroupId: action.groupId as GroupId,
					groups: state.groups.map((group) =>
						group.id === action.groupId
							? { ...group, selectedPaneId: action.paneId as PaneId }
							: group
					),
				},
				{ keepSelectedDraft: true }
			);
		case "addWorkspace": {
			const cleanState = compactTerminalState(state, {
				keepSelectedDraft: true,
			});
			const selectedGroup =
				cleanState.groups.find(hasId.bind(null, cleanState.selectedGroupId)) ??
				cleanState.groups[0];
			const group: TerminalGroupModel = {
				id: createGroupId(),
				name: `Workspace ${cleanState.groups.length + 1}`,
				panes: [],
				selectedPaneId: null,
				columns: selectedGroup?.columns ?? DEFAULT_COLUMNS,
				rows: selectedGroup?.rows ?? DEFAULT_ROWS,
			};
			return {
				...cleanState,
				groups: [...cleanState.groups, group],
				selectedGroupId: group.id,
			};
		}
		case "removeWorkspace": {
			if (state.groups.length <= 1) return null;
			const groups = state.groups.filter(
				(group) => group.id !== action.groupId
			);
			return {
				...state,
				groups,
				selectedGroupId:
					state.selectedGroupId === action.groupId
						? (groups[0]?.id ?? null)
						: state.selectedGroupId,
			};
		}
		case "renameWorkspace":
			return {
				...state,
				groups: state.groups.map((group) =>
					group.id === action.groupId
						? { ...group, name: action.name.trim() || group.name }
						: group
				),
			};
		case "addPane": {
			const selectedGroupId =
				(action.groupId as GroupId | undefined) ??
				state.selectedGroupId ??
				state.groups[0]?.id;
			if (!selectedGroupId) return null;
			return {
				...state,
				groups: state.groups.map(
					appendPaneToGroup.bind(null, selectedGroupId, action.pane)
				),
				selectedGroupId,
			};
		}
		case "removePane":
			return {
				...state,
				groups: reduceTerminalGroups(state.groups, action),
			};
		case "directorySelected":
		case "setPaneAgentKind":
			return {
				...state,
				groups: reduceTerminalGroups(state.groups, action),
			};
		case "ensureChatPane": {
			const selectedGroupId = state.selectedGroupId ?? state.groups[0]?.id;
			const group =
				state.groups.find(hasId.bind(null, selectedGroupId)) ?? state.groups[0];
			if (!group) return null;
			const pane =
				group.panes.find(
					(candidate) =>
						candidate.id === group.selectedPaneId &&
						isChatAgentKind(candidate.agentKind)
				) ??
				group.panes.find((candidate) => isChatAgentKind(candidate.agentKind));
			const chatPane = pane ?? createPendingAgentChatPane();
			return {
				...state,
				selectedGroupId: group.id,
				groups: state.groups.map((candidate) =>
					candidate.id === group.id
						? {
								...candidate,
								panes: pane ? candidate.panes : [chatPane, ...candidate.panes],
								selectedPaneId: chatPane.id,
							}
						: candidate
				),
			};
		}
	}
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

export type PrimaryProductLoopStage =
	| "workspace"
	| "pane"
	| "chatSession"
	| "checkpointOrDiff";

export interface PrimaryProductLoopStep {
	readonly stage: PrimaryProductLoopStage;
	readonly owner: string;
	readonly outcome: string;
}

export interface PrimaryProductLoopContext {
	readonly workspaceId: GroupId | null;
	readonly paneId: PaneId | null;
	readonly chatSessionPaneId: PaneId | null;
	readonly workspacePath: string | null;
	readonly outcomeSurfaces: readonly ["chat-checkpoints", "editor-git-diff"];
}

export interface TerminalViewSwitchHealth {
	readonly type: "view_switch";
	readonly from: string | null;
	readonly to: string;
	readonly timestamp: number;
	readonly elapsedMs: number | null;
	readonly workspaceId: GroupId | null;
	readonly paneId: PaneId | null;
	readonly chatSessionPaneId: PaneId | null;
	readonly workspacePath: string | null;
}

export const PRIMARY_PRODUCT_LOOP = [
	{
		stage: "workspace",
		owner: "TerminalGroupModel",
		outcome: "select a durable project workspace",
	},
	{
		stage: "pane",
		owner: "TerminalPaneModel",
		outcome: "focus a chat-capable pane inside that workspace",
	},
	{
		stage: "chatSession",
		owner: "ChatService",
		outcome: "run the agent session against the pane workspace context",
	},
	{
		stage: "checkpointOrDiff",
		owner: "ChatCheckpointReadModel + GitDiffView",
		outcome: "review checkpoint cards and editor/git diffs from the run",
	},
] as const satisfies readonly PrimaryProductLoopStep[];

const TERMINAL_STORAGE_KEY = "inferay-terminal-state" as const;
const TERMINAL_SHELL_CHANGE_EVENT = "terminal-shell-change" as const;

export type TerminalStateChangeSource =
	| "canonical"
	| "local"
	| "view"
	| "cache";

export interface TerminalShellChangeDetail {
	source: TerminalStateChangeSource;
	reason?: string;
	mainView?: "chat" | "editor" | "graph";
	productHealth?: TerminalViewSwitchHealth;
	stateKey?: string;
	state?: TerminalSavedState;
}

const CUSTOM_THEME_KEY = "inferay-custom-theme" as const;

const DEFAULT_THEME_ID: ThemeId = "default";

export const DEFAULT_FONT_SIZE = 13 as const;

export const DEFAULT_FONT_FAMILY: TerminalFont = "SF Mono";

export const DEFAULT_OPACITY = 1 as const;

export const DEFAULT_COLUMNS = 3 as const;

export const DEFAULT_ROWS = 2 as const;

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

export function terminalStateKey(state: TerminalSavedState): string {
	return JSON.stringify({
		selectedGroupId: state.selectedGroupId,
		groups: state.groups.map((group) => ({
			id: group.id,
			name: group.name,
			selectedPaneId: group.selectedPaneId,
			columns: group.columns,
			rows: group.rows,
			panes: group.panes.map((pane) => ({
				id: pane.id,
				agentKind: pane.agentKind,
				cwd: pane.cwd ?? null,
				pendingCwd: pane.pendingCwd ?? false,
				title: pane.title,
			})),
		})),
		themeId: state.themeId,
		fontSize: state.fontSize,
		fontFamily: state.fontFamily,
		opacity: state.opacity,
	});
}

export function terminalStateScore(
	state: Pick<TerminalSavedState, "groups"> | null
): number {
	if (!state) return 0;
	return state.groups.reduce((score, group) => {
		return (
			score +
			1 +
			group.panes.length * 10 +
			group.panes.filter((pane) => pane.cwd || pane.pendingCwd === false)
				.length *
				10
		);
	}, 0);
}

export function getPrimaryProductLoopContext(
	state: Pick<TerminalSavedState, "groups" | "selectedGroupId"> | null
): PrimaryProductLoopContext {
	const workspace =
		state?.groups.find(hasId.bind(null, state.selectedGroupId)) ??
		state?.groups[0] ??
		null;
	const selectedPane =
		workspace?.panes.find(hasId.bind(null, workspace.selectedPaneId)) ??
		workspace?.panes[0] ??
		null;
	const chatPane =
		selectedPane && isChatAgentKind(selectedPane.agentKind)
			? selectedPane
			: (workspace?.panes.find((pane) => isChatAgentKind(pane.agentKind)) ??
				null);
	const workspacePath = chatPane?.cwd ?? selectedPane?.cwd ?? null;
	return {
		workspaceId: workspace?.id ?? null,
		paneId: selectedPane?.id ?? null,
		chatSessionPaneId: chatPane?.id ?? null,
		workspacePath,
		outcomeSurfaces: ["chat-checkpoints", "editor-git-diff"],
	};
}

export function createTerminalViewSwitchHealth({
	context,
	from,
	previousTimestamp = null,
	timestamp = Date.now(),
	to,
}: {
	context: PrimaryProductLoopContext;
	from: string | null;
	previousTimestamp?: number | null;
	timestamp?: number;
	to: string;
}): TerminalViewSwitchHealth {
	return {
		type: "view_switch",
		from,
		to,
		timestamp,
		elapsedMs:
			previousTimestamp === null
				? null
				: Math.max(0, timestamp - previousTimestamp),
		workspaceId: context.workspaceId,
		paneId: context.paneId,
		chatSessionPaneId: context.chatSessionPaneId,
		workspacePath: context.workspacePath,
	};
}

let _cachedTerminalState: TerminalSavedState | null = null;
export function cacheTerminalState(state: TerminalSavedState): void {
	_cachedTerminalState = state;
}

export function createDefaultTerminalState(): TerminalSavedState {
	const group = createDefaultAgentChatGroup();
	return {
		groups: [group],
		selectedGroupId: group.id,
		themeId: DEFAULT_THEME_ID,
		fontSize: DEFAULT_FONT_SIZE,
		fontFamily: DEFAULT_FONT_FAMILY,
		opacity: DEFAULT_OPACITY,
	};
}

function chooseSelectedGroupId(
	groups: TerminalGroupModel[],
	selectedGroupId: GroupId | null
): GroupId | null {
	if (groups.some(hasId.bind(null, selectedGroupId))) return selectedGroupId;
	let bestGroup: TerminalGroupModel | null = null;
	let bestScore = -Infinity;
	for (const group of groups) {
		const score = terminalStateScore({ groups: [group] });
		if (score > bestScore) {
			bestGroup = group;
			bestScore = score;
		}
	}
	return bestGroup?.id ?? null;
}

export function normalizeTerminalState(
	value: unknown,
	options: { createDefault?: boolean } = {}
): TerminalSavedState | null {
	if (!isValidTerminalState(value)) {
		return options.createDefault ? createDefaultTerminalState() : null;
	}
	const groups = value.groups.map(migrateGroup);
	if (groups.length === 0) {
		return options.createDefault ? createDefaultTerminalState() : null;
	}
	return {
		...value,
		groups,
		selectedGroupId: chooseSelectedGroupId(groups, value.selectedGroupId),
		themeId: getThemeById(value.themeId).id,
		fontSize: Number.isFinite(value.fontSize)
			? value.fontSize
			: DEFAULT_FONT_SIZE,
		fontFamily: value.fontFamily || DEFAULT_FONT_FAMILY,
		opacity: Number.isFinite(value.opacity) ? value.opacity : DEFAULT_OPACITY,
	};
}

function isEmptyPendingPane(pane: TerminalPaneModel): boolean {
	return (
		pane.pendingCwd === true &&
		!pane.cwd &&
		(!pane.referencePaths || pane.referencePaths.length === 0)
	);
}

function shouldKeepEmptyPendingPane(
	pane: TerminalPaneModel,
	group: TerminalGroupModel,
	state: TerminalSavedState,
	options: { keepSelectedDraft?: boolean }
): boolean {
	return (
		pane.id === group.selectedPaneId ||
		(options.keepSelectedDraft === true &&
			group.id === state.selectedGroupId &&
			isChatAgentKind(pane.agentKind))
	);
}

function hasDurablePane(group: TerminalGroupModel): boolean {
	return group.panes.some((pane) => pane.cwd || pane.pendingCwd === false);
}

export function compactTerminalState(
	state: TerminalSavedState,
	options: { keepSelectedDraft?: boolean } = {}
): TerminalSavedState {
	let changed = false;
	const hasDurableGroup = state.groups.some(hasDurablePane);
	const selectedGroup =
		state.groups.find(hasId.bind(null, state.selectedGroupId)) ??
		state.groups[0];
	const groups = state.groups.flatMap((group) => {
		const groupIsDurable = hasDurablePane(group);
		if (
			hasDurableGroup &&
			!(options.keepSelectedDraft && group.id === state.selectedGroupId) &&
			!groupIsDurable
		) {
			return [];
		}
		if (!hasDurableGroup && group.id !== selectedGroup?.id) {
			return [];
		}
		if (!groupIsDurable) {
			if (options.keepSelectedDraft && group.id === state.selectedGroupId) {
				return [group];
			}
			const selectedPane =
				group.panes.find(hasId.bind(null, group.selectedPaneId)) ??
				group.panes[0];
			const panes = selectedPane ? [selectedPane] : [];
			if (panes.length === group.panes.length) return [group];
			changed = true;
			return [
				{
					...group,
					panes,
					selectedPaneId: selectedPane?.id ?? null,
				},
			];
		}
		const panes = group.panes.filter(
			(pane) =>
				shouldKeepEmptyPendingPane(pane, group, state, options) ||
				!isEmptyPendingPane(pane)
		);
		if (panes.length === group.panes.length) return [group];
		changed = true;
		return [
			{
				...group,
				panes,
				selectedPaneId: panes.some(hasId.bind(null, group.selectedPaneId))
					? group.selectedPaneId
					: (panes[0]?.id ?? null),
			},
		];
	});
	return changed || groups.length !== state.groups.length
		? {
				...state,
				groups,
				selectedGroupId: chooseSelectedGroupId(groups, state.selectedGroupId),
			}
		: state;
}

export function loadTerminalState(): TerminalSavedState | null {
	const parsed = readStoredJson<unknown>(TERMINAL_STORAGE_KEY, null);
	const state = normalizeTerminalState(parsed);
	_cachedTerminalState = state;
	return state;
}

export async function loadCanonicalTerminalState(): Promise<TerminalSavedState | null> {
	try {
		const response = await fetch("/api/terminal/state");
		if (!response.ok) return loadTerminalState();
		const serverState = await response.json();
		const normalizedBase = normalizeTerminalState(serverState);
		const normalized = normalizedBase
			? compactTerminalState(normalizedBase, { keepSelectedDraft: true })
			: null;
		if (normalized) {
			const previousKey = _cachedTerminalState
				? terminalStateKey(_cachedTerminalState)
				: null;
			const nextKey = terminalStateKey(normalized);
			_cachedTerminalState = normalized;
			writeStoredJson(TERMINAL_STORAGE_KEY, normalized);
			if (normalizedBase && terminalStateKey(normalizedBase) !== nextKey) {
				sendJson("/api/terminal/state", normalized).catch(noop);
			}
			if (previousKey !== nextKey && typeof window !== "undefined") {
				dispatchTerminalShellChange({
					source: "canonical",
					reason: "canonical-load",
					state: normalized,
					stateKey: nextKey,
				});
			}
			return normalized;
		}
		_cachedTerminalState = null;
		return null;
	} catch {
		return loadTerminalState();
	}
}

export function dispatchTerminalShellChange(
	detail: TerminalShellChangeDetail
): void {
	window.dispatchEvent(
		new CustomEvent<TerminalShellChangeDetail>(TERMINAL_SHELL_CHANGE_EVENT, {
			detail,
		})
	);
}

export function saveSyncedTerminalState(
	state: TerminalSavedState,
	reason?: string,
	source: TerminalStateChangeSource = "canonical"
): void {
	const normalized = normalizeTerminalState(state, { createDefault: true });
	if (!normalized) return;
	saveLocalTerminalState(normalized, reason, source);
	sendJson("/api/terminal/state", normalized).catch(noop);
}

function saveLocalTerminalState(
	state: TerminalSavedState,
	reason?: string,
	source: TerminalStateChangeSource = "local"
): void {
	const normalized = normalizeTerminalState(state, { createDefault: true });
	if (!normalized) return;
	_cachedTerminalState = normalized;
	writeStoredJson(TERMINAL_STORAGE_KEY, normalized);
	flushPendingClientStorageSync();
	dispatchTerminalShellChange({
		source,
		reason,
		state: normalized,
		stateKey: terminalStateKey(normalized),
	});
}

export async function mutateCanonicalTerminalState(
	mutate: (state: TerminalSavedState) => TerminalSavedState | null,
	reason?: string,
	options: { createIfMissing?: boolean } = {}
): Promise<TerminalSavedState | null> {
	const state =
		(await loadCanonicalTerminalState()) ??
		(options.createIfMissing ? createDefaultTerminalState() : null);
	if (!state) return null;
	const next = mutate(state);
	if (!next) return null;
	saveSyncedTerminalState(next, reason);
	return normalizeTerminalState(next, { createDefault: true });
}

export function mutateTerminalWorkspaceState(
	action:
		| TerminalWorkspaceAction
		| ((state: TerminalSavedState) => TerminalWorkspaceAction | null),
	reason?: string,
	options: { createIfMissing?: boolean } = {}
): Promise<TerminalSavedState | null> {
	return (async () => {
		const state =
			(await loadCanonicalTerminalState()) ??
			(options.createIfMissing ? createDefaultTerminalState() : null);
		if (!state) return null;
		const nextAction = typeof action === "function" ? action(state) : action;
		if (!nextAction) return null;
		const optimistic = reduceTerminalWorkspaceState(state, nextAction);
		if (optimistic) saveLocalTerminalState(optimistic, reason);
		try {
			const payload = await postJson<{ state: TerminalSavedState | null }>(
				"/api/terminal/state/workspace-action",
				{ action: nextAction }
			);
			const normalized = normalizeTerminalState(payload.state, {
				createDefault: true,
			});
			if (!normalized) return optimistic;
			saveLocalTerminalState(normalized, reason, "canonical");
			return normalized;
		} catch {
			return optimistic;
		}
	})();
}

export type TerminalGroupsAction =
	| ({
			type: "addPane";
			groupId: string;
			referencePaths?: string[];
	  } & (
			| { agentKind: AgentKind; cwd?: string; pendingCwd?: boolean }
			| { pane: TerminalPaneModel }
	  ))
	| { type: "removePane"; groupId: string; paneId: string; force?: boolean }
	| { type: "selectPane"; groupId: string; paneId: string }
	| {
			type: "directorySelected";
			groupId: string;
			paneId: string;
			path: string | null;
			referencePaths?: string[];
	  }
	| { type: "removeGroup"; groupId: string }
	| {
			type: "reorderPanes";
			groupId: string;
			fromIndex: number;
			toIndex: number;
	  }
	| {
			type: "setPaneAgentKind";
			groupId: string;
			paneId: string;
			agentKind: AgentKind;
	  }
	| { type: "replaceAll"; groups: TerminalGroupModel[] };

export function reduceTerminalGroups(
	state: TerminalGroupModel[],
	action: TerminalGroupsAction
): TerminalGroupModel[] {
	switch (action.type) {
		case "addPane": {
			const pane =
				"pane" in action
					? action.pane
					: createTerminalPane(action.agentKind, action.cwd, action.pendingCwd);
			if (action.referencePaths) pane.referencePaths = action.referencePaths;
			return state.map((group) =>
				group.id === action.groupId
					? { ...group, panes: [...group.panes, pane], selectedPaneId: pane.id }
					: group
			);
		}
		case "removePane":
			return state.map((group) => {
				if (group.id !== action.groupId) return group;
				const panes = group.panes.filter(lacksId.bind(null, action.paneId));
				return {
					...group,
					panes,
					selectedPaneId:
						group.selectedPaneId === action.paneId
							? (panes[0]?.id ?? null)
							: group.selectedPaneId,
				};
			});
		case "selectPane":
			return state.map((group) =>
				group.id === action.groupId
					? { ...group, selectedPaneId: action.paneId as PaneId }
					: group
			);
		case "directorySelected":
			return state.map((group) =>
				group.id === action.groupId
					? {
							...group,
							panes: group.panes.map((pane) =>
								pane.id === action.paneId
									? {
											...pane,
											cwd: action.path ?? undefined,
											pendingCwd: false,
											referencePaths: action.referencePaths,
											title: getPaneTitle(
												pane.agentKind,
												action.path ?? undefined
											),
										}
									: pane
							),
						}
					: group
			);
		case "removeGroup":
			return state.filter(lacksId.bind(null, action.groupId));
		case "reorderPanes":
			return state.map((group) => {
				if (group.id !== action.groupId) return group;
				const panes = [...group.panes];
				const [moved] = panes.splice(action.fromIndex, 1);
				if (moved) panes.splice(action.toIndex, 0, moved);
				return { ...group, panes };
			});
		case "setPaneAgentKind":
			return state.map((group) =>
				group.id === action.groupId
					? {
							...group,
							panes: group.panes.map((pane) =>
								pane.id === action.paneId
									? {
											...pane,
											agentKind: action.agentKind,
											isClaude: action.agentKind === "claude",
											paneType: action.agentKind,
											title: getPaneTitle(action.agentKind, pane.cwd),
										}
									: pane
							),
						}
					: group
			);
		case "replaceAll":
			return action.groups;
	}
}

/**
 * Change a pane's agent kind directly via localStorage + event.
 * No prop-drilling needed — call from any component.
 */
export function changePaneAgentKind(
	paneId: string,
	agentKind: AgentKind
): void {
	void mutateCanonicalTerminalState(
		(state) => ({
			...state,
			groups: state.groups.map((g) => ({
				...g,
				panes: g.panes.map((p) =>
					p.id !== paneId
						? p
						: { ...p, agentKind, isClaude: agentKind === "claude" }
				),
			})),
		}),
		"agent-kind-change"
	);
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

export function createDefaultAgentChatGroup(): TerminalGroupModel {
	const panes = [createPendingAgentChatPane()];
	return {
		id: createGroupId(),
		name: "Default",
		panes,
		selectedPaneId: panes[0]?.id ?? null,
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
	const panes = group.panes;
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
		loadTerminalState()?.groups.map(migrateGroup) ?? [
			createDefaultAgentChatGroup(),
		]
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
	readonly tone: "idle" | "thinking" | "responding" | "error" | "tool";
	readonly iconType: StatusIconType;
	readonly isActive: boolean;
	readonly toolName?: string;
}

const STATUS_CONFIG: Record<BaseStatus, Omit<StatusInfo, "toolName">> = {
	idle: {
		label: "Idle",
		tone: "idle",
		iconType: "circle",
		isActive: false,
	},
	thinking: {
		label: "Planning next step",
		tone: "thinking",
		iconType: "sparkles",
		isActive: true,
	},
	responding: {
		label: "Writing response",
		tone: "responding",
		iconType: "message",
		isActive: true,
	},
	error: {
		label: "Error",
		tone: "error",
		iconType: "alert",
		isActive: false,
	},
};

const TOOL_STATUS_CONFIG: Omit<StatusInfo, "toolName" | "label"> = {
	tone: "tool",
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
		tone: "idle",
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
		TERMINAL_THEMES[0]!
	);
}
