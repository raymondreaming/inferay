import type { GitFilePresentation } from "../../repository/model/types.ts";
export interface SelectedFile {
	path: string;
	staged: boolean;
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
	readonly currentBranch?: string;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
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
	readonly validRefs: boolean;
	readonly cleanWorktree: boolean;
	readonly sourceInOtherWorktree: boolean;
	readonly targetInOtherWorktree: boolean;
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
export function gitOperationErrorLabel(kind?: GitOperationErrorKind): string {
	switch (kind) {
		case "conflict":
			return "Merge conflict";
		case "dirtyWorktree":
			return "Working tree has changes";
		case "authentication":
			return "Authentication failed";
		case "nonFastForward":
			return "Remote contains newer commits";
		case "network":
			return "Network unavailable";
		case "worktreeInUse":
			return "Branch is open in another worktree";
		case "invalidInput":
			return "Invalid Git action";
		case "io":
			return "Git could not be started";
		default:
			return "Git command failed";
	}
}
export type GraphActionPresentation = {
	readonly title: string;
	readonly copy: string;
	readonly confirm: string;
	readonly needsName: boolean;
	readonly nameLabel?: string;
	readonly messageLabel: string | null;
	readonly danger: boolean;
};
const GRAPH_ACTIONS = {
	createBranch: {
		title: "Create branch",
		copy: "Create a new local branch at the selected commit.",
		needsName: true,
	},
	createTag: {
		title: "Create tag",
		copy: "Create a lightweight tag, or enter a message for an annotated tag.",
		needsName: true,
		messageLabel: "Annotation (optional)",
	},
	cherryPick: {
		title: "Cherry-pick commit",
		copy: "Apply this commit on top of the currently checked-out branch.",
		confirm: "Cherry-pick",
	},
	revert: {
		title: "Revert commit",
		copy: "Create a new commit that reverses the selected commit.",
	},
	stashPush: {
		title: "Stash worktree changes",
		copy: "Store tracked and untracked changes from the current worktree.",
		confirm: "Create stash",
		messageLabel: "Stash message (optional)",
	},
	stashApply: {
		title: "Apply stash",
		copy: "Apply this stash while keeping it in the stash list.",
	},
	stashPop: {
		title: "Pop stash",
		copy: "Apply this stash and remove it if the apply succeeds.",
		danger: true,
	},
	stashDrop: {
		title: "Delete stash",
		copy: "Permanently remove this stash from the repository.",
		danger: true,
	},
	stashRename: {
		title: "Rename stash",
		copy: "Replace this stash's displayed message while preserving its saved tree.",
		needsName: true,
		nameLabel: "New stash message",
	},
	renameBranch: {
		title: "Rename branch",
		copy: "Rename this local branch. Its commits and working tree are preserved.",
		needsName: true,
		nameLabel: "New branch name",
	},
	deleteBranch: {
		title: "Delete local branch",
		copy: "Delete this local branch only if Git confirms it is merged and not checked out in a worktree.",
		confirm: "Delete branch",
		danger: true,
	},
	deleteTag: {
		title: "Delete local tag",
		copy: "Remove this tag from the local repository. Remote tags are unchanged.",
		confirm: "Delete tag",
		danger: true,
	},
	setUpstream: {
		title: "Set branch upstream",
		copy: "Set the tracking branch without pushing or changing either branch.",
		confirm: "Set upstream",
		needsName: true,
		nameLabel: "Upstream (for example origin/main)",
	},
	pushSetUpstream: {
		title: "Push and set upstream",
		copy: "Push this local branch to the named remote and configure it as the tracking upstream.",
		confirm: "Push branch",
		needsName: true,
		nameLabel: "Remote name",
	},
	deleteRemoteBranch: {
		title: "Delete remote branch",
		copy: "Ask the configured remote to permanently delete this branch, then prune its tracking ref.",
		danger: true,
	},
	pushTag: {
		title: "Push tag",
		copy: "Publish this tag to the named remote.",
		needsName: true,
		nameLabel: "Remote name",
	},
	deleteRemoteTag: {
		title: "Delete remote tag",
		copy: "Permanently remove this tag from the named remote. The local tag is kept.",
		needsName: true,
		nameLabel: "Remote name",
		danger: true,
	},
	forcePushWithLease: {
		title: "Force push with lease",
		copy: "Rewrite the configured upstream only if it still points to the commit last fetched locally. This can replace remote history.",
		danger: true,
	},
	resetSoft: {
		title: "Soft reset branch",
		copy: "Move the current branch to this commit while keeping all resulting changes staged.",
		confirm: "Reset --soft",
		danger: true,
	},
	resetMixed: {
		title: "Mixed reset branch",
		copy: "Move the current branch to this commit and keep resulting changes unstaged in the worktree.",
		confirm: "Reset --mixed",
		danger: true,
	},
	resetHard: {
		title: "Hard reset branch",
		copy: "Move the current branch to this commit and permanently discard tracked index and worktree changes.",
		confirm: "Reset --hard",
		danger: true,
	},
	fetch: {
		title: "Fetch all remotes",
		copy: "Update remote-tracking refs and prune deleted remote refs without changing the worktree.",
		confirm: "Fetch",
	},
	pull: {
		title: "Pull current branch",
		copy: "Fetch and integrate the configured upstream using this repository's pull policy.",
		confirm: "Pull",
	},
	push: {
		title: "Push current branch",
		copy: "Push the current branch to its configured upstream. Force push is never used.",
		confirm: "Push",
	},
} satisfies Record<
	GitGraphActionRequest["action"],
	Pick<GraphActionPresentation, "title" | "copy"> &
		Partial<GraphActionPresentation>
>;
export function graphActionPresentation(
	action: GitGraphActionRequest["action"],
): GraphActionPresentation {
	const presentation = GRAPH_ACTIONS[action];
	return {
		needsName: false,
		messageLabel: null,
		danger: false,
		confirm: presentation.title,
		...presentation,
	};
}
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
	switch (action.type) {
		case "clearHighlight":
			return state.highlightedChangeIdx === undefined
				? state
				: {
						...state,
						highlightedChangeIdx: undefined,
					};
		case "clearScroll":
			return state.externalScrollTop === -1 &&
				state.externalScrollSource === "all"
				? state
				: {
						...state,
						externalScrollSource: "all",
						externalScrollTop: -1,
					};
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
			return state.externalScrollSource === "all" &&
				state.externalScrollTop === -1 &&
				state.highlightedChangeIdx === undefined
				? state
				: INITIAL_DIFF_NAVIGATION_STATE;
	}
}
export function diffViewportReducer(
	state: DiffViewportState,
	action: DiffViewportAction,
): DiffViewportState {
	switch (action.type) {
		case "measure": {
			const nextHeight =
				action.height || INITIAL_DIFF_VIEWPORT_STATE.viewHeight;
			return Math.abs(state.viewHeight - nextHeight) > 0.5
				? {
						...state,
						viewHeight: nextHeight,
					}
				: state;
		}
		case "scroll":
			return Math.abs(state.scrollTop - action.top) > 0.5
				? {
						...state,
						scrollTop: action.top,
					}
				: state;
	}
}
export type FileContentResponse = {
	readonly content: string;
	readonly cwd: string;
	readonly path: string;
	readonly size: number;
	readonly updatedAt: number;
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
export function getResponsiveGridColumns(
	availableWidth: number,
	preferredColumns: number,
): number {
	const widthColumns = Math.max(
		1,
		Math.floor(Math.max(0, availableWidth) / MIN_RESPONSIVE_PANE_WIDTH),
	);
	return Math.max(1, Math.min(4, preferredColumns, widthColumns));
}
export function getGridCanvasWidthPercent(
	occupiedColumns: number,
	availableColumns: number,
): number {
	const safeAvailableColumns = Math.max(1, availableColumns);
	const safeOccupiedColumns = Math.max(
		1,
		Math.min(safeAvailableColumns, occupiedColumns),
	);
	return (safeOccupiedColumns / safeAvailableColumns) * 100;
}
export type DockTree =
	| { readonly type: "panel"; readonly id: string }
	| {
			readonly type: "split";
			readonly direction: "horizontal" | "vertical";
			readonly ratio: number;
			readonly first: DockTree;
			readonly second: DockTree;
	  };
function panel(id: string): DockTree {
	return {
		type: "panel",
		id,
	};
}
function split(
	direction: "horizontal" | "vertical",
	first: DockTree,
	second: DockTree,
	ratio?: number,
): DockTree {
	const firstSpan = dockAxisSpan(first, direction);
	const secondSpan = dockAxisSpan(second, direction);
	return {
		type: "split",
		direction,
		ratio: clampRatio(ratio ?? firstSpan / (firstSpan + secondSpan)),
		first,
		second,
	};
}
function clampRatio(ratio: number) {
	return Math.max(0.14, Math.min(0.86, ratio));
}
export function dockAxisSpan(
	tree: DockTree,
	direction: "horizontal" | "vertical",
): number {
	if (tree.type === "panel") return 1;
	const first = dockAxisSpan(tree.first, direction);
	const second = dockAxisSpan(tree.second, direction);
	return tree.direction === direction
		? first + second
		: Math.max(first, second);
}
export function dockPanelIds(tree: DockTree | null): string[] {
	if (!tree) return [];
	if (tree.type === "panel") return [tree.id];
	return [...dockPanelIds(tree.first), ...dockPanelIds(tree.second)];
}

/** Transform leaves in one traversal. Reconciliation preserves split ratios;
 * moving a panel recomputes them to match the remaining panel spans. */
function transformPanels(
	tree: DockTree,
	visit: (leaf: Extract<DockTree, { type: "panel" }>) => DockTree | null,
	preserveRatio: boolean | "clamp" = false,
): DockTree | null {
	if (tree.type === "panel") return visit(tree);
	const first = transformPanels(tree.first, visit, preserveRatio);
	const second = transformPanels(tree.second, visit, preserveRatio);
	if (!first) return second;
	if (!second) return first;
	return preserveRatio === true
		? {
				...tree,
				first,
				second,
			}
		: split(
				tree.direction,
				first,
				second,
				preserveRatio ? tree.ratio : undefined,
			);
}
function beside(tree: DockTree, id: string, edge: DockEdge): DockTree {
	const direction =
		edge === "top" || edge === "bottom" ? "vertical" : "horizontal";
	return edge === "left" || edge === "top"
		? split(direction, panel(id), tree)
		: split(direction, tree, panel(id));
}
function buildRow(ids: readonly string[]): DockTree {
	return ids
		.slice(1)
		.reduce<DockTree>(
			(tree, id) => split("horizontal", tree, panel(id)),
			panel(ids[0]!),
		);
}
export function createDockTree(
	ids: readonly string[],
	columns: number,
): DockTree | null {
	if (ids.length === 0) return null;
	const safeColumns = Math.max(1, Math.min(columns, ids.length));
	const rows: DockTree[] = [];
	for (let index = 0; index < ids.length; index += safeColumns) {
		rows.push(buildRow(ids.slice(index, index + safeColumns)));
	}
	return rows
		.slice(1)
		.reduce<DockTree>((tree, row) => split("vertical", tree, row), rows[0]!);
}
export function constrainDockTreeColumns(
	tree: DockTree,
	columns: number,
): DockTree {
	const safeColumns = Math.max(1, columns);
	if (dockAxisSpan(tree, "horizontal") <= safeColumns) return tree;
	return createDockTree(dockPanelIds(tree), safeColumns) ?? tree;
}
function appendDockPanelWithinColumns(
	tree: DockTree,
	id: string,
	columns: number,
): DockTree {
	const safeColumns = Math.max(1, columns);
	const appendToLastRow = (
		node: DockTree,
	): { readonly tree: DockTree; readonly appended: boolean } => {
		if (node.type === "split" && node.direction === "vertical") {
			const result = appendToLastRow(node.second);
			return result.appended
				? {
						tree: {
							...node,
							second: result.tree,
						},
						appended: true,
					}
				: {
						tree: node,
						appended: false,
					};
		}
		if (dockAxisSpan(node, "horizontal") >= safeColumns) {
			return {
				tree: node,
				appended: false,
			};
		}
		return {
			tree: split("horizontal", node, panel(id)),
			appended: true,
		};
	};
	const constrained = constrainDockTreeColumns(tree, safeColumns);
	const result = appendToLastRow(constrained);
	return result.appended
		? result.tree
		: split("vertical", constrained, panel(id));
}
export function reconcileDockTree(
	tree: DockTree | null,
	ids: readonly string[],
	columns: number,
): DockTree | null {
	const allowed = new Set(ids);
	let next = tree
		? transformPanels(
				tree,
				(leaf) => (allowed.has(leaf.id) ? leaf : null),
				"clamp",
			)
		: null;
	if (next) next = constrainDockTreeColumns(next, columns);
	const present = new Set(dockPanelIds(next));
	for (const id of ids) {
		if (present.has(id)) continue;
		next = next ? appendDockPanelWithinColumns(next, id, columns) : panel(id);
		present.add(id);
	}
	return next ?? createDockTree(ids, columns);
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
	return branch === "first"
		? {
				...tree,
				first: resizeDockSplit(tree.first, rest, ratio),
			}
		: {
				...tree,
				second: resizeDockSplit(tree.second, rest, ratio),
			};
}
export function moveDockPanel(
	tree: DockTree,
	sourceId: string,
	targetId: string,
	edge: DockEdge,
): DockTree {
	if (sourceId === targetId) return tree;
	const ids = dockPanelIds(tree);
	if (!ids.includes(sourceId) || !ids.includes(targetId)) return tree;
	if (edge === "center")
		return transformPanels(
			tree,
			(leaf) =>
				leaf.id === sourceId
					? panel(targetId)
					: leaf.id === targetId
						? panel(sourceId)
						: leaf,
			true,
		)!;
	const withoutSource = transformPanels(tree, (leaf) =>
		leaf.id === sourceId ? null : leaf,
	);
	if (!withoutSource) return tree;
	return transformPanels(withoutSource, (leaf) =>
		leaf.id === targetId ? beside(leaf, sourceId, edge) : leaf,
	)!;
}
export function moveDockPanelToOuterEdge(
	tree: DockTree,
	sourceId: string,
	edge: DockOuterEdge,
): DockTree {
	const ids = dockPanelIds(tree);
	if (ids.length < 2 || !ids.includes(sourceId)) return tree;
	const withoutSource = transformPanels(tree, (leaf) =>
		leaf.id === sourceId ? null : leaf,
	);
	if (!withoutSource) return tree;
	return beside(withoutSource, sourceId, edge);
}
export function insertDockPanel(
	tree: DockTree,
	panelId: string,
	targetId: string,
	edge: DockEdge,
): DockTree {
	const ids = dockPanelIds(tree);
	if (ids.includes(panelId) || !ids.includes(targetId)) return tree;
	return transformPanels(tree, (leaf) =>
		leaf.id === targetId ? beside(leaf, panelId, edge) : leaf,
	)!;
}
export function insertDockPanelAtOuterEdge(
	tree: DockTree,
	panelId: string,
	edge: DockOuterEdge,
): DockTree {
	if (dockPanelIds(tree).includes(panelId)) return tree;
	return beside(tree, panelId, edge);
}
export function parseDockTree(value: string | null): DockTree | null {
	if (!value) return null;
	try {
		return parseDockNode(JSON.parse(value));
	} catch {
		return null;
	}
}

/** Validate and normalize persisted nodes together, with the same depth bound. */
function parseDockNode(value: unknown, depth = 0): DockTree | null {
	if (!value || typeof value !== "object" || depth > 32) return null;
	const node = value as Record<string, unknown>;
	if (node.type === "panel")
		return typeof node.id === "string" ? panel(node.id) : null;
	if (
		node.type !== "split" ||
		(node.direction !== "horizontal" && node.direction !== "vertical") ||
		(node.ratio !== undefined &&
			(typeof node.ratio !== "number" || !Number.isFinite(node.ratio)))
	)
		return null;
	const first = parseDockNode(node.first, depth + 1);
	const second = parseDockNode(node.second, depth + 1);
	return first && second
		? split(node.direction, first, second, node.ratio as number | undefined)
		: null;
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
export function openGitGraph<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		mainViewMode: "graph",
		focusedAuxiliaryPanel: {
			id: "workspace-diff-viewer",
			cwd,
		},
	};
}

/** Apply first-open defaults only after the directory is confirmed as a Git repository. */
export function initializeGitRepositoryPanels<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	if (current.repositoryInitialized) return current;
	const next = current.diffViewerCwd ? current : openGitGraph(current, cwd);
	return {
		...next,
		repositoryInitialized: true,
		sidebarVisible: true,
		focusedAuxiliaryPanel: current.focusedAuxiliaryPanel,
	};
}

/** Bind an open graph to the repository owned by the newly focused chat. */
export function bindGitGraphRepository<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	const repositoryChanged = current.diffViewerCwd !== cwd;
	return {
		...current,
		diffViewerCwd: cwd,
		focusedAuxiliaryPanel: null,
		selectedFile: repositoryChanged ? null : current.selectedFile,
		selectedCommitHash: repositoryChanged ? null : current.selectedCommitHash,
		selectedCommitIds: repositoryChanged ? [] : current.selectedCommitIds,
		selectedCommitParent: repositoryChanged
			? null
			: current.selectedCommitParent,
	};
}
function openFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	file: GitWorkspaceSelectedFile,
	source: GitWorkspaceDiffSource,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		selectedFile: {
			...file,
			source,
		},
		mainViewMode: "diff",
		focusedAuxiliaryPanel: {
			id: "workspace-diff-viewer",
			cwd,
		},
	};
}
export function openGitWorkingTreeFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	file: GitWorkspaceSelectedFile,
): GitWorkspacePanelSession<InitialFile> {
	return openFileDiff(current, cwd, file, {
		kind:
			current.mainViewMode === "graph" ||
			resolvedDiffContext(current) === "graphWorkingTree"
				? "graphWorkingTree"
				: "workingTree",
	});
}
export function openGitCommitFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	path: string,
	commitHash: string,
	commitParent: string | null,
): GitWorkspacePanelSession<InitialFile> {
	return openFileDiff(
		current,
		cwd,
		{
			path,
			staged: false,
		},
		{
			kind: "commit",
			commitHash,
			commitParent,
		},
	);
}
export function openGitComparisonFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	path: string,
	from: string,
	to: string,
): GitWorkspacePanelSession<InitialFile> {
	return openFileDiff(
		current,
		cwd,
		{
			path,
			staged: false,
		},
		{
			kind: "comparison",
			comparisonFrom: from,
			comparisonTo: to,
		},
	);
}
export function dismissGitWorkspaceViewer<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
): GitWorkspacePanelSession<InitialFile> {
	const graphCwd = current.diffViewerCwd;
	const returnsToGraph =
		graphCwd !== null && isGitWorkspaceGraphDrillIn(current);
	if (returnsToGraph) {
		return openGitGraph(current, graphCwd);
	}
	return {
		...current,
		selectedFile: null,
		selectedCommitHash: null,
		selectedCommitIds: [],
		selectedCommitParent: null,
		mainViewMode: "diff",
		diffViewerCwd: null,
		focusedAuxiliaryPanel:
			current.focusedAuxiliaryPanel?.id === "workspace-diff-viewer"
				? null
				: current.focusedAuxiliaryPanel,
	};
}
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
export function updateGitGraphSelection<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	itemId: string | null,
	orderedItemIds: readonly string[],
	intent?: GitGraphSelectionIntent,
): GitWorkspacePanelSession<InitialFile> {
	if (!itemId) {
		return {
			...current,
			selectedCommitHash: null,
			selectedCommitIds: [],
			selectedCommitParent: null,
		};
	}
	let nextIds: readonly string[] = [itemId];
	if (intent?.range && current.selectedCommitHash) {
		const anchor = orderedItemIds.indexOf(current.selectedCommitHash);
		const target = orderedItemIds.indexOf(itemId);
		if (anchor >= 0 && target >= 0) {
			nextIds = orderedItemIds.slice(
				Math.min(anchor, target),
				Math.max(anchor, target) + 1,
			);
		}
	} else if (intent?.additive) {
		nextIds = current.selectedCommitIds.includes(itemId)
			? current.selectedCommitIds.filter((id) => id !== itemId)
			: [...current.selectedCommitIds, itemId];
	}
	const nextPrimary = nextIds.includes(itemId)
		? itemId
		: (nextIds.at(-1) ?? null);
	const selectionChanged =
		nextPrimary !== current.selectedCommitHash ||
		nextIds.length !== current.selectedCommitIds.length ||
		nextIds.some((id, index) => id !== current.selectedCommitIds[index]);
	return {
		...current,
		selectedFile: selectionChanged ? null : current.selectedFile,
		selectedCommitHash: nextPrimary,
		selectedCommitIds: nextIds,
		selectedCommitParent: null,
	};
}
export function reconcileGitGraphSelection<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	items: readonly GitGraphSelectionItem[],
): {
	readonly session: GitWorkspacePanelSession<InitialFile>;
	readonly announcement: string | null;
} {
	if (items.length === 0)
		return {
			session: current,
			announcement: null,
		};
	const first = items[0]!;
	const visibleIds = new Set(items.map((item) => item.id));
	const retainedIds = current.selectedCommitIds.filter((id) =>
		visibleIds.has(id),
	);
	const nextIds = retainedIds.length ? retainedIds : [first.id];
	const nextPrimary =
		current.selectedCommitHash && visibleIds.has(current.selectedCommitHash)
			? current.selectedCommitHash
			: (nextIds.at(-1) ?? null);
	if (
		nextPrimary === current.selectedCommitHash &&
		nextIds.length === current.selectedCommitIds.length &&
		nextIds.every((id, index) => id === current.selectedCommitIds[index])
	) {
		return {
			session: current,
			announcement: null,
		};
	}
	return {
		session: {
			...current,
			selectedCommitHash: nextPrimary,
			selectedCommitIds: nextIds,
			selectedCommitParent: null,
		},
		announcement: current.selectedCommitHash
			? `The selected graph item is no longer available. Selected ${first.message}.`
			: null,
	};
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
