import * as stylex from "@stylexjs/stylex";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { DiffViewerBoundary } from "../../components/diff/DiffViewerBoundary.tsx";
import {
	CollapsedChangeFileSidebar,
	ChangeFileSidebar,
	type SelectedFile,
} from "../../components/git/ChangeFileSidebar.tsx";
import { CommitGraph } from "../../components/git/CommitGraph.tsx";
import { isChatAgentKind } from "../../features/agents/agents.ts";
import {
	clearAgentChatPaneState,
	deriveStoredSummary,
	loadPendingWorkspacePaths,
} from "../../features/chat/chat-session-store.ts";
import { useFileWatcher } from "../../features/file-watcher/useFileWatcher.ts";
import {
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderProjectGitFiles,
} from "../../features/git/git-file-utils.ts";
import { useGitChangeActions } from "../../features/git/useGitChangeActions.ts";
import {
	type DiffRequest,
	type HunkDiff,
	summarizeHunkDiff,
	useGitDiff,
} from "../../features/git/useGitDiff.ts";
import {
	useCommitDetails,
	useGitGraph,
} from "../../features/git/useGitGraph.ts";
import { useGitStatus } from "../../features/git/useGitStatus.ts";
import {
	dispatchAgentShellChange,
	type AgentGroupModel,
	type ThemeId,
} from "../../features/agent/agent-utils.ts";
import { incrementNumber, isNonEmptyString } from "../../lib/data.ts";
import {
	listenWindowEvent,
	setupAgentThemePanelShortcut,
} from "../../lib/react-events.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { type DiffViewMode, GitDiffView } from "../Agent/GitDiffView.tsx";
import { AgentSettingsPanel } from "../Agent/AgentSettingsPanel.tsx";
import {
	DiffViewerTopBar,
	EditorAgentChat,
	EditorWorkspace,
	EmptyEditorWorkspace,
	InactiveSessionTopBar,
	Placeholder,
} from "./editor-page-view.tsx";

interface Session {
	groupId: string;
	groupName: string;
	paneId: string;
	paneTitle: string;
	agentKind: "claude" | "codex";
	cwd?: string;
	referencePaths?: string[];
	pendingCwd?: boolean;
	messageCount: number;
	summary: string | null;
}

type StateValue<T> = T | ((current: T) => T);

type EditorUiState = {
	selectedPaneId: string | null;
	diffViewMode: DiffViewMode;
	closedPaneIds: Set<string>;
	scrollToChange: number;
	zenMode: boolean;
	chatPanelWidth: number;
	sidebarWidth: number;
	sidebarVisible: boolean;
	selectedCommitHash: string | null;
	fileViewMode: "path" | "tree";
	mainViewMode: "diff" | "graph";
	showSettings: boolean;
};

const EDITOR_CHAT_WIDTH_STORAGE_KEY = "agent-editor-chat-width";
const MIN_EDITOR_CHAT_WIDTH = 280;
const MAX_EDITOR_CHAT_WIDTH = 720;
const DEFAULT_EDITOR_CHAT_WIDTH = 400;

function loadEditorChatWidth() {
	const stored = Number(readStoredValue(EDITOR_CHAT_WIDTH_STORAGE_KEY));
	return Number.isFinite(stored)
		? Math.min(MAX_EDITOR_CHAT_WIDTH, Math.max(MIN_EDITOR_CHAT_WIDTH, stored))
		: DEFAULT_EDITOR_CHAT_WIDTH;
}

type EditorUiAction<K extends keyof EditorUiState = keyof EditorUiState> = {
	type: "fieldChanged";
	field: K;
	value: StateValue<EditorUiState[K]>;
};

function getInitialEditorUiState(): EditorUiState {
	return {
		selectedPaneId: null,
		diffViewMode: "split",
		closedPaneIds: new Set(),
		scrollToChange: 0,
		zenMode: loadZenMode(),
		chatPanelWidth: loadEditorChatWidth(),
		sidebarWidth: 280,
		sidebarVisible: true,
		selectedCommitHash: null,
		fileViewMode: "tree",
		mainViewMode: "diff",
		showSettings: false,
	};
}

function resolveStateValue<T>(current: T, value: StateValue<T>): T {
	return typeof value === "function"
		? (value as (current: T) => T)(current)
		: value;
}

function editorUiReducer(
	state: EditorUiState,
	action: EditorUiAction
): EditorUiState {
	switch (action.type) {
		case "fieldChanged": {
			const nextValue = resolveStateValue(
				state[action.field],
				action.value
			) as EditorUiState[typeof action.field];
			if (Object.is(state[action.field], nextValue)) return state;
			return {
				...state,
				[action.field]: nextValue,
			};
		}
	}
}

let cachedKey = "";
let cachedSessions: Session[] = [];

function flattenSessions(groups: AgentGroupModel[]): Session[] {
	return groups.flatMap((g) =>
		g.panes.flatMap((p) => {
			if (!isChatAgentKind(p.agentKind)) return [];
			const pendingWorkspacePaths = p.cwd
				? []
				: loadPendingWorkspacePaths(p.id);
			return [
				{
					groupId: g.id,
					groupName: g.name,
					paneId: p.id,
					paneTitle: p.title,
					agentKind: p.agentKind,
					cwd: p.cwd ?? pendingWorkspacePaths[0],
					referencePaths: p.cwd
						? p.referencePaths
						: pendingWorkspacePaths.slice(1),
					pendingCwd:
						p.pendingCwd || (!p.cwd && pendingWorkspacePaths.length > 0),
					messageCount: 0,
					summary: deriveStoredSummary(p.id),
				},
			];
		})
	);
}

function stableSessions(next: Session[]): Session[] {
	const key = next
		.map((s) =>
			[
				s.groupId,
				s.paneId,
				s.agentKind,
				s.cwd ?? "",
				s.pendingCwd ? "pending" : "ready",
				s.referencePaths?.join("\u0000") ?? "",
				s.summary ?? "",
			].join("\u0001")
		)
		.join("\u0002");
	if (key === cachedKey) return cachedSessions;
	cachedKey = key;
	cachedSessions = next;
	return next;
}

function getVisibleEditorGroups(
	groups: AgentGroupModel[],
	selectedGroupId: string | null
): AgentGroupModel[] {
	const activeGroup = groups.find((group) => group.id === selectedGroupId);
	return activeGroup ? [activeGroup] : groups;
}

function getTrackedSessionDirs(sessions: Session[]): string[] {
	const seen = new Set<string>();
	const dirs: string[] = [];
	for (const session of sessions) {
		if (!isNonEmptyString(session.cwd) || seen.has(session.cwd)) continue;
		seen.add(session.cwd);
		dirs.push(session.cwd);
	}
	return dirs;
}

function loadZenMode() {
	return readStoredValue("agent-editor-zen") === "true";
}

interface EditorPageProps {
	active?: boolean;
	groups: AgentGroupModel[];
	selectedGroupId: string | null;
	themeId: ThemeId;
	onSelectPane: (paneId: string) => void;
	onDirectoryChange: (
		paneId: string,
		cwd: string,
		referencePaths?: string[]
	) => void;
}

type EditorGitFile = {
	readonly path: string;
	readonly staged: boolean;
	readonly status: string;
};

type EditorDiffControllerArgs = {
	readonly active: boolean;
	readonly files: readonly EditorGitFile[];
	readonly refetchGit: () => Promise<unknown> | unknown;
	readonly session: Session | null;
	readonly setScrollToChange: (value: StateValue<number>) => void;
	readonly zenMode: boolean;
};

type EditorDiffController = {
	readonly clearDiff: () => void;
	readonly diff: HunkDiff | null;
	readonly diffLoading: boolean;
	readonly request: DiffRequest | null;
	readonly selectedDiffStats: ReturnType<typeof summarizeHunkDiff>;
	readonly selectedFile: SelectedFile | null;
	readonly selectFile: (paneId: string, request: DiffRequest) => void;
};

function useEditorDiffController({
	active,
	files,
	refetchGit,
	session,
	setScrollToChange,
	zenMode,
}: EditorDiffControllerArgs): EditorDiffController {
	const [selectedFiles, setSelectedFiles] = useState<
		Record<string, SelectedFile | null>
	>({});
	const selectedFile = useMemo(() => {
		if (!session) return null;
		const stored = selectedFiles[session.paneId];
		if (stored === null) return null;
		if (
			stored &&
			files.some((f) => f.path === stored.path && f.staged === stored.staged)
		) {
			return stored;
		}
		const first = files[0];
		return first ? { path: first.path, staged: first.staged } : null;
	}, [files, selectedFiles, session]);
	const autoRequest =
		session?.cwd && selectedFile
			? {
					cwd: session.cwd,
					file: selectedFile.path,
					staged: selectedFile.staged,
				}
			: null;
	const {
		diff,
		request,
		loading: diffLoading,
		loadDiff,
		clear: clearDiff,
	} = useGitDiff(autoRequest);
	const selectedDiffStats = useMemo(() => summarizeHunkDiff(diff), [diff]);
	const selectFile = useCallback((paneId: string, req: DiffRequest) => {
		setSelectedFiles((cur) => ({
			...cur,
			[paneId]: { path: req.file, staged: req.staged },
		}));
	}, []);
	useFileWatcher({
		enabled: active && zenMode,
		cwd: session?.cwd,
		paneId: session?.paneId,
		currentFile: request?.file,
		diffReady: !!diff && !diffLoading,
		loadDiff,
		setSelectedFile: useCallback(
			(path: string, staged: boolean) => {
				if (!session?.paneId) return;
				setSelectedFiles((cur) => ({
					...cur,
					[session.paneId]: { path, staged },
				}));
			},
			[session?.paneId]
		),
		onDiffLoaded: useCallback(() => {
			void refetchGit();
			setTimeout(setScrollToChange, 50, incrementNumber);
		}, [refetchGit, setScrollToChange]),
	});

	const cycleFile = useCallback(
		(dir: -1 | 1) => {
			if (!session?.cwd || !files.length) return;
			const idx = selectedFile
				? files.findIndex(
						(f) =>
							f.path === selectedFile.path && f.staged === selectedFile.staged
					)
				: -1;
			const next =
				dir === 1
					? idx >= files.length - 1
						? 0
						: idx + 1
					: idx <= 0
						? files.length - 1
						: idx - 1;
			const file = files[next]!;
			selectFile(session.paneId, {
				cwd: session.cwd,
				file: file.path,
				staged: file.staged,
			});
		},
		[files, selectFile, selectedFile, session]
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			const isEditable =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;
			if (isEditable) return;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				cycleFile(1);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				cycleFile(-1);
			}
		},
		[cycleFile]
	);

	useEffect(() => {
		if (!active) return;
		return listenWindowEvent("keydown", handleKeyDown);
	}, [active, handleKeyDown]);

	const clearSelectedDiff = useCallback(() => {
		if (session?.paneId) {
			setSelectedFiles((cur) => ({ ...cur, [session.paneId]: null }));
		}
		clearDiff();
	}, [clearDiff, session?.paneId]);

	return {
		clearDiff: clearSelectedDiff,
		diff,
		diffLoading,
		request,
		selectedDiffStats,
		selectedFile,
		selectFile,
	};
}

function useEditorPageModel({
	active = true,
	groups,
	selectedGroupId,
	themeId,
	onSelectPane,
	onDirectoryChange,
}: EditorPageProps): EditorPageSurfaceProps {
	const [editorUiState, editorUiDispatch] = useReducer(
		editorUiReducer,
		undefined,
		getInitialEditorUiState
	);
	const {
		selectedPaneId,
		diffViewMode,
		closedPaneIds,
		scrollToChange,
		zenMode,
		chatPanelWidth,
		sidebarWidth,
		sidebarVisible,
		selectedCommitHash,
		fileViewMode,
		mainViewMode,
		showSettings,
	} = editorUiState;
	const setEditorUiField = useCallback(
		<K extends keyof EditorUiState>(
			field: K,
			value: StateValue<EditorUiState[K]>
		) =>
			editorUiDispatch({
				type: "fieldChanged",
				field,
				value,
			} as EditorUiAction),
		[]
	);
	const setSelectedPaneId = useCallback(
		(value: StateValue<string | null>) =>
			setEditorUiField("selectedPaneId", value),
		[setEditorUiField]
	);
	const setDiffViewMode = useCallback(
		(value: StateValue<DiffViewMode>) =>
			setEditorUiField("diffViewMode", value),
		[setEditorUiField]
	);
	const setClosedPaneIds = useCallback(
		(value: StateValue<Set<string>>) =>
			setEditorUiField("closedPaneIds", value),
		[setEditorUiField]
	);
	const setScrollToChange = useCallback(
		(value: StateValue<number>) => setEditorUiField("scrollToChange", value),
		[setEditorUiField]
	);
	const setZenMode = useCallback(
		(value: StateValue<boolean>) => setEditorUiField("zenMode", value),
		[setEditorUiField]
	);
	const setChatPanelWidth = useCallback(
		(value: StateValue<number>) => setEditorUiField("chatPanelWidth", value),
		[setEditorUiField]
	);
	const setSidebarWidth = useCallback(
		(value: StateValue<number>) => setEditorUiField("sidebarWidth", value),
		[setEditorUiField]
	);
	const setSidebarVisible = useCallback(
		(value: StateValue<boolean>) => setEditorUiField("sidebarVisible", value),
		[setEditorUiField]
	);
	const setSelectedCommitHash = useCallback(
		(value: StateValue<string | null>) =>
			setEditorUiField("selectedCommitHash", value),
		[setEditorUiField]
	);
	const setFileViewMode = useCallback(
		(value: StateValue<"path" | "tree">) =>
			setEditorUiField("fileViewMode", value),
		[setEditorUiField]
	);
	const setMainViewMode = useCallback(
		(value: StateValue<"diff" | "graph">) =>
			setEditorUiField("mainViewMode", value),
		[setEditorUiField]
	);
	const setShowSettings = useCallback(
		(value: StateValue<boolean>) => setEditorUiField("showSettings", value),
		[setEditorUiField]
	);
	const chatRef = useRef<AgentChatHandle>(null);
	const sidebarDragRef = useRef<{
		startX: number;
		startWidth: number;
	} | null>(null);
	const chatPanelDragRef = useRef<{
		startX: number;
		startWidth: number;
	} | null>(null);
	const chatPanelWidthRef = useRef(chatPanelWidth);
	chatPanelWidthRef.current = chatPanelWidth;

	const visibleGroups = useMemo(() => {
		return getVisibleEditorGroups(groups, selectedGroupId);
	}, [groups, selectedGroupId]);
	const activeGroupSelectedPaneId = visibleGroups[0]?.selectedPaneId ?? null;
	const allSessions = useMemo(
		() => stableSessions(flattenSessions(visibleGroups)),
		[visibleGroups]
	);
	const sessions = useMemo(
		() => allSessions.filter((s) => !closedPaneIds.has(s.paneId)),
		[allSessions, closedPaneIds]
	);
	const effectiveSelectedPaneId = useMemo(() => {
		const activePaneId =
			activeGroupSelectedPaneId &&
			sessions.some((s) => s.paneId === activeGroupSelectedPaneId)
				? activeGroupSelectedPaneId
				: selectedPaneId;
		return activePaneId && sessions.some((s) => s.paneId === activePaneId)
			? activePaneId
			: (sessions[0]?.paneId ?? null);
	}, [activeGroupSelectedPaneId, selectedPaneId, sessions]);
	const trackedDirs = useMemo(
		() => getTrackedSessionDirs(sessions),
		[sessions]
	);
	const {
		projectMap,
		refetch: refetchGit,
		applyOptimistic,
		loaded: gitStatusLoaded,
	} = useGitStatus(trackedDirs, { enabled: active && trackedDirs.length > 0 });
	const sessionIdx = useMemo(
		() => sessions.findIndex((s) => s.paneId === effectiveSelectedPaneId),
		[effectiveSelectedPaneId, sessions]
	);
	const session =
		sessionIdx >= 0 ? (sessions[sessionIdx] ?? null) : (sessions[0] ?? null);
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
		cwd: session?.cwd,
		applyOptimistic,
		refetchStatus: refetchGit,
	});
	const project = session?.cwd ? (projectMap.get(session.cwd) ?? null) : null;
	const files = useMemo(
		() =>
			orderProjectGitFiles<{
				path: string;
				staged: boolean;
				status: string;
			}>(project),
		[project]
	);
	const staged = project?.files.filter(isStagedChange) ?? [];
	const modified = project?.files.filter(isUnstagedTrackedChange) ?? [];
	const untracked = project?.files.filter(isUntrackedChange) ?? [];
	const {
		clearDiff,
		diff,
		diffLoading,
		request,
		selectedDiffStats,
		selectedFile,
		selectFile,
	} = useEditorDiffController({
		active,
		files,
		refetchGit,
		session,
		setScrollToChange,
		zenMode,
	});
	const {
		commits: graphCommits,
		rows: graphRows,
		loading: graphLoading,
	} = useGitGraph(
		active && mainViewMode === "graph" ? session?.cwd : undefined,
		100
	);
	const { details: commitDetails, loading: commitDetailsLoading } =
		useCommitDetails(
			active && mainViewMode === "graph" ? session?.cwd : undefined,
			selectedCommitHash ?? undefined
		);

	const updateZenMode = useCallback(
		(next: boolean) => {
			setZenMode(next);
			writeStoredValue("agent-editor-zen", next ? "true" : "false");
			dispatchAgentShellChange({ source: "view", reason: "editor-zen" });
		},
		[setZenMode]
	);
	const exitZenMode = useCallback(() => updateZenMode(false), [updateZenMode]);
	const toggleZenMode = useCallback(
		() => updateZenMode(!zenMode),
		[updateZenMode, zenMode]
	);
	const refreshGitBranch = useCallback(() => {
		void refetchGit();
	}, [refetchGit]);
	useEffect(() => {
		return setupAgentThemePanelShortcut(setShowSettings);
	}, [setShowSettings]);

	const closePane = useCallback(
		(paneId: string) => {
			clearAgentChatPaneState(paneId);
			setClosedPaneIds((prev) => new Set(prev).add(paneId));
			if (effectiveSelectedPaneId === paneId) {
				const rest = sessions.filter((s) => s.paneId !== paneId);
				setSelectedPaneId(rest[0]?.paneId ?? null);
			}
		},
		[effectiveSelectedPaneId, sessions, setClosedPaneIds, setSelectedPaneId]
	);
	const selectEditorPane = useCallback(
		(paneId: string) => {
			setSelectedPaneId(paneId);
			onSelectPane?.(paneId);
		},
		[onSelectPane, setSelectedPaneId]
	);

	const handleSidebarDragStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			sidebarDragRef.current = {
				startX: e.clientX,
				startWidth: sidebarWidth,
			};

			const handleMouseMove = (e: MouseEvent) => {
				if (!sidebarDragRef.current) return;
				const delta = sidebarDragRef.current.startX - e.clientX;
				const newWidth = Math.min(
					400,
					Math.max(160, sidebarDragRef.current.startWidth + delta)
				);
				setSidebarWidth(newWidth);
			};

			const handleMouseUp = () => {
				sidebarDragRef.current = null;
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[setSidebarWidth, sidebarWidth]
	);

	const handleChatPanelDragStart = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			chatPanelDragRef.current = {
				startX: event.clientX,
				startWidth: chatPanelWidth,
			};

			const handleMouseMove = (moveEvent: MouseEvent) => {
				if (!chatPanelDragRef.current) return;
				const delta = moveEvent.clientX - chatPanelDragRef.current.startX;
				const availableMaximum = Math.max(
					MIN_EDITOR_CHAT_WIDTH,
					Math.min(MAX_EDITOR_CHAT_WIDTH, window.innerWidth - 520)
				);
				const nextWidth = Math.min(
					availableMaximum,
					Math.max(
						MIN_EDITOR_CHAT_WIDTH,
						chatPanelDragRef.current.startWidth + delta
					)
				);
				chatPanelWidthRef.current = nextWidth;
				setChatPanelWidth(nextWidth);
			};

			const handleMouseUp = () => {
				chatPanelDragRef.current = null;
				writeStoredValue(
					EDITOR_CHAT_WIDTH_STORAGE_KEY,
					String(chatPanelWidthRef.current)
				);
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[chatPanelWidth, setChatPanelWidth]
	);

	const viewer =
		mainViewMode === "diff" ? (
			diffLoading ? (
				<Placeholder label="Loading diff…" />
			) : diff && request ? (
				<DiffViewerBoundary
					resetKey={`${request.cwd}:${request.staged ? "staged" : "unstaged"}:${request.file}`}
				>
					<GitDiffView
						diff={diff}
						filePath={request.file}
						staged={request.staged}
						scrollToChange={scrollToChange}
						loading={false}
						onClose={clearDiff}
						hideHeader
						hideToolbar
						viewMode={diffViewMode}
						onViewModeChange={setDiffViewMode}
					/>
				</DiffViewerBoundary>
			) : (
				<Placeholder
					label={
						!gitStatusLoaded
							? "Checking repository…"
							: project
								? "Select a changed file"
								: "No Git repository"
					}
				/>
			)
		) : graphLoading ? (
			<Placeholder label="Loading graph…" />
		) : (
			<CommitGraph
				commits={graphCommits}
				rows={graphRows}
				selectedHash={selectedCommitHash ?? undefined}
				onSelect={setSelectedCommitHash}
				className={stylex.props(styles.fullHeight).className}
				wipFiles={files}
				branch={project?.branch}
			/>
		);
	const fileSidebarProps = {
		cwd: session?.cwd,
		fileViewMode,
		onFileViewModeChange: setFileViewMode,
		modified,
		untracked,
		staged,
		selectedFile,
		selectedDiffStats,
		onSelectFile: (f: { path: string; staged: boolean }) =>
			session?.cwd &&
			selectFile(session.paneId, {
				cwd: session.cwd,
				file: f.path,
				staged: f.staged,
			}),
		onStageFile: stageFile,
		onUnstageFile: unstageFile,
		onStageAll: stageAll,
		onUnstageAll: unstageAll,
		hasProject: !!project,
		projectLoading: !!session?.cwd && !gitStatusLoaded,
		files,
		branch: project?.branch,
		commitMessage,
		onCommitMessageChange: setCommitMessage,
		onCommit: commit,
		isCommitting,
		amendMode,
		onAmendModeChange: setAmendMode,
		onCollapse: () => setSidebarVisible(false),
	};
	const collapsedSidebar = (
		<CollapsedChangeFileSidebar
			unstagedCount={modified.length + untracked.length}
			stagedCount={staged.length}
			onExpand={() => setSidebarVisible(true)}
		/>
	);
	const diffSidebar = (
		<div
			{...stylex.props(styles.sidebarShell)}
			style={{ width: sidebarVisible ? sidebarWidth : 38 }}
		>
			{sidebarVisible ? (
				<>
					<button
						type="button"
						aria-label="Resize file sidebar"
						{...stylex.props(styles.sidebarResize)}
						onMouseDown={handleSidebarDragStart}
					/>
					<ChangeFileSidebar
						{...fileSidebarProps}
						mainViewMode="diff"
						selectedCommitHash={null}
						commitDetailsLoading={false}
						commitDetails={null}
					/>
				</>
			) : (
				collapsedSidebar
			)}
		</div>
	);
	const detailsSidebar = (
		<div
			{...stylex.props(styles.sidebarShell)}
			style={{ width: sidebarVisible ? sidebarWidth : 38 }}
		>
			{sidebarVisible ? (
				<>
					<button
						type="button"
						aria-label="Resize file sidebar"
						{...stylex.props(styles.sidebarResize)}
						onMouseDown={handleSidebarDragStart}
					/>
					<ChangeFileSidebar
						{...fileSidebarProps}
						mainViewMode={mainViewMode}
						selectedCommitHash={selectedCommitHash}
						commitDetailsLoading={commitDetailsLoading}
						commitDetails={commitDetails}
					/>
				</>
			) : (
				collapsedSidebar
			)}
		</div>
	);
	const emptyWorkspace = <EmptyEditorWorkspace sidebar={diffSidebar} />;
	const diffToolbar = session ? (
		<DiffViewerTopBar
			mainViewMode={mainViewMode}
			diffViewMode={diffViewMode}
			cwd={zenMode ? session.cwd : undefined}
			gitBranch={zenMode ? (project?.branch ?? null) : null}
			filePath={request?.file}
			selectedFile={selectedFile}
			diffStats={selectedDiffStats}
			onStageFile={stageFile}
			onUnstageFile={unstageFile}
			onMainViewModeChange={setMainViewMode}
			onDiffViewModeChange={setDiffViewMode}
			onGitBranchChanged={refreshGitBranch}
			zenMode={zenMode}
			onToggleZenMode={toggleZenMode}
		/>
	) : null;

	return {
		chatRef,
		chatPanelWidth,
		closePane,
		detailsSidebar,
		diffSidebar,
		diffToolbar,
		emptyWorkspace,
		exitZenMode,
		gitBranch: project?.branch ?? null,
		onDirectoryChange,
		onChatPanelDragStart: handleChatPanelDragStart,
		selectEditorPane,
		session,
		sessions,
		setShowSettings,
		showSettings,
		sidebarVisible,
		sidebarWidth,
		themeId,
		viewer,
		zenMode,
	};
}

export function EditorPage(props: EditorPageProps) {
	return <EditorPageSurface {...useEditorPageModel(props)} />;
}

type EditorPageSurfaceProps = {
	readonly chatRef: RefObject<AgentChatHandle | null>;
	readonly chatPanelWidth: number;
	readonly closePane: (paneId: string) => void;
	readonly detailsSidebar: ReactNode;
	readonly diffSidebar: ReactNode;
	readonly diffToolbar: ReactNode;
	readonly emptyWorkspace: ReactNode;
	readonly exitZenMode: () => void;
	readonly gitBranch: string | null;
	readonly onDirectoryChange: EditorPageProps["onDirectoryChange"];
	readonly onChatPanelDragStart: (event: React.MouseEvent) => void;
	readonly selectEditorPane: (paneId: string) => void;
	readonly session: Session | null;
	readonly sessions: Session[];
	readonly setShowSettings: (value: StateValue<boolean>) => void;
	readonly showSettings: boolean;
	readonly sidebarVisible: boolean;
	readonly sidebarWidth: number;
	readonly themeId: ThemeId;
	readonly viewer: ReactNode;
	readonly zenMode: boolean;
};

function EditorPageSurface({
	chatRef,
	chatPanelWidth,
	closePane,
	detailsSidebar,
	diffSidebar,
	diffToolbar,
	emptyWorkspace,
	exitZenMode,
	gitBranch,
	onDirectoryChange,
	onChatPanelDragStart,
	selectEditorPane,
	session,
	sessions,
	setShowSettings,
	showSettings,
	sidebarVisible,
	sidebarWidth,
	themeId,
	viewer,
	zenMode,
}: EditorPageSurfaceProps) {
	const openSettings = useCallback(
		() => setShowSettings(true),
		[setShowSettings]
	);
	const zenLeading = useMemo(
		() =>
			session ? (
				<EditorAgentChat
					session={session}
					chatRef={chatRef}
					gitBranch={gitBranch}
					composerOnly
					composerOnlyOffsetX={sidebarVisible ? -(sidebarWidth / 2) : 0}
					onExitComposerOnly={exitZenMode}
					onDirectoryChange={onDirectoryChange}
				/>
			) : null,
		[
			chatRef,
			exitZenMode,
			gitBranch,
			onDirectoryChange,
			session,
			sidebarVisible,
			sidebarWidth,
		]
	);

	return (
		<div {...stylex.props(styles.root)}>
			{!session ? (
				<div
					{...stylex.props(styles.pageGrid)}
					style={{ gridTemplateColumns: `${chatPanelWidth}px minmax(0, 1fr)` }}
				>
					<section {...stylex.props(styles.leftPane)}>
						<InactiveSessionTopBar onOpenSettings={openSettings} />
						{null}
						<button
							type="button"
							aria-label="Resize editor chat panel"
							{...stylex.props(styles.chatPanelResize)}
							onMouseDown={onChatPanelDragStart}
						/>
					</section>
					{emptyWorkspace}
				</div>
			) : zenMode ? (
				<EditorWorkspace
					zen
					leading={zenLeading}
					viewer={viewer}
					toolbar={diffToolbar}
					sidebar={diffSidebar}
				/>
			) : (
				<div
					{...stylex.props(styles.pageGrid)}
					style={{ gridTemplateColumns: `${chatPanelWidth}px minmax(0, 1fr)` }}
				>
					<section {...stylex.props(styles.leftPane)}>
						<EditorAgentChat
							session={session}
							chatRef={chatRef}
							gitBranch={gitBranch}
							onClose={closePane}
							sessions={sessions}
							onSelectSession={selectEditorPane}
							onDirectoryChange={onDirectoryChange}
						/>
						<button
							type="button"
							aria-label="Resize editor chat panel"
							{...stylex.props(styles.chatPanelResize)}
							onMouseDown={onChatPanelDragStart}
						/>
					</section>

					<EditorWorkspace
						toolbar={diffToolbar}
						viewer={viewer}
						sidebar={detailsSidebar}
					/>
				</div>
			)}
			{showSettings && (
				<AgentSettingsPanel
					themeId={themeId}
					onThemeChange={() => undefined}
					onClose={setShowSettings.bind(null, false)}
				/>
			)}
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		minHeight: 0,
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	pageGrid: {
		display: "grid",
		minHeight: 0,
		flex: 1,
		gridTemplateColumns: {
			default: "1fr",
			"@media (min-width: 1024px)": "400px minmax(0, 1fr)",
		},
	},
	leftPane: {
		position: "relative",
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
	},
	chatPanelResize: {
		position: "absolute",
		top: 0,
		right: -3,
		bottom: 0,
		zIndex: 40,
		backgroundColor: {
			default: "transparent",
			":hover": color.controlActive,
		},
		borderWidth: 0,
		cursor: "ew-resize",
		padding: 0,
		transitionDuration: "120ms",
		transitionProperty: "background-color",
		width: 6,
	},
	sidebarShell: {
		display: "flex",
		flexShrink: 0,
		flexDirection: "row",
		position: "relative",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.transparent,
	},
	sidebarResize: {
		position: "absolute",
		left: -2,
		top: 0,
		bottom: 0,
		zIndex: 30,
		width: controlSize._1,
		borderWidth: 0,
		cursor: "ew-resize",
		padding: 0,
		backgroundColor: {
			default: "transparent",
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: "120ms",
	},
	sidebarRestore: {
		alignItems: "center",
		backgroundColor: {
			default: color.surfaceGlass,
			":hover": color.controlActive,
		},
		borderLeftColor: color.border,
		borderLeftStyle: "solid",
		borderLeftWidth: 1,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		cursor: "pointer",
		display: "flex",
		flexShrink: 0,
		justifyContent: "center",
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		width: controlSize._8,
	},
	fullHeight: {
		height: "100%",
	},
	emptyWrap: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingInline: controlSize._6,
	},
	emptyCard: {
		maxWidth: "28rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		backgroundColor: color.backgroundRaised,
		padding: controlSize._6,
		textAlign: "center",
	},
	emptyTitle: {
		color: color.textMain,
		fontSize: "0.9375rem",
		fontWeight: 600,
	},
	emptyDescription: {
		marginTop: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_3,
		lineHeight: 1.65,
	},
});
