import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { postJson } from "../../../adapters/backend/http.ts";
import {
	readStoredJson,
	readStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../../adapters/storage/sync.ts";
import {
	color,
	controlSize,
	font,
	iconSize,
	layer,
	motion,
	radius,
	shadow,
} from "../../../design-system/styles.stylex.ts";
import { FileTypeIcon } from "../../../modules/explorer/components/FileTypeIcon.tsx";
import {
	DOCUMENT_OPEN_EVENT,
	type DocumentOpenDetail,
} from "../../../modules/explorer/model/explorer-events.ts";
import { useGitChangeActions } from "../../../modules/repository/hooks/useGitChangeActions.ts";
import { useGitDiff } from "../../../modules/repository/hooks/useGitDiff.tsx";
import {
	type CommitFile,
	useCommitDetails,
	useComparisonDetails,
	useGitGraph,
} from "../../../modules/repository/hooks/useGitGraph.tsx";
import { useGitStatus } from "../../../modules/repository/hooks/useGitStatus.tsx";
import type { GitFileEntry } from "../../../modules/repository/model/types.ts";
import { DiffViewerBoundary } from "../../../modules/workbench/diff/components/DiffViewerBoundary.tsx";
import { lockPointerSelection } from "../../../shared/lib/pointer-selection-lock.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import { LiquidSegmentedRail } from "../../../shared/ui/gooey/LiquidSegmentedRail.tsx";
import {
	IconArrowDown,
	IconCollapse,
	IconExpand,
	IconGitBranch,
	IconLayoutGrid,
	IconRefreshCw,
	IconX,
} from "../../../shared/ui/Icons.tsx";
import type { DiffRequest } from "../../repository/model/types.ts";
import {
	ChangesPanel,
	type SelectedFile,
} from "../changes/components/ChangesPanel.tsx";
import {
	getAlphabeticalFileOrder,
	getFileSelectionAfterToggle,
	getTreeFileOrder,
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderProjectGitFiles,
	resolveGitFileSelection,
} from "../changes/model/changes-model.ts";
import { WorkspaceDockHandle } from "../components/WorkspaceDockHandle.tsx";
import {
	DiffViewer,
	type DiffViewMode,
} from "../diff/components/DiffViewer.tsx";
import { summarizeHunkDiff } from "../diff/model/diff-lines.ts";
import {
	DocumentViewer,
	type FileContentResponse,
} from "../documents/components/DocumentViewer.tsx";
import {
	CommitGraph,
	type GitGraphActionRequest,
	type GraphSelectionIntent,
} from "../graph/components/CommitGraph.tsx";
import {
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	nextGitGraphHistoryLimit,
} from "../graph/model/graph-model.ts";
import {
	createInteractiveRebasePlan,
	type GitInteractiveRebaseCommit,
	type GitInteractiveRebaseStep,
	moveInteractiveRebaseStep,
	updateInteractiveRebaseStep,
	validateInteractiveRebasePlan,
} from "../graph/model/rebase-model.ts";
import {
	OPEN_ACTIVE_GIT_GRAPH_EVENT,
	TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT,
} from "../model/workbench-events.ts";
import { MIN_RESPONSIVE_PANE_WIDTH } from "../model/workbench-layout.ts";
import {
	bindGitGraphRepository,
	dismissGitWorkspaceViewer,
	type GitWorkspaceDetachedFilePanel,
	type GitWorkspacePanelSession,
	getGitWorkspaceSidebarContent,
	initializeGitRepositoryPanels,
	isGitWorkspaceGraphDrillIn,
	isHistoricalGitWorkspaceDiff,
	normalizeGitWorkspacePanelSession,
	openGitCommitFileDiff,
	openGitComparisonFileDiff,
	openGitGraph,
	openGitWorkingTreeFileDiff,
	reconcileGitGraphSelection,
	serializeGitWorkspacePanelSession,
	updateGitGraphSelection,
} from "../model/workbench-model.ts";
import {
	GIT_FILE_VIEW_MODE_STORAGE_KEY,
	loadGitFileViewMode,
	saveGitFileViewMode,
} from "../model/workbench-preferences.ts";

const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";
const DIFF_WIDTH_KEY_PREFIX = "agent-workspace-diff-width:";
const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";
const MIN_SIDEBAR_WIDTH = 230;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_DIFF_WIDTH = 320;
const DEFAULT_DIFF_WIDTH = 680;

function loadSidebarWidth() {
	const stored = Number(readStoredValue(SIDEBAR_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0
		? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
		: DEFAULT_SIDEBAR_WIDTH;
}

function loadDiffWidth(workspaceId: string) {
	const stored = Number(
		readStoredValue(`${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`),
	);
	return Number.isFinite(stored) && stored > 0
		? Math.max(MIN_DIFF_WIDTH, stored)
		: DEFAULT_DIFF_WIDTH;
}

function loadDiffViewMode(): DiffViewMode {
	return readStoredValue(DIFF_VIEW_MODE_KEY) === "split" ? "split" : "hunks";
}

type DragProps = {
	readonly draggable: boolean;
	readonly onDragStart: (event: PointerEvent) => void;
	readonly onCreatePanelDragStart: (
		event: PointerEvent,
		panelId: string,
		completeDrop: () => void,
	) => void;
	readonly onDragEnd: () => void;
};

type GitRefOperationResult = {
	readonly ok: boolean;
	readonly operation:
		| "merge"
		| "rebase"
		| "interactiveRebase"
		| "fastForward"
		| "cherryPick"
		| "revert";
	readonly outcome: GitOperationOutcome;
	readonly currentBranch?: string;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
	readonly error?: string;
};

type GitRefOperationPreflight = {
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
	readonly interactiveRebaseCommits: GitInteractiveRebaseCommit[];
	readonly reasons: string[];
};

type GitOperationOutcome =
	| "completed"
	| "awaitingContinuation"
	| "conflicted"
	| "failed";

type GitOperationActivityPhase =
	| "idle"
	| "running"
	| "conflicted"
	| "awaitingContinuation"
	| "completed"
	| "failed";

type GitOperationErrorKind =
	| "conflict"
	| "dirtyWorktree"
	| "authentication"
	| "nonFastForward"
	| "network"
	| "worktreeInUse"
	| "invalidInput"
	| "commandFailed"
	| "io";

type GitGraphActionResult = {
	readonly ok: boolean;
	readonly action: GitGraphActionRequest["action"];
	readonly outcome: GitOperationOutcome;
	readonly currentBranch?: string;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
	readonly error?: string;
};

function gitOperationErrorLabel(kind?: GitOperationErrorKind): string {
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

function gitGraphEmptyLabel(graph: ReturnType<typeof useGitGraph>): string {
	switch (graph.state) {
		case "unborn":
			return "This branch does not have its first commit yet";
		case "empty":
			return "This repository has no commits";
		case "nonRepository":
			return "The selected folder is not a Git repository";
		case "commandFailed":
			return graph.stateError || "Git history could not be read";
		default:
			return "No commits";
	}
}

type GraphActionPresentation = {
	readonly title: string;
	readonly copy: string;
	readonly confirm: string;
	readonly needsName: boolean;
	readonly nameLabel?: string;
	readonly messageLabel: string | null;
	readonly danger: boolean;
};

function graphActionPresentation(
	action: GitGraphActionRequest["action"],
): GraphActionPresentation {
	switch (action) {
		case "createBranch":
			return {
				title: "Create branch",
				copy: "Create a new local branch at the selected commit.",
				confirm: "Create branch",
				needsName: true,
				messageLabel: null,
				danger: false,
			};
		case "createTag":
			return {
				title: "Create tag",
				copy: "Create a lightweight tag, or enter a message for an annotated tag.",
				confirm: "Create tag",
				needsName: true,
				messageLabel: "Annotation (optional)",
				danger: false,
			};
		case "cherryPick":
			return {
				title: "Cherry-pick commit",
				copy: "Apply this commit on top of the currently checked-out branch.",
				confirm: "Cherry-pick",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "revert":
			return {
				title: "Revert commit",
				copy: "Create a new commit that reverses the selected commit.",
				confirm: "Revert commit",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "stashPush":
			return {
				title: "Stash worktree changes",
				copy: "Store tracked and untracked changes from the current worktree.",
				confirm: "Create stash",
				needsName: false,
				messageLabel: "Stash message (optional)",
				danger: false,
			};
		case "stashApply":
			return {
				title: "Apply stash",
				copy: "Apply this stash while keeping it in the stash list.",
				confirm: "Apply stash",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "stashPop":
			return {
				title: "Pop stash",
				copy: "Apply this stash and remove it if the apply succeeds.",
				confirm: "Pop stash",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "stashDrop":
			return {
				title: "Delete stash",
				copy: "Permanently remove this stash from the repository.",
				confirm: "Delete stash",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "stashRename":
			return {
				title: "Rename stash",
				copy: "Replace this stash's displayed message while preserving its saved tree.",
				confirm: "Rename stash",
				needsName: true,
				nameLabel: "New stash message",
				messageLabel: null,
				danger: false,
			};
		case "renameBranch":
			return {
				title: "Rename branch",
				copy: "Rename this local branch. Its commits and working tree are preserved.",
				confirm: "Rename branch",
				needsName: true,
				nameLabel: "New branch name",
				messageLabel: null,
				danger: false,
			};
		case "deleteBranch":
			return {
				title: "Delete local branch",
				copy: "Delete this local branch only if Git confirms it is merged and not checked out in a worktree.",
				confirm: "Delete branch",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "deleteTag":
			return {
				title: "Delete local tag",
				copy: "Remove this tag from the local repository. Remote tags are unchanged.",
				confirm: "Delete tag",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "setUpstream":
			return {
				title: "Set branch upstream",
				copy: "Set the tracking branch without pushing or changing either branch.",
				confirm: "Set upstream",
				needsName: true,
				nameLabel: "Upstream (for example origin/main)",
				messageLabel: null,
				danger: false,
			};
		case "pushSetUpstream":
			return {
				title: "Push and set upstream",
				copy: "Push this local branch to the named remote and configure it as the tracking upstream.",
				confirm: "Push branch",
				needsName: true,
				nameLabel: "Remote name",
				messageLabel: null,
				danger: false,
			};
		case "deleteRemoteBranch":
			return {
				title: "Delete remote branch",
				copy: "Ask the configured remote to permanently delete this branch, then prune its tracking ref.",
				confirm: "Delete remote branch",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "pushTag":
			return {
				title: "Push tag",
				copy: "Publish this tag to the named remote.",
				confirm: "Push tag",
				needsName: true,
				nameLabel: "Remote name",
				messageLabel: null,
				danger: false,
			};
		case "deleteRemoteTag":
			return {
				title: "Delete remote tag",
				copy: "Permanently remove this tag from the named remote. The local tag is kept.",
				confirm: "Delete remote tag",
				needsName: true,
				nameLabel: "Remote name",
				messageLabel: null,
				danger: true,
			};
		case "forcePushWithLease":
			return {
				title: "Force push with lease",
				copy: "Rewrite the configured upstream only if it still points to the commit last fetched locally. This can replace remote history.",
				confirm: "Force push with lease",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "resetSoft":
			return {
				title: "Soft reset branch",
				copy: "Move the current branch to this commit while keeping all resulting changes staged.",
				confirm: "Reset --soft",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "resetMixed":
			return {
				title: "Mixed reset branch",
				copy: "Move the current branch to this commit and keep resulting changes unstaged in the worktree.",
				confirm: "Reset --mixed",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "resetHard":
			return {
				title: "Hard reset branch",
				copy: "Move the current branch to this commit and permanently discard tracked index and worktree changes.",
				confirm: "Reset --hard",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "fetch":
			return {
				title: "Fetch all remotes",
				copy: "Update remote-tracking refs and prune deleted remote refs without changing the worktree.",
				confirm: "Fetch",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "pull":
			return {
				title: "Pull current branch",
				copy: "Fetch and integrate the configured upstream using this repository's pull policy.",
				confirm: "Pull",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "push":
			return {
				title: "Push current branch",
				copy: "Push the current branch to its configured upstream. Force push is never used.",
				confirm: "Push",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
	}
}

type DetachedFilePanel = GitWorkspaceDetachedFilePanel<FileContentResponse>;
type WorkspacePanelSession = GitWorkspacePanelSession<FileContentResponse>;

type StateValue<T> = T | ((current: T) => T);

const workspacePanelSessions = new Map<string, WorkspacePanelSession>();
const WORKSPACE_PANEL_SESSION_KEY = "agent-workspace-panels:";

function loadWorkspacePanelSession(workspaceId: string): WorkspacePanelSession {
	const cached = workspacePanelSessions.get(workspaceId);
	if (cached) return cached;
	const stored = readStoredJson<unknown>(
		`${WORKSPACE_PANEL_SESSION_KEY}${workspaceId}`,
		{},
	);
	const session =
		normalizeGitWorkspacePanelSession<FileContentResponse>(stored);
	workspacePanelSessions.set(workspaceId, session);
	return session;
}

function persistWorkspacePanelSession(
	workspaceId: string,
	session: WorkspacePanelSession,
) {
	writeStoredJson(
		`${WORKSPACE_PANEL_SESSION_KEY}${workspaceId}`,
		serializeGitWorkspacePanelSession(session),
	);
}

function resolveStateValue<T>(value: StateValue<T>, current: T): T {
	return typeof value === "function"
		? (value as (current: T) => T)(current)
		: value;
}

function useWorkspacePanelSession(workspaceId: string) {
	const [, setRevision] = useState(0);
	const session = loadWorkspacePanelSession(workspaceId);
	const update = useCallback(
		(change: (current: WorkspacePanelSession) => WorkspacePanelSession) => {
			const current = loadWorkspacePanelSession(workspaceId);
			const next = change(current);
			if (next === current) return;
			workspacePanelSessions.set(workspaceId, next);
			persistWorkspacePanelSession(workspaceId, next);
			setRevision((revision) => revision + 1);
		},
		[workspaceId],
	);
	return [session, update] as const;
}

let detachedFilePanelSequence = 0;

function createDetachedFilePanelId() {
	detachedFilePanelSequence += 1;
	return `workspace-file-viewer:${Date.now()}:${detachedFilePanelSequence}`;
}

function DiffFilePath({ path }: { readonly path: string }) {
	const separator = path.lastIndexOf("/");
	const fileName = separator >= 0 ? path.slice(separator + 1) : path;
	return (
		<span title={path} {...stylex.props(styles.viewerFloatingFile)}>
			<FileTypeIcon path={path} size={iconSize.md} />
			<span {...stylex.props(styles.viewerFloatingPath)}>
				<strong {...stylex.props(styles.viewerFileName)}>{fileName}</strong>
			</span>
		</span>
	);
}

function ChatDiffPanel({
	diff,
	file,
	loading,
	mainViewMode,
	onMainViewModeChange,
	graph,
	graphLoading,
	graphError,
	selectionAnnouncement,
	repositoryKey,
	selectedCommitHash,
	selectedCommitIds,
	onSelectCommit,
	onOpenGraphSelection,
	onCheckoutRef,
	onRunRefOperation,
	onRunGraphAction,
	onLoadMoreCommits,
	branch,
	onClose,
	closeLabel,
	viewMode,
	onViewModeChange,
	startAtFirstChange,
	zenMode,
	onToggleZenMode,
	drag,
}: {
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly file: SelectedFile | null;
	readonly loading: boolean;
	readonly mainViewMode: "diff" | "graph";
	readonly onMainViewModeChange: (mode: "diff" | "graph") => void;
	readonly graph: ReturnType<typeof useGitGraph>;
	readonly graphLoading: boolean;
	readonly graphError: string | null;
	readonly selectionAnnouncement: string;
	readonly repositoryKey?: string;
	readonly selectedCommitHash: string | null;
	readonly selectedCommitIds: readonly string[];
	readonly onSelectCommit: (
		itemId: string,
		intent?: GraphSelectionIntent,
	) => void;
	readonly onOpenGraphSelection: (itemId: string) => void;
	readonly onCheckoutRef: (ref: string) => void;
	readonly onRunRefOperation: (request: {
		operation:
			| "merge"
			| "rebase"
			| "interactiveRebase"
			| "fastForward"
			| "cherryPick"
			| "revert";
		action: "start" | "continue" | "skip" | "abort";
		source?: string;
		target?: string;
		steps?: GitInteractiveRebaseStep[];
	}) => Promise<GitRefOperationResult>;
	readonly onRunGraphAction: (
		request: GitGraphActionRequest & { name?: string; message?: string },
	) => Promise<GitGraphActionResult>;
	readonly onLoadMoreCommits: () => void;
	readonly branch?: string;
	readonly onClose: () => void;
	readonly closeLabel: string;
	readonly viewMode: DiffViewMode;
	readonly onViewModeChange: (mode: DiffViewMode) => void;
	readonly startAtFirstChange: boolean;
	readonly zenMode: boolean;
	readonly onToggleZenMode: () => void;
	readonly drag?: DragProps;
}) {
	const stats = useMemo(() => summarizeHunkDiff(diff), [diff]);
	const [hoveredModeIndex, setHoveredModeIndex] = useState<number | null>(null);
	const [pendingRefAction, setPendingRefAction] = useState<{
		source: string;
		target: string;
	} | null>(null);
	const [refOperationResult, setRefOperationResult] =
		useState<GitRefOperationResult | null>(null);
	const [refOperationRunning, setRefOperationRunning] = useState(false);
	const [refOperationPreflight, setRefOperationPreflight] =
		useState<GitRefOperationPreflight | null>(null);
	const [refPreflightRunning, setRefPreflightRunning] = useState(false);
	const [interactiveRebaseOpen, setInteractiveRebaseOpen] = useState(false);
	const [interactiveRebasePlan, setInteractiveRebasePlan] = useState<
		GitInteractiveRebaseStep[]
	>([]);
	const [pendingGraphAction, setPendingGraphAction] =
		useState<GitGraphActionRequest | null>(null);
	const [graphActionName, setGraphActionName] = useState("");
	const [graphActionMessage, setGraphActionMessage] = useState("");
	const [graphActionResult, setGraphActionResult] =
		useState<GitGraphActionResult | null>(null);
	const [graphActionRunning, setGraphActionRunning] = useState(false);
	useEffect(() => {
		if (!pendingRefAction || !repositoryKey) {
			setRefOperationPreflight(null);
			setRefPreflightRunning(false);
			setInteractiveRebaseOpen(false);
			setInteractiveRebasePlan([]);
			return;
		}
		let current = true;
		setRefOperationPreflight(null);
		setRefPreflightRunning(true);
		void postJson<GitRefOperationPreflight>(
			"/api/git/ref-operation-preflight",
			{
				cwd: repositoryKey,
				source: pendingRefAction.source,
				target: pendingRefAction.target,
			},
		)
			.then((result) => {
				if (!current) return;
				setRefOperationPreflight(result);
				setInteractiveRebasePlan(
					createInteractiveRebasePlan(result.interactiveRebaseCommits),
				);
			})
			.catch((error) => {
				if (!current) return;
				setRefOperationResult({
					ok: false,
					operation: "merge",
					outcome: "failed",
					conflicts: [],
					errorKind: "commandFailed",
					error:
						error instanceof Error
							? error.message
							: "Unable to check branch operations",
				});
			})
			.finally(() => {
				if (current) setRefPreflightRunning(false);
			});
		return () => {
			current = false;
		};
	}, [pendingRefAction, repositoryKey]);
	const runRefOperation = useCallback(
		async (
			operation:
				| "merge"
				| "rebase"
				| "interactiveRebase"
				| "fastForward"
				| "cherryPick"
				| "revert",
			action: "start" | "continue" | "skip" | "abort" = "start",
		) => {
			if (action === "start" && !pendingRefAction) return;
			setRefOperationRunning(true);
			const result = await onRunRefOperation({
				operation,
				action,
				source: pendingRefAction?.source,
				target: pendingRefAction?.target,
				steps:
					operation === "interactiveRebase" ? interactiveRebasePlan : undefined,
			});
			setRefOperationResult(result);
			setRefOperationRunning(false);
			if (result.ok) {
				setPendingRefAction(null);
			} else if (result.outcome === "conflicted") {
				setInteractiveRebaseOpen(false);
			}
		},
		[interactiveRebasePlan, onRunRefOperation, pendingRefAction],
	);
	const requestGraphAction = useCallback((request: GitGraphActionRequest) => {
		setGraphActionName(request.suggestedName ?? "");
		setGraphActionMessage("");
		setGraphActionResult(null);
		setPendingGraphAction(request);
	}, []);
	const runGraphAction = useCallback(async () => {
		if (!pendingGraphAction) return;
		setGraphActionRunning(true);
		const result = await onRunGraphAction({
			...pendingGraphAction,
			name: graphActionName.trim() || undefined,
			message: graphActionMessage.trim() || undefined,
		});
		setGraphActionRunning(false);
		setGraphActionResult(result);
		if (result.ok) setPendingGraphAction(null);
	}, [
		graphActionMessage,
		graphActionName,
		onRunGraphAction,
		pendingGraphAction,
	]);
	const activeModeIndex = zenMode
		? 2
		: mainViewMode === "graph"
			? -1
			: viewMode === "split"
				? 0
				: 1;
	const repositoryOperation = graph.operation ?? {
		kind: "idle" as const,
		phase: "idle" as const,
		conflicts: [] as string[],
	};
	const pendingGraphActionPresentation = pendingGraphAction
		? graphActionPresentation(pendingGraphAction.action)
		: null;
	const interactiveRebasePlanError = validateInteractiveRebasePlan(
		interactiveRebasePlan,
	);
	const interactiveRebaseCommits = new Map(
		(refOperationPreflight?.interactiveRebaseCommits ?? []).map((commit) => [
			commit.hash,
			commit,
		]),
	);
	const resumableOperation =
		repositoryOperation.kind === "idle" ? null : repositoryOperation.kind;
	const operationActivity: {
		phase: GitOperationActivityPhase;
		message: string;
	} =
		refOperationRunning || graphActionRunning || refPreflightRunning
			? { phase: "running", message: "Git operation running" }
			: repositoryOperation.phase === "conflicted"
				? { phase: "conflicted", message: "Git operation has conflicts" }
				: repositoryOperation.phase === "awaitingContinuation"
					? {
							phase: "awaitingContinuation",
							message: "Git operation is ready to continue",
						}
					: graphActionResult
						? {
								phase: graphActionResult.ok ? "completed" : "failed",
								message: graphActionResult.ok
									? `Git ${graphActionResult.action} completed`
									: gitOperationErrorLabel(graphActionResult.errorKind),
							}
						: refOperationResult
							? {
									phase: refOperationResult.ok ? "completed" : "failed",
									message: refOperationResult.ok
										? `Git ${refOperationResult.operation} completed`
										: gitOperationErrorLabel(refOperationResult.errorKind),
								}
							: { phase: "idle", message: "" };
	return (
		<section {...stylex.props(styles.viewerPanel)}>
			<span role="status" aria-live="polite" {...stylex.props(styles.srStatus)}>
				{selectionAnnouncement}
			</span>
			<span
				role="status"
				aria-live="polite"
				data-git-operation-phase={operationActivity.phase}
				{...stylex.props(styles.srStatus)}
			>
				{operationActivity.message}
			</span>
			<div
				aria-hidden="true"
				data-floating-viewer-scrim="true"
				{...stylex.props(
					styles.viewerFloatingScrim,
					mainViewMode === "graph" && styles.viewerFloatingScrimAboveContent,
				)}
			/>
			<header
				{...stylex.props(styles.viewerHeader, styles.viewerHeaderFloating)}
			>
				{mainViewMode === "graph" && drag ? (
					<WorkspaceDockHandle {...drag} />
				) : null}
				{mainViewMode === "diff" && file ? (
					<DiffFilePath path={file.path} />
				) : null}
				{mainViewMode === "diff" && (stats.added > 0 || stats.removed > 0) ? (
					<span {...stylex.props(styles.viewerStats)}>
						{stats.added > 0 ? (
							<span {...stylex.props(styles.viewerAdded)}>+{stats.added}</span>
						) : null}
						{stats.removed > 0 ? (
							<span {...stylex.props(styles.viewerRemoved)}>
								-{stats.removed}
							</span>
						) : null}
					</span>
				) : null}
				{mainViewMode === "graph" ? (
					<div {...stylex.props(styles.graphSyncActions)}>
						{(["fetch", "pull", "push"] as const).map((action) => {
							const ActionIcon =
								action === "fetch" ? IconRefreshCw : IconArrowDown;
							const label = `${action[0]!.toLocaleUpperCase()}${action.slice(1)} repository`;
							const actionName = `${action[0]!.toLocaleUpperCase()}${action.slice(1)}`;
							return (
								<button
									key={action}
									type="button"
									disabled={graphActionRunning}
									onClick={() =>
										requestGraphAction({ action, itemId: "repository" })
									}
									title={label}
									aria-label={label}
									{...stylex.props(styles.graphSyncButton)}
								>
									<ActionIcon
										size={iconSize.compact}
										{...stylex.props(action === "push" && styles.graphPushIcon)}
									/>
									<span>{actionName}</span>
								</button>
							);
						})}
					</div>
				) : null}
				{mainViewMode !== "graph" ? (
					<>
						<span {...stylex.props(styles.viewerFloatingDivider)} />
						<div
							{...stylex.props(styles.viewerModes)}
							onMouseLeave={() => setHoveredModeIndex(null)}
						>
							<LiquidSegmentedRail
								activeIndex={hoveredModeIndex ?? activeModeIndex}
								itemCount={3}
								radius={4}
							/>
							<button
								type="button"
								onMouseEnter={() => setHoveredModeIndex(0)}
								onPointerDown={(event) => {
									if (event.button === 0 && event.isPrimary) {
										onMainViewModeChange("diff");
										onViewModeChange("split");
									}
								}}
								onClick={(event) => {
									if (event.detail === 0) {
										onMainViewModeChange("diff");
										onViewModeChange("split");
									}
								}}
								title="Full file diff"
								aria-label="Full file diff"
								{...stylex.props(
									styles.viewerModeButton,
									viewMode === "split" && styles.viewerModeButtonActive,
								)}
							>
								<IconLayoutGrid size={iconSize.compact} />
							</button>
							<button
								type="button"
								onMouseEnter={() => setHoveredModeIndex(1)}
								onPointerDown={(event) => {
									if (event.button === 0 && event.isPrimary) {
										onMainViewModeChange("diff");
										onViewModeChange("hunks");
									}
								}}
								onClick={(event) => {
									if (event.detail === 0) {
										onMainViewModeChange("diff");
										onViewModeChange("hunks");
									}
								}}
								title="Hunk view"
								aria-label="Hunk view"
								{...stylex.props(
									styles.viewerModeButton,
									viewMode === "hunks" && styles.viewerModeButtonActive,
								)}
							>
								<IconGitBranch size={iconSize.compact} />
							</button>
							<button
								type="button"
								onMouseEnter={() => setHoveredModeIndex(2)}
								onPointerDown={(event) => {
									if (event.button === 0 && event.isPrimary) onToggleZenMode();
								}}
								onClick={(event) => {
									if (event.detail === 0) onToggleZenMode();
								}}
								title={zenMode ? "Exit focus mode" : "Focus workspace"}
								aria-label={zenMode ? "Exit focus mode" : "Focus workspace"}
								{...stylex.props(
									styles.viewerModeButton,
									zenMode && styles.viewerModeButtonActive,
								)}
							>
								{zenMode ? (
									<IconCollapse size={iconSize.compact} />
								) : (
									<IconExpand size={iconSize.compact} />
								)}
							</button>
						</div>
					</>
				) : null}
				{mainViewMode !== "graph" ? (
					<button
						type="button"
						onPointerDown={(event) => {
							if (event.button === 0 && event.isPrimary) onClose();
						}}
						onClick={(event) => {
							if (event.detail === 0) onClose();
						}}
						title={closeLabel}
						aria-label={closeLabel}
						{...stylex.props(styles.viewerClose)}
					>
						<IconX size={iconSize.xs} />
					</button>
				) : null}
			</header>
			<div
				{...stylex.props(
					styles.viewerBody,
					mainViewMode !== "graph" && styles.viewerBodyAboveScrim,
				)}
			>
				{mainViewMode === "graph" ? (
					graphLoading && graph.commits.length === 0 && !graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>Loading history…</div>
					) : graphError && graph.commits.length === 0 && !graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>{graphError}</div>
					) : graph.commits.length === 0 && !graph.searchQuery ? (
						<div {...stylex.props(styles.viewerEmpty)}>
							{gitGraphEmptyLabel(graph)}
						</div>
					) : (
						<CommitGraph
							commits={graph.commits}
							ancestry={graph.ancestry}
							onSearchChange={graph.setSearchQuery}
							searchActive={Boolean(graph.searchQuery)}
							searchQuery={graph.searchQuery}
							emptyLabel={
								graphLoading
									? "Searching history…"
									: (graphError ?? graph.stateError ?? "No matching commits")
							}
							rows={graph.rows}
							worktrees={graph.worktrees}
							selectedHash={selectedCommitHash ?? undefined}
							selectedIds={selectedCommitIds}
							onSelect={onSelectCommit}
							onOpenSelection={onOpenGraphSelection}
							onCheckoutRef={onCheckoutRef}
							branch={branch}
							embedded
							hasMore={graph.hasMore}
							loadingMore={graph.loading}
							repositoryKey={repositoryKey}
							onLoadMore={onLoadMoreCommits}
							onRefDrop={(source, target) => {
								setRefOperationResult(null);
								setInteractiveRebaseOpen(false);
								setPendingRefAction({ source, target });
							}}
							onGraphAction={requestGraphAction}
							onCompareWithWip={(itemId) => {
								const wip = graph.commits.find(
									(item) =>
										item.itemKind === "worktreeWip" && item.id === "wip",
								);
								if (!wip) return;
								onSelectCommit(wip.id);
								onSelectCommit(itemId, { additive: true, range: false });
							}}
						/>
					)
				) : diff && file ? (
					<DiffViewerBoundary resetKey={`${file.path}:${file.staged}`}>
						<DiffViewer
							diff={diff}
							filePath={file.path}
							staged={file.staged}
							loading={false}
							onClose={onClose}
							hideHeader
							hideToolbar
							viewMode={viewMode}
							onViewModeChange={onViewModeChange}
							startAtFirstChange={startAtFirstChange}
						/>
					</DiffViewerBoundary>
				) : !loading ? (
					<div {...stylex.props(styles.viewerEmpty)}>No diff available</div>
				) : null}
				{mainViewMode === "graph" && pendingRefAction ? (
					<div {...stylex.props(styles.refActionOverlay)}>
						<div
							role="dialog"
							aria-modal="true"
							aria-label="Choose branch operation"
							{...stylex.props(styles.refActionDialog)}
						>
							<strong {...stylex.props(styles.refActionTitle)}>
								{interactiveRebaseOpen
									? "Interactive rebase"
									: "Move branch history"}
							</strong>
							<p {...stylex.props(styles.refActionCopy)}>
								Source <code>{pendingRefAction.source}</code> → target{" "}
								<code>{pendingRefAction.target}</code>
							</p>
							{interactiveRebaseOpen &&
							!refOperationResult?.conflicts.length ? (
								<>
									<p {...stylex.props(styles.refActionCopy)}>
										Oldest commit first. Drag rows or use the arrow buttons to
										reorder, then choose Pick, Reword, Squash, or Drop.
									</p>
									<div {...stylex.props(styles.rebasePlan)}>
										{interactiveRebasePlan.map((step, index) => {
											const commit = interactiveRebaseCommits.get(step.hash);
											return (
												<div
													key={step.hash}
													draggable
													onDragStart={(event) => {
														event.dataTransfer?.setData(
															"application/x-inferay-rebase-step",
															String(index),
														);
													}}
													onDragOver={(event) => event.preventDefault()}
													onDrop={(event) => {
														const from = Number(
															event.dataTransfer?.getData(
																"application/x-inferay-rebase-step",
															),
														);
														if (Number.isInteger(from)) {
															setInteractiveRebasePlan((current) =>
																moveInteractiveRebaseStep(current, from, index),
															);
														}
													}}
													{...stylex.props(styles.rebasePlanRow)}
												>
													<div {...stylex.props(styles.rebasePlanControls)}>
														<select
															value={step.action}
															onChange={(event) =>
																setInteractiveRebasePlan((current) =>
																	updateInteractiveRebaseStep(current, index, {
																		action: event.currentTarget
																			.value as GitInteractiveRebaseStep["action"],
																	}),
																)
															}
															aria-label={`Action for ${step.hash.slice(0, 7)}`}
															{...stylex.props(styles.rebaseActionSelect)}
														>
															<option value="pick">Pick</option>
															<option value="reword">Reword</option>
															<option value="squash">Squash</option>
															<option value="drop">Drop</option>
														</select>
														<button
															type="button"
															disabled={index === 0}
															onClick={() =>
																setInteractiveRebasePlan((current) =>
																	moveInteractiveRebaseStep(
																		current,
																		index,
																		index - 1,
																	),
																)
															}
															aria-label={`Move ${step.hash.slice(0, 7)} earlier`}
															{...stylex.props(styles.rebaseMoveButton)}
														>
															↑
														</button>
														<button
															type="button"
															disabled={
																index === interactiveRebasePlan.length - 1
															}
															onClick={() =>
																setInteractiveRebasePlan((current) =>
																	moveInteractiveRebaseStep(
																		current,
																		index,
																		index + 1,
																	),
																)
															}
															aria-label={`Move ${step.hash.slice(0, 7)} later`}
															{...stylex.props(styles.rebaseMoveButton)}
														>
															↓
														</button>
														<code {...stylex.props(styles.rebaseSha)}>
															{step.hash.slice(0, 7)}
														</code>
														<span {...stylex.props(styles.rebaseSubject)}>
															{commit?.message ?? step.message}
														</span>
													</div>
													{step.action === "reword" ? (
														<input
															value={step.message ?? ""}
															onInput={(event) =>
																setInteractiveRebasePlan((current) =>
																	updateInteractiveRebaseStep(current, index, {
																		message: event.currentTarget.value,
																	}),
																)
															}
															aria-label={`New message for ${step.hash.slice(0, 7)}`}
															{...stylex.props(styles.graphActionInput)}
														/>
													) : null}
												</div>
											);
										})}
									</div>
									{interactiveRebasePlanError ? (
										<p {...stylex.props(styles.refActionError)}>
											{interactiveRebasePlanError}
										</p>
									) : null}
								</>
							) : null}
							{refOperationResult?.error ? (
								<p {...stylex.props(styles.refActionError)}>
									<strong>
										{gitOperationErrorLabel(refOperationResult.errorKind)}:
									</strong>{" "}
									{refOperationResult.error}
								</p>
							) : null}
							{refOperationResult?.conflicts.length ? (
								<p {...stylex.props(styles.refActionCopy)}>
									Resolve {refOperationResult.conflicts.length} conflicted file
									{refOperationResult.conflicts.length === 1 ? "" : "s"}, then
									continue or abort.
								</p>
							) : null}
							{!refOperationResult?.conflicts.length && refPreflightRunning ? (
								<p {...stylex.props(styles.refActionCopy)}>
									Checking valid operations…
								</p>
							) : null}
							{!refOperationResult?.conflicts.length &&
							refOperationPreflight &&
							!refOperationPreflight.canMerge &&
							!refOperationPreflight.canRebase ? (
								<p {...stylex.props(styles.refActionError)}>
									{refOperationPreflight.reasons.join(". ")}
								</p>
							) : null}
							<div {...stylex.props(styles.refActionButtons)}>
								{refOperationResult?.conflicts.length ? (
									<>
										<button
											type="button"
											disabled={refOperationRunning}
											onClick={() =>
												runRefOperation(refOperationResult.operation, "abort")
											}
											{...stylex.props(styles.refActionSecondary)}
										>
											Abort
										</button>
										{refOperationResult.operation !== "merge" ? (
											<button
												type="button"
												disabled={refOperationRunning}
												onClick={() =>
													runRefOperation(refOperationResult.operation, "skip")
												}
												{...stylex.props(styles.refActionSecondary)}
											>
												Skip commit
											</button>
										) : null}
										<button
											type="button"
											disabled={refOperationRunning}
											onClick={() =>
												runRefOperation(
													refOperationResult.operation,
													"continue",
												)
											}
											{...stylex.props(styles.refActionPrimary)}
										>
											Continue
										</button>
									</>
								) : interactiveRebaseOpen ? (
									<>
										<button
											type="button"
											disabled={refOperationRunning}
											onClick={() => setInteractiveRebaseOpen(false)}
											{...stylex.props(styles.refActionSecondary)}
										>
											Back
										</button>
										<button
											type="button"
											disabled={
												refOperationRunning || !!interactiveRebasePlanError
											}
											onClick={() => runRefOperation("interactiveRebase")}
											{...stylex.props(styles.refActionPrimary)}
										>
											{refOperationRunning
												? "Rebasing…"
												: "Start interactive rebase"}
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											disabled={refOperationRunning}
											onClick={() => setPendingRefAction(null)}
											{...stylex.props(styles.refActionSecondary)}
										>
											Cancel
										</button>
										{refOperationPreflight?.canInteractiveRebase ? (
											<button
												type="button"
												disabled={refOperationRunning}
												onClick={() => setInteractiveRebaseOpen(true)}
												{...stylex.props(styles.refActionSecondary)}
											>
												Interactive rebase…
											</button>
										) : null}
										{refOperationPreflight?.canRebase ? (
											<button
												type="button"
												disabled={refOperationRunning}
												onClick={() => runRefOperation("rebase")}
												{...stylex.props(styles.refActionSecondary)}
											>
												Rebase source onto target
											</button>
										) : null}
										{refOperationPreflight?.canFastForward ? (
											<button
												type="button"
												disabled={refOperationRunning}
												onClick={() => runRefOperation("fastForward")}
												{...stylex.props(styles.refActionSecondary)}
											>
												Fast-forward target
											</button>
										) : null}
										{refOperationPreflight?.canMerge ? (
											<button
												type="button"
												disabled={refOperationRunning}
												onClick={() => runRefOperation("merge")}
												{...stylex.props(styles.refActionPrimary)}
											>
												Merge source into target
											</button>
										) : null}
									</>
								)}
							</div>
						</div>
					</div>
				) : null}
				{mainViewMode === "graph" &&
				pendingGraphAction &&
				pendingGraphActionPresentation ? (
					<div {...stylex.props(styles.refActionOverlay)}>
						<div
							role="dialog"
							aria-modal="true"
							aria-label={pendingGraphActionPresentation.title}
							{...stylex.props(styles.refActionDialog)}
							onKeyDown={(event) => {
								if (event.key === "Escape" && !graphActionRunning) {
									setPendingGraphAction(null);
								}
							}}
						>
							<strong {...stylex.props(styles.refActionTitle)}>
								{pendingGraphActionPresentation.title}
							</strong>
							<p {...stylex.props(styles.refActionCopy)}>
								{pendingGraphActionPresentation.copy}
								{pendingGraphAction.target ? (
									<>
										{" "}
										Target <code>{pendingGraphAction.target}</code>.
									</>
								) : null}
								{pendingGraphAction.targets?.length ? (
									<>
										{" "}
										Apply oldest to newest:{" "}
										{pendingGraphAction.targets.map((target, index) => (
											<code key={target}>
												{index ? " → " : ""}
												{target.slice(0, 7)}
											</code>
										))}
									</>
								) : null}
							</p>
							{pendingGraphActionPresentation.needsName ? (
								<label {...stylex.props(styles.graphActionField)}>
									<span>
										{pendingGraphActionPresentation.nameLabel ?? "Name"}
									</span>
									<input
										value={graphActionName}
										onInput={(event) =>
											setGraphActionName(event.currentTarget.value)
										}
										{...stylex.props(styles.graphActionInput)}
									/>
								</label>
							) : null}
							{pendingGraphActionPresentation.messageLabel ? (
								<label {...stylex.props(styles.graphActionField)}>
									<span>{pendingGraphActionPresentation.messageLabel}</span>
									<textarea
										rows={2}
										value={graphActionMessage}
										onInput={(event) =>
											setGraphActionMessage(event.currentTarget.value)
										}
										{...stylex.props(styles.graphActionInput)}
									/>
								</label>
							) : null}
							{graphActionResult?.error ? (
								<p {...stylex.props(styles.refActionError)}>
									<strong>
										{gitOperationErrorLabel(graphActionResult.errorKind)}:
									</strong>{" "}
									{graphActionResult.error}
								</p>
							) : null}
							<div {...stylex.props(styles.refActionButtons)}>
								<button
									type="button"
									disabled={graphActionRunning}
									onClick={() => setPendingGraphAction(null)}
									{...stylex.props(styles.refActionSecondary)}
								>
									Cancel
								</button>
								<button
									type="button"
									disabled={
										graphActionRunning ||
										(pendingGraphActionPresentation.needsName &&
											!graphActionName.trim())
									}
									onClick={runGraphAction}
									{...stylex.props(
										pendingGraphActionPresentation.danger
											? styles.graphActionDanger
											: styles.refActionPrimary,
									)}
								>
									{graphActionRunning
										? "Working…"
										: pendingGraphActionPresentation.confirm}
								</button>
							</div>
						</div>
					</div>
				) : null}
				{mainViewMode === "graph" &&
				repositoryOperation.kind !== "idle" &&
				!pendingRefAction ? (
					<div role="status" {...stylex.props(styles.repositoryOperationBar)}>
						<div {...stylex.props(styles.repositoryOperationCopy)}>
							<strong>{repositoryOperation.kind} in progress</strong>
							<span>
								{repositoryOperation.conflicts.length
									? `${repositoryOperation.conflicts.length} conflicted ${repositoryOperation.conflicts.length === 1 ? "file" : "files"}`
									: "Ready to continue"}
							</span>
						</div>
						{resumableOperation ? (
							<div {...stylex.props(styles.refActionButtons)}>
								<button
									type="button"
									disabled={refOperationRunning}
									onClick={() => runRefOperation(resumableOperation, "abort")}
									{...stylex.props(styles.refActionSecondary)}
								>
									Abort
								</button>
								{resumableOperation !== "merge" ? (
									<button
										type="button"
										disabled={refOperationRunning}
										onClick={() => runRefOperation(resumableOperation, "skip")}
										{...stylex.props(styles.refActionSecondary)}
									>
										Skip
									</button>
								) : null}
								<button
									type="button"
									disabled={
										refOperationRunning ||
										repositoryOperation.conflicts.length > 0
									}
									onClick={() =>
										runRefOperation(resumableOperation, "continue")
									}
									{...stylex.props(styles.refActionPrimary)}
								>
									Continue
								</button>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</section>
	);
}

export function useRepositoryWorkbench({
	active,
	cwd,
	workspaceId,
}: {
	readonly active: boolean;
	readonly cwd?: string;
	readonly workspaceId: string;
}) {
	const [panelSession, updatePanelSession] =
		useWorkspacePanelSession(workspaceId);
	const {
		sidebarVisible,
		fileViewerOpen,
		fileViewerCwd,
		diffViewerCwd,
		focusedAuxiliaryPanel,
		detachedFilePanels,
		fileRequest,
		selectedFile,
		selectedFileCommitHash,
		selectedFileCommitParent,
		selectedFileComparisonFrom,
		selectedFileComparisonTo,
		selectedCommitHash,
		selectedCommitIds,
		selectedCommitParent,
		mainViewMode,
	} = panelSession;
	const setPanelField = useCallback(
		<Key extends keyof WorkspacePanelSession>(
			key: Key,
			value: StateValue<WorkspacePanelSession[Key]>,
		) =>
			updatePanelSession((current) => ({
				...current,
				[key]: resolveStateValue(value, current[key]),
			})),
		[updatePanelSession],
	);
	const setDiffViewerCwd = useCallback(
		(value: StateValue<string | null>) => setPanelField("diffViewerCwd", value),
		[setPanelField],
	);
	const setFocusedAuxiliaryPanel = useCallback(
		(value: StateValue<WorkspacePanelSession["focusedAuxiliaryPanel"]>) =>
			setPanelField("focusedAuxiliaryPanel", value),
		[setPanelField],
	);
	const setDetachedFilePanels = useCallback(
		(value: StateValue<DetachedFilePanel[]>) =>
			setPanelField("detachedFilePanels", value),
		[setPanelField],
	);
	const setSelectedFile = useCallback(
		(value: StateValue<SelectedFile | null>) =>
			setPanelField("selectedFile", value),
		[setPanelField],
	);
	const setMainViewMode = useCallback(
		(value: "diff" | "graph") => setPanelField("mainViewMode", value),
		[setPanelField],
	);
	const [fileViewMode, setFileViewModeState] = useState(loadGitFileViewMode);
	useEffect(() => {
		const applyStoredMode = (value: string | null) => {
			if (value === "path" || value === "tree") setFileViewModeState(value);
		};
		const stopLocalSync = listenWindowEvent(
			CLIENT_STORAGE_CHANGED_EVENT,
			(event) => {
				const detail = (
					event as CustomEvent<{ key?: string; value?: string | null }>
				).detail;
				if (detail?.key === GIT_FILE_VIEW_MODE_STORAGE_KEY)
					applyStoredMode(detail.value ?? null);
			},
		);
		const stopWindowSync = listenWindowEvent("storage", (event) => {
			if (event.key === GIT_FILE_VIEW_MODE_STORAGE_KEY)
				applyStoredMode(event.newValue);
		});
		return () => {
			stopLocalSync();
			stopWindowSync();
		};
	}, []);
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
	const [diffWidth, setDiffWidth] = useState(() => loadDiffWidth(workspaceId));
	const [diffViewMode, setDiffViewModeState] = useState(loadDiffViewMode);
	const [zenMode, setZenMode] = useState(false);
	const [graphActionError, setGraphActionError] = useState<string | null>(null);
	const [graphSelectionAnnouncement, setGraphSelectionAnnouncement] =
		useState("");
	const [pendingGraphFileOpen, setPendingGraphFileOpen] = useState<
		string | null
	>(null);
	const [graphLimit, setGraphLimit] = useState(DEFAULT_GIT_GRAPH_HISTORY_LIMIT);
	const setDiffViewMode = useCallback((mode: DiffViewMode) => {
		setDiffViewModeState(mode);
		writeStoredValue(DIFF_VIEW_MODE_KEY, mode);
	}, []);
	const toggleZenMode = useCallback(
		() => setZenMode((current) => !current),
		[],
	);
	useEffect(() => {
		if (!active || !zenMode) return;
		return listenWindowEvent("keydown", (event) => {
			if ((event as KeyboardEvent).key !== "Escape") return;
			(event as KeyboardEvent).preventDefault();
			setZenMode(false);
		});
	}, [active, zenMode]);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const diffDragRef = useRef<{ startX: number; startWidth: number } | null>(
		null,
	);
	const sidebarWidthRef = useRef(sidebarWidth);
	const diffWidthRef = useRef(diffWidth);
	sidebarWidthRef.current = sidebarWidth;
	diffWidthRef.current = diffWidth;
	const activeCwd = focusedAuxiliaryPanel?.cwd ?? cwd;
	const trackedCwds = useMemo(() => {
		if (!active) return [];
		return [
			...new Set(
				[
					cwd,
					fileViewerCwd,
					diffViewerCwd,
					focusedAuxiliaryPanel?.cwd,
					...detachedFilePanels.map((panel) => panel.cwd),
				].filter((value): value is string => !!value),
			),
		];
	}, [
		active,
		cwd,
		detachedFilePanels,
		diffViewerCwd,
		fileViewerCwd,
		focusedAuxiliaryPanel?.cwd,
	]);
	const graphCwd =
		active && mainViewMode === "graph"
			? (diffViewerCwd ?? undefined)
			: undefined;
	const graph = useGitGraph(graphCwd, graphLimit);
	const {
		projectMap,
		refetch,
		applyOptimistic,
		loaded: gitLoaded,
	} = useGitStatus(trackedCwds, {
		enabled: trackedCwds.length > 0,
		graph: graphCwd ? graph : undefined,
	});
	const project = activeCwd ? (projectMap.get(activeCwd) ?? null) : null;
	const diffViewerProject = diffViewerCwd
		? (projectMap.get(diffViewerCwd) ?? null)
		: null;
	const { staged, modified, untracked } = useMemo(
		() => ({
			staged: project?.files.filter(isStagedChange) ?? [],
			modified: project?.files.filter(isUnstagedTrackedChange) ?? [],
			untracked: project?.files.filter(isUntrackedChange) ?? [],
		}),
		[project],
	);
	const files = useMemo(() => orderProjectGitFiles(project), [project]);
	const graphRevisionsRef = useRef(new Map<string, string>());
	if (graphCwd && graph.revision) {
		graphRevisionsRef.current.set(graphCwd, graph.revision);
	}
	useEffect(() => setGraphLimit(DEFAULT_GIT_GRAPH_HISTORY_LIMIT), [graphCwd]);
	const selectedGraphCache = useRef<{
		cwd: string | undefined;
		items: Map<string, (typeof graph.commits)[number]>;
	}>({ cwd: graphCwd, items: new Map() });
	if (selectedGraphCache.current.cwd !== graphCwd)
		selectedGraphCache.current = { cwd: graphCwd, items: new Map() };
	const selectedGraphItems = useMemo(() => {
		const selected = new Set(selectedCommitIds);
		if (selectedCommitHash) selected.add(selectedCommitHash);
		const cached = selectedGraphCache.current.items;
		for (const id of cached.keys()) if (!selected.has(id)) cached.delete(id);
		for (const item of graph.commits)
			if (selected.has(item.id)) cached.set(item.id, item);
		return selectedCommitIds.flatMap((id) => {
			const item = cached.get(id);
			return item ? [item] : [];
		});
	}, [graph.commits, graphCwd, selectedCommitHash, selectedCommitIds]);
	const selectedGraphItem = selectedCommitHash
		? (selectedGraphCache.current.items.get(selectedCommitHash) ?? null)
		: null;

	const comparisonCommitItems = useMemo(
		() =>
			selectedGraphItems
				.filter((item) => item.itemKind !== "worktreeWip")
				.sort(
					(a, b) =>
						(a.navigation?.historyOrder ??
							graph.commits.findIndex((item) => item.id === a.id)) -
						(b.navigation?.historyOrder ??
							graph.commits.findIndex((item) => item.id === b.id)),
				),
		[graph.commits, selectedGraphItems],
	);
	const comparisonWipItems = selectedGraphItems.filter(
		(item) => item.itemKind === "worktreeWip",
	);
	const comparisonWip = comparisonWipItems[0];
	const comparisonFrom = comparisonCommitItems.at(-1)?.hash;
	const comparisonTo = comparisonWip
		? "WORKTREE"
		: comparisonCommitItems[0]?.hash;
	const comparisonIsValid =
		comparisonWipItems.length <= 1 &&
		comparisonCommitItems.length >= (comparisonWip ? 1 : 2);
	const comparisonCwd = comparisonWip?.worktreePath ?? graphCwd;
	const selectedGraphWorktree = useMemo(
		() =>
			selectedGraphItem?.itemKind === "worktreeWip"
				? (graph.worktrees.find(
						(worktree) => worktree.path === selectedGraphItem.worktreePath,
					) ?? null)
				: null,
		[graph.worktrees, selectedGraphItem],
	);
	const selectedLinkedWorktreeStatus =
		selectedGraphWorktree && !selectedGraphWorktree.isCurrent
			? selectedGraphWorktree.status
			: null;
	const sidebarStaged = selectedLinkedWorktreeStatus
		? selectedLinkedWorktreeStatus.files.filter(isStagedChange)
		: staged;
	const sidebarModified = selectedLinkedWorktreeStatus
		? selectedLinkedWorktreeStatus.files.filter(isUnstagedTrackedChange)
		: modified;
	const sidebarUntracked = selectedLinkedWorktreeStatus
		? selectedLinkedWorktreeStatus.files.filter(isUntrackedChange)
		: untracked;
	const selectedWorkingTreeCwd = selectedGraphWorktree?.path ?? activeCwd;
	const openSelectedWorktree = useCallback(() => {
		if (!selectedGraphWorktree || selectedGraphWorktree.isCurrent) return;
		updatePanelSession((current) => ({
			...current,
			diffViewerCwd: selectedGraphWorktree.path,
			selectedFile: null,
			selectedFileCommitHash: null,
			selectedFileCommitParent: null,
			selectedFileComparisonFrom: null,
			selectedFileComparisonTo: null,
			diffContext: null,
			selectedCommitHash: null,
			selectedCommitIds: [],
			selectedCommitParent: null,
			mainViewMode: "graph",
			focusedAuxiliaryPanel: {
				id: "workspace-diff-viewer",
				cwd: selectedGraphWorktree.path,
			},
		}));
	}, [selectedGraphWorktree, updatePanelSession]);
	const historicalCommitCwd =
		mainViewMode === "diff" && selectedFileCommitHash
			? (diffViewerCwd ?? undefined)
			: graphCwd;
	const historicalCommitHash =
		mainViewMode === "diff"
			? (selectedFileCommitHash ?? undefined)
			: selectedCommitIds.length <= 1 &&
					selectedGraphItem &&
					selectedGraphItem.itemKind !== "worktreeWip"
				? selectedGraphItem.hash
				: undefined;
	const historicalCommitParent =
		mainViewMode === "diff"
			? (selectedFileCommitParent ?? undefined)
			: (selectedCommitParent ?? undefined);
	const historicalGraphRevision =
		mainViewMode === "diff" && diffViewerCwd
			? graphRevisionsRef.current.get(diffViewerCwd)
			: graph.revision;
	const commitDetailsState = useCommitDetails(
		historicalCommitCwd,
		historicalCommitHash,
		historicalCommitParent,
		historicalGraphRevision,
	);
	const historicalComparisonCwd =
		mainViewMode === "diff" &&
		selectedFileComparisonFrom &&
		selectedFileComparisonTo
			? (diffViewerCwd ?? undefined)
			: comparisonCwd;
	const historicalComparisonFrom =
		mainViewMode === "diff"
			? (selectedFileComparisonFrom ?? undefined)
			: comparisonFrom;
	const historicalComparisonTo =
		mainViewMode === "diff"
			? (selectedFileComparisonTo ?? undefined)
			: comparisonTo;
	const comparisonDetailsState = useComparisonDetails(
		mainViewMode === "diff" || comparisonIsValid
			? historicalComparisonCwd
			: undefined,
		mainViewMode === "diff" || comparisonIsValid
			? historicalComparisonFrom
			: undefined,
		mainViewMode === "diff" || comparisonIsValid
			? historicalComparisonTo
			: undefined,
		historicalGraphRevision,
	);
	const selectGraphCommit = useCallback(
		(itemId: string | null, intent?: GraphSelectionIntent) => {
			const orderedItemIds = graph.commits.map((item) => item.id);
			updatePanelSession((current) =>
				updateGitGraphSelection(current, itemId, orderedItemIds, intent),
			);
		},
		[graph.commits, updatePanelSession],
	);
	const checkoutGraphRef = useCallback(
		async (branch: string) => {
			if (!graphCwd) return;
			setGraphActionError(null);
			try {
				const result = await postJson<{
					ok: boolean;
					branch?: string;
					error?: string;
				}>("/api/git/branches", { cwd: graphCwd, branch });
				if (!result.ok) throw new Error(result.error ?? "Checkout failed");
				await refetch();
				selectGraphCommit(null);
			} catch (error) {
				setGraphActionError(
					error instanceof Error ? error.message : "Checkout failed",
				);
			}
		},
		[graphCwd, refetch, selectGraphCommit],
	);
	const runGraphRefOperation = useCallback(
		async (request: {
			operation:
				| "merge"
				| "rebase"
				| "interactiveRebase"
				| "fastForward"
				| "cherryPick"
				| "revert";
			action: "start" | "continue" | "skip" | "abort";
			source?: string;
			target?: string;
			steps?: GitInteractiveRebaseStep[];
		}): Promise<GitRefOperationResult> => {
			if (!graphCwd) {
				return {
					ok: false,
					operation: request.operation,
					outcome: "failed",
					conflicts: [],
					errorKind: "invalidInput",
					error: "No Git repository selected",
				};
			}
			try {
				const result = await postJson<GitRefOperationResult>(
					"/api/git/ref-operation",
					{ cwd: graphCwd, ...request },
				);
				await refetch();
				if (result.ok) selectGraphCommit(result.head ?? null);
				return result;
			} catch (error) {
				return {
					ok: false,
					operation: request.operation,
					outcome: "failed",
					conflicts: [],
					errorKind: "commandFailed",
					error:
						error instanceof Error ? error.message : "Git operation failed",
				};
			}
		},
		[graphCwd, refetch, selectGraphCommit],
	);
	const runGraphActionRequest = useCallback(
		async (
			request: GitGraphActionRequest & { name?: string; message?: string },
		): Promise<GitGraphActionResult> => {
			if (!graphCwd) {
				return {
					ok: false,
					action: request.action,
					outcome: "failed",
					conflicts: [],
					errorKind: "invalidInput",
					error: "No Git repository selected",
				};
			}
			try {
				const result = await postJson<GitGraphActionResult>(
					"/api/git/graph-action",
					{
						cwd: graphCwd,
						action: request.action,
						target: request.target,
						targets: request.targets,
						name: request.name,
						message: request.message,
					},
				);
				await refetch();
				if (
					result.ok &&
					result.head &&
					[
						"cherryPick",
						"revert",
						"resetSoft",
						"resetMixed",
						"resetHard",
					].includes(request.action)
				) {
					selectGraphCommit(result.head);
				}
				return result;
			} catch (error) {
				return {
					ok: false,
					action: request.action,
					outcome: "failed",
					conflicts: [],
					errorKind: "commandFailed",
					error: error instanceof Error ? error.message : "Git action failed",
				};
			}
		},
		[graphCwd, refetch, selectGraphCommit],
	);
	useEffect(() => {
		if (mainViewMode !== "graph" || graph.loading || !graph.commits.length)
			return;
		const reconciliation = reconcileGitGraphSelection(
			panelSession,
			graph.commits,
		);
		if (reconciliation.session === panelSession) return;
		if (reconciliation.announcement) {
			setGraphSelectionAnnouncement(reconciliation.announcement);
		}
		updatePanelSession(() => reconciliation.session);
	}, [
		graph.commits,
		graph.loading,
		mainViewMode,
		panelSession,
		updatePanelSession,
	]);
	const keyboardFiles = useMemo(
		() =>
			fileViewMode === "tree"
				? [
						...getTreeFileOrder([...modified, ...untracked]),
						...getTreeFileOrder(staged),
					]
				: [
						...getAlphabeticalFileOrder([...modified, ...untracked]),
						...getAlphabeticalFileOrder(staged),
					],
		[fileViewMode, files, modified, staged, untracked],
	);
	const commitKeyboardFiles = useMemo(() => {
		const commitFiles = commitDetailsState.details?.files ?? [];
		return fileViewMode === "tree"
			? getTreeFileOrder(commitFiles)
			: getAlphabeticalFileOrder(commitFiles);
	}, [commitDetailsState.details, fileViewMode]);
	const comparisonKeyboardFiles = useMemo(() => {
		const comparisonFiles = comparisonDetailsState.details?.files ?? [];
		return fileViewMode === "tree"
			? getTreeFileOrder(comparisonFiles)
			: getAlphabeticalFileOrder(comparisonFiles);
	}, [comparisonDetailsState.details, fileViewMode]);
	const {
		commit,
		commitMessage,
		setCommitMessage,
		isCommitting,
		amendMode,
		setAmendMode,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	} = useGitChangeActions({
		cwd: activeCwd,
		applyOptimistic,
		refetchStatus: refetch,
	});
	const diffRequest = useMemo<DiffRequest | null>(
		() =>
			active && diffViewerCwd && selectedFile
				? {
						cwd: diffViewerCwd,
						repositoryRevision:
							graphRevisionsRef.current.get(diffViewerCwd) ?? undefined,
						file: selectedFile.path,
						staged: selectedFile.staged,
						commitHash: selectedFileCommitHash ?? undefined,
						commitParent: selectedFileCommitParent ?? undefined,
						comparisonFrom: selectedFileComparisonFrom ?? undefined,
						comparisonTo: selectedFileComparisonTo ?? undefined,
						view: diffViewMode === "split" ? "full" : "review",
					}
				: null,
		[
			active,
			diffViewMode,
			diffViewerCwd,
			graph.revision,
			selectedFile,
			selectedFileCommitHash,
			selectedFileCommitParent,
			selectedFileComparisonFrom,
			selectedFileComparisonTo,
		],
	);
	const { diff, loading: diffLoading } = useGitDiff(diffRequest);

	useEffect(() => {
		if (
			!selectedFile ||
			!diffViewerProject ||
			selectedFileCommitHash ||
			(selectedFileComparisonFrom && selectedFileComparisonTo)
		)
			return;
		const current = resolveGitFileSelection(
			diffViewerProject.files,
			selectedFile,
		);
		if (!current) {
			setSelectedFile(null);
			setDiffViewerCwd(null);
			return;
		}
		if (current.staged !== selectedFile.staged) {
			setSelectedFile({ path: current.path, staged: current.staged });
		}
	}, [
		diffViewerProject,
		selectedFile,
		selectedFileCommitHash,
		selectedFileComparisonFrom,
		selectedFileComparisonTo,
		setDiffViewerCwd,
		setSelectedFile,
	]);
	useEffect(() => {
		if (!active) return;
		setSidebarWidth(loadSidebarWidth());
	}, [active, workspaceId]);
	useEffect(() => {
		if (!active || !cwd || !gitLoaded || !projectMap.has(cwd)) return;
		updatePanelSession((current) =>
			initializeGitRepositoryPanels(current, cwd),
		);
	}, [active, cwd, gitLoaded, projectMap, updatePanelSession]);
	useEffect(() => {
		setDiffWidth(loadDiffWidth(workspaceId));
	}, [workspaceId]);
	useEffect(() => {
		if (!active) return;
		return listenWindowEvent(DOCUMENT_OPEN_EVENT, (event) => {
			const detail = (event as CustomEvent<DocumentOpenDetail>).detail;
			if (!detail?.cwd || !detail.path) return;
			updatePanelSession((current) => ({
				...current,
				fileViewerCwd: detail.cwd,
				focusedAuxiliaryPanel: {
					id: "workspace-file-viewer",
					cwd: detail.cwd,
				},
				fileRequest: { path: detail.path, token: Date.now() },
				fileViewerOpen: true,
			}));
		});
	}, [active, updatePanelSession]);

	useEffect(
		() =>
			listenWindowEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT, () => {
				if (!active) return;
				updatePanelSession((current) => ({
					...current,
					sidebarVisible: !current.sidebarVisible,
				}));
			}),
		[active, updatePanelSession],
	);
	const setFileViewMode = useCallback((mode: "path" | "tree") => {
		setFileViewModeState(mode);
		saveGitFileViewMode(mode);
	}, []);
	const closeFileViewer = useCallback(() => {
		updatePanelSession((current) => ({
			...current,
			fileViewerOpen: false,
			focusedAuxiliaryPanel:
				current.focusedAuxiliaryPanel?.id === "workspace-file-viewer"
					? null
					: current.focusedAuxiliaryPanel,
		}));
	}, [updatePanelSession]);
	const closeDiffViewer = useCallback(() => {
		updatePanelSession(dismissGitWorkspaceViewer);
	}, [updatePanelSession]);
	const returnsToGraphOnClose = isGitWorkspaceGraphDrillIn(panelSession);
	const selectChangedFile = useCallback(
		(file: GitFileEntry) => {
			if (!selectedWorkingTreeCwd) return;
			updatePanelSession((current) =>
				openGitWorkingTreeFileDiff(current, selectedWorkingTreeCwd, {
					path: file.path,
					staged: file.staged,
				}),
			);
		},
		[selectedWorkingTreeCwd, updatePanelSession],
	);
	const selectCommitFile = useCallback(
		(file: CommitFile) => {
			const commitCwd = selectedFileCommitHash ? diffViewerCwd : activeCwd;
			const commitHash =
				selectedFileCommitHash ??
				(selectedGraphItem?.itemKind !== "worktreeWip"
					? selectedGraphItem?.hash
					: undefined);
			const commitParent = selectedFileCommitHash
				? selectedFileCommitParent
				: selectedCommitParent;
			if (!commitCwd || !commitHash) return;
			updatePanelSession((current) =>
				openGitCommitFileDiff(
					current,
					commitCwd,
					file.path,
					commitHash,
					commitParent,
				),
			);
		},
		[
			activeCwd,
			diffViewerCwd,
			selectedCommitParent,
			selectedFileCommitHash,
			selectedFileCommitParent,
			selectedGraphItem,
			updatePanelSession,
		],
	);
	const selectComparisonFile = useCallback(
		(file: CommitFile) => {
			const fileComparisonCwd = selectedFileComparisonFrom
				? diffViewerCwd
				: comparisonCwd;
			const fileComparisonFrom = selectedFileComparisonFrom ?? comparisonFrom;
			const fileComparisonTo = selectedFileComparisonTo ?? comparisonTo;
			if (!fileComparisonCwd || !fileComparisonFrom || !fileComparisonTo)
				return;
			updatePanelSession((current) =>
				openGitComparisonFileDiff(
					current,
					fileComparisonCwd,
					file.path,
					fileComparisonFrom,
					fileComparisonTo,
				),
			);
		},
		[
			comparisonCwd,
			comparisonFrom,
			comparisonTo,
			diffViewerCwd,
			selectedFileComparisonFrom,
			selectedFileComparisonTo,
			updatePanelSession,
		],
	);
	const openGraphSelection = useCallback((itemId: string) => {
		setPendingGraphFileOpen(itemId);
	}, []);
	useEffect(() => {
		if (!pendingGraphFileOpen) return;
		if (
			mainViewMode !== "graph" ||
			selectedCommitHash !== pendingGraphFileOpen
		) {
			setPendingGraphFileOpen(null);
			return;
		}
		if (selectedGraphItem?.itemKind === "worktreeWip") {
			setPendingGraphFileOpen(null);
			const firstFile =
				keyboardFiles.find(
					(file) =>
						file.path === selectedFile?.path &&
						file.staged === selectedFile.staged,
				) ?? keyboardFiles[0];
			if (firstFile) selectChangedFile(firstFile);
			return;
		}
		if (selectedCommitIds.length > 1) {
			if (comparisonDetailsState.loading) return;
			setPendingGraphFileOpen(null);
			const firstFile =
				comparisonKeyboardFiles.find(
					(file) => file.path === selectedFile?.path,
				) ?? comparisonKeyboardFiles[0];
			if (firstFile) selectComparisonFile(firstFile);
			return;
		}
		if (commitDetailsState.loading) return;
		setPendingGraphFileOpen(null);
		const firstFile =
			commitKeyboardFiles.find((file) => file.path === selectedFile?.path) ??
			commitKeyboardFiles[0];
		if (firstFile) selectCommitFile(firstFile);
	}, [
		commitDetailsState.loading,
		commitKeyboardFiles,
		comparisonKeyboardFiles,
		comparisonDetailsState.loading,
		keyboardFiles,
		mainViewMode,
		pendingGraphFileOpen,
		selectChangedFile,
		selectCommitFile,
		selectComparisonFile,
		selectedCommitHash,
		selectedCommitIds.length,
		selectedFile,
		selectedGraphItem?.itemKind,
	]);
	const changeMainViewMode = useCallback(
		(mode: "diff" | "graph") => {
			if (mode === "graph" && activeCwd) {
				updatePanelSession((current) => openGitGraph(current, activeCwd));
				return;
			}
			setMainViewMode(mode);
		},
		[activeCwd, setMainViewMode, updatePanelSession],
	);
	useEffect(
		() =>
			listenWindowEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT, () => {
				if (active) changeMainViewMode("graph");
			}),
		[active, changeMainViewMode],
	);
	const focusWorkbench = useCallback(
		(repositoryCwd?: string) =>
			updatePanelSession((current) =>
				repositoryCwd && repositoryCwd !== cwd
					? current
					: repositoryCwd && current.mainViewMode === "graph"
						? bindGitGraphRepository(current, repositoryCwd)
						: current.focusedAuxiliaryPanel
							? { ...current, focusedAuxiliaryPanel: null }
							: current,
			),
		[cwd, updatePanelSession],
	);
	const focusDiffViewer = useCallback(() => {
		if (!diffViewerCwd) return;
		updatePanelSession((current) =>
			current.focusedAuxiliaryPanel?.id === "workspace-diff-viewer" &&
			current.focusedAuxiliaryPanel.cwd === diffViewerCwd
				? current
				: {
						...current,
						focusedAuxiliaryPanel: {
							id: "workspace-diff-viewer",
							cwd: diffViewerCwd,
						},
					},
		);
	}, [diffViewerCwd, updatePanelSession]);
	const cycleChangedFile = useCallback(
		(direction: -1 | 1) => {
			if (!keyboardFiles.length) return;
			const currentIndex = selectedFile
				? keyboardFiles.findIndex(
						(file) =>
							file.path === selectedFile.path &&
							file.staged === selectedFile.staged,
					)
				: -1;
			const nextIndex =
				currentIndex < 0
					? direction > 0
						? 0
						: keyboardFiles.length - 1
					: Math.max(
							0,
							Math.min(keyboardFiles.length - 1, currentIndex + direction),
						);
			if (nextIndex === currentIndex) return;
			selectChangedFile(keyboardFiles[nextIndex]!);
		},
		[keyboardFiles, selectChangedFile, selectedFile],
	);
	const cycleHistoricalFile = useCallback(
		(direction: -1 | 1) => {
			const comparisonDiff =
				selectedFileComparisonFrom !== null &&
				selectedFileComparisonTo !== null;
			const historicalFiles = comparisonDiff
				? comparisonKeyboardFiles
				: commitKeyboardFiles;
			if (!historicalFiles.length) return;
			const currentIndex = selectedFile
				? historicalFiles.findIndex((file) => file.path === selectedFile.path)
				: -1;
			const nextIndex =
				currentIndex < 0
					? direction > 0
						? 0
						: historicalFiles.length - 1
					: Math.max(
							0,
							Math.min(historicalFiles.length - 1, currentIndex + direction),
						);
			if (nextIndex === currentIndex) return;
			const nextFile = historicalFiles[nextIndex]!;
			if (comparisonDiff) selectComparisonFile(nextFile);
			else selectCommitFile(nextFile);
		},
		[
			commitKeyboardFiles,
			comparisonKeyboardFiles,
			selectCommitFile,
			selectComparisonFile,
			selectedFile,
			selectedFileComparisonFrom,
			selectedFileComparisonTo,
		],
	);
	const handleDiffKeyboardNavigation = useCallback(
		(event: KeyboardEvent) => {
			if (
				focusedAuxiliaryPanel?.id !== "workspace-diff-viewer" ||
				event.defaultPrevented ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			)
				return;
			if (panelSession.mainViewMode === "graph") return;
			const target = event.target as HTMLElement;
			const isEditable =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;
			if (isEditable) return;
			const graphDrillIn = isGitWorkspaceGraphDrillIn(panelSession);
			if (graphDrillIn && event.key === "ArrowLeft") {
				event.preventDefault();
				closeDiffViewer();
				return;
			}
			if (isHistoricalGitWorkspaceDiff(panelSession)) {
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					cycleHistoricalFile(event.key === "ArrowUp" ? -1 : 1);
				}
				return;
			}

			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault();
				cycleChangedFile(event.key === "ArrowUp" ? -1 : 1);
			} else if (
				event.key === "Enter" &&
				selectedFile &&
				target.tagName !== "BUTTON"
			) {
				event.preventDefault();
				const nextSelection = getFileSelectionAfterToggle(
					keyboardFiles,
					selectedFile,
				);
				if (selectedFile.staged) unstageFile(selectedFile.path);
				else stageFile(selectedFile.path);
				if (nextSelection) selectChangedFile(nextSelection);
			}
		},
		[
			closeDiffViewer,
			cycleChangedFile,
			cycleHistoricalFile,
			focusedAuxiliaryPanel?.id,
			keyboardFiles,
			panelSession,
			selectChangedFile,
			selectedFile,
			stageFile,
			unstageFile,
		],
	);
	useEffect(() => {
		if (!active) return;
		return listenWindowEvent("keydown", handleDiffKeyboardNavigation);
	}, [active, handleDiffKeyboardNavigation]);
	const handleResizeStart = useCallback(
		(event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
			event.preventDefault();
			const releaseSelection = lockPointerSelection();
			const shell = event.currentTarget.parentElement;
			dragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
			const move = (moveEvent: MouseEvent) => {
				if (!dragRef.current) return;
				const width = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(
						MIN_SIDEBAR_WIDTH,
						dragRef.current.startWidth +
							dragRef.current.startX -
							moveEvent.clientX,
					),
				);
				sidebarWidthRef.current = width;
				if (shell) shell.style.width = `${width}px`;
			};
			const end = () => {
				releaseSelection();
				writeStoredValue(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
				setSidebarWidth(sidebarWidthRef.current);
				dragRef.current = null;
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", end);
			};
			document.addEventListener("mousemove", move);
			document.addEventListener("mouseup", end);
		},
		[sidebarWidth],
	);
	const handleDiffResizeStart = useCallback(
		(event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const releaseSelection = lockPointerSelection();
			const rail = event.currentTarget.parentElement;
			const workspaceWidth =
				event.currentTarget.parentElement?.parentElement?.getBoundingClientRect()
					.width ?? window.innerWidth;
			const reservedSidebarWidth = sidebarVisible ? sidebarWidth : 0;
			const availableWidth = Math.max(
				MIN_DIFF_WIDTH,
				workspaceWidth - reservedSidebarWidth - MIN_RESPONSIVE_PANE_WIDTH,
			);
			const maximumWidth = availableWidth;
			const pointerId = event.pointerId;
			diffDragRef.current = {
				startX: event.clientX,
				startWidth: rail?.getBoundingClientRect().width ?? diffWidth,
			};
			try {
				event.currentTarget.setPointerCapture(pointerId);
			} catch {}
			const move = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== pointerId || !diffDragRef.current) return;
				moveEvent.preventDefault();
				const width = Math.min(
					maximumWidth,
					Math.max(
						MIN_DIFF_WIDTH,
						diffDragRef.current.startWidth +
							diffDragRef.current.startX -
							moveEvent.clientX,
					),
				);
				diffWidthRef.current = width;
				if (rail) rail.style.width = `${width}px`;
			};
			const end = (endEvent: PointerEvent) => {
				if (endEvent.pointerId !== pointerId) return;
				releaseSelection();
				writeStoredValue(
					`${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`,
					String(diffWidthRef.current),
				);
				setDiffWidth(diffWidthRef.current);
				diffDragRef.current = null;
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", end);
				window.removeEventListener("pointercancel", end);
			};
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", end);
			window.addEventListener("pointercancel", end);
		},
		[diffWidth, sidebarVisible, sidebarWidth, workspaceId],
	);

	const auxiliaryPanels = useMemo(() => {
		const panels: Array<{
			readonly id: string;
			readonly onSelect?: () => void;
			readonly render: (drag: DragProps) => unknown;
		}> = [];
		if (fileViewerOpen && fileViewerCwd) {
			panels.push({
				id: "workspace-file-viewer",
				onSelect: () =>
					setFocusedAuxiliaryPanel({
						id: "workspace-file-viewer",
						cwd: fileViewerCwd,
					}),
				render: (drag: DragProps) => (
					<DocumentViewer
						key={fileViewerCwd}
						cwd={fileViewerCwd}
						sessionId={`workspace-file-viewer:${workspaceId}:${fileViewerCwd}`}
						openRequest={fileRequest}
						onClose={closeFileViewer}
						onFileTabDragStart={(event, file, completeMove) => {
							const id = createDetachedFilePanelId();
							drag.onCreatePanelDragStart(event, id, () => {
								setDetachedFilePanels((current) => [
									...current,
									{
										id,
										cwd: file.cwd,
										path: file.path,
										initialFile: file,
									},
								]);
								setFocusedAuxiliaryPanel({ id, cwd: file.cwd });
								completeMove();
							});
						}}
						{...drag}
					/>
				),
			});
		}
		for (const panel of detachedFilePanels) {
			panels.push({
				id: panel.id,
				onSelect: () =>
					setFocusedAuxiliaryPanel({ id: panel.id, cwd: panel.cwd }),
				render: (drag: DragProps) => (
					<DocumentViewer
						key={panel.id}
						cwd={panel.cwd}
						sessionId={panel.id}
						initialFile={panel.initialFile}
						openRequest={
							panel.initialFile ? null : { path: panel.path, token: 0 }
						}
						onClose={() => {
							setDetachedFilePanels((current) =>
								current.filter((item) => item.id !== panel.id),
							);
							setFocusedAuxiliaryPanel((current) =>
								current?.id === panel.id ? null : current,
							);
						}}
						onFileTabDragStart={(event, file, completeMove) => {
							const id = createDetachedFilePanelId();
							drag.onCreatePanelDragStart(event, id, () => {
								setDetachedFilePanels((current) => [
									...current,
									{
										id,
										cwd: file.cwd,
										path: file.path,
										initialFile: file,
									},
								]);
								setFocusedAuxiliaryPanel({ id, cwd: file.cwd });
								completeMove();
							});
						}}
						{...drag}
					/>
				),
			});
		}
		return panels;
	}, [
		closeFileViewer,
		detachedFilePanels,
		fileRequest,
		fileViewerCwd,
		fileViewerOpen,
		setDetachedFilePanels,
		setFocusedAuxiliaryPanel,
		workspaceId,
	]);

	const diffPanel =
		diffViewerCwd && (selectedFile || mainViewMode === "graph") ? (
			<aside
				{...stylex.props(
					styles.diffRail,
					mainViewMode === "graph" && styles.graphRail,
					zenMode && styles.diffRailZen,
				)}
				style={
					zenMode
						? undefined
						: {
								width: diffWidth,
								maxWidth: `max(0px, calc(100% - ${MIN_RESPONSIVE_PANE_WIDTH + (sidebarVisible ? sidebarWidth : 0)}px))`,
							}
				}
				onPointerDownCapture={focusDiffViewer}
			>
				<button
					type="button"
					aria-label="Resize diff panel"
					onPointerDown={handleDiffResizeStart}
					{...stylex.props(styles.diffResizeHandle)}
				/>
				<ChatDiffPanel
					diff={diff}
					file={selectedFile}
					loading={diffLoading}
					mainViewMode={mainViewMode}
					onMainViewModeChange={changeMainViewMode}
					graph={graph}
					graphLoading={graph.loading}
					graphError={graphActionError ?? graph.error}
					selectionAnnouncement={graphSelectionAnnouncement}
					repositoryKey={graphCwd}
					selectedCommitHash={selectedCommitHash}
					selectedCommitIds={selectedCommitIds}
					onSelectCommit={selectGraphCommit}
					onOpenGraphSelection={openGraphSelection}
					onCheckoutRef={checkoutGraphRef}
					onRunRefOperation={runGraphRefOperation}
					onRunGraphAction={runGraphActionRequest}
					onLoadMoreCommits={() => setGraphLimit(nextGitGraphHistoryLimit)}
					branch={project?.branch}
					onClose={closeDiffViewer}
					closeLabel={
						returnsToGraphOnClose
							? "Back to commit graph"
							: "Close change viewer"
					}
					viewMode={diffViewMode}
					onViewModeChange={setDiffViewMode}
					startAtFirstChange={
						!selectedFileCommitHash &&
						!selectedFileComparisonFrom &&
						!selectedFileComparisonTo
					}
					zenMode={zenMode}
					onToggleZenMode={toggleZenMode}
				/>
			</aside>
		) : null;

	const sidebarContent = getGitWorkspaceSidebarContent(
		panelSession,
		selectedGraphItem?.itemKind === "worktreeWip",
	);
	const sidebar = (
		<aside
			{...stylex.props(styles.sidebarShell)}
			style={{ width: sidebarVisible ? sidebarWidth : 0 }}
		>
			{sidebarVisible ? (
				<>
					<button
						type="button"
						aria-label="Resize changes sidebar"
						onMouseDown={handleResizeStart}
						{...stylex.props(styles.resizeHandle)}
					/>
					<ChangesPanel
						cwd={selectedWorkingTreeCwd}
						fileViewMode={fileViewMode}
						onFileViewModeChange={setFileViewMode}
						content={sidebarContent}
						graphActive={mainViewMode === "graph"}
						modified={sidebarModified}
						untracked={sidebarUntracked}
						staged={sidebarStaged}
						selectedFile={
							focusedAuxiliaryPanel?.id === "workspace-diff-viewer"
								? selectedFile
								: null
						}
						onSelectFile={selectChangedFile}
						onStageFile={stageFile}
						onUnstageFile={unstageFile}
						onStageAll={stageAll}
						onUnstageAll={unstageAll}
						hasProject={!!project || !!selectedLinkedWorktreeStatus}
						projectLoading={!!activeCwd && !gitLoaded}
						selectedCommitHash={selectedCommitHash}
						selectedCommitCount={selectedCommitIds.length}
						selectedWorktreePath={selectedGraphWorktree?.path}
						onOpenWorktree={
							selectedGraphWorktree && !selectedGraphWorktree.isCurrent
								? openSelectedWorktree
								: undefined
						}
						commitDetailsLoading={commitDetailsState.loading}
						commitDetails={commitDetailsState.details}
						commitDetailsError={commitDetailsState.error}
						comparisonDetailsLoading={comparisonDetailsState.loading}
						comparisonDetails={comparisonDetailsState.details}
						onSelectCommitFile={selectCommitFile}
						onSelectComparisonFile={selectComparisonFile}
						branch={selectedGraphWorktree?.branch ?? project?.branch}
						commitMessage={commitMessage}
						onCommitMessageChange={setCommitMessage}
						onCommit={commit}
						isCommitting={isCommitting}
						amendMode={amendMode}
						onAmendModeChange={setAmendMode}
						showFileActions={!selectedLinkedWorktreeStatus}
						showCommitSection={!selectedLinkedWorktreeStatus}
					/>
				</>
			) : null}
		</aside>
	);

	return { auxiliaryPanels, diffPanel, focusWorkbench, sidebar, zenMode };
}

const styles = stylex.create({
	srStatus: {
		position: "absolute",
		width: "1px",
		height: "1px",
		overflow: "hidden",
		borderWidth: 0,
		clip: "rect(0 0 0 0)",
		margin: "-1px",
		padding: 0,
		whiteSpace: "nowrap",
	},
	sidebarShell: {
		position: "relative",
		display: "flex",
		height: "100%",
		minHeight: controlSize._0,
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.transparent,
	},
	diffRail: {
		position: "relative",
		boxSizing: "border-box",
		display: "flex",
		minWidth: controlSize._0,
		height: "100%",
		minHeight: controlSize._0,
		flexShrink: 0,
		backgroundColor: color.transparent,
		overflow: "visible",
	},
	graphRail: {
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
	},
	diffRailZen: {
		minWidth: controlSize._0,
		flex: 1,
	},
	diffResizeHandle: {
		position: "absolute",
		zIndex: layer.sticky,
		top: controlSize._0,
		bottom: controlSize._0,
		left: -4,
		width: controlSize._2,
		borderWidth: 0,
		padding: controlSize._0,
		touchAction: "none",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		cursor: "ew-resize",
	},
	resizeHandle: {
		position: "absolute",
		zIndex: layer.sticky,
		top: controlSize._0,
		bottom: controlSize._0,
		left: -3,
		width: controlSize._1_5,
		borderWidth: 0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		cursor: "ew-resize",
	},
	viewerPanel: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flexDirection: "column",
		backgroundColor: color.transparent,
		overflow: "hidden",
	},
	viewerHeader: {
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		paddingInline: controlSize._3,
	},
	viewerHeaderFloating: {
		position: "absolute",
		bottom: controlSize._2,
		left: "50%",
		zIndex: layer.dropdown,
		width: "auto",
		maxWidth: "calc(100% - 1.5rem)",
		height: controlSize._10,
		boxSizing: "border-box",
		gap: controlSize._2,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.xl,
		backgroundColor: color.backgroundPanel,
		boxShadow: "0 8px 24px rgba(0,0,0,.28)",
		paddingInline: controlSize._3,
		transform: "translateX(-50%)",
	},
	viewerFloatingScrim: {
		position: "absolute",
		left: controlSize._0,
		right: controlSize._0,
		bottom: controlSize._0,
		zIndex: layer.content,
		height: 80,
		pointerEvents: "none",
		backgroundImage:
			"linear-gradient(to top, var(--inferay-surface-base, var(--color-inferay-black)) 0px, var(--inferay-surface-base, var(--color-inferay-black)) 24px, transparent 80px)",
	},
	viewerFloatingScrimAboveContent: {
		zIndex: layer.control,
	},
	viewerFloatingFile: {
		alignItems: "center",
		display: "flex",
		flexShrink: 1,
		gap: controlSize._1_5,
		minWidth: controlSize._0,
	},
	viewerFloatingPath: {
		minWidth: controlSize._0,
		overflow: "hidden",
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	viewerFileName: {
		color: color.textMain,
		fontWeight: font.weightBold,
	},
	viewerStats: {
		display: "flex",
		flexShrink: 0,
		gap: controlSize._1_5,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	viewerFloatingDivider: {
		backgroundColor: color.border,
		flexShrink: 0,
		height: controlSize._5,
		width: 1,
	},
	graphSyncActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._0_5,
		marginLeft: "auto",
	},
	graphSyncButton: {
		display: "flex",
		minWidth: controlSize._10,
		height: controlSize._8,
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._0_5,
		paddingInline: controlSize._1,
		borderRadius: radius.sm,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		lineHeight: 1,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		":disabled": {
			opacity: 0.45,
		},
	},
	graphPushIcon: {
		transform: "rotate(180deg)",
	},
	viewerModes: {
		position: "relative",
		isolation: "isolate",
		display: "flex",
		height: controlSize._5,
		flexShrink: 0,
		alignItems: "center",
		backgroundColor: color.transparent,
	},
	viewerModeButton: {
		position: "relative",
		zIndex: layer.content,
		display: "flex",
		width: controlSize._6,
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.sm,
		backgroundColor: color.transparent,
		color: color.textMuted,
		transitionProperty: "color",
		transitionDuration: motion.durationFast,
	},
	viewerModeButtonActive: {
		backgroundColor: color.transparent,
		color: color.textMain,
	},
	viewerAdded: { color: color.diffAdded },
	viewerRemoved: { color: color.diffRemoved },
	viewerClose: {
		display: "flex",
		width: controlSize._5,
		height: controlSize._5,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: { default: color.transparent, ":hover": color.dangerWash },
		color: { default: color.textMuted, ":hover": color.danger },
	},
	viewerBody: {
		position: "relative",
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	viewerBodyAboveScrim: {
		zIndex: layer.chrome,
	},
	refActionOverlay: {
		position: "absolute",
		zIndex: layer.dropdown,
		inset: controlSize._0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: color.backgroundOverlay,
		padding: controlSize._4,
	},
	refActionDialog: {
		display: "flex",
		width: "min(32rem, 100%)",
		maxHeight: "calc(100% - 2rem)",
		flexDirection: "column",
		gap: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		overflow: "hidden",
		padding: controlSize._4,
	},
	refActionTitle: {
		color: color.textMain,
		fontSize: font.size_4,
	},
	refActionCopy: {
		color: color.textSoft,
		fontSize: font.size_2_75,
		lineHeight: 1.5,
	},
	refActionError: {
		color: color.danger,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
	rebasePlan: {
		display: "flex",
		minHeight: controlSize._0,
		flexDirection: "column",
		gap: controlSize._1,
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.background,
		padding: controlSize._1,
	},
	rebasePlanRow: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		borderRadius: radius.sm,
		backgroundColor: color.surfaceWhite02,
		cursor: "grab",
		padding: controlSize._1,
	},
	rebasePlanControls: {
		display: "flex",
		minWidth: controlSize._0,
		alignItems: "center",
		gap: controlSize._1,
	},
	rebaseActionSelect: {
		height: controlSize._6,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.surfaceControl,
		color: color.textSoft,
		fontSize: font.size_2,
		paddingInline: controlSize._1,
	},
	rebaseMoveButton: {
		display: "flex",
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textMuted,
		fontSize: font.size_2,
		":disabled": { opacity: 0.3 },
	},
	rebaseSha: {
		flexShrink: 0,
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
	},
	rebaseSubject: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		color: color.textSoft,
		fontSize: font.size_2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	graphActionField: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1_5,
		color: color.textSoft,
		fontSize: font.size_2,
	},
	graphActionInput: {
		width: "100%",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.accentBorder,
		},
		borderRadius: radius.sm,
		outline: "none",
		resize: "vertical",
		backgroundColor: color.background,
		color: color.textMain,
		fontFamily: font.familyDiff,
		fontSize: font.size_2_75,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
	},
	refActionButtons: {
		display: "flex",
		flexWrap: "wrap",
		justifyContent: "flex-end",
		gap: controlSize._2,
	},
	refActionSecondary: {
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		paddingInline: controlSize._3,
	},
	refActionPrimary: {
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.controlActive,
			":hover": color.accentWash,
		},
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		paddingInline: controlSize._3,
	},
	graphActionDanger: {
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.danger,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.dangerWash,
			":hover": color.dangerWash,
		},
		color: color.danger,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		paddingInline: controlSize._3,
	},
	repositoryOperationBar: {
		position: "absolute",
		zIndex: layer.dropdown,
		left: controlSize._3,
		right: controlSize._3,
		bottom: controlSize._3,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.warning,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		boxShadow: shadow.popover,
		padding: controlSize._3,
	},
	repositoryOperationCopy: {
		display: "flex",
		minWidth: controlSize._0,
		flexDirection: "column",
		gap: controlSize._1,
		color: color.textSoft,
		fontSize: font.size_2,
		textTransform: "capitalize",
	},
	viewerEmpty: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
