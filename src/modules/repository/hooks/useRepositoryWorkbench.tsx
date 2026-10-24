import type {
	ChangesPanelProjection,
	DiffRequest,
	DiffViewMode,
	GitActionResponse,
	GitCommitFile,
	GitFileEntry,
	GitGraphActionRequest,
	GitRefOperationRequest,
	GraphCommit,
	GraphFileOpen,
	PanelAction,
	PanelSession,
	RepositoryPreferences,
} from "@contracts";
import {
	ChangesPanel,
	type ChangesPanelModel,
} from "@repository/components/changes/components/ChangesPanel/index.tsx";
import { DocumentViewer } from "@repository/components/documents/components/DocumentViewer/index.tsx";
import type { GraphSelectionIntent } from "@repository/components/graph/components/CommitGraph/index.tsx";
import {
	nextGitGraphHistoryLimit,
	useGraphPreferences,
} from "@repository/components/graph/components/CommitGraph/useCommitGraphState.tsx";
import {
	ChatDiffPanel,
	GitOperationFeedback,
} from "@repository/components/operations/ChatDiffPanel/index.tsx";
import { useGitOperations } from "@repository/components/operations/ChatDiffPanel/useGitOperations.tsx";
import { RepositoryToolbar } from "@repository/components/operations/ChatDiffPanel/ViewerHeader.tsx";
import {
	WorkbenchDiffRail,
	WorkbenchSidebar,
} from "@repository/components/RepositoryWorkbenchPanels/index.tsx";
import { useDiffPrefetch, useGitDiff } from "@repository/hooks/useGitDiff.tsx";
import {
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	type HistoricalQuery,
	useGitGraph,
	useHistoryDetails,
} from "@repository/hooks/useGitGraph.tsx";
import {
	useGitChangeActions,
	useGitStatus,
} from "@repository/hooks/useGitStatus.tsx";
import {
	checkoutGitBranch,
	runGitOperation,
} from "@repository/services/gitApi.ts";
import {
	DOCUMENT_OPEN_EVENT,
	type DocumentOpenDetail,
	GRAPH_KEYBOARD_EVENT,
	listenWindowEvent,
	OPEN_ACTIVE_GIT_GRAPH_EVENT,
	repositoryKeyboardInput,
	TOGGLE_ACTIVE_GIT_GRAPH_EVENT,
	TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT,
	type ToggleGitGraphDetail,
	type ToggleGitSidebarDetail,
} from "@shared/lib/dom.tsx";
import {
	adjacentGitFile,
	CLIENT_STORAGE_CHANGED_EVENT,
	getFileSelectionAfterToggle,
	isOnboardingRunning,
	onboardingChrome,
	readStoredValue,
	project as rustProject,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { useWorkspacePanelSession } from "@workspace/hooks/useWorkspacePanelSession.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	Show,
	untrack,
} from "solid-js";

const GIT_FILE_VIEW_MODE_STORAGE_KEY = "inferay-git-file-view-mode";
const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";

const EMPTY_FILES: GitFileEntry[] = [];

export function useRepositoryWorkbench(repositoryPath: Accessor<string>) {
	const [
		panelSession,
		updatePanelSession,
		panelSessionError,
		panelAnnouncement,
	] = useWorkspacePanelSession(repositoryPath);
	const fileSource = createMemo(() => panelSession().selectedFile?.source);
	const saveDocumentSession = (
		sessionId: string,
		session: PanelSession["documentSessions"][string],
	) =>
		updatePanelSession({
			type: "documents",
			sessionId,
			...session,
		});
	const readPreferences = () =>
		rustProject<RepositoryPreferences>("repositoryPreferences", {
			fileViewMode: readStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY),
			diffViewMode: readStoredValue(DIFF_VIEW_MODE_KEY),
		});
	const [fileViewMode, setFileViewModeState] = createSignal(
		() => readPreferences().fileViewMode,
	);
	onSettled(() =>
		listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
			const { key, value } =
				(event as CustomEvent<{ key?: string; value?: string | null }>)
					.detail ?? {};
			if (
				key === GIT_FILE_VIEW_MODE_STORAGE_KEY &&
				(value === "path" || value === "tree")
			)
				setFileViewModeState(value);
		}),
	);
	const [diffViewMode, setDiffViewModeState] = createSignal(
		() => readPreferences().diffViewMode,
	);
	const [graphActionError, setGraphActionError] = createSignal<string | null>(
		null,
	);
	const graphSelectionAnnouncement = createMemo<string>(
		(previous) => panelAnnouncement() || previous || "",
	);
	const [pendingGraphFileOpen, setPendingGraphFileOpen] = createSignal<
		string | null
	>(null);
	const setDiffViewMode = (mode: DiffViewMode) => {
		setDiffViewModeState(mode);
		writeStoredValue(DIFF_VIEW_MODE_KEY, mode);
	};
	const [panelsUnlocked, setPanelsUnlocked] = createSignal(false);
	const context = createMemo(() =>
		rustProject<{
			activeCwd: string | null;
			trackedCwds: string[];
			graphCwd: string | null;
			diffVisible: boolean;
			selectedFileVisible: boolean;
		}>("repositoryWorkbenchContext", {
			cwd: repositoryPath(),
			focusedCwd: panelSession().focusedAuxiliaryPanel?.cwd,
			fileViewerCwd: panelSession().fileViewerCwd,
			diffViewerCwd: panelSession().diffViewerCwd,
			detachedCwds: panelSession().detachedFilePanels.map((panel) => panel.cwd),
			mainViewMode: panelSession().mainViewMode,
			graphVisible:
				panelSession().graphVisible &&
				(panelsUnlocked() || onboardingChrome().graph !== false),
			hasSelectedFile: Boolean(panelSession().selectedFile),
			focusedPanelId: panelSession().focusedAuxiliaryPanel?.id,
		}),
	);
	const sidebarVisible = createMemo(
		() =>
			panelSession().sidebarVisible &&
			(panelsUnlocked() || onboardingChrome().changes !== false),
	);
	const activeCwd = createMemo(() => context().activeCwd ?? undefined);
	const trackedCwds = createMemo(() => context().trackedCwds, {
		equals: (before, after) =>
			before.length === after.length &&
			before.every((cwd, index) => cwd === after[index]),
	});
	// Start the requested graph immediately, while its panel transition settles.
	const [openingGraph, setOpeningGraph] = createSignal(true);
	onSettled(() => {
		const cwd = activeCwd();
		if (cwd) updatePanelSession({ type: "openGraph", cwd });
		setOpeningGraph(false);
	});
	const graphCwd = createMemo(() =>
		openingGraph() && onboardingChrome().graph !== false
			? activeCwd()
			: (context().graphCwd ?? undefined),
	);
	const [graphLimit, setGraphLimit] = createSignal(() => {
		graphCwd();
		return DEFAULT_GIT_GRAPH_HISTORY_LIMIT;
	});
	const [graphPreferences, setGraphPreferences] = useGraphPreferences(
		untrack(graphCwd),
	);
	const graph = useGitGraph(graphCwd, graphLimit, graphPreferences);
	const gitStatus = useGitStatus(
		() => trackedCwds(),
		() => ({
			enabled: trackedCwds().length > 0,
			graph: graphCwd() ? graph : undefined,
		}),
	);
	const project = createMemo(() => {
		const _activeCwdValue = activeCwd();
		return _activeCwdValue
			? (gitStatus.projectMap.get(_activeCwdValue) ?? null)
			: null;
	});
	const diffViewerProject = createMemo(() => {
		const _sourceValue3 = panelSession();
		return _sourceValue3.diffViewerCwd
			? (gitStatus.projectMap.get(_sourceValue3.diffViewerCwd) ?? null)
			: null;
	});
	const graphSelection = createMemo(
		() => {
			const { mainViewMode, selectedCommitHash, selectedCommitIds } =
				panelSession();
			return { mainViewMode, selectedCommitHash, selectedCommitIds };
		},
		{
			equals: (before, after) =>
				before.mainViewMode === after.mainViewMode &&
				before.selectedCommitHash === after.selectedCommitHash &&
				before.selectedCommitIds.length === after.selectedCommitIds.length &&
				before.selectedCommitIds.every(
					(id, index) => id === after.selectedCommitIds[index],
				),
		},
	);
	const graphItems = createMemo(
		() => new Map(graph.commits.map((item) => [item.id, item])),
	);
	const selectedGraph = createMemo<{
		cwd: string | undefined;
		items: GraphCommit[];
		item: GraphCommit | null;
	}>((previous) => {
		const cwd = graphCwd(),
			session = graphSelection();
		const retained = new Map(
			previous && previous.cwd === cwd
				? previous.items.map((item) => [item.id, item])
				: [],
		);
		if (previous && previous.cwd === cwd && previous.item)
			retained.set(previous.item.id, previous.item);
		const lookup = (id: string | null) =>
			id === null ? null : (graphItems().get(id) ?? retained.get(id) ?? null);
		return {
			cwd,
			items: session.selectedCommitIds.flatMap((id) => {
				const item = lookup(id);
				return item ? [item] : [];
			}),
			item: lookup(session.selectedCommitHash),
		};
	});
	const selectedGraphItems = createMemo(() => selectedGraph().items);
	const selectedGraphItem = createMemo(() => selectedGraph().item);
	const comparisonSelection = createMemo(() =>
		selectedGraphItems().map((item) => ({
			id: item.id,
			hash: item.hash,
			itemKind: item.itemKind,
			historyOrder: item.navigation?.historyOrder,
			worktreePath: item.worktreePath,
		})),
	);
	const selectedGraphWorktree = createMemo(() => {
		const item = selectedGraphItem();
		return panelSession().graphVisible && item?.itemKind === "worktreeWip"
			? (graph.worktrees.find((tree) => tree.path === item.worktreePath) ??
					null)
			: null;
	});
	const selectedLinkedWorktreeStatus = createMemo(() => {
		const _selectedGraphWorktreeValue = selectedGraphWorktree();
		return _selectedGraphWorktreeValue && !_selectedGraphWorktreeValue.isCurrent
			? _selectedGraphWorktreeValue.status
			: null;
	});
	const workingTreeFiles = createMemo(
		() =>
			selectedLinkedWorktreeStatus()?.files ?? project()?.files ?? EMPTY_FILES,
	);
	const workingTreePresentation = createMemo(
		() =>
			selectedLinkedWorktreeStatus()?.filePresentation ??
			project()?.filePresentation,
	);
	const selectedWorkingTreeCwd = createMemo(
		() => selectedGraphWorktree()?.path ?? activeCwd(),
	);
	const openSelectedWorktree = () => {
		const _selectedGraphWorktreeValue2 = selectedGraphWorktree();
		if (!_selectedGraphWorktreeValue2 || _selectedGraphWorktreeValue2.isCurrent)
			return;
		updatePanelSession({
			type: "openGraph",
			cwd: _selectedGraphWorktreeValue2.path,
			reset: true,
		});
	};
	const historicalInput = createMemo(
		() => {
			const session = panelSession();
			const item = selectedGraphItem();
			return {
				mainViewMode: session.mainViewMode,
				diffViewerCwd: session.diffViewerCwd,
				graphCwd: graphCwd(),
				graphRevision: graph.revision,
				diffRevision: diffViewerProject()?.revision,
				selectedCommitCount: session.selectedCommitIds.length,
				selectedCommitParent: session.selectedCommitParent,
				selectedCommitHash: item?.hash,
				selectedCommitKind: item?.itemKind,
				fileSource: fileSource(),
			};
		},
		{
			equals: (before, after) =>
				before.mainViewMode === after.mainViewMode &&
				before.diffViewerCwd === after.diffViewerCwd &&
				before.graphCwd === after.graphCwd &&
				before.graphRevision === after.graphRevision &&
				before.diffRevision === after.diffRevision &&
				before.selectedCommitCount === after.selectedCommitCount &&
				before.selectedCommitParent === after.selectedCommitParent &&
				before.selectedCommitHash === after.selectedCommitHash &&
				before.selectedCommitKind === after.selectedCommitKind &&
				before.fileSource === after.fileSource,
		},
	);
	const historical = createMemo(() =>
		rustProject<HistoricalQuery>("historicalQuery", historicalInput()),
	);
	const historyDetails = useHistoryDetails(historical, () => {
		const session = graphSelection();
		return session.mainViewMode === "graph" &&
			session.selectedCommitIds.length > 1
			? comparisonSelection()
			: undefined;
	});
	const selectGraphCommit = (
		itemId: string | null,
		intent?: GraphSelectionIntent,
	) => {
		const orderedItemIds = intent?.range
			? graph.commits.map((item) => item.id)
			: [];
		updatePanelSession({
			type: "selectGraph",
			id: itemId,
			orderedIds: orderedItemIds,
			intent,
		});
	};
	const checkoutGraphRef = async (branch: string) => {
		const _graphCwdValue3 = graphCwd();
		if (!_graphCwdValue3) return;
		setGraphActionError(null);
		try {
			const result = await checkoutGitBranch(_graphCwdValue3, branch);
			if (!result.ok) throw new Error(result.error ?? "Checkout failed");
			await gitStatus.refetch();
			selectGraphCommit(null);
		} catch (error) {
			setGraphActionError(
				error instanceof Error ? error.message : "Checkout failed",
			);
		}
	};
	const runGraphOperation = async (
		endpoint: string,
		operation: string,
		input: object,
		fallback: string,
	): Promise<GitActionResponse> => {
		const cwd = graphCwd() ?? activeCwd();
		try {
			if (!cwd) throw new Error("No Git repository selected");
			const result = await runGitOperation(cwd, endpoint, input);
			await gitStatus.refetch();
			if (result.selection) selectGraphCommit(result.selection.commit);
			return result;
		} catch (error) {
			return rustProject("gitActionFailure", {
				operation,
				error: error instanceof Error ? error.message : fallback,
				errorKind: cwd ? "commandFailed" : "invalidInput",
			});
		}
	};
	const runGraphRefOperation = (input: GitRefOperationRequest) =>
		runGraphOperation(
			"ref-operation",
			input.operation,
			input,
			"Git operation failed",
		);
	const runGraphActionRequest = (input: GitGraphActionRequest) =>
		runGraphOperation("graph-action", input.action, input, "Git action failed");
	createEffect(
		() => ({
			commits: graph.commits,
			loading: graph.loading,
			session: graphSelection(),
		}),
		({ commits, loading, session }) => {
			if (session.mainViewMode !== "graph" || loading || !commits.length)
				return;
			const visible = graphItems();
			if (
				session.selectedCommitHash &&
				visible.has(session.selectedCommitHash) &&
				session.selectedCommitIds.length &&
				session.selectedCommitIds.every((id) => visible.has(id))
			)
				return;
			updatePanelSession({
				type: "reconcileGraph",
				items: commits.map(({ id, message }) => ({ id, message })),
			});
		},
	);
	// Panel snapshots also change on file selection, focus, and persistence.
	// Only these fields can change file ordering or the history summary.
	const changesSelection = createMemo(
		() => ({
			content: panelSession().sidebarContent,
			selectedCommitHash: panelSession().selectedCommitHash,
			selectedCommitCount: panelSession().selectedCommitIds.length,
		}),
		{
			equals: (before, after) =>
				before.content === after.content &&
				before.selectedCommitHash === after.selectedCommitHash &&
				before.selectedCommitCount === after.selectedCommitCount,
		},
	);
	const changesModel = createMemo<ChangesPanelModel>(() => {
		const files = workingTreeFiles();
		const { commit, comparison } = historyDetails.data;
		const history = comparison ?? commit;
		const model = rustProject<ChangesPanelProjection>("changesPanel", {
			files,
			filePresentation: workingTreePresentation(),
			fileViewMode: fileViewMode(),
			...changesSelection(),
			historyLoading: historyDetails.loading,
			historyFiles: history?.files,
			historyFilePresentation: history?.filePresentation,
			commitDetailsError: historyDetails.error,
		});
		return {
			...model,
			unstagedFiles: model.unstagedFiles.map((index) => files[index]!),
			stagedFiles: model.stagedFiles.map((index) => files[index]!),
			navigableFiles: model.navigableFiles.map((index) => files[index]!),
			historyDetails:
				model.historyDetails === "comparison"
					? comparison
					: model.historyDetails === "commit"
						? commit
						: null,
			navigableHistoricalFiles: model.navigableHistoricalFiles.map(
				(index) => history!.files[index]!,
			),
		};
	});
	const changeActions = useGitChangeActions(() => ({
		cwd: activeCwd(),
		refetchStatus: gitStatus.refetch,
	}));
	const diffRequest = createMemo(() => {
		const _sourceValue7 = panelSession();
		return rustProject<DiffRequest | null>("diffRequest", {
			active: true,
			cwd: _sourceValue7.diffViewerCwd,
			selectedFile: _sourceValue7.selectedFile,
			revision: diffViewerProject()?.revision,
			fileSource: fileSource(),
			viewMode: diffViewMode(),
		});
	});
	const prefetchDiffs = useDiffPrefetch();
	const prefetchContext = createMemo(() => ({
		active: sidebarVisible(),
		cwd: selectedWorkingTreeCwd(),
		revision: gitStatus.projectMap.get(selectedWorkingTreeCwd() ?? "")
			?.revision,
		viewMode: diffViewMode(),
	}));
	const prefetchFiles = createMemo(() => {
		const context = prefetchContext();
		return (files: GitFileEntry[]) =>
			prefetchDiffs(
				context.active
					? files.flatMap((file) => {
							const request = rustProject<DiffRequest | null>("diffRequest", {
								...context,
								selectedFile: file,
							});
							return request ? [request] : [];
						})
					: [],
			);
	});

	const fileDiff = useGitDiff(() => diffRequest());
	createEffect(
		() => ({
			project: diffViewerProject(),
			file: panelSession().selectedFile,
			historical: historical(),
		}),
		({ project, file, historical }) => {
			if (
				!file ||
				!project ||
				historical.commitSource ||
				historical.comparisonSource
			)
				return;
			const current =
				project.files.find(
					(item) => item.path === file.path && item.staged === file.staged,
				) ?? project.files.find((item) => item.path === file.path);
			if (current && current.staged === file.staged) return;
			updatePanelSession({
				type: "reconcileFile",
				expected: file,
				staged: current?.staged ?? null,
			});
		},
	);
	createEffect(
		() => {
			const cwd = repositoryPath();
			return cwd &&
				gitStatus.loaded &&
				gitStatus.projectMap.has(cwd) &&
				(!panelSession().repositoryInitialized || !panelSession().diffViewerCwd)
				? cwd
				: null;
		},
		(cwd) => {
			if (cwd)
				updatePanelSession({
					type: "initialize",
					cwd,
					reveal: !isOnboardingRunning(),
				});
		},
	);
	const setFileViewMode = (mode: "path" | "tree") => {
		setFileViewModeState(mode);
		writeStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY, mode);
	};
	const closeFileViewer = () => {
		updatePanelSession({
			type: "closeFile",
			id: "workspace-file-viewer",
		});
	};
	let sidebarElement: HTMLElement | undefined;
	let diffRailElement: HTMLElement | undefined;
	const focusCommitGraph = () =>
		requestAnimationFrame(() => {
			if (panelSession().mainViewMode !== "graph") return;
			diffRailElement
				?.querySelector<HTMLElement>('[aria-label="Repository commit history"]')
				?.focus({ preventScroll: true });
		});
	const closeDiffViewer = () => {
		updatePanelSession({
			type: "dismissDiff",
		});
		if (!panelSession().graphVisible)
			sidebarElement?.focus({ preventScroll: true });
		else focusCommitGraph();
	};
	const returnsToGraphOnClose = createMemo(() => panelSession().graphDrillIn);
	const fileSelectionContext = createMemo(() => ({
		commitSource: historical().commitSource,
		comparisonSource: historical().comparisonSource,
		diffViewerCwd: panelSession().diffViewerCwd,
		selectedCommitParent: panelSession().selectedCommitParent,
		activeCwd: activeCwd(),
		workingTreeCwd: selectedWorkingTreeCwd(),
		selectedGraphItem: {
			hash: selectedGraphItem()?.hash,
			itemKind: selectedGraphItem()?.itemKind,
		},
		comparisonPlan: historyDetails.data.plan,
	}));
	const selectFile = (
		kind: "workingTree" | "commit" | "comparison",
		file: GitFileEntry | GitCommitFile,
	) => {
		const action = rustProject<PanelAction | null>("repositoryFileSelection", {
			...fileSelectionContext(),
			kind,
			file,
		});
		if (action) updatePanelSession(action);
	};
	const selectChangedFile = selectFile.bind(null, "workingTree");
	const selectCommitFile = selectFile.bind(null, "commit");
	const selectComparisonFile = selectFile.bind(null, "comparison");
	createEffect(
		() => {
			const request = pendingGraphFileOpen();
			if (!request) return null;
			const session = panelSession();
			return rustProject<GraphFileOpen>("graphFileOpen", {
				...fileSelectionContext(),
				request,
				mainViewMode: session.mainViewMode,
				selectedCommitHash: session.selectedCommitHash,
				selectedCommitCount: session.selectedCommitIds.length,
				selectedFile: session.selectedFile,
				loading: historyDetails.loading,
				file: (selectedGraphItem()?.itemKind === "worktreeWip"
					? changesModel().navigableFiles
					: changesModel().navigableHistoricalFiles)[0],
			});
		},
		(result) => {
			if (!result?.ready) return;
			setPendingGraphFileOpen(null);
			if (result.action) untrack(() => updatePanelSession(result.action!));
		},
	);
	const changeMainViewMode = (mode: "diff" | "graph") => {
		const action = rustProject<PanelAction | null>("repositoryInteraction", {
			type: "mode",
			mode,
			activeCwd: activeCwd(),
		});
		if (action) updatePanelSession(action);
	};
	const focusDiffViewer = () => {
		const action = rustProject<PanelAction | null>("repositoryInteraction", {
			type: "focusDiff",
			diffViewerCwd: panelSession().diffViewerCwd,
		});
		if (action) updatePanelSession(action);
	};
	const navigation = (sidebar = false) => {
		const session = panelSession();
		const graph = sidebar || session.mainViewMode === "graph";
		const workingTree = graph
			? session.sidebarContent === "workingTree"
			: !session.historicalDiff;
		const kind = workingTree
			? "workingTree"
			: (
						graph
							? session.selectedCommitIds.length > 1
							: historical().comparisonSource !== null
				  )
				? "comparison"
				: "commit";
		return {
			kind,
			files: workingTree
				? changesModel().navigableFiles
				: changesModel().navigableHistoricalFiles,
			matches: (file: GitFileEntry | GitCommitFile) =>
				file.path === session.selectedFile?.path &&
				(!workingTree ||
					("staged" in file && file.staged === session.selectedFile?.staged)),
		} as const;
	};
	const cycleFile = (direction: -1 | 1) => {
		const { kind, files, matches } = navigation();
		const next = adjacentGitFile(files, matches, direction);
		if (next) selectFile(kind, next);
	};
	const handleDiffKeyboardNavigation = (event: KeyboardEvent) => {
		const session = panelSession();
		const target = event.target as HTMLElement;
		const action = rustProject<
			| {
					type:
						| "close"
						| "closeGraph"
						| "open"
						| "enterSidebar"
						| "focusGraph"
						| "navigateGraph";
			  }
			| { type: "cycle" | "scrollDiff"; direction: -1 | 1 }
			| { type: "toggle" }
			| null
		>("repositoryKeyboardAction", {
			...repositoryKeyboardInput(event),
			graphFocused: Boolean(
				target.closest('[aria-label="Repository commit history"]'),
			),
			focusedPanelId: session.focusedAuxiliaryPanel?.id,
			repositoryTabFocused: Boolean(target.closest("[data-repository-tab]")),
			sidebarFocused: sidebarElement?.contains(target) ?? false,
			chatFocused: Boolean(target.closest("[data-chat-pane-id]")),
			windowFocused: target === document.body,
			emptyComposer:
				target instanceof HTMLTextAreaElement &&
				target.hasAttribute("data-chat-composer") &&
				target.value.length === 0,
			mainViewMode: session.mainViewMode,
			graphVisible: session.graphVisible,
			sidebarVisible: session.sidebarVisible,
			historical: session.historicalDiff,
			workingTree: session.sidebarContent === "workingTree",
			hasFile: Boolean(session.selectedFile),
		});
		if (!action) return;
		if (action.type === "navigateGraph") {
			diffRailElement
				?.querySelector<HTMLElement>('[aria-label="Repository commit history"]')
				?.dispatchEvent(
					new CustomEvent(GRAPH_KEYBOARD_EVENT, { detail: event }),
				);
			return;
		}
		event.preventDefault();
		if (action.type === "enterSidebar") {
			const { kind, files, matches } = navigation(true);
			const first = files.find(matches) ?? files[0];
			if (!first) return;
			// Focus the mounted sidebar before selection renders the diff and file rows.
			sidebarElement?.focus({ preventScroll: true });
			selectFile(kind, first);
		} else if (action.type === "focusGraph") {
			const cwd = session.diffViewerCwd ?? activeCwd();
			if (cwd) {
				updatePanelSession({ type: "openGraph", cwd });
				focusCommitGraph();
			}
		} else if (action.type === "closeGraph") {
			const cwd = graphCwd();
			if (cwd) updatePanelSession({ type: "toggleGraph", cwd });
			if (session.sidebarVisible)
				sidebarElement?.focus({ preventScroll: true });
		} else if (action.type === "close") closeDiffViewer();
		else if (action.type === "open") changeMainViewMode("diff");
		else if (action.type === "cycle") cycleFile(action.direction);
		else if (action.type === "scrollDiff") {
			const scroller =
				diffRailElement?.querySelector<HTMLElement>(
					'[data-diff-scroll-side="right"]',
				) ??
				diffRailElement?.querySelector<HTMLElement>("[data-diff-scroll-side]");
			scroller?.scrollBy({
				top: action.direction * scroller.clientHeight * 0.9,
			});
		} else if (session.selectedFile) {
			const nextSelection = getFileSelectionAfterToggle(
				changesModel().navigableFiles,
				session.selectedFile,
			);
			if (session.selectedFile.staged)
				changeActions.unstageFile(session.selectedFile.path);
			else changeActions.stageFile(session.selectedFile.path);
			if (nextSelection) selectChangedFile(nextSelection);
		}
	};
	onSettled(() => {
		const cleanup = [
			listenWindowEvent("keydown", handleDiffKeyboardNavigation),
			listenWindowEvent(DOCUMENT_OPEN_EVENT, (event) => {
				const detail = (event as CustomEvent<DocumentOpenDetail>).detail;
				if (detail?.cwd && detail.path)
					updatePanelSession({
						type: "document",
						cwd: detail.cwd,
						path: detail.path,
					});
			}),
			listenWindowEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT, (event) => {
				const requested = (event as CustomEvent<ToggleGitSidebarDetail>).detail
					?.visible;
				if (requested === undefined) setPanelsUnlocked(true);
				if (requested === panelSession().sidebarVisible) return;
				updatePanelSession({ type: "toggleSidebar" });
			}),
			listenWindowEvent(TOGGLE_ACTIVE_GIT_GRAPH_EVENT, (event) => {
				const cwd = activeCwd();
				if (!cwd) return;
				const session = panelSession();
				const requested = (event as CustomEvent<ToggleGitGraphDetail>).detail
					?.visible;
				if (requested === undefined) setPanelsUnlocked(true);
				if (
					requested ===
					(session.mainViewMode === "graph" && session.graphVisible)
				)
					return;
				updatePanelSession({ type: "toggleGraph", cwd });
			}),
			listenWindowEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT, () => {
				setPanelsUnlocked(true);
				changeMainViewMode("graph");
			}),
		];
		return () => cleanup.forEach((remove) => remove());
	});
	const renderAuxiliaryPanel = (id: string) => {
		if (id === "workspace-file-viewer")
			return (
				<DocumentViewer
					cwd={panelSession().fileViewerCwd!}
					sessionId={`workspace-file-viewer:${repositoryPath()}:${panelSession().fileViewerCwd}`}
					workspaceId={repositoryPath()}
					onSessionChange={saveDocumentSession}
					openRequest={panelSession().fileRequest}
					onClose={closeFileViewer}
				/>
			);
		const panel = createMemo(() =>
			panelSession().detachedFilePanels.find((panel) => panel.id === id),
		);
		const retained = createMemo<
			PanelSession["detachedFilePanels"][number] | undefined
		>((previous) => panel() ?? previous);
		const openRequest = createMemo(() => {
			const value = retained();
			return value ? { path: value.path, token: 0 } : null;
		});
		return (
			<Show when={panel()}>
				{(_value) => (
					<DocumentViewer
						cwd={retained()?.cwd ?? ""}
						sessionId={id}
						workspaceId={repositoryPath()}
						onSessionChange={saveDocumentSession}
						openRequest={openRequest()}
						onClose={() => updatePanelSession({ type: "closeFile", id })}
					/>
				)}
			</Show>
		);
	};
	const auxiliaryPanels = createMemo(() => {
		const session = panelSession();
		const panels = session.detachedFilePanels.map((panel) => ({
			id: panel.id,
			cwd: panel.cwd,
		}));
		if (session.fileViewerOpen && session.fileViewerCwd)
			panels.unshift({
				id: "workspace-file-viewer",
				cwd: session.fileViewerCwd,
			});
		return panels.map((panel) => ({
			id: panel.id,
			onSelect: () => updatePanelSession({ type: "focus", panel }),
			render: () => renderAuxiliaryPanel(panel.id),
		}));
	});
	const operations = useGitOperations(() => ({
		repositoryKey: graphCwd() ?? activeCwd(),
		graph,
		onRunRefOperation: runGraphRefOperation,
		onRunGraphAction: runGraphActionRequest,
	}));
	const diffPanel = (
		<>
			{context().diffVisible ? (
				<WorkbenchDiffRail
					ref={(element) => {
						diffRailElement = element;
					}}
					onFocus={focusDiffViewer}
				>
					<ChatDiffPanel
						diff={fileDiff.diff}
						file={panelSession().selectedFile}
						loading={fileDiff.loading}
						error={fileDiff.error}
						mainViewMode={panelSession().mainViewMode}
						onMainViewModeChange={changeMainViewMode}
						graph={graph}
						graphView={{
							preferences: graphPreferences(),
							onPreferencesChange: setGraphPreferences,
							selectedHash: panelSession().selectedCommitHash ?? undefined,
							selectedIds: panelSession().selectedCommitIds,
							onSelect: selectGraphCommit,
							onOpenSelection: setPendingGraphFileOpen,
							onCheckoutRef: checkoutGraphRef,
							onLoadMore: () => setGraphLimit(nextGitGraphHistoryLimit),
						}}
						graphError={graphActionError() ?? graph.error}
						selectionAnnouncement={graphSelectionAnnouncement()}
						repositoryKey={graphCwd()}
						operations={operations}
						branch={project()?.branch}
						onClose={closeDiffViewer}
						closeLabel={
							returnsToGraphOnClose()
								? "Back to commit graph"
								: "Close change viewer"
						}
						viewMode={diffViewMode()}
						onViewModeChange={setDiffViewMode}
						startAtFirstChange={
							!historical().commitSource && !historical().comparisonSource
						}
					/>
				</WorkbenchDiffRail>
			) : null}
		</>
	);
	const sidebar = (
		<>
			{
				<WorkbenchSidebar
					ref={(element) => {
						sidebarElement = element;
					}}
					onFocus={focusDiffViewer}
					visible={sidebarVisible()}
				>
					<ChangesPanel
						actions={changeActions}
						onPrefetchFiles={prefetchFiles()}
						filePresentation={workingTreePresentation()}
						cwd={selectedWorkingTreeCwd()}
						fileViewMode={fileViewMode()}
						onFileViewModeChange={setFileViewMode}
						model={changesModel()}
						selectedFile={
							context().selectedFileVisible ? panelSession().selectedFile : null
						}
						onSelectFile={selectChangedFile}
						hasProject={!!project() || !!selectedLinkedWorktreeStatus()}
						projectLoading={!!activeCwd() && !gitStatus.loaded}
						selectedCommitCount={panelSession().selectedCommitIds.length}
						selectedWorktreePath={selectedGraphWorktree()?.path}
						onOpenWorktree={
							selectedGraphWorktree() && !selectedGraphWorktree()!.isCurrent
								? openSelectedWorktree
								: undefined
						}
						onSelectCommitFile={selectCommitFile}
						onSelectComparisonFile={selectComparisonFile}
						showFileActions={!selectedLinkedWorktreeStatus()}
						showCommitSection={!selectedLinkedWorktreeStatus()}
					/>
				</WorkbenchSidebar>
			}
		</>
	);
	return {
		get auxiliaryPanels() {
			return auxiliaryPanels();
		},
		diffPanel,
		toolbar: (
			<RepositoryToolbar
				branch={project()?.branch}
				operations={operations}
				actions={graph.actions}
			/>
		),
		operationFeedback: (
			<GitOperationFeedback
				operations={operations}
				returnFocus={() =>
					diffRailElement?.querySelector<HTMLElement>(
						'[aria-label="Repository commit history"]',
					) ?? sidebarElement
				}
			/>
		),
		sidebar,
		sidebarVisible,
		error: panelSessionError,
		graphVisible: () =>
			panelSession().mainViewMode === "graph" && context().diffVisible,
	};
}
