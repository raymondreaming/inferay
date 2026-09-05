import { postJson } from "../../../adapters/backend/http.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import {
	type AgentKind,
	getAgentDefinition,
	isChatAgentKind,
} from "../../../modules/agents/model/agents.ts";
import { hasId, noop } from "../../../shared/lib/data.ts";
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

export type AgentWorkspaceAction =
	| { type: "selectWorkspace"; groupId: string }
	| { type: "selectPane"; groupId: string; paneId: string }
	| { type: "addWorkspace" }
	| { type: "removeWorkspace"; groupId: string }
	| { type: "renameWorkspace"; groupId: string; name: string }
	| {
			type: "addPane";
			groupId?: string;
			agentKind?: AgentKind;
			cwd?: string;
			referencePaths?: string[];
	  }
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
	| {
			type: "reorderPanes";
			groupId: string;
			fromIndex: number;
			toIndex: number;
	  }
	| {
			type: "setGridDimensions";
			groupId: string;
			columns?: number;
			rows?: number;
	  }
	| {
			type: "setPaneProviderSession";
			paneId: string;
			providerSessionId: string | null;
	  }
	| { type: "changePaneAgentKind"; paneId: string; agentKind: AgentKind }
	| { type: "setTheme"; themeId: string }
	| { type: "ensureChatPane" };

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
	selection?: { groupId: string; paneId?: string };
	error?: string;
	saved?: boolean;
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

export function agentStateKey(state: AgentSavedState): string {
	return JSON.stringify(state);
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

export function loadAgentState(): AgentSavedState | null {
	const state = _cachedAgentState;
	const selection = pendingSelection?.selection;
	if (!state || !selection) return state;
	return {
		...state,
		selectedGroupId: selection.groupId as GroupId,
		groups: selection.paneId
			? state.groups.map((group) =>
					group.id === selection.groupId
						? { ...group, selectedPaneId: selection.paneId as PaneId }
						: group,
				)
			: state.groups,
	};
}

function acceptAgentState(
	state: AgentSavedState,
	reason?: string,
	saved = false,
): void {
	_cachedAgentState = state;
	dispatchAgentShellChange({
		source: "canonical",
		reason,
		saved,
		state: loadAgentState() ?? state,
		stateKey: agentStateKey(state),
		selection: pendingSelection?.selection,
	});
}

export async function initializeAgentState(): Promise<AgentSavedState> {
	const { state } = await postJson<{ state: AgentSavedState }>(
		"/api/agent/state/initialize",
		{
			legacy:
				readStoredValue(AGENT_STORAGE_KEY) ??
				readStoredValue(LEGACY_AGENT_STORAGE_KEY),
		},
	);
	acceptAgentState(state, "initialize");
	return state;
}

export function loadCanonicalAgentState(): Promise<AgentSavedState | null> {
	const read = pendingWorkspaceMutation.then(async () => {
		try {
			const response = await fetch("/api/agent/state");
			if (!response.ok) throw new Error("Failed to load workspace");
			const state = (await response.json()) as AgentSavedState | null;
			if (state) acceptAgentState(state, "canonical-load");
			return loadAgentState();
		} catch {
			dispatchAgentShellChange({
				source: "canonical",
				error: "Saved workspaces could not be loaded.",
			});
			return _cachedAgentState;
		}
	});
	pendingWorkspaceMutation = read.catch(noop);
	return read;
}

let pendingWorkspaceMutation: Promise<unknown> = Promise.resolve();
let workspaceRequestId = 0;
let pendingSelection: {
	id: number;
	selection: { groupId: string; paneId?: string };
} | null = null;

export function mutateAgentWorkspaceState(
	action:
		| AgentWorkspaceAction
		| ((state: AgentSavedState) => AgentWorkspaceAction | null),
	reason?: string,
	_options: { createIfMissing?: boolean } = {},
): Promise<AgentSavedState | null> {
	const id = ++workspaceRequestId;
	if (
		typeof action !== "function" &&
		(action.type === "selectPane" || action.type === "selectWorkspace")
	) {
		pendingSelection = {
			id,
			selection: {
				groupId: action.groupId,
				paneId: action.type === "selectPane" ? action.paneId : undefined,
			},
		};
		dispatchAgentShellChange({
			source: "local",
			reason,
			selection: pendingSelection.selection,
		});
	}
	const mutation = pendingWorkspaceMutation.then(async () => {
		const current = _cachedAgentState ?? (await initializeAgentState());
		const nextAction = typeof action === "function" ? action(current) : action;
		if (!nextAction) return null;
		try {
			const { state } = await postJson<{ state: AgentSavedState }>(
				"/api/agent/state/workspace-action",
				{ action: nextAction },
			);
			if (pendingSelection?.id === id) pendingSelection = null;
			acceptAgentState(state, reason, true);
			return loadAgentState();
		} catch {
			if (pendingSelection?.id === id) pendingSelection = null;
			dispatchAgentShellChange({
				source: "canonical",
				state: _cachedAgentState ?? undefined,
				selection: pendingSelection?.selection,
				error: "Workspace changes could not be saved.",
			});
			return null;
		}
	});
	pendingWorkspaceMutation = mutation.catch(noop);
	return mutation;
}

export type AgentGroupsAction = Exclude<
	AgentWorkspaceAction,
	{
		type:
			| "addWorkspace"
			| "removeWorkspace"
			| "renameWorkspace"
			| "ensureChatPane";
	}
>;

/**
 * Change provider identity through the native workspace owner.
 */
export function changePaneAgentKind(
	paneId: string,
	agentKind: AgentKind,
): void {
	void mutateAgentWorkspaceState(
		{ type: "changePaneAgentKind", paneId, agentKind },
		"agent-kind-change",
	);
}

export function setPaneProviderSession(
	paneId: string,
	providerSessionId: string | null,
): void {
	void mutateAgentWorkspaceState(
		{ type: "setPaneProviderSession", paneId, providerSessionId },
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

export function getThemeById(themeId: string): AgentTheme {
	return (
		AGENT_THEMES.find(hasId.bind(null, themeId)) ??
		AGENT_THEMES.find(hasId.bind(null, DEFAULT_THEME_ID)) ??
		AGENT_THEMES[0]!
	);
}
