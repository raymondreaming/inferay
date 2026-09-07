import type { DetachedFilePanel as NativeDetachedFilePanel } from "../../../../build/presentation/contracts/DetachedFilePanel.ts";
import type { DiffSource as NativeDiffSource } from "../../../../build/presentation/contracts/DiffSource.ts";
import type { DocumentSession as NativeDocumentSession } from "../../../../build/presentation/contracts/DocumentSession.ts";
import type { FileContent as NativeFileContent } from "../../../../build/presentation/contracts/FileContent.ts";
import type { GitOperationErrorKind as NativeErrorKind } from "../../../../build/presentation/contracts/GitOperationErrorKind.ts";
import type { GitOperationOutcome as NativeOutcome } from "../../../../build/presentation/contracts/GitOperationOutcome.ts";
import type { GitRefOperationPreflight as NativeRefPreflight } from "../../../../build/presentation/contracts/GitRefOperationPreflight.ts";
import type { PanelAction as NativePanelAction } from "../../../../build/presentation/contracts/PanelAction.ts";
import type { PanelSession as NativePanelSession } from "../../../../build/presentation/contracts/PanelSession.ts";
import { project as rustProject } from "../../../adapters/presentation/model.ts";
import type {
	CommitDetails,
	CommitFile,
	ComparisonDetails,
	GraphNode,
} from "../../repository/model/git-graph.ts";
import type {
	DiffRequest,
	GitFileEntry,
	GitFilePresentation,
	HunkDiff,
} from "../../repository/model/types.ts";
export interface SelectedFile {
	path: string;
	staged: boolean;
}

export type SelectedGraphCache = {
	cwd: string | undefined;
	items: Map<string, GraphNode>;
};

export function resolveSelectedGraphItems(
	cache: SelectedGraphCache,
	cwd: string | undefined,
	commits: readonly GraphNode[],
	selectedIds: readonly string[],
	selectedHash: string | null,
) {
	const current = cache.cwd === cwd ? cache : { cwd, items: new Map() };
	const selected = new Set(selectedIds);
	if (selectedHash) selected.add(selectedHash);
	for (const id of current.items.keys())
		if (!selected.has(id)) current.items.delete(id);
	for (const item of commits)
		if (selected.has(item.id)) current.items.set(item.id, item);
	return {
		cache: current,
		items: selectedIds.flatMap((id) => {
			const item = current.items.get(id);
			return item ? [item] : [];
		}),
		item: selectedHash ? (current.items.get(selectedHash) ?? null) : null,
	};
}

export function adjacentGitFile<T>(
	files: readonly T[],
	isSelected: (file: T) => boolean,
	direction: -1 | 1,
	repeatBoundary = false,
): T | undefined {
	return (
		rustProject<T | null>("adjacentFile", {
			files,
			current: files.findIndex(isSelected),
			direction,
			repeatBoundary,
		}) ?? undefined
	);
}
export function visibleGitFiles<T extends { path: string }>(
	files: readonly T[],
	presentation: GitFilePresentation | undefined,
	mode: "path" | "tree",
): T[] {
	return rustProject("visibleFiles", { files, presentation, mode });
}

export function getFileSelectionAfterToggle<T extends SelectedFile>(
	files: readonly T[],
	selected: SelectedFile,
): T | null {
	return rustProject("selectionAfterToggle", { files, selected });
}

export function buildChangesPanelModel({
	content,
	fileViewMode,
	filePresentation,
	modified,
	untracked,
	staged,
	selectedCommitHash,
	selectedCommitCount,
	commitDetailsLoading,
	commitDetails,
	commitDetailsError,
	comparisonDetailsLoading,
	comparisonDetails,
}: {
	content: "workingTree" | "history";
	fileViewMode: "path" | "tree";
	filePresentation?: GitFilePresentation;
	modified: readonly GitFileEntry[];
	untracked: readonly GitFileEntry[];
	staged: readonly GitFileEntry[];
	selectedCommitHash: string | null;
	selectedCommitCount: number;
	commitDetailsLoading: boolean;
	commitDetails: CommitDetails | null;
	commitDetailsError?: string | null;
	comparisonDetailsLoading: boolean;
	comparisonDetails: ComparisonDetails | null;
}): {
	unstagedFiles: GitFileEntry[];
	stagedFiles: GitFileEntry[];
	workingFiles: GitFileEntry[];
	navigableFiles: GitFileEntry[];
	showingWorkingTree: boolean;
	comparing: boolean;
	historyDetails: CommitDetails | ComparisonDetails | null;
	historyLoading: boolean;
	historyMessage: string;
	navigableHistoricalFiles: CommitFile[];
	additions: number;
	deletions: number;
} {
	return rustProject("changesPanel", {
		content,
		fileViewMode,
		filePresentation,
		modified,
		untracked,
		staged,
		selectedCommitHash,
		selectedCommitCount,
		commitDetailsLoading,
		commitDetails,
		commitDetailsError,
		comparisonDetailsLoading,
		comparisonDetails,
	});
}

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
type GitOperationResult<Operation extends string> = {
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
	"merge" | "rebase" | "fastForward" | "cherryPick" | "revert"
>;
export type GitRefOperationRequest = {
	operation: GitRefOperationResult["operation"];
	action: "start" | "continue" | "skip" | "abort";
	source?: string;
	target?: string;
};
export type GitRefOperationPreflight = NativeRefPreflight;
export type GitOperationOutcome = NativeOutcome;
export type GitOperationActivityPhase =
	| "idle"
	| "running"
	| "conflicted"
	| "awaitingContinuation"
	| "completed"
	| "failed";
export type GitOperationErrorKind = NativeErrorKind;
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
const MAX_RENDERED_DIFF_LINES = 100_000;

export function buildDiffViewerModel(
	diff: HunkDiff,
	filePath: string,
	viewMode: DiffViewMode,
): {
	changeRanges: Array<[number, number]>;
	changePositions: number[];
	extension: string;
	conflict: boolean;
	message: string | null;
	isMarkdown: boolean;
	markdownContent: string;
	navigable: boolean;
} {
	return rustProject("diffViewer", { diff, filePath, viewMode });
}
export {
	DIFF_CONFIG,
	GUTTER_W,
	LINE_H,
} from "../diff/components/DiffViewer/styles.ts";

import type { DiffScrollSource } from "../diff/hooks/useSplitDiffScroll.tsx";

type DiffNavigationState = {
	externalScrollSource: DiffScrollSource;
	externalScrollTop: number;
	highlightedChangeIdx: number | undefined;
};
export const INITIAL_DIFF_NAVIGATION_STATE = {
	externalScrollSource: "all",
	externalScrollTop: -1,
	highlightedChangeIdx: undefined,
} satisfies DiffNavigationState;
export const INITIAL_DIFF_VIEWPORT_STATE = {
	scrollTop: 0,
	viewHeight: 600,
};
export function diffNavigationReducer(
	state: DiffNavigationState,
	action:
		| { type: "clearHighlight" | "clearScroll" | "reset" }
		| { type: "jumpToChange"; changeIdx: number; top: number }
		| { type: "jumpToPosition"; source: DiffScrollSource; top: number },
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
	state: typeof INITIAL_DIFF_VIEWPORT_STATE,
	action: { type: "measure"; height: number } | { type: "scroll"; top: number },
) {
	const field = action.type === "measure" ? "viewHeight" : "scrollTop";
	const value =
		action.type === "measure"
			? action.height || INITIAL_DIFF_VIEWPORT_STATE.viewHeight
			: action.top;
	return Math.abs(state[field] - value) > 0.5
		? { ...state, [field]: value }
		: state;
}

export type FileContentResponse = NativeFileContent;
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
export function resizeDockSplit(
	tree: DockTree,
	path: readonly ("first" | "second")[],
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
type GitWorkspaceDiffSource = NativeDiffSource;

export function historicalGitQueryContext({
	mainViewMode,
	diffViewerCwd,
	graphCwd,
	graphRevision,
	storedRevision,
	selectedCommitIds,
	selectedCommitParent,
	selectedGraphItem,
	fileSource,
}: {
	mainViewMode: "diff" | "graph";
	diffViewerCwd: string | null;
	graphCwd: string | undefined;
	graphRevision: string;
	storedRevision: string | undefined;
	selectedCommitIds: readonly string[];
	selectedCommitParent: string | null;
	selectedGraphItem: GraphNode | null;
	fileSource: GitWorkspaceDiffSource | undefined;
}): {
	commitSource: Extract<GitWorkspaceDiffSource, { kind: "commit" }> | null;
	comparisonSource: Extract<
		GitWorkspaceDiffSource,
		{ kind: "comparison" }
	> | null;
	commit: { cwd?: string; hash?: string; parent?: string };
	comparison: { cwd?: string; from?: string; to?: string };
	revision?: string;
} {
	return rustProject("historicalQuery", {
		mainViewMode,
		diffViewerCwd,
		graphCwd,
		graphRevision,
		storedRevision,
		selectedCommitIds,
		selectedCommitParent,
		selectedGraphItem,
		fileSource,
	});
}

export function gitWorkbenchDiffRequest({
	active,
	cwd,
	selectedFile,
	revision,
	fileSource,
	viewMode,
}: {
	active: boolean;
	cwd: string | null;
	selectedFile: (SelectedFile & { source: GitWorkspaceDiffSource }) | null;
	revision: string | undefined;
	fileSource: GitWorkspaceDiffSource | undefined;
	viewMode: DiffViewMode;
}): DiffRequest | null {
	return rustProject("diffRequest", {
		active,
		cwd,
		selectedFile,
		revision,
		fileSource,
		viewMode,
	});
}
export type GitWorkspaceDetachedFilePanel = NativeDetachedFilePanel;
export type GitWorkspaceDocumentSession = NativeDocumentSession;
export type GitWorkspacePanelSession = NativePanelSession;
export function emptyGitWorkspacePanelSession(): GitWorkspacePanelSession {
	return rustProject("emptyPanels", null);
}

import { readStoredValue } from "../../../adapters/storage/stored-values.ts";
export const GIT_FILE_VIEW_MODE_STORAGE_KEY = "inferay-git-file-view-mode";
export function loadGitFileViewMode(): "path" | "tree" {
	return readStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY) === "path"
		? "path"
		: "tree";
}

export const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";

export const DIFF_WIDTH_KEY_PREFIX = "agent-workspace-diff-width:";

export const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";

export const MIN_SIDEBAR_WIDTH = 230;

export const MAX_SIDEBAR_WIDTH = 420;

const DEFAULT_SIDEBAR_WIDTH = 300;

export const MIN_DIFF_WIDTH = 320;

const DEFAULT_DIFF_WIDTH = 680;

export function loadSidebarWidth() {
	const stored = Number(readStoredValue(SIDEBAR_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0
		? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
		: DEFAULT_SIDEBAR_WIDTH;
}

export function loadDiffWidth(workspaceId: string) {
	const stored = Number(
		readStoredValue(`${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`),
	);
	return Number.isFinite(stored) && stored > 0
		? Math.max(MIN_DIFF_WIDTH, stored)
		: DEFAULT_DIFF_WIDTH;
}

export function loadDiffViewMode(): DiffViewMode {
	return readStoredValue(DIFF_VIEW_MODE_KEY) === "split" ? "split" : "hunks";
}

import { postJson } from "../../../adapters/backend/http.ts";
export function createGitOperations(
	graphCwd: string | undefined,
	refetch: () => Promise<unknown>,
	selectGraphCommit: (id: string | null) => void,
) {
	async function run<Operation extends string>(
		endpoint: string,
		operation: Operation,
		request: object,
		selectHead: boolean,
		fallback: string,
	): Promise<GitOperationResult<Operation>> {
		const failed = (
			error: string,
			errorKind: "invalidInput" | "commandFailed",
		): GitOperationResult<Operation> => ({
			ok: false,
			operation,
			outcome: "failed",
			conflicts: [],
			errorKind,
			errorLabel:
				errorKind === "invalidInput"
					? "Invalid Git action"
					: "Git command failed",
			error,
		});
		if (!graphCwd) return failed("No Git repository selected", "invalidInput");
		try {
			const result = await postJson<GitOperationResult<Operation>>(
				`/api/git/${endpoint}`,
				{ cwd: graphCwd, ...request },
			);
			await refetch();
			if (
				result.ok &&
				selectHead &&
				(endpoint === "ref-operation" || result.head)
			)
				selectGraphCommit(result.head ?? null);
			return result;
		} catch (error) {
			return failed(
				error instanceof Error ? error.message : fallback,
				"commandFailed",
			);
		}
	}
	return {
		runGraphRefOperation: (request: GitRefOperationRequest) =>
			run(
				"ref-operation",
				request.operation,
				request,
				true,
				"Git operation failed",
			),
		runGraphActionRequest: ({
			action,
			target,
			targets,
			name,
			message,
		}: GitGraphActionRequest & { name?: string; message?: string }) =>
			run(
				"graph-action",
				action,
				{ action, target, targets, name, message },
				[
					"cherryPick",
					"revert",
					"resetSoft",
					"resetMixed",
					"resetHard",
				].includes(action),
				"Git action failed",
			),
	};
}

export type GitWorkspacePanelAction = NativePanelAction;
