import {
	readStoredBoolean,
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";

export const DEFAULT_SIDEBAR_WIDTH = 292;
export const MIN_SIDEBAR_WIDTH = 188;
export const MAX_SIDEBAR_WIDTH = 340;
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
	window.dispatchEvent(
		new CustomEvent<WorkspaceSidebarCollapsedDetail>(
			WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
			{ detail: { collapsed } },
		),
	);
}

export type SidebarUpdateStatus = "idle" | "updating" | "error";

export interface SidebarUiState {
	collapsed: boolean;
	sidebarWidth: number;
	resizing: boolean;
	updateStatus: SidebarUpdateStatus;
}

export type SidebarUiAction =
	| { type: "collapsed"; value: boolean }
	| { type: "sidebarWidth"; value: number }
	| { type: "resizing"; value: boolean }
	| { type: "updateStatus"; value: SidebarUpdateStatus };

export function loadSidebarUiState(): SidebarUiState {
	const storedWidth = Number(readStoredValue("main-sidebar-width"));
	return {
		collapsed: loadSidebarCollapsed(),
		sidebarWidth: Number.isFinite(storedWidth)
			? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, storedWidth))
			: DEFAULT_SIDEBAR_WIDTH,
		resizing: false,
		updateStatus: "idle",
	};
}

export function sidebarUiReducer(
	state: SidebarUiState,
	action: SidebarUiAction,
): SidebarUiState {
	switch (action.type) {
		case "collapsed":
			return state.collapsed === action.value
				? state
				: { ...state, collapsed: action.value };
		case "sidebarWidth":
			return state.sidebarWidth === action.value
				? state
				: { ...state, sidebarWidth: action.value };
		case "resizing":
			return state.resizing === action.value
				? state
				: { ...state, resizing: action.value };
		case "updateStatus":
			return state.updateStatus === action.value
				? state
				: { ...state, updateStatus: action.value };
	}
}
