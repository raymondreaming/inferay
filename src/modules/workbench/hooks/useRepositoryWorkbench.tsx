import { useQuery } from "@octanejs/tanstack-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { postJson } from "../../../adapters/backend/http.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../../adapters/storage/sync.ts";
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
import type {
	GitFileEntry,
	GitInteractiveRebaseStep,
} from "../../../modules/repository/model/types.ts";
import { lockPointerSelection } from "../../../shared/lib/pointer-selection-lock.ts";
import { queryClient } from "../../../shared/lib/query-client.ts";
import { listenWindowEvent } from "../../../shared/lib/react-events.ts";
import type { DiffRequest } from "../../repository/model/types.ts";
import {
	ChangesPanel,
	getFileSelectionAfterToggle,
	type SelectedFile,
	visibleGitFiles,
} from "../changes/components/ChangesPanel/index.tsx";
import type {
	DragProps,
	GitGraphActionResult,
	GitRefOperationResult,
} from "../components/ChatDiffPanel/index.tsx";
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
import {
	OPEN_ACTIVE_GIT_GRAPH_EVENT,
	TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT,
} from "../model/workbench-events.ts";
import { MIN_RESPONSIVE_PANE_WIDTH } from "../model/workbench-layout.ts";
import {
	bindGitGraphRepository,
	dismissGitWorkspaceViewer,
	emptyGitWorkspacePanelSession,
	type GitWorkspaceDetachedFilePanel,
	type GitWorkspacePanelSession,
	getGitWorkspaceSidebarContent,
	initializeGitRepositoryPanels,
	isGitWorkspaceGraphDrillIn,
	isHistoricalGitWorkspaceDiff,
	openGitCommitFileDiff,
	openGitComparisonFileDiff,
	openGitGraph,
	openGitWorkingTreeFileDiff,
	reconcileGitGraphSelection,
	updateGitGraphSelection,
} from "../model/workbench-model.ts";
import {
	GIT_FILE_VIEW_MODE_STORAGE_KEY,
	loadGitFileViewMode,
	saveGitFileViewMode,
} from "../model/workbench-preferences.ts";

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

export type StateValue<T> = T | ((current: T) => T);

export const emptyPanelSession =
	emptyGitWorkspacePanelSession<FileContentResponse>();

export function resolveStateValue<T>(value: StateValue<T>, current: T): T {
	return typeof value === "function"
		? (value as (current: T) => T)(current)
		: value;
}

export function useWorkspacePanelSession(workspaceId: string) {
	const [saveError, setSaveError] = useState<{
		workspaceId: string;
		message: string;
	} | null>(null);
	const pending = useRef<Promise<unknown>>(Promise.resolve());
	const options = useMemo(
		() => ({
			queryKey: ["workspace-panels", workspaceId],
			queryFn: async () => {
				const { session } = await postJson<{ session: WorkspacePanelSession }>(
					"/api/workspace/panels",
					{
						workspaceId,
					},
				);
				return session;
			},
			staleTime: Infinity,
			gcTime: 30 * 60 * 1000,
		}),
		[workspaceId],
	);
	const query = useQuery(options, queryClient);
	const update = useCallback(
		(change: (current: WorkspacePanelSession) => WorkspacePanelSession) => {
			const apply = (current: WorkspacePanelSession) => {
				const next = change(current);
				if (next === current) return;
				queryClient.setQueryData(options.queryKey, next);
				const patch = Object.fromEntries(
					Object.entries(next).filter(
						([key, value]) =>
							value !== current[key as keyof WorkspacePanelSession],
					),
				);
				if (patch.detachedFilePanels) {
					patch.detachedFilePanels = next.detachedFilePanels.map(
						({ id, cwd, path }) => ({ id, cwd, path }),
					);
				}
				pending.current = pending.current
					.catch(() => undefined)
					.then(async () => {
						await postJson("/api/workspace/panels", { workspaceId, patch });
					})
					.catch((error) => {
						console.error("Could not save workspace panels", error);
						setSaveError({
							workspaceId,
							message: "Some workspace panel changes could not be saved.",
						});
					});
			};
			const current = queryClient.getQueryData<WorkspacePanelSession>(
				options.queryKey,
			);
			if (current) apply(current);
			else
				void queryClient
					.ensureQueryData(options)
					.then(() => {
						const restored = queryClient.getQueryData<WorkspacePanelSession>(
							options.queryKey,
						);
						if (restored) apply(restored);
					})
					.catch((error) =>
						console.error("Could not restore workspace panels", error),
					);
		},
		[options, workspaceId],
	);
	const error = query.error
		? "Saved workspace panels could not be restored."
		: saveError?.workspaceId === workspaceId
			? saveError.message
			: null;
	return [query.data ?? emptyPanelSession, update, error] as const;
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
	const [panelSession, updatePanelSession, panelSessionError] =
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
	const comparisonDetailsState = useComparisonDetails(
		mainViewMode === "diff" ? (diffViewerCwd ?? undefined) : graphCwd,
		mainViewMode === "diff"
			? (selectedFileComparisonFrom ?? undefined)
			: undefined,
		mainViewMode === "diff"
			? (selectedFileComparisonTo ?? undefined)
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
					operation: request.action,
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
					operation: request.action,
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
		const current =
			diffViewerProject.files.find(
				(file) =>
					file.path === selectedFile.path &&
					file.staged === selectedFile.staged,
			) ??
			diffViewerProject.files.find((file) => file.path === selectedFile.path);
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
		const startFileDrag = (
			drag: DragProps,
			event: PointerEvent,
			file: FileContentResponse,
			completeMove: () => void,
		) => {
			const id = createDetachedFilePanelId();
			drag.onCreatePanelDragStart(event, id, () => {
				setDetachedFilePanels((current) => [
					...current,
					{ id, cwd: file.cwd, path: file.path, initialFile: file },
				]);
				setFocusedAuxiliaryPanel({ id, cwd: file.cwd });
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
		setDetachedFilePanels,
		setFocusedAuxiliaryPanel,
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
				onResize={handleDiffResizeStart}
			>
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
				amendMode={amendMode}
				onAmendModeChange={setAmendMode}
				showFileActions={!selectedLinkedWorktreeStatus}
				showCommitSection={!selectedLinkedWorktreeStatus}
			/>
		</WorkbenchSidebar>
	);

	return { auxiliaryPanels, diffPanel, focusWorkbench, sidebar, zenMode };
}
