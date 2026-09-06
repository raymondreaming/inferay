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

export function getFileSelectionAfterToggle<T extends SelectedFile>(
	files: readonly T[],
	selected: SelectedFile,
): T | null {
	const section = files.filter((file) => file.staged === selected.staged);
	const index = section.findIndex((file) => file.path === selected.path);
	const current = section[index];
	return current
		? (section[index + 1] ??
				section[index - 1] ?? { ...current, staged: !current.staged })
		: null;
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
}) {
	const unstagedFiles = visibleGitFiles(
		[...modified, ...untracked],
		filePresentation,
		"path",
	);
	const stagedFiles = visibleGitFiles(staged, filePresentation, "path");
	const workingFiles = [...unstagedFiles, ...stagedFiles];
	const navigableFiles =
		fileViewMode === "tree"
			? [
					...visibleGitFiles(unstagedFiles, filePresentation, "tree"),
					...visibleGitFiles(stagedFiles, filePresentation, "tree"),
				]
			: workingFiles;
	const showingWorkingTree = content === "workingTree";
	const comparing = selectedCommitCount > 1;
	const historyDetails = comparing
		? comparisonDetails
		: selectedCommitHash
			? commitDetails
			: null;
	const historyLoading = comparing
		? comparisonDetailsLoading
		: Boolean(selectedCommitHash && commitDetailsLoading);
	const historicalFiles =
		comparisonDetails?.files ?? commitDetails?.files ?? [];
	const historicalPresentation =
		comparisonDetails?.filePresentation ?? commitDetails?.filePresentation;
	const navigableHistoricalFiles = visibleGitFiles(
		historicalFiles,
		historicalPresentation,
		fileViewMode,
	);
	const displayedFiles: readonly (GitFileEntry | CommitFile)[] =
		showingWorkingTree ? workingFiles : historicalFiles;
	return {
		unstagedFiles,
		stagedFiles,
		workingFiles,
		navigableFiles,
		showingWorkingTree,
		comparing,
		historyDetails,
		historyLoading,
		historyMessage: historyLoading
			? comparing
				? "Comparing…"
				: "Loading…"
			: comparing
				? "The selected items cannot be compared"
				: selectedCommitHash
					? commitDetailsError || "No details available for this commit"
					: "Select a commit to view details",
		navigableHistoricalFiles,
		additions: displayedFiles.reduce(
			(total, file) => total + (file.additions ?? 0),
			0,
		),
		deletions: displayedFiles.reduce(
			(total, file) => total + (file.deletions ?? 0),
			0,
		),
	};
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
export type GitRefOperationPreflight = {
	readonly source: string;
	readonly target: string;
	readonly canMerge: boolean;
	readonly canFastForward: boolean;
	readonly canRebase: boolean;
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
const MAX_RENDERED_DIFF_LINES = 100_000;

export function buildDiffViewerModel(
	diff: HunkDiff,
	filePath: string,
	viewMode: DiffViewMode,
) {
	const changeRanges =
		viewMode === "hunks"
			? diff.metadata.inlineChangeRanges
			: diff.metadata.splitChangeRanges;
	const changePositions = changeRanges.map(([start]) => start);
	const extension = filePath.includes(".")
		? (filePath.split(".").pop() ?? "")
		: "";
	let statusMessage: string | null = null;
	if (diff.compactLines?.length === 1) {
		const line = diff.compactLines[0];
		if (line?.type === "context" && /too large|cannot read/i.test(line.content))
			statusMessage = line.content.trim();
	}
	if (
		!statusMessage &&
		diff.oldLines.length === 0 &&
		diff.newLines.length === 1
	) {
		const line = diff.newLines[0];
		if (line?.type === "context" && /too large|cannot read/i.test(line.content))
			statusMessage = line.content.trim();
	}
	const totalLines =
		diff.compactLines?.length ??
		Math.max(diff.oldLines.length, diff.newLines.length);
	const longestLine = Math.max(
		diff.metadata.maxOldLineChars,
		diff.metadata.maxNewLineChars,
		diff.metadata.maxInlineLineChars,
		diff.metadata.maxConflictLineChars,
	);
	const oversizedMessage =
		totalLines > MAX_RENDERED_DIFF_LINES
			? `Diff is too large to render safely (${totalLines.toLocaleString()} lines). Use the Editor/agent to inspect this file in smaller chunks.`
			: longestLine > MAX_RENDERED_LINE_CHARS * 2
				? `Diff contains a very long line (${longestLine.toLocaleString()} characters). Rendering is limited to keep the app responsive.`
				: null;
	const isMarkdown =
		!diff.compactLines && (extension === "md" || extension === "mdx");
	const conflict = Boolean(diff.mergeConflictContent) && !isMarkdown;
	const message = statusMessage ?? oversizedMessage;
	return {
		changeRanges,
		changePositions,
		extension,
		conflict,
		message,
		isMarkdown,
		markdownContent: isMarkdown
			? diff.newLines
					.filter((line) => line.type !== "hunk" && line.type !== "spacer")
					.map((line) => line.content)
					.join("\n")
			: "",
		navigable: !diff.isBinary && (conflict || (!message && !isMarkdown)),
	};
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
type GitWorkspaceDiffSource =
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
}) {
	const commitSource = fileSource?.kind === "commit" ? fileSource : null;
	const comparisonSource =
		fileSource?.kind === "comparison" ? fileSource : null;
	const diffMode = mainViewMode === "diff";
	return {
		commitSource,
		comparisonSource,
		commit: {
			cwd:
				diffMode && commitSource?.commitHash
					? (diffViewerCwd ?? undefined)
					: graphCwd,
			hash: diffMode
				? (commitSource?.commitHash ?? undefined)
				: selectedCommitIds.length <= 1 &&
						selectedGraphItem?.itemKind !== "worktreeWip"
					? selectedGraphItem?.hash
					: undefined,
			parent: diffMode
				? (commitSource?.commitParent ?? undefined)
				: (selectedCommitParent ?? undefined),
		},
		comparison: {
			cwd: diffMode ? (diffViewerCwd ?? undefined) : graphCwd,
			from: diffMode ? comparisonSource?.comparisonFrom : undefined,
			to: diffMode ? comparisonSource?.comparisonTo : undefined,
		},
		revision: diffMode && diffViewerCwd ? storedRevision : graphRevision,
	};
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
	if (!active || !cwd || !selectedFile) return null;
	const commit = fileSource?.kind === "commit" ? fileSource : null;
	const comparison = fileSource?.kind === "comparison" ? fileSource : null;
	return {
		cwd,
		revision,
		file: selectedFile.path,
		staged: selectedFile.staged,
		commitHash: commit?.commitHash,
		commitParent: commit?.commitParent ?? undefined,
		comparisonFrom: comparison?.comparisonFrom,
		comparisonTo: comparison?.comparisonTo,
		view: viewMode === "split" ? "full" : "review",
	};
}
export interface GitWorkspaceDetachedFilePanel<InitialFile = unknown> {
	readonly id: string;
	readonly cwd: string;
	readonly path: string;
	readonly initialFile?: InitialFile;
}
export interface GitWorkspaceDocumentSession {
	readonly cwd: string;
	readonly activePath: string | null;
	readonly paths: readonly string[];
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
	readonly documentSessions: Readonly<
		Record<string, GitWorkspaceDocumentSession>
	>;
	readonly fileRequest: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly selectedFile: {
		readonly path: string;
		readonly staged: boolean;
		readonly source: GitWorkspaceDiffSource;
	} | null;
	readonly selectedCommitHash: string | null;
	readonly selectedCommitIds: readonly string[];
	readonly selectedCommitParent: string | null;
	readonly mainViewMode: "diff" | "graph";
	readonly graphDrillIn: boolean;
	readonly historicalDiff: boolean;
	readonly sidebarContent: "workingTree" | "history";
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
		documentSessions: {},
		fileRequest: null,
		selectedFile: null,
		selectedCommitHash: null,
		selectedCommitIds: [],
		selectedCommitParent: null,
		mainViewMode: "diff",
		graphDrillIn: false,
		historicalDiff: false,
		sidebarContent: "history",
	};
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
	| {
			type: "documents";
			sessionId: string;
			cwd: string;
			activePath: string | null;
			paths: readonly string[];
	  }
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
			intent?: { readonly additive: boolean; readonly range: boolean };
	  }
	| {
			type: "reconcileGraph";
			items: readonly { readonly id: string; readonly message: string }[];
	  }
	| {
			type: "reconcileFile";
			expected: GitWorkspacePanelSession["selectedFile"];
			staged: boolean | null;
	  };

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
