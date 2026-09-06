import type { GitFilePresentation } from "../../repository/model/types.ts";
export interface SelectedFile {
	path: string;
	staged: boolean;
}
export function adjacentGitFile<T>(
	files: readonly T[],
	isSelected: (file: T) => boolean,
	direction: -1 | 1,
	repeatBoundary = false,
): T | undefined {
	const current = files.findIndex(isSelected);
	const next =
		current < 0
			? direction > 0
				? 0
				: files.length - 1
			: Math.max(0, Math.min(files.length - 1, current + direction));
	return repeatBoundary || next !== current ? files[next] : undefined;
}
export function visibleGitFiles<T extends { path: string }>(
	files: readonly T[],
	presentation: GitFilePresentation | undefined,
	mode: "path" | "tree",
): T[] {
	if (!presentation) return [...files];
	const current = new Map(files.map((file) => [file.path, file]));
	return (
		mode === "tree" ? presentation.treeOrder : presentation.pathOrder
	).flatMap((path) => {
		const file = current.get(path);
		return file ? [file] : [];
	});
}

import type { GitInteractiveRebaseStep } from "../../repository/model/types.ts";
import type { GitGraphActionRequest } from "../graph/components/CommitGraph/index.tsx";
export type DragProps = {
	readonly draggable: boolean;
	readonly onDragStart: (event: PointerEvent) => void;
	readonly onCreatePanelDragStart: (
		event: PointerEvent,
		panelId: string,
		completeDrop: () => void,
	) => void;
	readonly onDragEnd: () => void;
};
export type GitOperationResult<Operation extends string> = {
	readonly ok: boolean;
	readonly operation: Operation;
	readonly outcome: GitOperationOutcome;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
	readonly errorLabel?: string;
	readonly error?: string;
};
export type GitRefOperationResult = GitOperationResult<
	| "merge"
	| "rebase"
	| "interactiveRebase"
	| "fastForward"
	| "cherryPick"
	| "revert"
>;
export type GitRefOperationRequest = {
	operation: GitRefOperationResult["operation"];
	action: "start" | "continue" | "skip" | "abort";
	source?: string;
	target?: string;
	steps?: GitInteractiveRebaseStep[];
};
export type GitRefOperationPreflight = {
	readonly source: string;
	readonly target: string;
	readonly canMerge: boolean;
	readonly canFastForward: boolean;
	readonly canRebase: boolean;
	readonly canInteractiveRebase: boolean;
	readonly interactiveRebaseCommits: {
		hash: string;
		message: string;
		author: string;
		date: string;
	}[];
	readonly interactiveRebasePlan: GitInteractiveRebaseStep[];
	readonly reasons: string[];
};
export type GitOperationOutcome =
	| "completed"
	| "awaitingContinuation"
	| "conflicted"
	| "failed";
export type GitOperationActivityPhase =
	| "idle"
	| "running"
	| "conflicted"
	| "awaitingContinuation"
	| "completed"
	| "failed";
export type GitOperationErrorKind =
	| "conflict"
	| "dirtyWorktree"
	| "authentication"
	| "nonFastForward"
	| "network"
	| "worktreeInUse"
	| "invalidInput"
	| "commandFailed"
	| "io";
export type GitGraphActionResult = GitOperationResult<
	GitGraphActionRequest["action"]
>;
export type GraphActionPresentation = {
	readonly title: string;
	readonly copy: string;
	readonly confirm: string;
	readonly needsName: boolean;
	readonly nameLabel?: string;
	readonly messageLabel: string | null;
	readonly danger: boolean;
};
export type DiffViewMode = "split" | "hunks";
export const MAX_RENDERED_LINE_CHARS = 4000;
export {
	DIFF_CONFIG,
	GUTTER_W,
	LINE_H,
} from "../diff/components/DiffViewer/styles.ts";

import type { DiffScrollSource } from "../diff/hooks/useSplitDiffScroll.tsx";
export interface DiffNavigationState {
	externalScrollSource: DiffScrollSource;
	externalScrollTop: number;
	highlightedChangeIdx: number | undefined;
}
export interface DiffViewportState {
	scrollTop: number;
	viewHeight: number;
}
export type DiffNavigationAction =
	| { type: "clearHighlight" }
	| { type: "clearScroll" }
	| { type: "jumpToChange"; changeIdx: number; top: number }
	| { type: "jumpToPosition"; source: DiffScrollSource; top: number }
	| { type: "reset" };
export type DiffViewportAction =
	| { type: "measure"; height: number }
	| { type: "scroll"; top: number };
export const INITIAL_DIFF_NAVIGATION_STATE: DiffNavigationState = {
	externalScrollSource: "all",
	externalScrollTop: -1,
	highlightedChangeIdx: undefined,
};
export const INITIAL_DIFF_VIEWPORT_STATE: DiffViewportState = {
	scrollTop: 0,
	viewHeight: 600,
};
export function diffNavigationReducer(
	state: DiffNavigationState,
	action: DiffNavigationAction,
): DiffNavigationState {
	let next: DiffNavigationState;
	switch (action.type) {
		case "clearHighlight":
			next = { ...state, highlightedChangeIdx: undefined };
			break;
		case "clearScroll":
			next = { ...state, externalScrollTop: -1, externalScrollSource: "all" };
			break;
		case "jumpToChange":
			return {
				externalScrollSource: "all",
				externalScrollTop: action.top,
				highlightedChangeIdx: action.changeIdx,
			};
		case "jumpToPosition":
			return {
				...state,
				externalScrollSource: action.source,
				externalScrollTop: action.top,
			};
		case "reset":
			next = INITIAL_DIFF_NAVIGATION_STATE;
			break;
	}
	return state.externalScrollSource === next.externalScrollSource &&
		state.externalScrollTop === next.externalScrollTop &&
		state.highlightedChangeIdx === next.highlightedChangeIdx
		? state
		: next;
}
export function diffViewportReducer(
	state: DiffViewportState,
	action: DiffViewportAction,
): DiffViewportState {
	const field = action.type === "measure" ? "viewHeight" : "scrollTop";
	const value =
		action.type === "measure"
			? action.height || INITIAL_DIFF_VIEWPORT_STATE.viewHeight
			: action.top;
	return Math.abs(state[field] - value) > 0.5
		? { ...state, [field]: value }
		: state;
}

export type FileContentResponse = {
	readonly content: string;
	readonly cwd: string;
	readonly path: string;
};
export const OPEN_ACTIVE_GIT_GRAPH_EVENT = "inferay-open-active-git-graph";
export const TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT =
	"inferay-toggle-active-git-sidebar";
export function dispatchOpenActiveGitGraph(): void {
	window.dispatchEvent(new CustomEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT));
}
export function dispatchToggleActiveGitSidebar(): void {
	window.dispatchEvent(new CustomEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT));
}
export type DockEdge = "center" | "left" | "right" | "top" | "bottom";
export type DockOuterEdge = Exclude<DockEdge, "center">;
export const MIN_RESPONSIVE_PANE_WIDTH = 300;
export type DockTree =
	| { readonly type: "panel"; readonly id: string }
	| {
			readonly type: "split";
			readonly direction: "horizontal" | "vertical";
			readonly ratio: number;
			readonly first: DockTree;
			readonly second: DockTree;
	  };
function clampRatio(ratio: number) {
	return Math.max(0.14, Math.min(0.86, ratio));
}
export type DockTreePath = readonly ("first" | "second")[];
export function resizeDockSplit(
	tree: DockTree,
	path: DockTreePath,
	ratio: number,
): DockTree {
	if (path.length === 0) {
		return tree.type === "split"
			? {
					...tree,
					ratio: clampRatio(ratio),
				}
			: tree;
	}
	if (tree.type === "panel") return tree;
	const [branch, ...rest] = path;
	const key = branch === "first" ? "first" : "second";
	return { ...tree, [key]: resizeDockSplit(tree[key], rest, ratio) };
}
export interface GitWorkspaceSelectedFile {
	readonly path: string;
	readonly staged: boolean;
}
export type GitWorkspaceDiffSource =
	| { readonly kind: "workingTree" | "graphWorkingTree" }
	| {
			readonly kind: "commit";
			readonly commitHash: string;
			readonly commitParent: string | null;
	  }
	| {
			readonly kind: "comparison";
			readonly comparisonFrom: string;
			readonly comparisonTo: string;
	  };
export interface GitWorkspaceDetachedFilePanel<InitialFile = unknown> {
	readonly id: string;
	readonly cwd: string;
	readonly path: string;
	readonly initialFile?: InitialFile;
}
export interface GitWorkspacePanelSession<InitialFile = unknown> {
	readonly repositoryInitialized: boolean;
	readonly sidebarVisible: boolean;
	readonly fileViewerOpen: boolean;
	readonly fileViewerCwd: string | null;
	readonly diffViewerCwd: string | null;
	readonly focusedAuxiliaryPanel: {
		readonly id: string;
		readonly cwd: string;
	} | null;
	readonly detachedFilePanels: GitWorkspaceDetachedFilePanel<InitialFile>[];
	readonly fileRequest: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly selectedFile:
		| (GitWorkspaceSelectedFile & { readonly source: GitWorkspaceDiffSource })
		| null;
	readonly selectedCommitHash: string | null;
	readonly selectedCommitIds: readonly string[];
	readonly selectedCommitParent: string | null;
	readonly mainViewMode: "diff" | "graph";
}
export interface GitGraphSelectionIntent {
	readonly additive: boolean;
	readonly range: boolean;
}
export interface GitGraphSelectionItem {
	readonly id: string;
	readonly message: string;
}
export function emptyGitWorkspacePanelSession<
	InitialFile = unknown,
>(): GitWorkspacePanelSession<InitialFile> {
	return {
		repositoryInitialized: false,
		sidebarVisible: false,
		fileViewerOpen: false,
		fileViewerCwd: null,
		diffViewerCwd: null,
		focusedAuxiliaryPanel: null,
		detachedFilePanels: [],
		fileRequest: null,
		selectedFile: null,
		selectedCommitHash: null,
		selectedCommitIds: [],
		selectedCommitParent: null,
		mainViewMode: "diff",
	};
}
function resolvedDiffContext(current: GitWorkspacePanelSession) {
	return current.mainViewMode === "diff"
		? current.selectedFile?.source.kind
		: undefined;
}
export type GitWorkspacePanelAction<InitialFile = unknown> =
	| { type: "initialize" | "focusChat"; cwd?: string }
	| { type: "openGraph"; cwd: string; reset?: boolean }
	| { type: "focus"; panel: GitWorkspacePanelSession["focusedAuxiliaryPanel"] }
	| { type: "mode"; mode: "diff" | "graph" }
	| { type: "toggleSidebar" | "dismissDiff" }
	| { type: "document"; cwd: string; path: string }
	| {
			type: "detachFile";
			id: string;
			cwd: string;
			path: string;
			initialFile?: InitialFile;
	  }
	| { type: "closeFile"; id: string }
	| { type: "workingTreeFile"; cwd: string; path: string; staged: boolean }
	| {
			type: "commitFile";
			cwd: string;
			path: string;
			commitHash: string;
			commitParent: string | null;
	  }
	| {
			type: "comparisonFile";
			cwd: string;
			path: string;
			from: string;
			to: string;
	  }
	| {
			type: "selectGraph";
			id: string | null;
			orderedIds: readonly string[];
			intent?: GitGraphSelectionIntent;
	  }
	| { type: "reconcileGraph"; items: readonly GitGraphSelectionItem[] }
	| {
			type: "reconcileFile";
			expected: GitWorkspacePanelSession["selectedFile"];
			staged: boolean | null;
	  };
export function isGitWorkspaceGraphDrillIn(
	current: GitWorkspacePanelSession,
): boolean {
	const context = resolvedDiffContext(current);
	return (
		current.mainViewMode === "diff" &&
		(context === "graphWorkingTree" ||
			context === "commit" ||
			context === "comparison")
	);
}
export function isHistoricalGitWorkspaceDiff(
	current: GitWorkspacePanelSession,
): boolean {
	const context = resolvedDiffContext(current);
	return (
		current.mainViewMode === "diff" &&
		(context === "commit" || context === "comparison")
	);
}
export function getGitWorkspaceSidebarContent(
	current: GitWorkspacePanelSession,
	selectedGraphItemIsWorkingTree: boolean,
): "workingTree" | "history" {
	if (current.mainViewMode === "graph") {
		return selectedGraphItemIsWorkingTree ? "workingTree" : "history";
	}
	const context = resolvedDiffContext(current);
	return context === "workingTree" || context === "graphWorkingTree"
		? "workingTree"
		: "history";
}

import {
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
export type GitFileViewMode = "path" | "tree";
export const GIT_FILE_VIEW_MODE_STORAGE_KEY = "inferay-git-file-view-mode";
export function loadGitFileViewMode(): GitFileViewMode {
	return readStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY) === "path"
		? "path"
		: "tree";
}
export function saveGitFileViewMode(mode: GitFileViewMode): void {
	writeStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY, mode);
}
