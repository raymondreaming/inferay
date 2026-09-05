import { postJson, sendJson } from "../../../adapters/backend/http.ts";
import {
	readStoredJson,
	readStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import { flushPendingClientStorageSync } from "../../../adapters/storage/sync.ts";
import {
	type AgentKind,
	type ChatAgentKind,
	getAgentDefinition,
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../../modules/agents/model/agents.ts";
import { hasId, lacksId, noop } from "../../../shared/lib/data.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";

export type { AgentKind } from "../../../modules/agents/model/agents.ts";

export type HexColor = `#${string}`;

export interface AgentTheme {
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
} as const;

export type ThemeId = (typeof THEME_IDS)[keyof typeof THEME_IDS];
export type AgentLayoutMode = "grid" | "rows";

export function loadAgentLayoutMode(): AgentLayoutMode {
	const stored =
		readStoredValue("agent-layout-mode") ??
		readStoredValue("terminal-layout-mode");
	if (stored && readStoredValue("agent-layout-mode") === null) {
		writeStoredValue("agent-layout-mode", stored);
	}
	return stored === "grid" ? "grid" : "rows";
}

export function syncAgentLayoutMode(
	setLayoutMode: (mode: AgentLayoutMode) => void,
): void {
	setLayoutMode(loadAgentLayoutMode());
}

export function listenAgentLayoutMode(
	setLayoutMode: (mode: AgentLayoutMode) => void,
): () => void {
	return listenWindowEvent(
		"agent-shell-change",
		syncAgentLayoutMode.bind(null, setLayoutMode),
	);
}

export function appendPaneToGroup(
	selectedGroupId: string,
	pane: AgentPaneModel,
	group: AgentGroupModel,
): AgentGroupModel {
	if (group.id !== selectedGroupId) return group;
	const panes =
		group.panes.length === 1 &&
		isEmptyPendingPane(group.panes[0]!) &&
		!isEmptyPendingPane(pane)
			? [pane]
			: [...group.panes, pane];
	return { ...group, panes, selectedPaneId: pane.id };
}

export type AgentWorkspaceAction =
	| { type: "selectWorkspace"; groupId: string }
	| { type: "selectPane"; groupId: string; paneId: string }
	| { type: "addWorkspace" }
	| { type: "removeWorkspace"; groupId: string }
	| { type: "renameWorkspace"; groupId: string; name: string }
	| { type: "addPane"; pane: AgentPaneModel; groupId?: string }
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

export function reduceAgentWorkspaceState(
	state: AgentSavedState,
	action: AgentWorkspaceAction,
): AgentSavedState | null {
	switch (action.type) {
		case "selectWorkspace":
			if (!state.groups.some(hasId.bind(null, action.groupId))) return state;
			return compactAgentState(
				{ ...state, selectedGroupId: action.groupId as GroupId },
				{ keepSelectedDraft: true },
			);
		case "selectPane":
			return compactAgentState(
				{
					...state,
					selectedGroupId: action.groupId as GroupId,
					groups: state.groups.map((group) =>
						group.id === action.groupId
							? { ...group, selectedPaneId: action.paneId as PaneId }
							: group,
					),
				},
				{ keepSelectedDraft: true },
			);
		case "addWorkspace": {
			const cleanState = compactAgentState(state, {
				keepSelectedDraft: true,
			});
			const starterPane = createPendingAgentChatPane();
			const group: AgentGroupModel = {
				id: createGroupId(),
				name: `Workspace ${cleanState.groups.length + 1}`,
				panes: [starterPane],
				selectedPaneId: starterPane.id,
				columns: DEFAULT_COLUMNS,
				rows: DEFAULT_ROWS,
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
				(group) => group.id !== action.groupId,
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
						: group,
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
					appendPaneToGroup.bind(null, selectedGroupId, action.pane),
				),
				selectedGroupId,
			};
		}
		case "removePane":
			return {
				...state,
				groups: reduceAgentGroups(state.groups, action),
			};
		case "directorySelected":
		case "setPaneAgentKind":
			return {
				...state,
				groups: reduceAgentGroups(state.groups, action),
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
						isChatAgentKind(candidate.agentKind),
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
						: candidate,
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
	["midnight", "Midnight", "#0d0e0f", "#ededed", "#6e8cff", "#1e1f21"],
];

const AGENT_THEMES: readonly AgentTheme[] = TERM_THEME_DATA.map(
	([id, name, bg, fg, cursor, separator]) => ({
		id,
		name,
		bg,
		fg,
		cursor,
		separator,
	}),
);

const AGENT_FONTS = [
	"SF Mono",
	"Menlo",
	"Monaco",
	"Courier New",
	"JetBrains Mono",
	"Fira Code",
	"Source Code Pro",
] as const;

export type AgentFont = (typeof AGENT_FONTS)[number];

export type PaneId = string & { readonly __brand: "PaneId" };

export type GroupId = string & { readonly __brand: "GroupId" };

function createPaneId(): PaneId {
	return crypto.randomUUID() as PaneId;
}

export function createGroupId(): GroupId {
	return crypto.randomUUID() as GroupId;
}

export type PaneType = AgentKind;

export interface AgentPaneModel {
	readonly id: PaneId;
	title: string;
	readonly agentKind: AgentKind;
	readonly isClaude: boolean;
	readonly paneType?: PaneType;
	cwd?: string;
	pendingCwd?: boolean;
	referencePaths?: string[];
	summary?: string;
	providerSessionId?: string;
}

export interface AgentGroupModel {
	readonly id: GroupId;
	name: string;
	panes: AgentPaneModel[];
	selectedPaneId: PaneId | null;
	columns: number;
	rows: number;
}

export interface AgentSavedState {
	groups: AgentGroupModel[];
	selectedGroupId: GroupId | null;
	themeId: ThemeId;
	fontSize: number;
	fontFamily: string;
	opacity: number;
}

/** Canonical workspace names for new code; legacy Agent names remain wire-compatible. */
export type Pane = AgentPaneModel;
export type WorkspaceGroup = AgentGroupModel;

export interface PrimaryProductLoopContext {
	readonly workspaceId: GroupId | null;
	readonly paneId: PaneId | null;
	readonly chatSessionPaneId: PaneId | null;
	readonly workspacePath: string | null;
	readonly outcomeSurfaces: readonly ["chat-checkpoints", "chat-git-diff"];
}

export interface AgentViewSwitchHealth {
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

const AGENT_STORAGE_KEY = "inferay-agent-state" as const;
const LEGACY_AGENT_STORAGE_KEY = "inferay-terminal-state" as const;
const AGENT_SHELL_CHANGE_EVENT = "agent-shell-change" as const;
export const REMOVE_AGENT_PANE_REQUEST_EVENT =
	"inferay-remove-agent-pane-request" as const;

export interface RemoveAgentPaneRequestDetail {
	paneId: string;
}

export type AgentStateChangeSource = "canonical" | "local" | "view" | "cache";

export interface AgentShellChangeDetail {
	source: AgentStateChangeSource;
	reason?: string;
	mainView?: "chat" | "graph";
	productHealth?: AgentViewSwitchHealth;
	stateKey?: string;
	state?: AgentSavedState;
}

const DEFAULT_THEME_ID: ThemeId = "default";

export const DEFAULT_FONT_SIZE = 13 as const;

export const DEFAULT_FONT_FAMILY: AgentFont = "SF Mono";

export const DEFAULT_OPACITY = 1 as const;

export const DEFAULT_COLUMNS = 1 as const;

export const DEFAULT_ROWS = 1 as const;

function isValidAgentState(value: unknown): value is AgentSavedState {
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

export function agentStateKey(state: AgentSavedState): string {
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
				providerSessionId: pane.providerSessionId ?? null,
			})),
		})),
		themeId: state.themeId,
		fontSize: state.fontSize,
		fontFamily: state.fontFamily,
		opacity: state.opacity,
	});
}

export function agentStateScore(
	state: Pick<AgentSavedState, "groups"> | null,
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
	state: Pick<AgentSavedState, "groups" | "selectedGroupId"> | null,
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
		outcomeSurfaces: ["chat-checkpoints", "chat-git-diff"],
	};
}

export function createAgentViewSwitchHealth({
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
}): AgentViewSwitchHealth {
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

let _cachedAgentState: AgentSavedState | null = null;
export function cacheAgentState(state: AgentSavedState): void {
	_cachedAgentState = state;
}

export function createDefaultAgentState(): AgentSavedState {
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
	groups: AgentGroupModel[],
	selectedGroupId: GroupId | null,
): GroupId | null {
	if (groups.some(hasId.bind(null, selectedGroupId))) return selectedGroupId;
	let bestGroup: AgentGroupModel | null = null;
	let bestScore = -Infinity;
	for (const group of groups) {
		const score = agentStateScore({ groups: [group] });
		if (score > bestScore) {
			bestGroup = group;
			bestScore = score;
		}
	}
	return bestGroup?.id ?? null;
}

export function normalizeAgentState(
	value: unknown,
	options: { createDefault?: boolean } = {},
): AgentSavedState | null {
	if (!isValidAgentState(value)) {
		return options.createDefault ? createDefaultAgentState() : null;
	}
	const groups = value.groups.map(migrateGroup);
	if (groups.length === 0) {
		return options.createDefault ? createDefaultAgentState() : null;
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

function isEmptyPendingPane(pane: AgentPaneModel): boolean {
	return (
		pane.pendingCwd === true &&
		!pane.cwd &&
		(!pane.referencePaths || pane.referencePaths.length === 0)
	);
}

function shouldKeepEmptyPendingPane(
	pane: AgentPaneModel,
	group: AgentGroupModel,
	state: AgentSavedState,
	options: { keepSelectedDraft?: boolean },
): boolean {
	return (
		pane.id === group.selectedPaneId ||
		(options.keepSelectedDraft === true &&
			group.id === state.selectedGroupId &&
			isChatAgentKind(pane.agentKind))
	);
}

function hasDurablePane(group: AgentGroupModel): boolean {
	return group.panes.some((pane) => pane.cwd || pane.pendingCwd === false);
}

export function compactAgentState(
	state: AgentSavedState,
	options: { keepSelectedDraft?: boolean } = {},
): AgentSavedState {
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
				!isEmptyPendingPane(pane),
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

export function loadAgentState(): AgentSavedState | null {
	const current = readStoredJson<unknown>(AGENT_STORAGE_KEY, null);
	const parsed =
		current ?? readStoredJson<unknown>(LEGACY_AGENT_STORAGE_KEY, null);
	const state = normalizeAgentState(parsed);
	if (state && current === null) writeStoredJson(AGENT_STORAGE_KEY, state);
	_cachedAgentState = state;
	return state;
}

export async function loadCanonicalAgentState(): Promise<AgentSavedState | null> {
	try {
		const response = await fetch("/api/agent/state");
		if (!response.ok) return loadAgentState();
		const serverState = await response.json();
		const normalizedBase = normalizeAgentState(serverState);
		const normalized = normalizedBase
			? compactAgentState(normalizedBase, { keepSelectedDraft: true })
			: null;
		if (normalized) {
			const previousKey = _cachedAgentState
				? agentStateKey(_cachedAgentState)
				: null;
			const nextKey = agentStateKey(normalized);
			_cachedAgentState = normalized;
			writeStoredJson(AGENT_STORAGE_KEY, normalized);
			if (normalizedBase && agentStateKey(normalizedBase) !== nextKey) {
				sendJson("/api/agent/state", normalized).catch(noop);
			}
			if (previousKey !== nextKey && typeof window !== "undefined") {
				dispatchAgentShellChange({
					source: "canonical",
					reason: "canonical-load",
					state: normalized,
					stateKey: nextKey,
				});
			}
			return normalized;
		}
		_cachedAgentState = null;
		return null;
	} catch {
		return loadAgentState();
	}
}

export function dispatchAgentShellChange(detail: AgentShellChangeDetail): void {
	window.dispatchEvent(
		new CustomEvent<AgentShellChangeDetail>(AGENT_SHELL_CHANGE_EVENT, {
			detail,
		}),
	);
}

export function dispatchRemoveAgentPaneRequest(paneId: string): void {
	window.dispatchEvent(
		new CustomEvent<RemoveAgentPaneRequestDetail>(
			REMOVE_AGENT_PANE_REQUEST_EVENT,
			{ detail: { paneId } },
		),
	);
}

export function saveSyncedAgentState(
	state: AgentSavedState,
	reason?: string,
	source: AgentStateChangeSource = "canonical",
): void {
	const normalized = normalizeAgentState(state, { createDefault: true });
	if (!normalized) return;
	saveLocalAgentState(normalized, reason, source);
	sendJson("/api/agent/state", normalized).catch(noop);
}

function saveLocalAgentState(
	state: AgentSavedState,
	reason?: string,
	source: AgentStateChangeSource = "local",
): void {
	const normalized = normalizeAgentState(state, { createDefault: true });
	if (!normalized) return;
	_cachedAgentState = normalized;
	writeStoredJson(AGENT_STORAGE_KEY, normalized);
	flushPendingClientStorageSync();
	dispatchAgentShellChange({
		source,
		reason,
		state: normalized,
		stateKey: agentStateKey(normalized),
	});
}

export async function mutateCanonicalAgentState(
	mutate: (state: AgentSavedState) => AgentSavedState | null,
	reason?: string,
	options: { createIfMissing?: boolean } = {},
): Promise<AgentSavedState | null> {
	const state =
		(await loadCanonicalAgentState()) ??
		(options.createIfMissing ? createDefaultAgentState() : null);
	if (!state) return null;
	const next = mutate(state);
	if (!next) return null;
	saveSyncedAgentState(next, reason);
	return normalizeAgentState(next, { createDefault: true });
}

export function mutateAgentWorkspaceState(
	action:
		| AgentWorkspaceAction
		| ((state: AgentSavedState) => AgentWorkspaceAction | null),
	reason?: string,
	options: { createIfMissing?: boolean } = {},
): Promise<AgentSavedState | null> {
	return (async () => {
		const state =
			(await loadCanonicalAgentState()) ??
			(options.createIfMissing ? createDefaultAgentState() : null);
		if (!state) return null;
		const nextAction = typeof action === "function" ? action(state) : action;
		if (!nextAction) return null;
		const optimistic = reduceAgentWorkspaceState(state, nextAction);
		if (optimistic) saveLocalAgentState(optimistic, reason);
		try {
			const payload = await postJson<{ state: AgentSavedState | null }>(
				"/api/agent/state/workspace-action",
				{ action: nextAction },
			);
			const normalized = normalizeAgentState(payload.state, {
				createDefault: true,
			});
			if (!normalized) return optimistic;
			saveLocalAgentState(normalized, reason, "canonical");
			return normalized;
		} catch {
			return optimistic;
		}
	})();
}

export type AgentGroupsAction =
	| ({
			type: "addPane";
			groupId: string;
			referencePaths?: string[];
	  } & (
			| { agentKind: AgentKind; cwd?: string; pendingCwd?: boolean }
			| { pane: AgentPaneModel }
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
	| { type: "replaceAll"; groups: AgentGroupModel[] };

export function reduceAgentGroups(
	state: AgentGroupModel[],
	action: AgentGroupsAction,
): AgentGroupModel[] {
	switch (action.type) {
		case "addPane": {
			const pane =
				"pane" in action
					? action.pane
					: createAgentPane(action.agentKind, action.cwd, action.pendingCwd);
			if (action.referencePaths) pane.referencePaths = action.referencePaths;
			return state.map((group) =>
				group.id === action.groupId
					? { ...group, panes: [...group.panes, pane], selectedPaneId: pane.id }
					: group,
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
					: group,
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
												action.path ?? undefined,
											),
										}
									: pane,
							),
						}
					: group,
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
									: pane,
							),
						}
					: group,
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
	agentKind: AgentKind,
): void {
	void mutateCanonicalAgentState(
		(state) => ({
			...state,
			groups: state.groups.map((g) => ({
				...g,
				panes: g.panes.map((p) =>
					p.id !== paneId
						? p
						: {
								...p,
								agentKind,
								isClaude: agentKind === "claude",
								providerSessionId: undefined,
							},
				),
			})),
		}),
		"agent-kind-change",
	);
}

export function setPaneProviderSession(
	paneId: string,
	providerSessionId: string | null,
): void {
	void mutateCanonicalAgentState(
		(state) => ({
			...state,
			groups: state.groups.map((group) => ({
				...group,
				panes: group.panes.map((pane) =>
					pane.id === paneId
						? { ...pane, providerSessionId: providerSessionId ?? undefined }
						: pane,
				),
			})),
		}),
		"provider-session",
	);
}

export function getPaneTitle(pane: AgentPaneModel): string;

export function getPaneTitle(agentKind: AgentKind, cwd?: string): string;

export function getPaneTitle(
	paneOrAgentKind: AgentPaneModel | AgentKind,
	cwd?: string,
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

export function createAgentPane(
	agentKind: AgentKind,
	cwd?: string,
	pendingCwd?: boolean,
): AgentPaneModel {
	const chatAgentKind = isChatAgentKind(agentKind)
		? agentKind
		: loadDefaultChatSettings().agentKind;
	return {
		id: createPaneId(),
		title: getPaneTitle(chatAgentKind, cwd),
		agentKind: chatAgentKind,
		isClaude: chatAgentKind === "claude",
		paneType: chatAgentKind,
		cwd,
		pendingCwd,
	};
}

export function createPendingAgentChatPane(
	agentKind: ChatAgentKind = loadDefaultChatSettings().agentKind,
): AgentPaneModel {
	return createAgentPane(agentKind, undefined, true);
}

export function createDefaultAgentChatGroup(): AgentGroupModel {
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
	group: Partial<AgentGroupModel> & {
		id: GroupId;
		name: string;
		panes: AgentPaneModel[];
		selectedPaneId: PaneId | null;
	},
): AgentGroupModel {
	const panes = group.panes;
	const selectedPaneId = panes.some(hasId.bind(null, group.selectedPaneId))
		? group.selectedPaneId
		: (panes[0]?.id ?? null);
	return {
		...group,
		panes: panes.map((pane) => {
			const inferredAgentKind =
				pane.agentKind ??
				(pane.paneType === "codex"
					? "codex"
					: pane.isClaude
						? "claude"
						: "agent");
			const agentKind = isChatAgentKind(inferredAgentKind)
				? inferredAgentKind
				: loadDefaultChatSettings().agentKind;
			return {
				...pane,
				agentKind,
				isClaude: agentKind === "claude",
				paneType: agentKind,
			};
		}),
		selectedPaneId,
		columns: group.columns ?? DEFAULT_COLUMNS,
		rows: group.rows ?? DEFAULT_ROWS,
	};
}

export function getInitialGroups(): AgentGroupModel[] {
	return (
		loadAgentState()?.groups.map(migrateGroup) ?? [
			createDefaultAgentChatGroup(),
		]
	);
}

export function getThemeById(themeId: string): AgentTheme {
	return (
		AGENT_THEMES.find(hasId.bind(null, themeId)) ??
		AGENT_THEMES.find(hasId.bind(null, DEFAULT_THEME_ID)) ??
		AGENT_THEMES[0]!
	);
}
