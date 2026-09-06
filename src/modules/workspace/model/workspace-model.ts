import { lazy } from "octane";
import { dispatchWindowEvent } from "../../../shared/lib/data.ts";
export const Settings = lazy(() =>
	import("../../settings/components/Settings/index.tsx").then((module) => ({
		default: module.Settings,
	})),
);
export type MutableRef<T> = {
	current: T;
};

import { postJson } from "../../../adapters/backend/http.ts";
import { readStoredValue } from "../../../adapters/storage/stored-values.ts";
import type { AppThemeId } from "../../../app/model/appearance.ts";
import {
	noop,
	listenWindowEvent as WorkspaceModelListenWindowEvent,
} from "../../../shared/lib/data.ts";
import type { AgentKind as WorkspaceModelAgentKind } from "../../agents/model/agents.ts";

export type { AgentKind as WorkspaceModelAgentKind } from "../../agents/model/agents.ts";
export type ThemeId = AppThemeId;
export interface AgentTheme {
	readonly cursor: string;
	readonly separator: string;
}
export type AgentLayoutMode = "grid" | "rows";
export function loadAgentLayoutMode(): AgentLayoutMode {
	const stored = readStoredValue("agent-layout-mode");
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
	return WorkspaceModelListenWindowEvent(
		"agent-shell-change",
		syncAgentLayoutMode.bind(null, setLayoutMode),
	);
}
export type AgentWorkspaceAction =
	| { type: "selectWorkspace"; groupId: string }
	| { type: "selectRepository"; cwd: string }
	| { type: "selectPane"; groupId: string; paneId: string }
	| { type: "addWorkspace" }
	| { type: "removeWorkspace"; groupId: string }
	| { type: "renameWorkspace"; groupId: string; name: string }
	| {
			type: "addPane";
			groupId?: string;
			agentKind?: WorkspaceModelAgentKind;
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
			agentKind: WorkspaceModelAgentKind;
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
			type: "changePaneAgentKind";
			paneId: string;
			agentKind: WorkspaceModelAgentKind;
	  }
	| { type: "setTheme"; themeId: string };
const AGENT_THEMES: Record<ThemeId, AgentTheme> = {
	default: {
		cursor: "#007AFF",
		separator: "#111111",
	},
	midnight: {
		cursor: "#6e8cff",
		separator: "#1e1f21",
	},
};
export type PaneId = string & { readonly __brand: "PaneId" };
export type GroupId = string & { readonly __brand: "GroupId" };
export interface AgentPaneModel {
	readonly id: PaneId;
	title: string;
	readonly agentKind: WorkspaceModelAgentKind;
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
	repositories: RepositoryWorkspaceIndex;
	groups: AgentGroupModel[];
	selectedGroupId: GroupId | null;
	themeId: ThemeId;
	fontSize: number;
	fontFamily: string;
	opacity: number;
}

/** Canonical workspace names for new code; legacy Agent names remain wire-compatible. */
export type Pane = AgentPaneModel;
const AGENT_SHELL_CHANGE_EVENT = "agent-shell-change" as const;
export const REMOVE_AGENT_PANE_REQUEST_EVENT =
	"inferay-remove-agent-pane-request" as const;
export interface RemoveAgentPaneRequestDetail {
	paneId: string;
}
export interface AgentShellChangeDetail {
	selection?: { groupId: string; paneId?: string };
	error?: string;
	saved?: boolean;
	source: "canonical" | "local" | "view" | "cache";

	stateKey?: string;
	state?: AgentSavedState;
}
export const DEFAULT_COLUMNS = 1 as const;
export const DEFAULT_ROWS = 1 as const;
export function agentStateKey(state: AgentSavedState): string {
	return JSON.stringify(state);
}
let _cachedAgentState: AgentSavedState | null = null;
export function dispatchAgentShellChange(detail: AgentShellChangeDetail): void {
	dispatchWindowEvent<AgentShellChangeDetail>(AGENT_SHELL_CHANGE_EVENT, detail);
}
export function dispatchRemoveAgentPaneRequest(paneId: string): void {
	dispatchWindowEvent<RemoveAgentPaneRequestDetail>(
		REMOVE_AGENT_PANE_REQUEST_EVENT,
		{
			paneId,
		},
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
						? {
								...group,
								selectedPaneId: selection.paneId as PaneId,
							}
						: group,
				)
			: state.groups,
	};
}
function acceptAgentState(
	state: AgentSavedState,

	saved = false,
): void {
	_cachedAgentState = state;
	dispatchAgentShellChange({
		source: "canonical",

		saved,
		state: loadAgentState() ?? state,
		stateKey: agentStateKey(state),
		selection: pendingSelection?.selection,
	});
}
export async function initializeAgentState(): Promise<AgentSavedState> {
	const { state } = await postJson<{ state: AgentSavedState }>(
		"/api/agent/state/initialize",
		{},
	);
	acceptAgentState(state);
	return state;
}
let pendingWorkspaceRead: {
	barrier: Promise<unknown>;
	result: Promise<AgentSavedState | null>;
} | null = null;
export function loadCanonicalAgentState(): Promise<AgentSavedState | null> {
	if (pendingWorkspaceRead?.barrier === pendingWorkspaceMutation) {
		return pendingWorkspaceRead.result;
	}
	const read = pendingWorkspaceMutation.then(async () => {
		try {
			const response = await fetch("/api/agent/state");
			if (!response.ok) throw new Error("Failed to load workspace");
			const state = (await response.json()) as AgentSavedState | null;
			if (state) acceptAgentState(state);
			return loadAgentState();
		} catch {
			dispatchAgentShellChange({
				source: "canonical",
				error: "Saved workspaces could not be loaded.",
			});
			return _cachedAgentState;
		}
	});
	const barrier = read
		.finally(() => {
			if (pendingWorkspaceRead?.result === read) pendingWorkspaceRead = null;
		})
		.catch(noop);
	pendingWorkspaceMutation = barrier;
	pendingWorkspaceRead = {
		barrier,
		result: read,
	};
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
				{
					action: nextAction,
				},
			);
			if (pendingSelection?.id === id) pendingSelection = null;
			acceptAgentState(state, true);
			return loadAgentState();
		} catch {
			if (pendingSelection?.id === id) pendingSelection = null;
			dispatchAgentShellChange({
				source: "canonical",
				state: loadAgentState() ?? undefined,
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
		type: "addWorkspace" | "removeWorkspace" | "renameWorkspace";
	}
>;

/**
 * Change provider identity through the native workspace owner.
 */
export function changePaneAgentKind(
	paneId: string,
	agentKind: WorkspaceModelAgentKind,
): void {
	void mutateAgentWorkspaceState({
		type: "changePaneAgentKind",
		paneId,
		agentKind,
	});
}
export function getThemeById(themeId: string): AgentTheme {
	return Object.hasOwn(AGENT_THEMES, themeId)
		? AGENT_THEMES[themeId as ThemeId]
		: AGENT_THEMES.default;
}

import { useCallback, useEffect, useMemo } from "octane";
import { hasId } from "../../../shared/lib/data.ts";
import type { AgentChatHandle } from "../../conversation/components/AgentChatView/index.tsx";
import type { AgentPaneActionsArgs } from "../components/AgentPage/index.tsx";
export function useAgentPaneActions({
	chatRefs,
	cleanupPane,
	dispatchAgentGroupAction,
	groups,
	selectedGroupId,
}: AgentPaneActionsArgs) {
	const removePane = useCallback(
		(paneId: string) => {
			const group =
				groups.find((item) => item.panes.some(hasId.bind(null, paneId))) ??
				(selectedGroupId
					? groups.find(hasId.bind(null, selectedGroupId))
					: null);
			if (!group) return;
			cleanupPane(paneId);
			dispatchAgentGroupAction({
				type: "removePane",
				groupId: group.id,
				paneId,
			});
		},
		[cleanupPane, dispatchAgentGroupAction, groups, selectedGroupId],
	);
	useEffect(
		() =>
			WorkspaceModelListenWindowEvent(
				REMOVE_AGENT_PANE_REQUEST_EVENT,
				(event) => {
					const paneId = (event as CustomEvent<RemoveAgentPaneRequestDetail>)
						.detail?.paneId;
					if (paneId) removePane(paneId);
				},
			),
		[removePane],
	);
	const actions = useMemo(() => {
		const dispatch = (
			action: Parameters<typeof dispatchAgentGroupAction>[0],
		) => {
			if (selectedGroupId) dispatchAgentGroupAction(action);
		};
		const groupId = selectedGroupId ?? "";
		return {
			handleAddPane: (agentKind: WorkspaceModelAgentKind) =>
				dispatch({
					type: "addPane",
					groupId,
					agentKind,
				}),
			reorderPanes: (fromIndex: number, toIndex: number) =>
				dispatch({
					type: "reorderPanes",
					groupId,
					fromIndex,
					toIndex,
				}),
			handleSetPaneAgentKind: (
				paneId: string,
				agentKind: WorkspaceModelAgentKind,
			) =>
				dispatch({
					type: "setPaneAgentKind",
					groupId,
					paneId,
					agentKind,
				}),
			handleDirectorySelected: (
				paneId: string,
				path: string | null,
				referencePaths?: string[],
			) =>
				dispatch({
					type: "directorySelected",
					groupId,
					paneId,
					path,
					referencePaths,
				}),
			selectPane: (paneId: string) =>
				dispatch({
					type: "selectPane",
					groupId,
					paneId,
				}),
		};
	}, [dispatchAgentGroupAction, selectedGroupId]);
	const handleChatRef = useCallback(
		(paneId: string, handle: AgentChatHandle | null) => {
			if (handle) chatRefs.current?.set(paneId, handle);
			else chatRefs.current?.delete(paneId);
		},
		[chatRefs],
	);
	return {
		...actions,
		handleChatRef,
		removePane,
	};
}

import type {
	DockEdge,
	DockOuterEdge,
} from "../../workbench/model/workbench-model.ts";
export const EMPTY_AUXILIARY_PANELS: readonly AuxiliaryPanel[] = [];
export const ROOT_DOCK_TARGET_ID = "__workspace-root__";
export const MIN_GRID_ROW_HEIGHT = 340;
export type AuxiliaryPanel = {
	readonly id: string;
	readonly onSelect?: () => void;
	readonly render: (drag: {
		readonly draggable: boolean;
		readonly onDragStart: (event: PointerEvent) => void;
		readonly onCreatePanelDragStart: (
			event: PointerEvent,
			panelId: string,
			completeDrop: () => void,
		) => void;
		readonly onDragEnd: () => void;
	}) => unknown;
};
export interface WorkspaceCanvasProps {
	active?: boolean;
	panes: AgentPaneModel[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	layoutMode: "grid" | "rows";
	theme: AgentTheme;
	onSelectPane: (paneId: string) => void;
	onFocusPane?: (paneId: string) => void;
	onClosePane: (paneId: string) => void;
	onDirectorySelect: (
		paneId: string,
		path: string | null,
		referencePaths?: string[],
	) => void;
	onDirectoryCancel: (paneId: string) => void;
	onChatRef: (paneId: string, handle: AgentChatHandle | null) => void;
	onReorderPanes?: (fromIndex: number, toIndex: number) => void;
	onAddPane?: (agentKind: WorkspaceModelAgentKind) => void;
	onSetPaneAgentKind?: (
		paneId: string,
		agentKind: WorkspaceModelAgentKind,
	) => void;
	workspaceId?: string;
	auxiliaryPanels?: readonly AuxiliaryPanel[];
}
export const paneViewProps = (
	p: WorkspaceCanvasProps,
	pane: AgentPaneModel,
	idx: number,
	onDragStart: (e: PointerEvent, i: number) => void,
	onDragEnd: () => void,
) => ({
	pane,
	isSelected: p.active !== false && pane.id === p.selectedPaneId,
	isVisible: p.active !== false,
	onClose: p.onClosePane,
	onDirectorySelect: p.onDirectorySelect,
	onDirectoryCancel: p.onDirectoryCancel,
	chatRef: p.onChatRef,
	paneIndex: idx,
	onHeaderDragStart: onDragStart,
	onHeaderDragEnd: onDragEnd,
	onSetPaneAgentKind: p.onSetPaneAgentKind,
});
export function canScrollInDirection(element: HTMLElement, deltaY: number) {
	if (deltaY < 0) return element.scrollTop > 0;
	if (deltaY > 0) {
		return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
	}
	return false;
}
export function isWorkspaceDockDragSource(target: EventTarget | null) {
	return (
		target instanceof Element &&
		!!target.closest('[data-workspace-dock-drag-source="true"]')
	);
}
export function shouldFocusPaneComposer(target: EventTarget | null) {
	if (!(target instanceof Element)) return true;
	if (
		target.closest(
			"button, input, textarea, select, a, [contenteditable='true']",
		)
	) {
		return false;
	}
	return window.getSelection()?.isCollapsed !== false;
}
export function isVerticalScroller(element: HTMLElement) {
	const style = window.getComputedStyle(element);
	return (
		(style.overflowY === "auto" || style.overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight
	);
}
export function findVerticalScroller(
	target: EventTarget | null,
	boundary: HTMLElement,
) {
	let element = target instanceof HTMLElement ? target : null;
	while (element && element !== boundary) {
		if (isVerticalScroller(element)) return element;
		element = element.parentElement;
	}
	for (const descendant of boundary.querySelectorAll<HTMLElement>("*")) {
		if (isVerticalScroller(descendant)) return descendant;
	}
	return null;
}
export function scrollElementBy(element: HTMLElement, deltaY: number) {
	const maxScrollTop =
		element.scrollHeight > element.clientHeight
			? element.scrollHeight - element.clientHeight
			: Number.POSITIVE_INFINITY;
	element.scrollTop = Math.max(
		0,
		Math.min(maxScrollTop, element.scrollTop + deltaY),
	);
}
export function canScrollHorizontally(element: HTMLElement, deltaX: number) {
	if (deltaX < 0) return element.scrollLeft > 0;
	if (deltaX > 0) {
		return element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
	}
	return false;
}
export function dockEdgeForPoint(
	clientX: number,
	clientY: number,
	element: HTMLElement,
): DockEdge {
	const rect = element.getBoundingClientRect();
	const x = (clientX - rect.left) / Math.max(1, rect.width);
	const y = (clientY - rect.top) / Math.max(1, rect.height);
	const distance = Math.min(x, 1 - x, y, 1 - y);
	if (distance > 0.28) return "center";
	if (distance === x) return "left";
	if (distance === 1 - x) return "right";
	if (distance === y) return "top";
	return "bottom";
}
export function outerDockEdgeForPointer(
	event: { readonly clientX: number; readonly clientY: number },
	root: HTMLElement,
): DockOuterEdge | null {
	const rect = root.getBoundingClientRect();
	const edgeBand = Math.min(
		72,
		Math.max(28, Math.min(rect.width, rect.height) * 0.1),
	);
	const distances = [
		["left", event.clientX - rect.left],
		["right", rect.right - event.clientX],
		["top", event.clientY - rect.top],
		["bottom", rect.bottom - event.clientY],
	] as const;
	const closest = distances.reduce((best, candidate) =>
		candidate[1] < best[1] ? candidate : best,
	);
	return closest[1] >= 0 && closest[1] <= edgeBand ? closest[0] : null;
}
export type SidebarUpdateStatus = "idle" | "updating" | "error";
interface SidebarWorkspaceGroup {
	id: string;
	name: string;
	panes: AgentPaneModel[];
	selectedPaneId?: string | null;
	columns: number;
	rows: number;
}
export interface SidebarWorkspaceState {
	repositories: RepositoryWorkspaceIndex;
	groups: SidebarWorkspaceGroup[];
	selectedGroupId: string | null;
	key: string;
}
export interface RepositoryWorkspaceSourceGroup {
	readonly id: string;
	readonly panes: readonly AgentPaneModel[];
	readonly selectedPaneId?: string | null;
}
export interface RepositoryWorkspaceEntry {
	readonly groupId: string;
	readonly pane: AgentPaneModel;
}
export interface RepositoryWorkspace {
	readonly cwd: string;
	readonly name: string;
	readonly entries: readonly RepositoryWorkspaceEntry[];
}
export interface RepositoryWorkspaceIndex {
	readonly workspaces: readonly RepositoryWorkspace[];
	readonly unassignedEntries: readonly RepositoryWorkspaceEntry[];
}
const EMPTY_REPOSITORIES: RepositoryWorkspaceIndex = {
	workspaces: [],
	unassignedEntries: [],
};
export interface RepositoryWorkspaceProjection {
	readonly workspaces: readonly RepositoryWorkspace[];
	readonly activePath: string | null;
	readonly activeWorkspace: RepositoryWorkspace | null;
	readonly unassignedEntries: readonly RepositoryWorkspaceEntry[];
}
function normalizeRepositoryPath(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "/") return trimmed;
	return trimmed.replace(/[\\/]+$/, "");
}
export function projectRepositoryWorkspaces({
	groups,
	selectedGroupId,
	repositories = EMPTY_REPOSITORIES,
}: {
	groups: readonly RepositoryWorkspaceSourceGroup[];
	selectedGroupId: string | null;
	repositories: RepositoryWorkspaceIndex;
}): RepositoryWorkspaceProjection {
	const { workspaces, unassignedEntries } = repositories;
	const selectedGroup =
		groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
	const selectedPane =
		selectedGroup?.panes.find(
			(pane) => pane.id === selectedGroup.selectedPaneId,
		) ??
		selectedGroup?.panes[0] ??
		null;
	const activePath = selectedPane?.cwd
		? normalizeRepositoryPath(selectedPane.cwd)
		: null;
	const activeWorkspace =
		workspaces.find((workspace) => workspace.cwd === activePath) ?? null;
	return {
		workspaces,
		activePath,
		activeWorkspace,
		unassignedEntries,
	};
}
export function getVisibleRepositoryEntries(
	projection: RepositoryWorkspaceProjection,
	groupId?: string,
): readonly RepositoryWorkspaceEntry[] {
	const entries =
		projection.activeWorkspace?.entries ?? projection.unassignedEntries;
	return groupId
		? entries.filter((entry) => entry.groupId === groupId)
		: entries;
}

import { useState } from "octane";
export function useWorkspaceState(loadCanonical = true, selectFirst = true) {
	const load = (state: AgentSavedState | null = loadAgentState()) => {
		return {
			groups: state?.groups ?? [],
			repositories: state?.repositories ?? EMPTY_REPOSITORIES,
			selectedGroupId:
				state?.selectedGroupId ??
				(selectFirst ? state?.groups[0]?.id : null) ??
				null,
			key: state ? agentStateKey(state) : "",
		};
	};
	const [state, setState] = useState(load);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const stop = WorkspaceModelListenWindowEvent(
			"agent-shell-change",
			(event) => {
				const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
				if (detail?.error) setError(detail.error);
				else if (detail?.saved) setError(null);
				if (detail?.source === "view" && !detail.stateKey) return;
				const next = load(detail?.state ?? loadAgentState());
				setState((current) =>
					current.key === next.key && !detail?.error ? current : next,
				);
			},
		);
		if (loadCanonical) void loadCanonicalAgentState();
		return stop;
	}, [loadCanonical, selectFirst]);
	return [state, setState, error] as const;
}

import {
	readStoredBoolean,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
export const CREATE_AGENT_CHAT_EVENT = "create-agent-chat";
export const FOCUS_AGENT_CHAT_COMPOSER_EVENT =
	"inferay-focus-agent-chat-composer";
export type CreateAgentChatTarget = "active-repository" | "new-repository";
export interface CreateAgentChatDetail {
	target: CreateAgentChatTarget;
}
export interface FocusAgentChatComposerDetail {
	paneId: string;
}
export function resolveCreateAgentChatCwd(
	target: CreateAgentChatTarget,
	activeRepositoryCwd?: string,
): string | undefined {
	return target === "active-repository" ? activeRepositoryCwd : undefined;
}
export function dispatchCreateAgentChat(
	target: CreateAgentChatTarget = "active-repository",
): void {
	dispatchWindowEvent<CreateAgentChatDetail>(CREATE_AGENT_CHAT_EVENT, {
		target,
	});
}
export function dispatchFocusAgentChatComposer(paneId: string): void {
	dispatchWindowEvent<FocusAgentChatComposerDetail>(
		FOCUS_AGENT_CHAT_COMPOSER_EVENT,
		{
			paneId,
		},
	);
}
export const WORKSPACE_SIDEBAR_COLLAPSED_EVENT =
	"inferay-workspace-sidebar-collapsed";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
export interface WorkspaceSidebarCollapsedDetail {
	collapsed: boolean;
}
export function loadSidebarCollapsed(): boolean {
	return readStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY);
}
export function setWorkspaceSidebarCollapsed(collapsed: boolean): void {
	writeStoredValue(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
	dispatchWindowEvent<WorkspaceSidebarCollapsedDetail>(
		WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
		{
			collapsed,
		},
	);
}
