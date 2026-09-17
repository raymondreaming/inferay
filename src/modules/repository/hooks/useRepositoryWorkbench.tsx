import type {
	DiffRequest,
	DiffSource,
	DiffViewMode,
	FileContent,
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
	RetainedGraphSelection,
} from "@contracts";
import { ChangesPanel } from "@repository/components/changes/components/ChangesPanel/index.tsx";
import { DocumentViewer } from "@repository/components/documents/components/DocumentViewer/index.tsx";
import type { GraphSelectionIntent } from "@repository/components/graph/components/CommitGraph/index.tsx";
import {
	nextGitGraphHistoryLimit,
	useGraphPreferences,
} from "@repository/components/graph/components/CommitGraph/useCommitGraphState.tsx";
import { ChatDiffPanel } from "@repository/components/operations/ChatDiffPanel/index.tsx";
import {
	WorkbenchDiffRail,
	WorkbenchSidebar,
} from "@repository/components/RepositoryWorkbenchPanels/index.tsx";
import { useDiffPrefetch, useGitDiff } from "@repository/hooks/useGitDiff.tsx";
import {
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	useCommitDetails,
	useComparisonDetails,
	useGitGraph,
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
	createPointerResize,
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
	visibleGitFiles,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import type { DragProps } from "@workspace/components/WorkspaceCanvas/index.tsx";
import { MIN_RESPONSIVE_PANE_WIDTH } from "@workspace/components/WorkspaceCanvas/index.tsx";
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
const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";
const DIFF_WIDTH_KEY = "agent-workspace-diff-width";
const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";

const EMPTY_FILE_GROUPS = {
	staged: [],
	modified: [],
	untracked: [],
};

export let detachedFilePanelSequence = 0;
export function createDetachedFilePanelId() {
	detachedFilePanelSequence += 1;
	return `workspace-file-viewer:${Date.now()}:${detachedFilePanelSequence}`;
}
export function useRepositoryWorkbench(
	_options: Accessor<{
		readonly active: boolean;
		readonly cwd?: string;
		readonly workspaceId: string;
	}>,
) {
	const [
		panelSession,
		updatePanelSession,
		panelSessionError,
		panelAnnouncement,
	] = useWorkspacePanelSession(() => _options().workspaceId);
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
			sidebarWidth: readStoredValue(SIDEBAR_WIDTH_KEY),
			diffWidth:
				readStoredValue(DIFF_WIDTH_KEY) ??
				readStoredValue(`${DIFF_WIDTH_KEY}:${_options().workspaceId}`),
		});
	const [fileViewMode, setFileViewModeState] = createSignal(
		() => readPreferences().fileViewMode,
	);
	const [sidebarWidth, setSidebarWidth] = createSignal(() => {
		void _options().active;
		void _options().workspaceId;
		return readPreferences().sidebarWidth;
	});
	const [diffWidth, setDiffWidth] = createSignal(
		untrack(() => readPreferences().diffWidth),
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
			if (key === DIFF_WIDTH_KEY) setDiffWidth(readPreferences().diffWidth);
			if (key === SIDEBAR_WIDTH_KEY)
				setSidebarWidth(readPreferences().sidebarWidth);
		}),
	);
	const [diffViewMode, setDiffViewModeState] = createSignal(
		() => readPreferences().diffViewMode,
	);
	const [zenMode, setZenMode] = createSignal(false);
	createEffect(
		() => panelSession().graphVisible,
		(visible) => {
			if (!visible) setZenMode(false);
		},
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
	const trackResize = createPointerResize();
	const toggleZenMode = () => setZenMode((current) => !current);
	createEffect(
		() => _options().active && zenMode(),
		(enabled) => {
			if (!enabled) return;
			return listenWindowEvent("keydown", (event) => {
				if ((event as KeyboardEvent).key !== "Escape") return;
				(event as KeyboardEvent).preventDefault();
				setZenMode(false);
			});
		},
	);
	const [panelsUnlocked, setPanelsUnlocked] = createSignal(false);
	const context = createMemo(() =>
		rustProject<{
			activeCwd: string | null;
			trackedCwds: string[];
			graphCwd: string | null;
			diffVisible: boolean;
			selectedFileVisible: boolean;
		}>("repositoryWorkbenchContext", {
			cwd: _options().cwd,
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
	const activeCwd = () => context().activeCwd ?? undefined;
	const trackedCwds = () => context().trackedCwds;
	const graphCwd = () => context().graphCwd ?? undefined;
	const [graphLimit, setGraphLimit] = createSignal(() => {
		graphCwd();
		return DEFAULT_GIT_GRAPH_HISTORY_LIMIT;
	});
	const [graphPreferences, setGraphPreferences] = useGraphPreferences(
		untrack(graphCwd),
	);
	const graph = useGitGraph(
		() => graphCwd(),
		() => graphLimit(),
		() => graphPreferences(),
		() => _options().active,
	);
	const gitStatus = useGitStatus(
		() => trackedCwds(),
		() => ({
			enabled: _options().active && trackedCwds().length > 0,
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
	const fileGroups = createMemo(
		() => project()?.fileGroups ?? EMPTY_FILE_GROUPS,
	);
	const graphRevisions = new Map<string, string>();
	createEffect(
		() => [graphCwd(), graph.revision] as const,
		([cwd, revision]) => {
			if (cwd && revision) {
				graphRevisions.set(cwd, revision);
			}
		},
	);
	const selectedGraph = createMemo<{
		cwd: string | undefined;
		items: GraphCommit[];
		item: GraphCommit | null;
	}>((previous) => {
		const cwd = graphCwd(),
			session = panelSession();
		const records =
			previous && previous.cwd === cwd
				? [
						...previous.items,
						...(previous.item ? [previous.item] : []),
						...graph.commits,
					]
				: graph.commits;
		const selection = rustProject<RetainedGraphSelection>(
			"retainedGraphSelection",
			{
				ids: records.map((item) => item.id),
				selectedIds: session.selectedCommitIds,
				selectedHash: session.selectedCommitHash,
			},
		);
		return {
			cwd,
			items: selection.indices.map((index) => records[index]!),
			item: selection.index === null ? null : records[selection.index]!,
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
		const index = rustProject<number | null>("repositorySelectedWorktree", {
			graphVisible: panelSession().graphVisible,
			item: selectedGraphItem(),
			worktrees: graph.worktrees,
		});
		return index === null ? null : graph.worktrees[index]!;
	});
	const selectedLinkedWorktreeStatus = createMemo(() => {
		const _selectedGraphWorktreeValue = selectedGraphWorktree();
		return _selectedGraphWorktreeValue && !_selectedGraphWorktreeValue.isCurrent
			? _selectedGraphWorktreeValue.status
			: null;
	});
	const workingTreeFiles = createMemo(
		() => selectedLinkedWorktreeStatus()?.fileGroups ?? fileGroups(),
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
	const historical = createMemo(() => {
		const _sourceValue5 = panelSession();
		return rustProject<{
			commitSource: Extract<
				DiffSource,
				{
					kind: "commit";
				}
			> | null;
			comparisonSource: Extract<
				DiffSource,
				{
					kind: "comparison";
				}
			> | null;
			commit: {
				cwd?: string;
				hash?: string;
				parent?: string;
			};
			comparison: {
				cwd?: string;
				from?: string;
				to?: string;
			};
			revision?: string;
		}>("historicalQuery", {
			mainViewMode: _sourceValue5.mainViewMode,
			diffViewerCwd: _sourceValue5.diffViewerCwd,
			graphCwd: graphCwd(),
			graphRevision: graph.revision,
			storedRevision: _sourceValue5.diffViewerCwd
				? graphRevisions.get(_sourceValue5.diffViewerCwd)
				: undefined,
			selectedCommitIds: _sourceValue5.selectedCommitIds,
			selectedCommitParent: _sourceValue5.selectedCommitParent,
			selectedGraphItem: selectedGraphItem(),
			fileSource: fileSource(),
		});
	});
	const commitDetailsState = useCommitDetails(
		() => historical().commit.cwd,
		() => historical().commit.hash,
		() => historical().commit.parent,
		() => historical().revision,
	);
	const comparisonDetailsState = useComparisonDetails(
		() => historical().comparison.cwd,
		() => historical().comparison.from,
		() => historical().comparison.to,
		() => historical().revision,
		() => {
			const _sourceValue6 = panelSession();
			return _sourceValue6.mainViewMode === "graph" &&
				_sourceValue6.selectedCommitIds.length > 1
				? comparisonSelection()
				: undefined;
		},
	);
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
		const cwd = graphCwd();
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
			session: panelSession(),
		}),
		({ commits, loading, session }) => {
			if (session.mainViewMode !== "graph" || loading || !commits.length)
				return;
			const visible = new Set(commits.map((item) => item.id));
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
	const keyboardFiles = createMemo(
		() =>
			rustProject<{ navigableFiles: GitFileEntry[] }>("changesPanel", {
				...workingTreeFiles(),
				filePresentation: workingTreePresentation(),
				fileViewMode: fileViewMode(),
			}).navigableFiles,
	);
	const commitKeyboardFiles = createMemo(() => {
		const commitFiles = commitDetailsState.details?.files ?? [];
		return visibleGitFiles(
			commitFiles,
			commitDetailsState.details?.filePresentation,
			fileViewMode(),
		);
	});
	const comparisonKeyboardFiles = createMemo(() => {
		const comparisonFiles = comparisonDetailsState.details?.files ?? [];
		return visibleGitFiles(
			comparisonFiles,
			comparisonDetailsState.details?.filePresentation,
			fileViewMode(),
		);
	});
	const changeActions = useGitChangeActions(() => ({
		cwd: activeCwd(),
		refetchStatus: gitStatus.refetch,
	}));
	const diffRequest = createMemo(() => {
		const _sourceValue7 = panelSession();
		return rustProject<DiffRequest | null>("diffRequest", {
			active: _options().active,
			cwd: _sourceValue7.diffViewerCwd,
			selectedFile: _sourceValue7.selectedFile,
			revision: _sourceValue7.diffViewerCwd
				? graphCwd() === _sourceValue7.diffViewerCwd
					? graph.revision
					: graphRevisions.get(_sourceValue7.diffViewerCwd)
				: undefined,
			fileSource: fileSource(),
			viewMode: diffViewMode(),
		});
	});
	const prefetchDiffs = useDiffPrefetch();
	const prefetchContext = createMemo(() => ({
		active: _options().active && sidebarVisible(),
		cwd: selectedWorkingTreeCwd(),
		revision:
			graphCwd() === selectedWorkingTreeCwd()
				? graph.revision
				: graphRevisions.get(selectedWorkingTreeCwd() ?? ""),
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
			const { active, cwd } = _options();
			return active &&
				cwd &&
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
			if (!_options().active || panelSession().mainViewMode !== "graph") return;
			diffRailElement
				?.querySelector<HTMLElement>('[aria-label="Repository commit history"]')
				?.focus({ preventScroll: true });
		});
	const closeDiffViewer = () => {
		setZenMode(false);
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
		comparisonPlan: comparisonDetailsState.plan,
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
	const openGraphSelection = setPendingGraphFileOpen;
	createEffect(
		() => {
			const request = pendingGraphFileOpen();
			if (!request) return null;
			const session = panelSession();
			const comparing = session.selectedCommitIds.length > 1;
			return rustProject<GraphFileOpen>("graphFileOpen", {
				...fileSelectionContext(),
				request,
				mainViewMode: session.mainViewMode,
				selectedCommitHash: session.selectedCommitHash,
				selectedCommitCount: session.selectedCommitIds.length,
				selectedFile: session.selectedFile,
				loading: comparing
					? comparisonDetailsState.loading
					: commitDetailsState.loading,
				files:
					selectedGraphItem()?.itemKind === "worktreeWip"
						? keyboardFiles()
						: comparing
							? comparisonKeyboardFiles()
							: commitKeyboardFiles(),
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
	const focusWorkbench = (repositoryCwd?: string) => {
		const action = rustProject<PanelAction | null>("repositoryInteraction", {
			type: "focusWorkbench",
			cwd: repositoryCwd,
			repositoryCwd: _options().cwd,
			hasFocusedPanel: Boolean(panelSession().focusedAuxiliaryPanel),
			mainViewMode: panelSession().mainViewMode,
			diffViewerCwd: panelSession().diffViewerCwd,
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
	const cycleFile = (direction: -1 | 1) => {
		const session = panelSession();
		const comparisonDiff = historical().comparisonSource !== null;
		const kind =
			session.mainViewMode === "graph"
				? session.sidebarContent === "workingTree"
					? "workingTree"
					: session.selectedCommitIds.length > 1
						? "comparison"
						: "commit"
				: session.historicalDiff
					? comparisonDiff
						? "comparison"
						: "commit"
					: "workingTree";
		const files: (GitFileEntry | GitCommitFile)[] =
			kind === "workingTree"
				? keyboardFiles()
				: kind === "comparison"
					? comparisonKeyboardFiles()
					: commitKeyboardFiles();
		const nextFile = adjacentGitFile(
			files,
			(file) =>
				file.path === session.selectedFile?.path &&
				(kind !== "workingTree" ||
					("staged" in file && file.staged === session.selectedFile?.staged)),
			direction,
		);
		if (nextFile) selectFile(kind, nextFile);
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
			const kind =
				session.sidebarContent === "workingTree"
					? "workingTree"
					: session.selectedCommitIds.length > 1
						? "comparison"
						: "commit";
			const files =
				kind === "workingTree"
					? keyboardFiles()
					: kind === "comparison"
						? comparisonKeyboardFiles()
						: commitKeyboardFiles();
			const first =
				files.find(
					(file) =>
						file.path === session.selectedFile?.path &&
						(kind !== "workingTree" ||
							("staged" in file &&
								file.staged === session.selectedFile?.staged)),
				) ?? files[0];
			if (!first) return;
			// Focus the mounted sidebar before selection renders the diff and file rows.
			sidebarElement?.focus({ preventScroll: true });
			selectFile(kind, first);
		} else if (action.type === "focusGraph") {
			const cwd = session.diffViewerCwd ?? activeCwd();
			if (cwd) {
				setZenMode(false);
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
				keyboardFiles(),
				session.selectedFile,
			);
			if (session.selectedFile.staged)
				changeActions.unstageFile(session.selectedFile.path);
			else changeActions.stageFile(session.selectedFile.path);
			if (nextSelection) selectChangedFile(nextSelection);
		}
	};
	createEffect(
		() => _options().active,
		(active) => {
			if (!active) return;
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
					const requested = (event as CustomEvent<ToggleGitSidebarDetail>)
						.detail?.visible;
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
					setZenMode(false);
					updatePanelSession({ type: "toggleGraph", cwd });
				}),
				listenWindowEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT, () =>
					changeMainViewMode("graph"),
				),
			];
			return () => cleanup.forEach((remove) => remove());
		},
	);
	const handleResizeStart = (
		event: PointerEvent & {
			currentTarget: HTMLButtonElement;
		},
		isDiff = false,
	) => {
		const _sidebarWidthValue = sidebarWidth(),
			_diffWidthValue = diffWidth();
		if (event.button !== 0) return;
		event.preventDefault();
		if (isDiff) event.stopPropagation();
		const rail = event.currentTarget.parentElement;
		const resize = rustProject<{
			availableWidth: number;
			startWidth: number;
			width: number;
		}>("repositoryResizeStart", {
			diff: isDiff,
			containerWidth:
				rail?.parentElement?.getBoundingClientRect().width ?? window.innerWidth,
			railWidth: rail?.getBoundingClientRect().width,
			sidebarVisible: panelSession().sidebarVisible,
			sidebarWidth: _sidebarWidthValue,
			diffWidth: _diffWidthValue,
			minimumPaneWidth: MIN_RESPONSIVE_PANE_WIDTH,
		});
		const startX = event.clientX;
		let width = resize.width;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		trackResize(
			event.pointerId,
			(moveEvent) => {
				moveEvent.preventDefault();
				width = rustProject<number>("repositoryResize", {
					diff: isDiff,
					availableWidth: resize.availableWidth,
					width: resize.startWidth + startX - moveEvent.clientX,
				});
				if (rail) rail.style.width = `${width}px`;
			},
			() => {
				writeStoredValue(
					isDiff ? DIFF_WIDTH_KEY : SIDEBAR_WIDTH_KEY,
					String(width),
				);
				if (isDiff) setDiffWidth(width);
				else setSidebarWidth(width);
			},
		);
	};
	const startFileDrag = (
		drag: DragProps,
		event: PointerEvent,
		file: FileContent,
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
	const renderAuxiliaryPanel = (id: string, drag: DragProps) => {
		if (id === "workspace-file-viewer")
			return (
				<DocumentViewer
					cwd={panelSession().fileViewerCwd!}
					sessionId={`workspace-file-viewer:${_options().workspaceId}:${panelSession().fileViewerCwd}`}
					workspaceId={_options().workspaceId}
					onSessionChange={saveDocumentSession}
					openRequest={panelSession().fileRequest}
					onClose={closeFileViewer}
					onFileTabDragStart={startFileDrag.bind(null, drag)}
					{...drag}
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
			return !value || value.initialFile
				? null
				: { path: value.path, token: 0 };
		});
		return (
			<Show when={panel()}>
				{(_value) => (
					<DocumentViewer
						cwd={retained()?.cwd ?? ""}
						sessionId={id}
						workspaceId={_options().workspaceId}
						onSessionChange={saveDocumentSession}
						initialFile={retained()?.initialFile}
						openRequest={openRequest()}
						onClose={() => updatePanelSession({ type: "closeFile", id })}
						onFileTabDragStart={startFileDrag.bind(null, drag)}
						{...drag}
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
			render: (drag: DragProps) => renderAuxiliaryPanel(panel.id, drag),
		}));
	});
	const diffPanel = (
		<>
			{context().diffVisible ? (
				<WorkbenchDiffRail
					ref={(element) => {
						diffRailElement = element;
					}}
					zenMode={zenMode()}
					width={diffWidth()}
					maxWidth={`max(0px, calc(100% - ${MIN_RESPONSIVE_PANE_WIDTH + (sidebarVisible() ? sidebarWidth() : 0)}px))`}
					onFocus={focusDiffViewer}
					onResize={(event) => handleResizeStart(event, true)}
				>
					<ChatDiffPanel
						diff={fileDiff.diff}
						file={panelSession().selectedFile}
						loading={fileDiff.loading}
						error={fileDiff.error}
						mainViewMode={panelSession().mainViewMode}
						onMainViewModeChange={changeMainViewMode}
						graph={graph}
						graphPreferences={graphPreferences()}
						onGraphPreferencesChange={setGraphPreferences}
						graphLoading={graph.loading}
						graphError={graphActionError() ?? graph.error}
						selectionAnnouncement={graphSelectionAnnouncement()}
						repositoryKey={graphCwd()}
						selectedCommitHash={panelSession().selectedCommitHash}
						selectedCommitIds={panelSession().selectedCommitIds}
						onSelectCommit={selectGraphCommit}
						onOpenGraphSelection={openGraphSelection}
						onCheckoutRef={checkoutGraphRef}
						onRunRefOperation={runGraphRefOperation}
						onRunGraphAction={runGraphActionRequest}
						onLoadMoreCommits={() => setGraphLimit(nextGitGraphHistoryLimit)}
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
						zenMode={zenMode()}
						onToggleZenMode={toggleZenMode}
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
					width={sidebarWidth()}
					error={panelSessionError()}
					onResize={handleResizeStart}
				>
					<ChangesPanel
						onPrefetchFiles={prefetchFiles()}
						filePresentation={workingTreePresentation()}
						cwd={selectedWorkingTreeCwd()}
						fileViewMode={fileViewMode()}
						onFileViewModeChange={setFileViewMode}
						content={panelSession().sidebarContent}
						graphActive={panelSession().mainViewMode === "graph"}
						modified={workingTreeFiles().modified}
						untracked={workingTreeFiles().untracked}
						staged={workingTreeFiles().staged}
						selectedFile={
							context().selectedFileVisible ? panelSession().selectedFile : null
						}
						onSelectFile={selectChangedFile}
						onStageFile={changeActions.stageFile}
						onUnstageFile={changeActions.unstageFile}
						onStageAll={changeActions.stageAll}
						onUnstageAll={changeActions.unstageAll}
						hasProject={!!project() || !!selectedLinkedWorktreeStatus()}
						projectLoading={!!activeCwd() && !gitStatus.loaded}
						selectedCommitHash={panelSession().selectedCommitHash}
						selectedCommitCount={panelSession().selectedCommitIds.length}
						selectedWorktreePath={selectedGraphWorktree()?.path}
						onOpenWorktree={
							selectedGraphWorktree() && !selectedGraphWorktree()!.isCurrent
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
						branch={selectedGraphWorktree()?.branch ?? project()?.branch}
						commitMessage={changeActions.commitMessage}
						onCommitMessageChange={changeActions.setCommitMessage}
						onCommit={changeActions.commit}
						isCommitting={changeActions.isCommitting}
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
		focusWorkbench,
		sidebar,
		get zenMode() {
			return zenMode();
		},
	};
}
