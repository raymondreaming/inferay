import { useMutation, useQuery } from "@octanejs/tanstack-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { postJson } from "../../../adapters/backend/http.ts";
import {
	CLIENT_STORAGE_CHANGED_EVENT,
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import {
	listenWindowEvent,
	queryClient,
	trackPointerResize,
} from "../../../shared/lib/data.ts";
import {
	DOCUMENT_OPEN_EVENT,
	type DocumentOpenDetail,
} from "../../explorer/model/explorer-events.ts";
import { useGitDiff } from "../../repository/hooks/useGitDiff.tsx";
import {
	type CommitFile,
	useCommitDetails,
	useComparisonDetails,
	useGitGraph,
} from "../../repository/hooks/useGitGraph.tsx";
import { useGitStatus } from "../../repository/hooks/useGitStatus.tsx";
import type {
	DiffRequest,
	GitFileEntry,
} from "../../repository/model/types.ts";
import { useGitChangeActions } from "../../repository/model/types.ts";
import {
	ChangesPanel,
	getFileSelectionAfterToggle,
	visibleGitFiles,
} from "../changes/components/ChangesPanel/index.tsx";
import type { DragProps } from "../components/ChatDiffPanel/index.tsx";
import { ChatDiffPanel } from "../components/ChatDiffPanel/index.tsx";
import {
	WorkbenchDiffRail,
	WorkbenchSidebar,
} from "../components/WorkbenchPanels/index.tsx";
import type { DiffViewMode } from "../diff/components/DiffViewer/index.tsx";
import {
	DocumentViewer,
	type FileContentResponse,
} from "../documents/components/DocumentViewer/index.tsx";
import type {
	GitGraphActionRequest,
	GraphSelectionIntent,
} from "../graph/components/CommitGraph/index.tsx";
import {
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	nextGitGraphHistoryLimit,
} from "../graph/model/graph-model.ts";
import type {
	GitOperationResult,
	GitRefOperationRequest,
} from "../model/workbench-model.ts";
import {
	adjacentGitFile,
	emptyGitWorkspacePanelSession,
	GIT_FILE_VIEW_MODE_STORAGE_KEY,
	type GitWorkspaceDetachedFilePanel,
	type GitWorkspacePanelAction,
	type GitWorkspacePanelSession,
	getGitWorkspaceSidebarContent,
	isGitWorkspaceGraphDrillIn,
	isHistoricalGitWorkspaceDiff,
	loadGitFileViewMode,
	MIN_RESPONSIVE_PANE_WIDTH,
	OPEN_ACTIVE_GIT_GRAPH_EVENT,
	saveGitFileViewMode,
	TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT,
} from "../model/workbench-model.ts";

export const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";

export const DIFF_WIDTH_KEY_PREFIX = "agent-workspace-diff-width:";

export const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";

export const MIN_SIDEBAR_WIDTH = 230;

export const MAX_SIDEBAR_WIDTH = 420;

export const DEFAULT_SIDEBAR_WIDTH = 300;

export const MIN_DIFF_WIDTH = 320;

export const DEFAULT_DIFF_WIDTH = 680;

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

export type DetachedFilePanel =
	GitWorkspaceDetachedFilePanel<FileContentResponse>;

export type WorkspacePanelSession =
	GitWorkspacePanelSession<FileContentResponse>;

export const emptyPanelSession =
	emptyGitWorkspacePanelSession<FileContentResponse>();
type PanelAction = GitWorkspacePanelAction<FileContentResponse>;
function panelQuery(workspaceId: string) {
	return {
		queryKey: ["workspace-panels", workspaceId],
		queryFn: async () =>
			(
				await postJson<{ session: WorkspacePanelSession }>(
					"/api/workspace/panels",
					{ workspaceId },
				)
			).session,
		staleTime: Infinity,
		gcTime: 30 * 60 * 1000,
	};
}
export function useWorkspacePanelSession(workspaceId: string) {
	const options = useMemo(() => panelQuery(workspaceId), [workspaceId]);
	const query = useQuery(options, queryClient);
	// File contents and the immediate drag preview stay local; native stores only panel identity.
	const draggedFiles = useRef(
		new Map<
			string,
			{ panel: DetachedFilePanel; pending: boolean; workspaceId: string }
		>(),
	);
	const mutation = useMutation(
		{
			mutationKey: ["workspace-panels", workspaceId],
			scope: { id: `workspace-panels:${workspaceId}` },
			mutationFn: async ({
				workspaceId,
				action,
			}: {
				workspaceId: string;
				action: PanelAction;
			}) => {
				await queryClient.ensureQueryData(panelQuery(workspaceId));
				const wireAction = { ...action };
				if (wireAction.type === "detachFile") delete wireAction.initialFile;
				return postJson<{
					session: WorkspacePanelSession;
					announcement: string | null;
				}>("/api/workspace/panels", { workspaceId, action: wireAction });
			},
			onSuccess: ({ session }, { workspaceId, action }) => {
				const file =
					"id" in action && action.id
						? draggedFiles.current.get(action.id)
						: undefined;
				if (file && action.type === "detachFile") file.pending = false;
				if (action.type === "closeFile") draggedFiles.current.delete(action.id);
				const panels = session.detachedFilePanels.map((panel) => ({
					...panel,
					initialFile: draggedFiles.current.get(panel.id)?.panel.initialFile,
				}));
				for (const entry of draggedFiles.current.values()) {
					if (
						entry.workspaceId === workspaceId &&
						entry.pending &&
						!panels.some((panel) => panel.id === entry.panel.id)
					)
						panels.push({
							...entry.panel,
							initialFile: entry.panel.initialFile,
						});
				}
				queryClient.setQueryData(panelQuery(workspaceId).queryKey, {
					...session,
					detachedFilePanels: panels,
				});
			},
		},
		queryClient,
	);
	const mutate = mutation.mutate;
	const update = useCallback(
		(action: PanelAction) => {
			if (action.type === "detachFile") {
				const panel = {
					id: action.id,
					cwd: action.cwd,
					path: action.path,
					initialFile: action.initialFile,
				};
				draggedFiles.current.set(action.id, {
					panel,
					pending: true,
					workspaceId,
				});
				queryClient.setQueryData<WorkspacePanelSession>(
					panelQuery(workspaceId).queryKey,
					(current) =>
						current
							? {
									...current,
									detachedFilePanels: [...current.detachedFilePanels, panel],
								}
							: current,
				);
			}
			mutate({ workspaceId, action });
		},
		[mutate, workspaceId],
	);
	const error = query.error
		? "Saved workspace panels could not be restored."
		: mutation.error
			? "Some workspace panel changes could not be saved."
			: null;
	return [
		query.data ?? emptyPanelSession,
		update,
		error,
		mutation.data?.announcement,
	] as const;
}

export let detachedFilePanelSequence = 0;

export function createDetachedFilePanelId() {
	detachedFilePanelSequence += 1;
	return `workspace-file-viewer:${Date.now()}:${detachedFilePanelSequence}`;
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
	const [
		panelSession,
		updatePanelSession,
		panelSessionError,
		panelAnnouncement,
	] = useWorkspacePanelSession(workspaceId);
	const {
		sidebarVisible,
		fileViewerOpen,
		fileViewerCwd,
		diffViewerCwd,
		focusedAuxiliaryPanel,
		detachedFilePanels,
		fileRequest,
		selectedFile,
		selectedCommitHash,
		selectedCommitIds,
		selectedCommitParent,
		mainViewMode,
	} = panelSession;
	const fileSource = selectedFile?.source;
	const commitSource = fileSource?.kind === "commit" ? fileSource : null;
	const comparisonSource =
		fileSource?.kind === "comparison" ? fileSource : null;

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
			staged: project?.files.filter((file) => file.staged) ?? [],
			modified:
				project?.files.filter((file) => !file.staged && file.status !== "?") ??
				[],
			untracked:
				project?.files.filter((file) => !file.staged && file.status === "?") ??
				[],
		}),
		[project],
	);
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

	const comparisonSelection = useMemo(
		() =>
			selectedGraphItems.map((item) => ({
				id: item.id,
				hash: item.hash,
				itemKind: item.itemKind,
				historyOrder: item.navigation?.historyOrder,
				worktreePath: item.worktreePath,
			})),
		[selectedGraphItems],
	);
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
		? selectedLinkedWorktreeStatus.files.filter((file) => file.staged)
		: staged;
	const sidebarModified = selectedLinkedWorktreeStatus
		? selectedLinkedWorktreeStatus.files.filter(
				(file) => !file.staged && file.status !== "?",
			)
		: modified;
	const sidebarUntracked = selectedLinkedWorktreeStatus
		? selectedLinkedWorktreeStatus.files.filter(
				(file) => !file.staged && file.status === "?",
			)
		: untracked;
	const selectedWorkingTreeCwd = selectedGraphWorktree?.path ?? activeCwd;
	const openSelectedWorktree = useCallback(() => {
		if (!selectedGraphWorktree || selectedGraphWorktree.isCurrent) return;
		updatePanelSession({
			type: "openGraph",
			cwd: selectedGraphWorktree.path,
			reset: true,
		});
	}, [selectedGraphWorktree, updatePanelSession]);
	const historicalCommitCwd =
		mainViewMode === "diff" && commitSource?.commitHash
			? (diffViewerCwd ?? undefined)
			: graphCwd;
	const historicalCommitHash =
		mainViewMode === "diff"
			? (commitSource?.commitHash ?? undefined)
			: selectedCommitIds.length <= 1 &&
					selectedGraphItem &&
					selectedGraphItem.itemKind !== "worktreeWip"
				? selectedGraphItem.hash
				: undefined;
	const historicalCommitParent =
		mainViewMode === "diff"
			? (commitSource?.commitParent ?? undefined)
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
	const comparisonDetailsState = useComparisonDetails(
		mainViewMode === "diff" ? (diffViewerCwd ?? undefined) : graphCwd,
		mainViewMode === "diff"
			? (comparisonSource?.comparisonFrom ?? undefined)
			: undefined,
		mainViewMode === "diff"
			? (comparisonSource?.comparisonTo ?? undefined)
			: undefined,
		historicalGraphRevision,
		mainViewMode === "graph" && selectedCommitIds.length > 1
			? comparisonSelection
			: undefined,
	);
	const comparisonFrom = comparisonDetailsState.plan?.from;
	const comparisonTo = comparisonDetailsState.plan?.to;
	const comparisonCwd = comparisonDetailsState.plan?.cwd;
	const selectGraphCommit = useCallback(
		(itemId: string | null, intent?: GraphSelectionIntent) => {
			const orderedItemIds = graph.commits.map((item) => item.id);
			updatePanelSession({
				type: "selectGraph",
				id: itemId,
				orderedIds: orderedItemIds,
				intent,
			});
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
	const { runGraphRefOperation, runGraphActionRequest } = useMemo(() => {
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
			if (!graphCwd)
				return failed("No Git repository selected", "invalidInput");
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
	}, [graphCwd, refetch, selectGraphCommit]);
	useEffect(() => {
		if (mainViewMode !== "graph" || graph.loading || !graph.commits.length)
			return;
		const visible = new Set(graph.commits.map((item) => item.id));
		if (
			panelSession.selectedCommitHash &&
			visible.has(panelSession.selectedCommitHash) &&
			panelSession.selectedCommitIds.length &&
			panelSession.selectedCommitIds.every((id) => visible.has(id))
		)
			return;
		updatePanelSession({
			type: "reconcileGraph",
			items: graph.commits.map(({ id, message }) => ({ id, message })),
		});
	}, [
		graph.commits,
		graph.loading,
		mainViewMode,
		panelSession,
		updatePanelSession,
	]);
	useEffect(() => {
		if (panelAnnouncement) setGraphSelectionAnnouncement(panelAnnouncement);
	}, [panelAnnouncement]);
	const keyboardFiles = useMemo(
		() => [
			...visibleGitFiles(
				[...modified, ...untracked],
				project?.filePresentation,
				fileViewMode,
			),
			...visibleGitFiles(staged, project?.filePresentation, fileViewMode),
		],
		[fileViewMode, modified, untracked, staged, project?.filePresentation],
	);
	const commitKeyboardFiles = useMemo(() => {
		const commitFiles = commitDetailsState.details?.files ?? [];
		return visibleGitFiles(
			commitFiles,
			commitDetailsState.details?.filePresentation,
			fileViewMode,
		);
	}, [commitDetailsState.details, fileViewMode]);
	const comparisonKeyboardFiles = useMemo(() => {
		const comparisonFiles = comparisonDetailsState.details?.files ?? [];
		return visibleGitFiles(
			comparisonFiles,
			comparisonDetailsState.details?.filePresentation,
			fileViewMode,
		);
	}, [comparisonDetailsState.details, fileViewMode]);
	const {
		commit,
		commitMessage,
		setCommitMessage,
		isCommitting,
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
						commitHash: commitSource?.commitHash ?? undefined,
						commitParent: commitSource?.commitParent ?? undefined,
						comparisonFrom: comparisonSource?.comparisonFrom ?? undefined,
						comparisonTo: comparisonSource?.comparisonTo ?? undefined,
						view: diffViewMode === "split" ? "full" : "review",
					}
				: null,
		[
			active,
			diffViewMode,
			diffViewerCwd,
			graph.revision,
			selectedFile,
			commitSource,
			comparisonSource,
		],
	);
	const {
		diff,
		error: diffError,
		loading: diffLoading,
	} = useGitDiff(diffRequest);

	useEffect(() => {
		if (!selectedFile || !diffViewerProject || commitSource || comparisonSource)
			return;
		const current =
			diffViewerProject.files.find(
				(file) =>
					file.path === selectedFile.path &&
					file.staged === selectedFile.staged,
			) ??
			diffViewerProject.files.find((file) => file.path === selectedFile.path);
		if (current && current.staged === selectedFile.staged) return;
		updatePanelSession({
			type: "reconcileFile",
			expected: selectedFile,
			staged: current?.staged ?? null,
		});
	}, [
		diffViewerProject,
		selectedFile,
		commitSource,
		comparisonSource,
		updatePanelSession,
	]);

	useEffect(() => {
		if (!active) return;
		setSidebarWidth(loadSidebarWidth());
	}, [active, workspaceId]);
	useEffect(() => {
		if (!active || !cwd || !gitLoaded || !projectMap.has(cwd)) return;
		if (!panelSession.repositoryInitialized || !diffViewerCwd)
			updatePanelSession({ type: "initialize", cwd });
	}, [
		active,
		cwd,
		gitLoaded,
		projectMap,
		panelSession.repositoryInitialized,
		diffViewerCwd,
		updatePanelSession,
	]);
	useEffect(() => {
		setDiffWidth(loadDiffWidth(workspaceId));
	}, [workspaceId]);
	useEffect(() => {
		if (!active) return;
		return listenWindowEvent(DOCUMENT_OPEN_EVENT, (event) => {
			const detail = (event as CustomEvent<DocumentOpenDetail>).detail;
			if (!detail?.cwd || !detail.path) return;
			updatePanelSession({
				type: "document",
				cwd: detail.cwd,
				path: detail.path,
			});
		});
	}, [active, updatePanelSession]);

	useEffect(
		() =>
			listenWindowEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT, () => {
				if (!active) return;
				updatePanelSession({ type: "toggleSidebar" });
			}),
		[active, updatePanelSession],
	);
	const setFileViewMode = useCallback((mode: "path" | "tree") => {
		setFileViewModeState(mode);
		saveGitFileViewMode(mode);
	}, []);
	const closeFileViewer = useCallback(() => {
		updatePanelSession({ type: "closeFile", id: "workspace-file-viewer" });
	}, [updatePanelSession]);
	const closeDiffViewer = useCallback(() => {
		updatePanelSession({ type: "dismissDiff" });
	}, [updatePanelSession]);
	const returnsToGraphOnClose = isGitWorkspaceGraphDrillIn(panelSession);
	const selectChangedFile = useCallback(
		(file: GitFileEntry) => {
			if (!selectedWorkingTreeCwd) return;
			updatePanelSession({
				type: "workingTreeFile",
				cwd: selectedWorkingTreeCwd,
				path: file.path,
				staged: file.staged,
			});
		},
		[selectedWorkingTreeCwd, updatePanelSession],
	);
	const selectCommitFile = useCallback(
		(file: CommitFile) => {
			const commitCwd = commitSource?.commitHash ? diffViewerCwd : activeCwd;
			const commitHash =
				commitSource?.commitHash ??
				(selectedGraphItem?.itemKind !== "worktreeWip"
					? selectedGraphItem?.hash
					: undefined);
			const commitParent = commitSource?.commitHash
				? commitSource?.commitParent
				: selectedCommitParent;
			if (!commitCwd || !commitHash) return;
			updatePanelSession({
				type: "commitFile",
				cwd: commitCwd,
				path: file.path,
				commitHash,
				commitParent,
			});
		},
		[
			activeCwd,
			diffViewerCwd,
			selectedCommitParent,
			commitSource,
			selectedGraphItem,
			updatePanelSession,
		],
	);
	const selectComparisonFile = useCallback(
		(file: CommitFile) => {
			const fileComparisonCwd = comparisonSource?.comparisonFrom
				? diffViewerCwd
				: comparisonCwd;
			const fileComparisonFrom =
				comparisonSource?.comparisonFrom ?? comparisonFrom;
			const fileComparisonTo = comparisonSource?.comparisonTo ?? comparisonTo;
			if (!fileComparisonCwd || !fileComparisonFrom || !fileComparisonTo)
				return;
			updatePanelSession({
				type: "comparisonFile",
				cwd: fileComparisonCwd,
				path: file.path,
				from: fileComparisonFrom,
				to: fileComparisonTo,
			});
		},
		[
			comparisonCwd,
			comparisonFrom,
			comparisonTo,
			diffViewerCwd,
			comparisonSource,
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
		const comparing = selectedCommitIds.length > 1;
		if (comparing ? comparisonDetailsState.loading : commitDetailsState.loading)
			return;
		setPendingGraphFileOpen(null);
		const files = comparing ? comparisonKeyboardFiles : commitKeyboardFiles;
		const firstFile =
			files.find((file) => file.path === selectedFile?.path) ?? files[0];
		if (firstFile)
			(comparing ? selectComparisonFile : selectCommitFile)(firstFile);
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
				updatePanelSession({ type: "openGraph", cwd: activeCwd });
				return;
			}
			updatePanelSession({ type: "mode", mode });
		},
		[activeCwd, updatePanelSession],
	);
	useEffect(
		() =>
			listenWindowEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT, () => {
				if (active) changeMainViewMode("graph");
			}),
		[active, changeMainViewMode],
	);
	const focusWorkbench = useCallback(
		(repositoryCwd?: string) => {
			if (!repositoryCwd || repositoryCwd === cwd)
				updatePanelSession({ type: "focusChat", cwd: repositoryCwd });
		},
		[cwd, updatePanelSession],
	);
	const focusDiffViewer = useCallback(() => {
		if (diffViewerCwd)
			updatePanelSession({
				type: "focus",
				panel: { id: "workspace-diff-viewer", cwd: diffViewerCwd },
			});
	}, [diffViewerCwd, updatePanelSession]);
	const cycleChangedFile = useCallback(
		(direction: -1 | 1) => {
			const next = adjacentGitFile(
				keyboardFiles,
				(file) =>
					file.path === selectedFile?.path &&
					file.staged === selectedFile?.staged,
				direction,
			);
			if (next) selectChangedFile(next);
		},
		[keyboardFiles, selectChangedFile, selectedFile],
	);
	const cycleHistoricalFile = useCallback(
		(direction: -1 | 1) => {
			const comparisonDiff = comparisonSource !== null;
			const historicalFiles = comparisonDiff
				? comparisonKeyboardFiles
				: commitKeyboardFiles;
			const nextFile = adjacentGitFile(
				historicalFiles,
				(file) => file.path === selectedFile?.path,
				direction,
			);
			if (!nextFile) return;
			if (comparisonDiff) selectComparisonFile(nextFile);
			else selectCommitFile(nextFile);
		},
		[
			commitKeyboardFiles,
			comparisonKeyboardFiles,
			selectCommitFile,
			selectComparisonFile,
			selectedFile,
			comparisonSource,
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
			const historical = isHistoricalGitWorkspaceDiff(panelSession);
			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault();
				(historical ? cycleHistoricalFile : cycleChangedFile)(
					event.key === "ArrowUp" ? -1 : 1,
				);
			} else if (
				!historical &&
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
		(
			event: PointerEvent & { currentTarget: HTMLButtonElement },
			isDiff = false,
		) => {
			if (event.button !== 0) return;
			event.preventDefault();
			if (isDiff) event.stopPropagation();
			const rail = event.currentTarget.parentElement;
			const minimum = isDiff ? MIN_DIFF_WIDTH : MIN_SIDEBAR_WIDTH;
			const maximum = isDiff
				? Math.max(
						MIN_DIFF_WIDTH,
						(rail?.parentElement?.getBoundingClientRect().width ??
							window.innerWidth) -
							(sidebarVisible ? sidebarWidth : 0) -
							MIN_RESPONSIVE_PANE_WIDTH,
					)
				: MAX_SIDEBAR_WIDTH;
			const startX = event.clientX;
			const startWidth = isDiff
				? (rail?.getBoundingClientRect().width ?? diffWidth)
				: sidebarWidth;
			let width = isDiff ? diffWidth : sidebarWidth;
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {}
			trackPointerResize(
				event.pointerId,
				(moveEvent) => {
					moveEvent.preventDefault();
					width = Math.min(
						maximum,
						Math.max(minimum, startWidth + startX - moveEvent.clientX),
					);
					if (rail) rail.style.width = `${width}px`;
				},
				() => {
					writeStoredValue(
						isDiff
							? `${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`
							: SIDEBAR_WIDTH_KEY,
						String(width),
					);
					if (isDiff) setDiffWidth(width);
					else setSidebarWidth(width);
				},
			);
		},
		[diffWidth, sidebarVisible, sidebarWidth, workspaceId],
	);

	const auxiliaryPanels = useMemo(() => {
		const startFileDrag = (
			drag: DragProps,
			event: PointerEvent,
			file: FileContentResponse,
			completeMove: () => void,
		) => {
			const id = createDetachedFilePanelId();
			drag.onCreatePanelDragStart(event, id, () => {
				updatePanelSession({
					type: "detachFile",
					id,
					cwd: file.cwd,
					path: file.path,
					initialFile: file,
				});
				completeMove();
			});
		};

		const panels: Array<{
			readonly id: string;
			readonly onSelect?: () => void;
			readonly render: (drag: DragProps) => unknown;
		}> = [];
		if (fileViewerOpen && fileViewerCwd) {
			panels.push({
				id: "workspace-file-viewer",
				onSelect: () =>
					updatePanelSession({
						type: "focus",
						panel: { id: "workspace-file-viewer", cwd: fileViewerCwd },
					}),
				render: (drag: DragProps) => (
					<DocumentViewer
						key={fileViewerCwd}
						cwd={fileViewerCwd}
						sessionId={`workspace-file-viewer:${workspaceId}:${fileViewerCwd}`}
						openRequest={fileRequest}
						onClose={closeFileViewer}
						onFileTabDragStart={startFileDrag.bind(null, drag)}
						{...drag}
					/>
				),
			});
		}
		for (const panel of detachedFilePanels) {
			panels.push({
				id: panel.id,
				onSelect: () =>
					updatePanelSession({
						type: "focus",
						panel: { id: panel.id, cwd: panel.cwd },
					}),
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
							updatePanelSession({ type: "closeFile", id: panel.id });
						}}
						onFileTabDragStart={startFileDrag.bind(null, drag)}
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
		updatePanelSession,
		workspaceId,
	]);

	const diffPanel =
		diffViewerCwd && (selectedFile || mainViewMode === "graph") ? (
			<WorkbenchDiffRail
				graph={mainViewMode === "graph"}
				zenMode={zenMode}
				width={diffWidth}
				maxWidth={`max(0px, calc(100% - ${MIN_RESPONSIVE_PANE_WIDTH + (sidebarVisible ? sidebarWidth : 0)}px))`}
				onFocus={focusDiffViewer}
				onResize={(event) => handleResizeStart(event, true)}
			>
				<ChatDiffPanel
					diff={diff}
					file={selectedFile}
					loading={diffLoading}
					error={diffError}
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
					startAtFirstChange={!commitSource && !comparisonSource}
					zenMode={zenMode}
					onToggleZenMode={toggleZenMode}
				/>
			</WorkbenchDiffRail>
		) : null;

	const sidebarContent = getGitWorkspaceSidebarContent(
		panelSession,
		selectedGraphItem?.itemKind === "worktreeWip",
	);
	const sidebar = (
		<WorkbenchSidebar
			visible={sidebarVisible}
			width={sidebarWidth}
			error={panelSessionError}
			onResize={handleResizeStart}
		>
			<ChangesPanel
				filePresentation={
					selectedLinkedWorktreeStatus?.filePresentation ??
					project?.filePresentation
				}
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
				showFileActions={!selectedLinkedWorktreeStatus}
				showCommitSection={!selectedLinkedWorktreeStatus}
			/>
		</WorkbenchSidebar>
	);

	return { auxiliaryPanels, diffPanel, focusWorkbench, sidebar, zenMode };
}
