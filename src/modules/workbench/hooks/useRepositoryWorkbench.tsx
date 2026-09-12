import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	Show,
} from "solid-js";
import type { DiffSource } from "../../../../build/presentation/contracts/DiffSource.ts";
import type { GitActionResponse } from "../../../../build/presentation/contracts/GitActionResponse.ts";
import type { GitCommitFile } from "../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitFileEntry } from "../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GraphCommit } from "../../../../build/presentation/contracts/GraphCommit.ts";
import type { PanelSession } from "../../../../build/presentation/contracts/PanelSession.ts";
import {
	postJson,
	readStoredValue,
	project as rustProject,
} from "../../../shared/lib/native.tsx";
import type { DiffRequest } from "../../repository/hooks/useGitDiff.tsx";
import type { GitGraphActionRequest } from "../graph/components/CommitGraph/index.tsx";
import { useWorkspacePanelSession } from "./useWorkspacePanelSession.tsx";

const EMPTY_FILE_GROUPS = {
	staged: [],
	modified: [],
	untracked: [],
};

import type { FileContent } from "../../../../build/presentation/contracts/FileContent.ts";
import {
	createPointerResize,
	DOCUMENT_OPEN_EVENT,
	type DocumentOpenDetail,
	listenWindowEvent,
	OPEN_ACTIVE_GIT_GRAPH_EVENT,
	TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT,
} from "../../../shared/lib/dom.tsx";
import {
	adjacentGitFile,
	CLIENT_STORAGE_CHANGED_EVENT,
	getFileSelectionAfterToggle,
	writeStoredValue,
} from "../../../shared/lib/native.tsx";
import {
	useDiffPrefetch,
	useGitDiff,
} from "../../repository/hooks/useGitDiff.tsx";
import {
	useCommitDetails,
	useComparisonDetails,
	useGitGraph,
} from "../../repository/hooks/useGitGraph.tsx";
import {
	useGitChangeActions,
	useGitStatus,
} from "../../repository/hooks/useGitStatus.tsx";
import type { DragProps } from "../../workspace/components/WorkspaceCanvas/index.tsx";
import { MIN_RESPONSIVE_PANE_WIDTH } from "../../workspace/components/WorkspaceCanvas/index.tsx";
import {
	ChangesPanel,
	visibleGitFiles,
} from "../changes/components/ChangesPanel/index.tsx";
import { ChatDiffPanel } from "../components/ChatDiffPanel/index.tsx";
import {
	WorkbenchDiffRail,
	WorkbenchSidebar,
} from "../components/WorkbenchPanels/index.tsx";
import type { DiffViewMode } from "../diff/components/DiffViewer/index.tsx";
import { DocumentViewer } from "../documents/components/DocumentViewer/index.tsx";
import type { GraphSelectionIntent } from "../graph/components/CommitGraph/index.tsx";
import {
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	loadPreferences,
	nextGitGraphHistoryLimit,
} from "../graph/components/CommitGraph/useCommitGraphState.tsx";
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
	const _source = createMemo(() => panelSession());
	const fileSource = createMemo(() => _source().selectedFile?.source);
	const saveDocumentSession = (
		sessionId: string,
		session: PanelSession["documentSessions"][string],
	) =>
		updatePanelSession({
			type: "documents",
			sessionId,
			...session,
		});
	const [fileViewMode, setFileViewModeState] =
		createSignal(loadGitFileViewMode);
	onSettled(() => {
		const applyStoredMode = (value: string | null) => {
			if (value === "path" || value === "tree") setFileViewModeState(value);
		};
		return listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
			const detail = (
				event as CustomEvent<{
					key?: string;
					value?: string | null;
				}>
			).detail;
			if (detail?.key === GIT_FILE_VIEW_MODE_STORAGE_KEY)
				applyStoredMode(detail.value ?? null);
		});
	});
	const [sidebarWidth, setSidebarWidth] = createSignal(() => {
		_options().active;
		_options().workspaceId;
		return loadSidebarWidth();
	});
	const [diffWidth, setDiffWidth] = createSignal(() =>
		loadDiffWidth(_options().workspaceId),
	);
	const [diffViewMode, setDiffViewModeState] = createSignal(loadDiffViewMode);
	const [zenMode, setZenMode] = createSignal(false);
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
		() => [_options().active, zenMode()],
		() => {
			if (!_options().active || !zenMode()) return;
			return listenWindowEvent("keydown", (event) => {
				if ((event as KeyboardEvent).key !== "Escape") return;
				(event as KeyboardEvent).preventDefault();
				setZenMode(false);
			});
		},
	);
	const activeCwd = createMemo(
		() => _source().focusedAuxiliaryPanel?.cwd ?? _options().cwd,
	);
	const trackedCwds = createMemo(() => {
		const _optionsValue = _options(),
			_sourceValue = _source();
		return _optionsValue.active
			? [
					...new Set(
						[
							_optionsValue.cwd,
							_sourceValue.fileViewerCwd,
							_sourceValue.diffViewerCwd,
							_sourceValue.focusedAuxiliaryPanel?.cwd,
							..._sourceValue.detachedFilePanels.map((panel) => panel.cwd),
						].filter((value): value is string => Boolean(value)),
					),
				]
			: [];
	});
	const graphCwd = createMemo(() => {
		const _sourceValue2 = _source();
		return _options().active && _sourceValue2.mainViewMode === "graph"
			? (_sourceValue2.diffViewerCwd ?? undefined)
			: undefined;
	});
	const [graphLimit, setGraphLimit] = createSignal(() => {
		graphCwd();
		return DEFAULT_GIT_GRAPH_HISTORY_LIMIT;
	});
	const [graphPreferenceState, setGraphPreferenceState] = createSignal(() => ({
		repositoryKey: graphCwd(),
		value: loadPreferences(graphCwd()),
	}));
	const graphPreferences = createMemo(() => {
		const _graphPreferenceStateValue = graphPreferenceState(),
			_graphCwdValue = graphCwd();
		return _graphPreferenceStateValue.repositoryKey === _graphCwdValue
			? _graphPreferenceStateValue.value
			: loadPreferences(_graphCwdValue);
	});
	const graph = useGitGraph(
		() => graphCwd(),
		() => graphLimit(),
		() => graphPreferences(),
	);
	const _source2 = useGitStatus(
		() => trackedCwds(),
		() => ({
			enabled: trackedCwds().length > 0,
			graph: graphCwd() ? graph : undefined,
		}),
	);
	const project = createMemo(() => {
		const _activeCwdValue = activeCwd();
		return _activeCwdValue
			? (_source2.projectMap.get(_activeCwdValue) ?? null)
			: null;
	});
	const diffViewerProject = createMemo(() => {
		const _sourceValue3 = _source();
		return _sourceValue3.diffViewerCwd
			? (_source2.projectMap.get(_sourceValue3.diffViewerCwd) ?? null)
			: null;
	});
	const fileGroups = createMemo(
		() => project()?.fileGroups ?? EMPTY_FILE_GROUPS,
	);
	const _source3 = createMemo(() => fileGroups());
	const graphRevisionsRef = {
		current: new Map<string, string>(),
	};
	createEffect(
		() => [graphCwd(), graph.revision] as const,
		([cwd, revision]) => {
			if (cwd && revision) {
				graphRevisionsRef.current.set(cwd, revision);
			}
		},
	);
	const selectedGraphCache = {
		current: {
			cwd: undefined,
			items: new Map(),
		},
	} as {
		current: SelectedGraphCache;
	};
	const selectedGraph = createMemo(() => {
		const _sourceValue4 = _source();
		const result = resolveSelectedGraphItems(
			selectedGraphCache.current,
			graphCwd(),
			graph.commits,
			_sourceValue4.selectedCommitIds,
			_sourceValue4.selectedCommitHash,
		);
		selectedGraphCache.current = result.cache;
		return result;
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
	const selectedGraphWorktree = createMemo(() =>
		selectedGraphItem()?.itemKind === "worktreeWip"
			? (graph.worktrees.find(
					(worktree) => worktree.path === selectedGraphItem().worktreePath,
				) ?? null)
			: null,
	);
	const selectedLinkedWorktreeStatus = createMemo(() => {
		const _selectedGraphWorktreeValue = selectedGraphWorktree();
		return _selectedGraphWorktreeValue && !_selectedGraphWorktreeValue.isCurrent
			? _selectedGraphWorktreeValue.status
			: null;
	});
	const _source4 = createMemo(
		() => selectedLinkedWorktreeStatus()?.fileGroups ?? fileGroups(),
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
		const _sourceValue5 = _source();
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
				? graphRevisionsRef.current.get(_sourceValue5.diffViewerCwd)
				: undefined,
			selectedCommitIds: _sourceValue5.selectedCommitIds,
			selectedCommitParent: _sourceValue5.selectedCommitParent,
			selectedGraphItem: selectedGraphItem(),
			fileSource: fileSource(),
		});
	});
	const _source5 = createMemo(() => historical());
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
			const _sourceValue6 = _source();
			return _sourceValue6.mainViewMode === "graph" &&
				_sourceValue6.selectedCommitIds.length > 1
				? comparisonSelection()
				: undefined;
		},
	);
	const comparisonFrom = createMemo(() => comparisonDetailsState.plan?.from);
	const comparisonTo = createMemo(() => comparisonDetailsState.plan?.to);
	const comparisonCwd = createMemo(() => comparisonDetailsState.plan?.cwd);
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
			const result = await postJson<{
				ok: boolean;
				branch?: string;
				error?: string;
			}>("/api/git/branches", {
				cwd: _graphCwdValue3,
				branch,
			});
			if (!result.ok) throw new Error(result.error ?? "Checkout failed");
			await _source2.refetch();
			selectGraphCommit(null);
		} catch (error) {
			setGraphActionError(
				error instanceof Error ? error.message : "Checkout failed",
			);
		}
	};
	const _source6 = createMemo(() =>
		createGitOperations(graphCwd(), _source2.refetch, selectGraphCommit),
	);
	createEffect(
		() => [
			graph.commits,
			graph.loading,
			_source().mainViewMode,
			panelSession(),
			updatePanelSession,
		],
		() => {
			const _panelSessionValue = panelSession();
			if (
				_source().mainViewMode !== "graph" ||
				graph.loading ||
				!graph.commits.length
			)
				return;
			const visible = new Set(graph.commits.map((item) => item.id));
			if (
				_panelSessionValue.selectedCommitHash &&
				visible.has(_panelSessionValue.selectedCommitHash) &&
				_panelSessionValue.selectedCommitIds.length &&
				_panelSessionValue.selectedCommitIds.every((id) => visible.has(id))
			)
				return;
			updatePanelSession({
				type: "reconcileGraph",
				items: graph.commits.map(({ id, message }) => ({
					id,
					message,
				})),
			});
		},
	);
	const keyboardFiles = createMemo(() => {
		const _source3Value = _source3(),
			_projectValue = project(),
			_fileViewModeValue = fileViewMode();
		return [
			...visibleGitFiles(
				[..._source3Value.modified, ..._source3Value.untracked],
				_projectValue?.filePresentation,
				_fileViewModeValue,
			),
			...visibleGitFiles(
				_source3Value.staged,
				_projectValue?.filePresentation,
				_fileViewModeValue,
			),
		];
	});
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
	const _source7 = useGitChangeActions(() => ({
		cwd: activeCwd(),
		refetchStatus: _source2.refetch,
	}));
	const diffRequest = createMemo(() => {
		const _sourceValue7 = _source();
		return rustProject<DiffRequest | null>("diffRequest", {
			active: _options().active,
			cwd: _sourceValue7.diffViewerCwd,
			selectedFile: _sourceValue7.selectedFile,
			revision: _sourceValue7.diffViewerCwd
				? graphCwd() === _sourceValue7.diffViewerCwd
					? graph.revision
					: graphRevisionsRef.current.get(_sourceValue7.diffViewerCwd)
				: undefined,
			fileSource: fileSource(),
			viewMode: diffViewMode(),
		});
	});
	const prefetchDiffs = useDiffPrefetch();
	const prefetchContext = createMemo(() => ({
		active: _options().active && _source().sidebarVisible,
		cwd: selectedWorkingTreeCwd(),
		revision:
			graphCwd() === selectedWorkingTreeCwd()
				? graph.revision
				: graphRevisionsRef.current.get(selectedWorkingTreeCwd() ?? ""),
		viewMode: diffViewMode(),
	}));
	const prefetchFiles = (files: GitFileEntry[]) => {
		const context = prefetchContext();
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
	};

	const _source8 = useGitDiff(() => diffRequest());
	createEffect(
		() => {
			const _source5Value = _source5();
			return [
				diffViewerProject(),
				_source().selectedFile,
				_source5Value.commitSource,
				_source5Value.comparisonSource,
				updatePanelSession,
			];
		},
		() => {
			const _sourceValue9 = _source(),
				_diffViewerProjectValue = diffViewerProject(),
				_source5Value2 = _source5();
			if (
				!_sourceValue9.selectedFile ||
				!_diffViewerProjectValue ||
				_source5Value2.commitSource ||
				_source5Value2.comparisonSource
			)
				return;
			const current =
				_diffViewerProjectValue.files.find((file) => {
					const _sourceValue8 = _sourceValue9;
					return (
						file.path === _sourceValue8.selectedFile?.path &&
						file.staged === _sourceValue8.selectedFile?.staged
					);
				}) ??
				_diffViewerProjectValue.files.find(
					(file) => file.path === _sourceValue9.selectedFile?.path,
				);
			if (current && current.staged === _sourceValue9.selectedFile.staged)
				return;
			updatePanelSession({
				type: "reconcileFile",
				expected: _sourceValue9.selectedFile,
				staged: current?.staged ?? null,
			});
		},
	);
	createEffect(
		() => {
			const _optionsValue3 = _options();
			return [
				_optionsValue3.active,
				_optionsValue3.cwd,
				_source2.loaded,
				_source2.projectMap,
				panelSession().repositoryInitialized,
				_source().diffViewerCwd,
				updatePanelSession,
			];
		},
		() => {
			const _optionsValue4 = _options();
			if (
				!_optionsValue4.active ||
				!_optionsValue4.cwd ||
				!_source2.loaded ||
				!_source2.projectMap.has(_optionsValue4.cwd)
			)
				return;
			if (!panelSession().repositoryInitialized || !_source().diffViewerCwd)
				updatePanelSession({
					type: "initialize",
					cwd: _optionsValue4.cwd,
				});
		},
	);
	createEffect(
		() => [_options().active, updatePanelSession],
		() => {
			if (!_options().active) return;
			return listenWindowEvent(DOCUMENT_OPEN_EVENT, (event) => {
				const detail = (event as CustomEvent<DocumentOpenDetail>).detail;
				if (!detail?.cwd || !detail.path) return;
				updatePanelSession({
					type: "document",
					cwd: detail.cwd,
					path: detail.path,
				});
			});
		},
	);
	createEffect(
		() => [_options().active, updatePanelSession],
		() => {
			return listenWindowEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT, () => {
				if (!_options().active) return;
				updatePanelSession({
					type: "toggleSidebar",
				});
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
	const closeDiffViewer = () => {
		updatePanelSession({
			type: "dismissDiff",
		});
	};
	const returnsToGraphOnClose = createMemo(() => panelSession().graphDrillIn);
	const selectChangedFile = (file: GitFileEntry) => {
		const _selectedWorkingTreeCwdValue = selectedWorkingTreeCwd();
		if (!_selectedWorkingTreeCwdValue) return;
		updatePanelSession({
			type: "workingTreeFile",
			cwd: _selectedWorkingTreeCwdValue,
			path: file.path,
			staged: file.staged,
		});
	};
	const selectCommitFile = (file: GitCommitFile) => {
		const _source5Value3 = _source5(),
			_sourceValue0 = _source(),
			_selectedGraphItemValue = selectedGraphItem();
		const commitCwd = _source5Value3.commitSource?.commitHash
			? _sourceValue0.diffViewerCwd
			: activeCwd();
		const commitHash =
			_source5Value3.commitSource?.commitHash ??
			(_selectedGraphItemValue?.itemKind !== "worktreeWip"
				? _selectedGraphItemValue?.hash
				: undefined);
		const commitParent = _source5Value3.commitSource?.commitHash
			? _source5Value3.commitSource?.commitParent
			: _sourceValue0.selectedCommitParent;
		if (!commitCwd || !commitHash) return;
		updatePanelSession({
			type: "commitFile",
			cwd: commitCwd,
			path: file.path,
			commitHash,
			commitParent,
		});
	};
	const selectComparisonFile = (file: GitCommitFile) => {
		const _source5Value4 = _source5();
		const fileComparisonCwd = _source5Value4.comparisonSource?.comparisonFrom
			? _source().diffViewerCwd
			: comparisonCwd();
		const fileComparisonFrom =
			_source5Value4.comparisonSource?.comparisonFrom ?? comparisonFrom();
		const fileComparisonTo =
			_source5Value4.comparisonSource?.comparisonTo ?? comparisonTo();
		if (!fileComparisonCwd || !fileComparisonFrom || !fileComparisonTo) return;
		updatePanelSession({
			type: "comparisonFile",
			cwd: fileComparisonCwd,
			path: file.path,
			from: fileComparisonFrom,
			to: fileComparisonTo,
		});
	};
	const openGraphSelection = (itemId: string) => {
		setPendingGraphFileOpen(itemId);
	};
	createEffect(
		() => {
			const request = pendingGraphFileOpen();
			if (!request) return null;
			const session = _source();
			if (
				session.mainViewMode !== "graph" ||
				session.selectedCommitHash !== request
			)
				return "cancel";
			if (selectedGraphItem()?.itemKind === "worktreeWip")
				return [
					request,
					keyboardFiles(),
					session.selectedFile?.path,
					session.selectedFile?.staged,
				];
			const comparing = session.selectedCommitIds.length > 1;
			const loading = comparing
				? comparisonDetailsState.loading
				: commitDetailsState.loading;
			return [
				request,
				comparing,
				loading,
				loading
					? null
					: comparing
						? comparisonKeyboardFiles()
						: commitKeyboardFiles(),
				session.selectedFile?.path,
			];
		},
		() => {
			const _pendingGraphFileOpenValue = pendingGraphFileOpen();
			if (!_pendingGraphFileOpenValue) return;
			const _sourceValue11 = _source();
			if (
				_sourceValue11.mainViewMode !== "graph" ||
				_sourceValue11.selectedCommitHash !== _pendingGraphFileOpenValue
			) {
				setPendingGraphFileOpen(null);
				return;
			}
			if (selectedGraphItem()?.itemKind === "worktreeWip") {
				setPendingGraphFileOpen(null);
				const _keyboardFilesValue = keyboardFiles();
				const firstFile =
					_keyboardFilesValue.find((file) => {
						const _sourceValue10 = _source();
						return (
							file.path === _sourceValue10.selectedFile?.path &&
							file.staged === _sourceValue10.selectedFile.staged
						);
					}) ?? _keyboardFilesValue[0];
				if (firstFile) selectChangedFile(firstFile);
				return;
			}
			const comparing = _sourceValue11.selectedCommitIds.length > 1;
			if (
				comparing ? comparisonDetailsState.loading : commitDetailsState.loading
			)
				return;
			setPendingGraphFileOpen(null);
			const files = comparing
				? comparisonKeyboardFiles()
				: commitKeyboardFiles();
			const firstFile =
				files.find((file) => file.path === _source().selectedFile?.path) ??
				files[0];
			if (firstFile)
				(comparing ? selectComparisonFile : selectCommitFile)(firstFile);
		},
	);
	const changeMainViewMode = (mode: "diff" | "graph") => {
		const _activeCwdValue2 = activeCwd();
		if (mode === "graph" && _activeCwdValue2) {
			updatePanelSession({
				type: "openGraph",
				cwd: _activeCwdValue2,
			});
			return;
		}
		updatePanelSession({
			type: "mode",
			mode,
		});
	};
	createEffect(
		() => [_options().active, changeMainViewMode, activeCwd()],
		() => {
			return listenWindowEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT, () => {
				if (_options().active) changeMainViewMode("graph");
			});
		},
	);
	const focusWorkbench = (repositoryCwd?: string) => {
		if (!repositoryCwd || repositoryCwd === _options().cwd)
			updatePanelSession({
				type: "focusChat",
				cwd: repositoryCwd,
			});
	};
	const focusDiffViewer = () => {
		const _sourceValue12 = _source();
		if (_sourceValue12.diffViewerCwd)
			updatePanelSession({
				type: "focus",
				panel: {
					id: "workspace-diff-viewer",
					cwd: _sourceValue12.diffViewerCwd,
				},
			});
	};
	const cycleChangedFile = (direction: -1 | 1) => {
		const next = adjacentGitFile(
			keyboardFiles(),
			(file) => {
				const _sourceValue13 = _source();
				return (
					file.path === _sourceValue13.selectedFile?.path &&
					file.staged === _sourceValue13.selectedFile?.staged
				);
			},
			direction,
		);
		if (next) selectChangedFile(next);
	};
	const cycleHistoricalFile = (direction: -1 | 1) => {
		const comparisonDiff = _source5().comparisonSource !== null;
		const historicalFiles = comparisonDiff
			? comparisonKeyboardFiles()
			: commitKeyboardFiles();
		const nextFile = adjacentGitFile(
			historicalFiles,
			(file) => file.path === _source().selectedFile?.path,
			direction,
		);
		if (!nextFile) return;
		if (comparisonDiff) selectComparisonFile(nextFile);
		else selectCommitFile(nextFile);
	};
	const handleDiffKeyboardNavigation = (event: KeyboardEvent) => {
		const _sourceValue14 = _source(),
			_panelSessionValue2 = panelSession();
		if (
			_sourceValue14.focusedAuxiliaryPanel?.id !== "workspace-diff-viewer" ||
			event.defaultPrevented ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey
		)
			return;
		if (_panelSessionValue2.mainViewMode === "graph") return;
		const target = event.target as HTMLElement;
		const isEditable =
			target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.isContentEditable;
		if (isEditable) return;
		if (_panelSessionValue2.graphDrillIn && event.key === "ArrowLeft") {
			event.preventDefault();
			closeDiffViewer();
			return;
		}
		const historical = _panelSessionValue2.historicalDiff;
		if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			event.preventDefault();
			(historical ? cycleHistoricalFile : cycleChangedFile)(
				event.key === "ArrowUp" ? -1 : 1,
			);
		} else if (
			!historical &&
			event.key === "Enter" &&
			_sourceValue14.selectedFile &&
			target.tagName !== "BUTTON"
		) {
			event.preventDefault();
			const nextSelection = getFileSelectionAfterToggle(
				keyboardFiles(),
				_sourceValue14.selectedFile,
			);
			if (_sourceValue14.selectedFile.staged)
				_source7.unstageFile(_sourceValue14.selectedFile.path);
			else _source7.stageFile(_sourceValue14.selectedFile.path);
			if (nextSelection) selectChangedFile(nextSelection);
		}
	};
	createEffect(
		() => [
			_options().active,
			handleDiffKeyboardNavigation,
			_source(),
			_source5(),
			comparisonKeyboardFiles(),
			commitKeyboardFiles(),
			comparisonCwd(),
			comparisonFrom(),
			comparisonTo(),
			selectedGraphItem(),
			activeCwd(),
			keyboardFiles(),
			selectedWorkingTreeCwd(),
		],
		() => {
			if (!_options().active) return;
			return listenWindowEvent("keydown", handleDiffKeyboardNavigation);
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
		const minimum = isDiff ? MIN_DIFF_WIDTH : MIN_SIDEBAR_WIDTH;
		const maximum = isDiff
			? Math.max(
					MIN_DIFF_WIDTH,
					(rail?.parentElement?.getBoundingClientRect().width ??
						window.innerWidth) -
						(_source().sidebarVisible ? _sidebarWidthValue : 0) -
						MIN_RESPONSIVE_PANE_WIDTH,
				)
			: MAX_SIDEBAR_WIDTH;
		const startX = event.clientX;
		const startWidth = isDiff
			? (rail?.getBoundingClientRect().width ?? _diffWidthValue)
			: _sidebarWidthValue;
		let width = isDiff ? _diffWidthValue : _sidebarWidthValue;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		trackResize(
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
						? `${DIFF_WIDTH_KEY_PREFIX}${_options().workspaceId}`
						: SIDEBAR_WIDTH_KEY,
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
					cwd={_source().fileViewerCwd!}
					sessionId={`workspace-file-viewer:${_options().workspaceId}:${_source().fileViewerCwd}`}
					workspaceId={_options().workspaceId}
					onSessionChange={saveDocumentSession}
					openRequest={_source().fileRequest}
					onClose={closeFileViewer}
					onFileTabDragStart={startFileDrag.bind(null, drag)}
					{...drag}
				/>
			);
		const panel = createMemo(() =>
			_source().detachedFilePanels.find((panel) => panel.id === id),
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
		const session = _source();
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
			{_source().diffViewerCwd &&
			(_source().mainViewMode === "graph"
				? _source().sidebarVisible
				: Boolean(_source().selectedFile)) ? (
				<WorkbenchDiffRail
					zenMode={zenMode()}
					width={diffWidth()}
					maxWidth={`max(0px, calc(100% - ${MIN_RESPONSIVE_PANE_WIDTH + (_source().sidebarVisible ? sidebarWidth() : 0)}px))`}
					onFocus={focusDiffViewer}
					onResize={(event) => handleResizeStart(event, true)}
				>
					<ChatDiffPanel
						diff={_source8.diff}
						file={_source().selectedFile}
						loading={_source8.loading}
						error={_source8.error}
						mainViewMode={_source().mainViewMode}
						onMainViewModeChange={changeMainViewMode}
						graph={graph}
						graphPreferences={graphPreferences()}
						onGraphPreferencesChange={(update) =>
							setGraphPreferenceState((current) => {
								const _graphCwdValue4 = graphCwd();
								return {
									repositoryKey: _graphCwdValue4,
									value:
										typeof update === "function"
											? update(
													current.repositoryKey === _graphCwdValue4
														? current.value
														: loadPreferences(_graphCwdValue4),
												)
											: update,
								};
							})
						}
						graphLoading={graph.loading}
						graphError={graphActionError() ?? graph.error}
						selectionAnnouncement={graphSelectionAnnouncement()}
						repositoryKey={graphCwd()}
						selectedCommitHash={_source().selectedCommitHash}
						selectedCommitIds={_source().selectedCommitIds}
						onSelectCommit={selectGraphCommit}
						onOpenGraphSelection={openGraphSelection}
						onCheckoutRef={checkoutGraphRef}
						onRunRefOperation={_source6().runGraphRefOperation}
						onRunGraphAction={_source6().runGraphActionRequest}
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
							!_source5().commitSource && !_source5().comparisonSource
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
					visible={_source().sidebarVisible}
					width={sidebarWidth()}
					error={panelSessionError()}
					onResize={handleResizeStart}
				>
					<ChangesPanel
						prefetchKey={JSON.stringify(prefetchContext())}
						onPrefetchFiles={prefetchFiles}
						filePresentation={
							selectedLinkedWorktreeStatus()?.filePresentation ??
							project()?.filePresentation
						}
						cwd={selectedWorkingTreeCwd()}
						fileViewMode={fileViewMode()}
						onFileViewModeChange={setFileViewMode}
						content={panelSession().sidebarContent}
						graphActive={_source().mainViewMode === "graph"}
						modified={_source4().modified}
						untracked={_source4().untracked}
						staged={_source4().staged}
						selectedFile={
							_source().focusedAuxiliaryPanel?.id === "workspace-diff-viewer"
								? _source().selectedFile
								: null
						}
						onSelectFile={selectChangedFile}
						onStageFile={_source7.stageFile}
						onUnstageFile={_source7.unstageFile}
						onStageAll={_source7.stageAll}
						onUnstageAll={_source7.unstageAll}
						hasProject={!!project() || !!selectedLinkedWorktreeStatus()}
						projectLoading={!!activeCwd() && !_source2.loaded}
						selectedCommitHash={_source().selectedCommitHash}
						selectedCommitCount={_source().selectedCommitIds.length}
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
						commitMessage={_source7.commitMessage}
						onCommitMessageChange={_source7.setCommitMessage}
						onCommit={_source7.commit}
						isCommitting={_source7.isCommitting}
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
		get diffPanel() {
			return diffPanel;
		},
		get focusWorkbench() {
			return focusWorkbench;
		},
		get sidebar() {
			return sidebar;
		},
		get zenMode() {
			return zenMode();
		},
	};
}
export type SelectedGraphCache = {
	cwd: string | undefined;
	items: Map<string, GraphCommit>;
};
export function resolveSelectedGraphItems(
	cache: SelectedGraphCache,
	cwd: string | undefined,
	commits: readonly GraphCommit[],
	selectedIds: readonly string[],
	selectedHash: string | null,
) {
	const current =
		cache.cwd === cwd
			? cache
			: {
					cwd,
					items: new Map(),
				};
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
export type GitRefOperationRequest = {
	operation: GitActionResponse["operation"];
	action: "start" | "continue" | "skip" | "abort";
	source?: string;
	target?: string;
};
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
export function createGitOperations(
	graphCwd: string | undefined,
	refetch: () => Promise<unknown>,
	selectGraphCommit: (id: string | null) => void,
) {
	async function run(
		endpoint: string,
		operation: string,
		request: object,
		fallback: string,
	): Promise<GitActionResponse> {
		const failed = (
			error: string,
			errorKind: "invalidInput" | "commandFailed",
		): GitActionResponse => ({
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
			const result = await postJson<GitActionResponse>(`/api/git/${endpoint}`, {
				cwd: graphCwd,
				...request,
			});
			await refetch();
			if (result.selection) selectGraphCommit(result.selection.commit);
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
			run("ref-operation", request.operation, request, "Git operation failed"),
		runGraphActionRequest: ({
			action,
			target,
			targets,
			name,
			message,
		}: GitGraphActionRequest & {
			name?: string;
			message?: string;
		}) =>
			run(
				"graph-action",
				action,
				{
					action,
					target,
					targets,
					name,
					message,
				},
				"Git action failed",
			),
	};
}
