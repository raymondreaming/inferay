import {
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "octane";
import { postJson } from "../../../adapters/backend/http.ts";
import {
	CLIENT_STORAGE_CHANGED_EVENT,
	readStoredBoolean,
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import type { AppThemeId } from "../../../app/model/appearance.ts";
import {
	dispatchWindowEvent,
	hasId,
	listenWindowEvent,
	noop,
} from "../../../shared/lib/data.ts";
import type { AgentKind } from "../../agents/model/agents.ts";
import type { AgentChatHandle } from "../../conversation/components/AgentChatView/index.tsx";
import type {
	DockEdge,
	DockOuterEdge,
} from "../../workbench/model/workbench-model.ts";
import type { AgentPaneActionsArgs } from "../components/AgentPage/index.tsx";

export type { AgentKind as WorkspaceModelAgentKind } from "../../agents/model/agents.ts";
export const Settings = lazy(() =>
	import("../../settings/components/Settings/index.tsx").then(
		({ Settings }) => ({ default: Settings }),
	),
);
export type MutableRef<T> = { current: T };
export type ThemeId = AppThemeId;
export type AgentTheme = {
	readonly cursor: string;
	readonly separator: string;
};
export type AgentLayoutMode = "grid" | "rows";
export type PaneId = string & { readonly __brand: "PaneId" };
export type GroupId = string & { readonly __brand: "GroupId" };
export interface AgentPaneModel {
	readonly id: PaneId;
	title: string;
	readonly agentKind: AgentKind;
	cwd?: string;
	pendingCwd?: boolean;
	referencePaths?: string[];
	pendingWorkspacePaths?: string[];
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
	readonly activePath: string | null;
	readonly activeWorkspace: RepositoryWorkspace | null;
	readonly visibleEntries: readonly RepositoryWorkspaceEntry[];
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
export type Pane = AgentPaneModel;
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
	| { type: "changePaneAgentKind"; paneId: string; agentKind: AgentKind }
	| { type: "setTheme"; themeId: string };
export type AgentGroupsAction = Exclude<
	AgentWorkspaceAction,
	{ type: "addWorkspace" | "removeWorkspace" | "renameWorkspace" }
>;
export const REMOVE_AGENT_PANE_REQUEST_EVENT =
	"inferay-remove-agent-pane-request";
export interface RemoveAgentPaneRequestDetail {
	paneId: string;
}
export const DEFAULT_COLUMNS = 1 as const;
export const DEFAULT_ROWS = 1 as const;
const EMPTY: RepositoryWorkspaceIndex = {
	workspaces: [],
	unassignedEntries: [],
	activePath: null,
	activeWorkspace: null,
	visibleEntries: [],
};
type WorkspaceSnapshot = {
	state: AgentSavedState | null;
	error: string | null;
};
let snapshot: WorkspaceSnapshot = { state: null, error: null };
let canonicalState: AgentSavedState | null = null;
const subscribers = new Set<() => void>();
const publish = (next: WorkspaceSnapshot) => {
	snapshot = next;
	for (const subscriber of subscribers) subscriber();
};
let queue: Promise<unknown> = Promise.resolve();
let read: Promise<AgentSavedState | null> | null = null;
let selectionRequest = 0;
let pendingSelection: { id: number; groupId: string; paneId?: string } | null =
	null;
function selected(state: AgentSavedState, groupId: string, paneId?: string) {
	const groups = paneId
		? state.groups.map((group) =>
				group.id === groupId
					? { ...group, selectedPaneId: paneId as PaneId }
					: group,
			)
		: state.groups;
	const group = groups.find((group) => group.id === groupId);
	const pane =
		group?.panes.find((pane) => pane.id === group.selectedPaneId) ??
		group?.panes[0];
	const raw = pane?.cwd?.trim(),
		activePath = raw === "/" ? raw : (raw?.replace(/[\\/]+$/, "") ?? null);
	const activeWorkspace =
		state.repositories.workspaces.find(
			(workspace) => workspace.cwd === activePath,
		) ?? null;
	return {
		...state,
		groups,
		selectedGroupId: groupId as GroupId,
		repositories: {
			...state.repositories,
			activePath,
			activeWorkspace,
			visibleEntries:
				activeWorkspace?.entries ?? state.repositories.unassignedEntries,
		},
	};
}
export const dispatchRemoveAgentPaneRequest = (paneId: string) =>
	dispatchWindowEvent<RemoveAgentPaneRequestDetail>(
		REMOVE_AGENT_PANE_REQUEST_EVENT,
		{ paneId },
	);
export function loadAgentState() {
	return snapshot.state;
}
function accept(state: AgentSavedState, saved = false) {
	canonicalState = state;
	const pending = pendingSelection;
	publish({
		state: pending ? selected(state, pending.groupId, pending.paneId) : state,
		error: saved ? null : snapshot.error,
	});
}
export async function initializeAgentState() {
	const { state } = await postJson<{ state: AgentSavedState }>(
		"/api/agent/state/initialize",
		{},
	);
	accept(state, true);
	return state;
}
export function loadCanonicalAgentState(): Promise<AgentSavedState | null> {
	if (read) return read;
	const current = queue.then(async () => {
		try {
			const response = await fetch("/api/agent/state");
			if (!response.ok) throw 0;
			const state = (await response.json()) as AgentSavedState | null;
			if (state) accept(state, true);
			return loadAgentState();
		} catch {
			publish({ ...snapshot, error: "Saved workspaces could not be loaded." });
			return snapshot.state;
		}
	});
	const tracked = current.finally(() => {
		if (read === tracked) read = null;
	});
	read = tracked;
	queue = read.catch(noop);
	return current;
}
export function mutateAgentWorkspaceState(
	action:
		| AgentWorkspaceAction
		| ((state: AgentSavedState) => AgentWorkspaceAction | null),
) {
	const requestId = ++selectionRequest;
	if (
		typeof action !== "function" &&
		(action.type === "selectPane" || action.type === "selectWorkspace")
	) {
		pendingSelection = {
			id: requestId,
			groupId: action.groupId,
			paneId: action.type === "selectPane" ? action.paneId : undefined,
		};
		const state = snapshot.state;
		if (state)
			publish({
				...snapshot,
				state: selected(
					state,
					action.groupId,
					action.type === "selectPane" ? action.paneId : undefined,
				),
			});
	}
	const mutation = queue.then(async () => {
		const current = snapshot.state ?? (await initializeAgentState()),
			next = typeof action === "function" ? action(current) : action;
		if (!next) return null;
		try {
			const { state } = await postJson<{ state: AgentSavedState }>(
				"/api/agent/state/workspace-action",
				{ action: next },
			);
			if (pendingSelection?.id === requestId) pendingSelection = null;
			accept(state, true);
			return loadAgentState();
		} catch {
			if (pendingSelection?.id === requestId) pendingSelection = null;
			if (canonicalState) accept(canonicalState);
			publish({ ...snapshot, error: "Workspace changes could not be saved." });
			return null;
		}
	});
	queue = mutation.catch(noop);
	return mutation;
}
export const changePaneAgentKind = (paneId: string, agentKind: AgentKind) => {
	void mutateAgentWorkspaceState({
		type: "changePaneAgentKind",
		paneId,
		agentKind,
	});
};
const THEMES: Record<ThemeId, AgentTheme> = {
	default: { cursor: "#007AFF", separator: "#111111" },
	midnight: { cursor: "#6e8cff", separator: "#1e1f21" },
};
export const getThemeById = (id: string) =>
	Object.hasOwn(THEMES, id) ? THEMES[id as ThemeId] : THEMES.default;
export const loadAgentLayoutMode = (): AgentLayoutMode =>
	readStoredValue("agent-layout-mode") === "grid" ? "grid" : "rows";
export const listenAgentLayoutMode = (set: (mode: AgentLayoutMode) => void) =>
	listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
		if (
			(event as CustomEvent<{ key?: string }>).detail?.key ===
			"agent-layout-mode"
		)
			set(loadAgentLayoutMode());
	});
export function setAgentLayoutMode(mode: AgentLayoutMode) {
	writeStoredValue("agent-layout-mode", mode);
}
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
				groups.find((g) => g.panes.some(hasId.bind(null, paneId))) ??
				groups.find(hasId.bind(null, selectedGroupId));
			if (group) {
				cleanupPane(paneId);
				dispatchAgentGroupAction({
					type: "removePane",
					groupId: group.id,
					paneId,
				});
			}
		},
		[cleanupPane, dispatchAgentGroupAction, groups, selectedGroupId],
	);
	useEffect(
		() =>
			listenWindowEvent(REMOVE_AGENT_PANE_REQUEST_EVENT, (event) => {
				const id = (event as CustomEvent<RemoveAgentPaneRequestDetail>).detail
					?.paneId;
				if (id) removePane(id);
			}),
		[removePane],
	);
	const actions = useMemo(() => {
		const send = (a: AgentGroupsAction) => {
				if (selectedGroupId) dispatchAgentGroupAction(a);
			},
			groupId = selectedGroupId ?? "";
		return {
			handleAddPane: (agentKind: AgentKind) =>
				send({ type: "addPane", groupId, agentKind }),
			reorderPanes: (fromIndex: number, toIndex: number) =>
				send({ type: "reorderPanes", groupId, fromIndex, toIndex }),
			handleSetPaneAgentKind: (paneId: string, agentKind: AgentKind) =>
				send({ type: "setPaneAgentKind", groupId, paneId, agentKind }),
			handleDirectorySelected: (
				paneId: string,
				path: string | null,
				referencePaths?: string[],
			) =>
				send({
					type: "directorySelected",
					groupId,
					paneId,
					path,
					referencePaths,
				}),
			selectPane: (paneId: string) =>
				send({ type: "selectPane", groupId, paneId }),
		};
	}, [dispatchAgentGroupAction, selectedGroupId]);
	const handleChatRef = useCallback(
		(id: string, handle: AgentChatHandle | null) => {
			handle ? chatRefs.current?.set(id, handle) : chatRefs.current?.delete(id);
		},
		[chatRefs],
	);
	return { ...actions, handleChatRef, removePane };
}
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
	layoutMode: AgentLayoutMode;
	theme: AgentTheme;
	onSelectPane: (id: string) => void;
	onFocusPane?: (id: string) => void;
	onClosePane: (id: string) => void;
	onDirectorySelect: (
		id: string,
		path: string | null,
		references?: string[],
	) => void;
	onDirectoryCancel: (id: string) => void;
	onChatRef: (id: string, handle: AgentChatHandle | null) => void;
	onReorderPanes?: (from: number, to: number) => void;
	onAddPane?: (kind: AgentKind) => void;
	onSetPaneAgentKind?: (id: string, kind: AgentKind) => void;
	workspaceId?: string;
	auxiliaryPanels?: readonly AuxiliaryPanel[];
}
export const paneViewProps = (
	p: WorkspaceCanvasProps,
	pane: AgentPaneModel,
	paneIndex: number,
	onHeaderDragStart: (e: PointerEvent, i: number) => void,
	onHeaderDragEnd: () => void,
) => ({
	pane,
	isSelected: p.active !== false && pane.id === p.selectedPaneId,
	isVisible: p.active !== false,
	onClose: p.onClosePane,
	onDirectorySelect: p.onDirectorySelect,
	onDirectoryCancel: p.onDirectoryCancel,
	chatRef: p.onChatRef,
	paneIndex,
	onHeaderDragStart,
	onHeaderDragEnd,
	onSetPaneAgentKind: p.onSetPaneAgentKind,
});
export const canScrollInDirection = (e: HTMLElement, y: number) =>
	y < 0
		? e.scrollTop > 0
		: y > 0 && e.scrollTop + e.clientHeight < e.scrollHeight - 1;
export const canScrollHorizontally = (e: HTMLElement, x: number) =>
	x < 0
		? e.scrollLeft > 0
		: x > 0 && e.scrollLeft + e.clientWidth < e.scrollWidth - 1;
export const isWorkspaceDockDragSource = (t: EventTarget | null) =>
	t instanceof Element &&
	!!t.closest('[data-workspace-dock-drag-source="true"]');
export const shouldFocusPaneComposer = (t: EventTarget | null) =>
	!(t instanceof Element) ||
	(!t.closest("button,input,textarea,select,a,[contenteditable='true']") &&
		window.getSelection()?.isCollapsed !== false);
const isScroller = (e: HTMLElement) =>
	["auto", "scroll"].includes(getComputedStyle(e).overflowY) &&
	e.scrollHeight > e.clientHeight;
export function findVerticalScroller(t: EventTarget | null, b: HTMLElement) {
	let e = t instanceof HTMLElement ? t : null;
	while (e && e !== b) {
		if (isScroller(e)) return e;
		e = e.parentElement;
	}
	return [...b.querySelectorAll<HTMLElement>("*")].find(isScroller) ?? null;
}
export function scrollElementBy(e: HTMLElement, y: number) {
	e.scrollTop = Math.max(
		0,
		Math.min(
			e.scrollHeight > e.clientHeight
				? e.scrollHeight - e.clientHeight
				: Infinity,
			e.scrollTop + y,
		),
	);
}
export function dockEdgeForPoint(
	cx: number,
	cy: number,
	e: HTMLElement,
): DockEdge {
	const r = e.getBoundingClientRect(),
		x = (cx - r.left) / Math.max(1, r.width),
		y = (cy - r.top) / Math.max(1, r.height),
		d = Math.min(x, 1 - x, y, 1 - y);
	return d > 0.28
		? "center"
		: d === x
			? "left"
			: d === 1 - x
				? "right"
				: d === y
					? "top"
					: "bottom";
}
export function outerDockEdgeForPointer(
	e: { readonly clientX: number; readonly clientY: number },
	root: HTMLElement,
): DockOuterEdge | null {
	const r = root.getBoundingClientRect(),
		band = Math.min(72, Math.max(28, Math.min(r.width, r.height) * 0.1)),
		closest = (
			[
				["left", e.clientX - r.left],
				["right", r.right - e.clientX],
				["top", e.clientY - r.top],
				["bottom", r.bottom - e.clientY],
			] as const
		).reduce((a, b) => (b[1] < a[1] ? b : a));
	return closest[1] >= 0 && closest[1] <= band ? closest[0] : null;
}
export type SidebarUpdateStatus = "idle" | "updating" | "error";
export interface SidebarWorkspaceState {
	repositories: RepositoryWorkspaceIndex;
	groups: AgentGroupModel[];
	selectedGroupId: GroupId | null;
}
export function useWorkspaceState(loadCanonical = true, selectFirst = true) {
	const current = useSyncExternalStore(
		(subscribe) => {
			subscribers.add(subscribe);
			return () => subscribers.delete(subscribe);
		},
		() => snapshot,
		() => snapshot,
	);
	const project = (s: AgentSavedState | null) => ({
		groups: s?.groups ?? [],
		repositories: s?.repositories ?? EMPTY,
		selectedGroupId:
			s?.selectedGroupId ?? (selectFirst ? s?.groups[0]?.id : null) ?? null,
	});
	useEffect(() => {
		if (loadCanonical) void loadCanonicalAgentState();
	}, [loadCanonical, selectFirst]);
	const state: SidebarWorkspaceState = project(current.state);
	const setState = (
		update:
			| SidebarWorkspaceState
			| ((state: SidebarWorkspaceState) => SidebarWorkspaceState),
	) => {
		const next = typeof update === "function" ? update(state) : update;
		if (current.state)
			publish({ ...current, state: { ...current.state, ...next } });
	};
	return [state, setState, current.error] as const;
}
export const CREATE_AGENT_CHAT_EVENT = "create-agent-chat",
	FOCUS_AGENT_CHAT_COMPOSER_EVENT = "inferay-focus-agent-chat-composer";
export type CreateAgentChatTarget = "active-repository" | "new-repository";
export interface CreateAgentChatDetail {
	target: CreateAgentChatTarget;
}
export interface FocusAgentChatComposerDetail {
	paneId: string;
}
export const resolveCreateAgentChatCwd = (
	t: CreateAgentChatTarget,
	c?: string,
) => (t === "active-repository" ? c : undefined);
export const dispatchCreateAgentChat = (
	target: CreateAgentChatTarget = "active-repository",
) =>
	dispatchWindowEvent<CreateAgentChatDetail>(CREATE_AGENT_CHAT_EVENT, {
		target,
	});
export const dispatchFocusAgentChatComposer = (paneId: string) =>
	dispatchWindowEvent<FocusAgentChatComposerDetail>(
		FOCUS_AGENT_CHAT_COMPOSER_EVENT,
		{ paneId },
	);
export const WORKSPACE_SIDEBAR_COLLAPSED_EVENT =
	"inferay-workspace-sidebar-collapsed";
export interface WorkspaceSidebarCollapsedDetail {
	collapsed: boolean;
}
export const loadSidebarCollapsed = () =>
	readStoredBoolean("sidebar-collapsed");
export function setWorkspaceSidebarCollapsed(collapsed: boolean) {
	writeStoredValue("sidebar-collapsed", String(collapsed));
	dispatchWindowEvent<WorkspaceSidebarCollapsedDetail>(
		WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
		{ collapsed },
	);
}
