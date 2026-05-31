import * as stylex from "@stylexjs/stylex";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AgentChatHandle,
	AgentChatView,
} from "../../components/chat/AgentChatView.tsx";
import { DiffViewerBoundary } from "../../components/diff/DiffViewerBoundary.tsx";
import {
	ChangeFileSidebar,
	type SelectedFile,
} from "../../components/git/ChangeFileSidebar.tsx";
import { CommitGraph } from "../../components/git/CommitGraph.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import {
	IconCollapse,
	IconExpand,
	IconGitBranch,
	IconLayoutGrid,
	IconPanelLeft,
	IconPlus,
	IconX,
} from "../../components/ui/Icons.tsx";
import { WorkspaceEmptyState } from "../../components/ui/WorkspacePage.tsx";
import { useActivityFeed } from "../../features/activity-feed/useActivityFeed.ts";
import { isChatAgentKind } from "../../features/agents/agents.ts";
import { useAgentSessions } from "../../features/agents/useAgentSessions.ts";
import { useFileWatcher } from "../../features/file-watcher/useFileWatcher.ts";
import { loadPendingWorkspacePaths } from "../../features/chat/chat-session-store.ts";
import {
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderProjectGitFiles,
} from "../../features/git/git-file-utils.ts";
import { useGitChangeActions } from "../../features/git/useGitChangeActions.ts";
import {
	type DiffRequest,
	summarizeHunkDiff,
	useGitDiff,
} from "../../features/git/useGitDiff.ts";
import {
	useCommitDetails,
	useGitGraph,
} from "../../features/git/useGitGraph.ts";
import { useGitStatus } from "../../features/git/useGitStatus.ts";
import {
	loadTerminalState,
	type TerminalGroupModel,
} from "../../features/terminal/terminal-utils.ts";
import {
	incrementNumber,
	isNonEmptyString,
	toggleBoolean,
} from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	readStoredValue,
	removeStoredValue,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import { wsClient } from "../../lib/websocket.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { type DiffViewMode, GitDiffView } from "../Terminal/GitDiffView.tsx";

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
}

let cachedKey = "";
let cachedSessions: Session[] = [];

function flattenSessions(groups: TerminalGroupModel[]): Session[] {
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
			].join("\u0001")
		)
		.join("\u0002");
	if (key === cachedKey) return cachedSessions;
	cachedKey = key;
	cachedSessions = next;
	return next;
}

function loadZenMode() {
	return readStoredValue("terminal-editor-zen") === "true";
}

interface EditorPageProps {
	groups?: TerminalGroupModel[];
	selectedGroupId?: string | null;
	onSelectPane?: (paneId: string) => void;
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[]
	) => void;
}

export function EditorPage({
	groups: liveGroups,
	selectedGroupId: liveSelectedGroupId,
	onSelectPane,
	onDirectoryChange,
}: EditorPageProps = {}) {
	const [, setTick] = useState(0);
	const [selectedPaneId, setSelectedPaneId] = useState<string | null>(
		() => readStoredValue("editor-selected-pane") ?? null
	);
	const [selectedFiles, setSelectedFiles] = useState<
		Record<string, SelectedFile | null>
	>({});
	const [, setAgentStatuses] = useState<Map<string, string>>(new Map());
	const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>("split");
	const [closedPaneIds, setClosedPaneIds] = useState<Set<string>>(new Set());
	const [scrollToChange, setScrollToChange] = useState(0);
	const [zenMode, setZenMode] = useState(loadZenMode);
	const [sidebarWidth, setSidebarWidth] = useState(280); // Default 17.5rem
	const [sidebarVisible, setSidebarVisible] = useState(true);
	const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
		null
	);
	const [fileViewMode, setFileViewMode] = useState<"path" | "tree">("tree");
	const [mainViewMode, setMainViewMode] = useState<"diff" | "graph">("diff");
	const chatRef = useRef<AgentChatHandle>(null);
	const sidebarDragRef = useRef<{
		startX: number;
		startWidth: number;
	} | null>(null);

	const [sessionVersion, setSessionVersion] = useState(0);
	const terminalState = useMemo(
		() => (liveGroups ? null : loadTerminalState()),
		[liveGroups, sessionVersion]
	);
	const sourceGroups = liveGroups ?? terminalState?.groups ?? [];
	const activeGroupId =
		liveSelectedGroupId ?? terminalState?.selectedGroupId ?? null;
	const visibleGroups = useMemo(() => {
		const activeGroup = sourceGroups.find(
			(group) => group.id === activeGroupId
		);
		return activeGroup ? [activeGroup] : sourceGroups;
	}, [activeGroupId, sourceGroups]);
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
	const { sessions: liveAgentSessions } = useAgentSessions();
	const trackedDirs = useMemo(
		() => [...new Set(sessions.map((s) => s.cwd).filter(isNonEmptyString))],
		[sessions]
	);
	const {
		projectMap,
		refetch: refetchGit,
		applyOptimistic,
	} = useGitStatus(trackedDirs);
	const {
		diff,
		request,
		loading: diffLoading,
		loadDiff,
		clear: clearDiff,
	} = useGitDiff();
	const selectedDiffStats = useMemo(() => summarizeHunkDiff(diff), [diff]);

	const refresh = useCallback(() => setTick(incrementNumber), []);
	useEffect(wsClient.connect.bind(wsClient), []);

	useEffect(() => {
		const id = setInterval(refresh, 5000);
		return () => clearInterval(id);
	}, [refresh]);

	useEffect(() => {
		setAgentStatuses((cur) => {
			const next = new Map(cur);
			for (const s of liveAgentSessions) {
				const existing = next.get(s.paneId);
				if (!existing || existing === "idle" || existing === "thinking") {
					next.set(s.paneId, s.isRunning ? "thinking" : "idle");
				}
			}
			return next;
		});
	}, [liveAgentSessions]);

	useEffect(() => {
		if (effectiveSelectedPaneId) {
			writeStoredValue("editor-selected-pane", effectiveSelectedPaneId);
		} else {
			removeStoredValue("editor-selected-pane");
		}
	}, [effectiveSelectedPaneId]);

	const sessionIdx = useMemo(
		() => sessions.findIndex((s) => s.paneId === effectiveSelectedPaneId),
		[effectiveSelectedPaneId, sessions]
	);
	const session =
		sessionIdx >= 0 ? sessions[sessionIdx] : (sessions[0] ?? null);
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
		onRefresh: refresh,
		applyOptimistic,
		refetchStatus: refetchGit,
	});
	const project = session?.cwd ? (projectMap.get(session.cwd) ?? null) : null;
	const files = useMemo(
		(orderProjectGitFiles<{
			path: string;
			staged: boolean;
			status: string;
		}>).bind(null, project),
		[project]
	);
	const staged = project?.files.filter(isStagedChange) ?? [];
	const modified = project?.files.filter(isUnstagedTrackedChange) ?? [];
	const untracked = project?.files.filter(isUntrackedChange) ?? [];
	const selectedFile = session ? (selectedFiles[session.paneId] ?? null) : null;
	const {
		commits: graphCommits,
		rows: graphRows,
		loading: graphLoading,
	} = useGitGraph(mainViewMode === "graph" ? session?.cwd : undefined, 100);
	const { details: commitDetails, loading: commitDetailsLoading } =
		useCommitDetails(
			mainViewMode === "graph" ? session?.cwd : undefined,
			selectedCommitHash ?? undefined
		);

	const selectFile = useCallback(
		(paneId: string, req: DiffRequest) => {
			setSelectedFiles((cur) => ({
				...cur,
				[paneId]: { path: req.file, staged: req.staged },
			}));
			loadDiff(req);
		},
		[loadDiff]
	);

	useActivityFeed({
		paneId: session?.paneId,
		cwd: session?.cwd,
	});

	const { checkPendingScroll } = useFileWatcher({
		enabled: zenMode,
		cwd: session?.cwd,
		paneId: session?.paneId,
		currentFile: request?.file,
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
			refresh();
			setTimeout(setScrollToChange, 50, incrementNumber);
		}, [refresh]),
	});

	const updateZenMode = useCallback((next: boolean) => {
		setZenMode(next);
		writeStoredValue("terminal-editor-zen", next ? "true" : "false");
		window.dispatchEvent(new Event("terminal-shell-change"));
	}, []);

	useEffect(() => {
		const syncEditorShellState = () => {
			setZenMode(loadZenMode());
			setSessionVersion(incrementNumber);
			// Re-read selected pane (sidebar may have changed it)
			const storedPane = readStoredValue("editor-selected-pane");
			if (storedPane) setSelectedPaneId(storedPane);
		};
		return listenWindowEvent("terminal-shell-change", syncEditorShellState);
	}, []);

	useEffect(() => {
		if (diff && !diffLoading) checkPendingScroll();
	}, [diff, diffLoading, checkPendingScroll]);

	const selectedFilesRef = useRef(selectedFiles);
	selectedFilesRef.current = selectedFiles;
	const requestRef = useRef(request);
	requestRef.current = request;

	useEffect(() => {
		if (!session?.cwd) {
			clearDiff();
			return;
		}
		if (!files.length) {
			clearDiff();
			setSelectedFiles((cur) => ({ ...cur, [session.paneId]: null }));
			return;
		}

		const cur = selectedFilesRef.current[session.paneId] ?? null;
		const match = cur
			? files.find((f) => f.path === cur.path && f.staged === cur.staged)
			: null;
		const target = match ?? files[0]!;

		if (!cur || cur.path !== target.path || cur.staged !== target.staged) {
			setSelectedFiles((c) => ({
				...c,
				[session.paneId]: { path: target.path, staged: target.staged },
			}));
		}

		const req = requestRef.current;
		if (
			req?.cwd !== session.cwd ||
			req?.file !== target.path ||
			req?.staged !== target.staged
		) {
			loadDiff({ cwd: session.cwd, file: target.path, staged: target.staged });
		}
	}, [clearDiff, files, loadDiff, session]);

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
			const f = files[next]!;
			selectFile(session.paneId, {
				cwd: session.cwd,
				file: f.path,
				staged: f.staged,
			});
		},
		[files, selectFile, selectedFile, session]
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isEditable =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;
			if (isEditable) return;

			if (e.key === "ArrowDown") {
				e.preventDefault();
				cycleFile(1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				cycleFile(-1);
			}
		};
		return listenWindowEvent("keydown", onKey);
	}, [cycleFile]);

	const closePane = useCallback(
		(paneId: string) => {
			setClosedPaneIds((prev) => new Set(prev).add(paneId));
			if (effectiveSelectedPaneId === paneId) {
				const rest = sessions.filter((s) => s.paneId !== paneId);
				setSelectedPaneId(rest[0]?.paneId ?? null);
			}
		},
		[effectiveSelectedPaneId, sessions]
	);
	const selectEditorPane = useCallback(
		(paneId: string) => {
			setSelectedPaneId(paneId);
			onSelectPane?.(paneId);
		},
		[onSelectPane]
	);

	const handleAgentStatusChange = useCallback((id: string, status: string) => {
		setAgentStatuses((cur) => {
			if (cur.get(id) === status) return cur;
			return new Map(cur).set(id, status);
		});
	}, []);

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
		[sidebarWidth]
	);

	const viewer =
		mainViewMode === "diff" ? (
			diffLoading ? (
				<Placeholder label="Loading diff..." />
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
					label={project ? "Select a changed file" : "No diff available"}
				/>
			)
		) : graphLoading ? (
			<Placeholder label="Loading graph..." />
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
		files,
		branch: project?.branch,
		commitMessage,
		onCommitMessageChange: setCommitMessage,
		onCommit: commit,
		isCommitting,
		amendMode,
		onAmendModeChange: setAmendMode,
	};
	const diffSidebar = sidebarVisible ? (
		<div {...stylex.props(styles.sidebarShell)} style={{ width: sidebarWidth }}>
			<div
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
		</div>
	) : null;
	const detailsSidebar = sidebarVisible ? (
		<div {...stylex.props(styles.sidebarShell)} style={{ width: sidebarWidth }}>
			<div
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
		</div>
	) : null;
	const emptyWorkspace = (
		<EditorWorkspace
			viewer={<Placeholder label="No diff available" />}
			sidebar={diffSidebar}
		/>
	);

	return (
		<div {...stylex.props(styles.root)}>
			{!session ? (
				<div {...stylex.props(styles.pageGrid)}>
					<section {...stylex.props(styles.leftPane)}>
						<div {...stylex.props(styles.topBar)}>
							<span {...stylex.props(styles.topBarLabel)}>
								No active session
							</span>
						</div>
						<EmptyState />
					</section>
					{emptyWorkspace}
				</div>
			) : zenMode ? (
				/* ===== ZEN MODE LAYOUT ===== */
				<EditorWorkspace
					zen
					leading={
						<EditorAgentChat
							session={session}
							chatRef={chatRef}
							onStatusChange={handleAgentStatusChange}
							composerOnly
							composerOnlyOffsetX={sidebarVisible ? -(sidebarWidth / 2) : 0}
							onExitComposerOnly={() => updateZenMode(false)}
							onDirectoryChange={onDirectoryChange}
						/>
					}
					viewer={viewer}
					sidebar={diffSidebar}
				/>
			) : (
				/* ===== NORMAL MODE LAYOUT ===== */
				<div {...stylex.props(styles.pageGrid)}>
					<section {...stylex.props(styles.leftPane)}>
						<EditorAgentChat
							session={session}
							chatRef={chatRef}
							onStatusChange={handleAgentStatusChange}
							onClose={closePane}
							sessions={sessions}
							onSelectSession={selectEditorPane}
							onDirectoryChange={onDirectoryChange}
						/>
					</section>

					<EditorWorkspace
						toolbar={
							<DiffViewerTopBar
								mainViewMode={mainViewMode}
								diffViewMode={diffViewMode}
								filePath={request?.file}
								selectedFile={selectedFile}
								diffStats={selectedDiffStats}
								sidebarVisible={sidebarVisible}
								onStageFile={stageFile}
								onUnstageFile={unstageFile}
								onToggleSidebar={setSidebarVisible.bind(null, toggleBoolean)}
								onMainViewModeChange={setMainViewMode}
								onDiffViewModeChange={setDiffViewMode}
								zenMode={zenMode}
								onToggleZenMode={() => updateZenMode(true)}
							/>
						}
						viewer={viewer}
						sidebar={detailsSidebar}
					/>
				</div>
			)}
		</div>
	);
}

function EmptyState() {
	return (
		<div {...stylex.props(styles.emptySurface)}>
			<WorkspaceEmptyState
				icon={<IconPanelLeft size={16} />}
				title="No active editor session"
				description="Open a chat pane with a repository to inspect its changes, review diffs, and keep the agent conversation beside the code."
			/>
		</div>
	);
}

function Placeholder({ label }: { label: string }) {
	return (
		<div {...stylex.props(styles.centerFull, styles.centerPad)}>
			<WorkspaceEmptyState
				icon={<IconGitBranch size={16} />}
				title={label}
				description={
					label.startsWith("Loading")
						? "Inferay is preparing the selected repository view."
						: label === "Select a changed file"
							? "Choose a file from the changes sidebar to inspect its diff, stage it, or send targeted context to the active agent."
							: "Diffs will appear here when the selected editor session has a repository and changed files."
				}
			/>
		</div>
	);
}

function EditorWorkspace({
	leading,
	toolbar,
	viewer,
	sidebar,
	zen,
}: {
	leading?: ReactNode;
	toolbar?: ReactNode;
	viewer: ReactNode;
	sidebar: ReactNode;
	zen?: boolean;
}) {
	const body = (
		<>
			{leading}
			<div {...stylex.props(toolbar ? styles.viewerColumn : styles.viewerPane)}>
				{toolbar}
				{toolbar ? (
					<div {...stylex.props(styles.diffHost)}>{viewer}</div>
				) : (
					viewer
				)}
			</div>
			{sidebar}
		</>
	);

	return zen ? (
		<div {...stylex.props(styles.zenLayout)}>{body}</div>
	) : (
		<aside {...stylex.props(styles.rightPane)}>
			<div {...stylex.props(styles.splitBody)}>{body}</div>
		</aside>
	);
}

function EditorAgentChat({
	session,
	chatRef,
	onStatusChange,
	onClose,
	sessions,
	onSelectSession,
	onDirectoryChange,
	composerOnly,
	composerOnlyOffsetX,
	onExitComposerOnly,
}: {
	session: Session;
	chatRef: React.RefObject<AgentChatHandle | null>;
	onStatusChange: (paneId: string, status: string) => void;
	onClose?: (paneId: string) => void;
	sessions?: Session[];
	onSelectSession?: (paneId: string) => void;
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[]
	) => void;
	composerOnly?: boolean;
	composerOnlyOffsetX?: number;
	onExitComposerOnly?: () => void;
}) {
	return (
		<AgentChatView
			key={session.paneId}
			ref={chatRef}
			paneId={session.paneId}
			cwd={session.cwd}
			referencePaths={session.referencePaths}
			agentKind={session.agentKind}
			onStatusChange={onStatusChange}
			onClose={onClose}
			sessions={sessions}
			onSelectSession={onSelectSession}
			onDirectoryChange={onDirectoryChange}
			composerOnly={composerOnly}
			composerOnlyOffsetX={composerOnlyOffsetX}
			onExitComposerOnly={onExitComposerOnly}
		/>
	);
}

function ToolbarButton({
	active,
	title,
	icon,
	onClick,
}: {
	active: boolean;
	title: string;
	icon: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			{...stylex.props(
				styles.toolbarButton,
				active && styles.toolbarButtonActive
			)}
		>
			{icon}
		</button>
	);
}

/* ── Top-bar components ─────────────────────────────────── */

function DiffViewerTopBar({
	mainViewMode,
	diffViewMode,
	filePath,
	selectedFile,
	diffStats,
	sidebarVisible,
	onStageFile,
	onUnstageFile,
	onToggleSidebar,
	onMainViewModeChange,
	onDiffViewModeChange,
	zenMode,
	onToggleZenMode,
}: {
	mainViewMode: "diff" | "graph";
	diffViewMode: DiffViewMode;
	filePath?: string;
	selectedFile: SelectedFile | null;
	diffStats: ReturnType<typeof summarizeHunkDiff>;
	sidebarVisible: boolean;
	onStageFile: (path: string) => void;
	onUnstageFile: (path: string) => void;
	onToggleSidebar: () => void;
	onMainViewModeChange: (mode: "diff" | "graph") => void;
	onDiffViewModeChange: (mode: DiffViewMode) => void;
	zenMode: boolean;
	onToggleZenMode: () => void;
}) {
	const fileActionTitle = selectedFile?.staged ? "Unstage file" : "Stage file";
	return (
		<div {...stylex.props(styles.topBar)}>
			<div {...stylex.props(styles.segmented)}>
				<button
					type="button"
					onClick={() => onMainViewModeChange("diff")}
					{...stylex.props(
						styles.segmentButton,
						mainViewMode === "diff" && styles.segmentButtonActive
					)}
				>
					Diff
				</button>
				<button
					type="button"
					onClick={() => onMainViewModeChange("graph")}
					{...stylex.props(
						styles.segmentButton,
						mainViewMode === "graph" && styles.segmentButtonActive
					)}
				>
					Graph
				</button>
			</div>

			{filePath && (
				<span {...stylex.props(styles.filePathLabel)}>{filePath}</span>
			)}
			{filePath && mainViewMode === "diff" && (
				<span {...stylex.props(styles.diffStatsLabel)}>
					<span>
						{diffStats.hunks} hunk{diffStats.hunks === 1 ? "" : "s"}
					</span>
					{diffStats.added > 0 && (
						<span {...stylex.props(styles.addedText)}>+{diffStats.added}</span>
					)}
					{diffStats.removed > 0 && (
						<span {...stylex.props(styles.deletedText)}>
							-{diffStats.removed}
						</span>
					)}
				</span>
			)}
			{filePath && selectedFile && (
				<IconButton
					type="button"
					title={fileActionTitle}
					onClick={() =>
						selectedFile.staged
							? onUnstageFile(selectedFile.path)
							: onStageFile(selectedFile.path)
					}
					variant="subtle"
					size="xs"
				>
					{selectedFile.staged ? <IconX size={10} /> : <IconPlus size={10} />}
				</IconButton>
			)}
			<span {...stylex.props(styles.spacer)} />

			<div {...stylex.props(styles.segmented)}>
				<ToolbarButton
					active={diffViewMode === "split"}
					title="Split diff"
					onClick={() => onDiffViewModeChange("split")}
					icon={<IconLayoutGrid size={11} />}
				/>
				<ToolbarButton
					active={diffViewMode === "hunks"}
					title="Hunk view"
					onClick={() => onDiffViewModeChange("hunks")}
					icon={<IconGitBranch size={11} />}
				/>
				<ToolbarButton
					active={sidebarVisible}
					title={
						sidebarVisible ? "Hide changes sidebar" : "Show changes sidebar"
					}
					onClick={onToggleSidebar}
					icon={<IconPanelLeft size={11} />}
				/>
				<ToolbarButton
					active={zenMode}
					title={zenMode ? "Exit focus mode" : "Focus editor"}
					onClick={onToggleZenMode}
					icon={zenMode ? <IconCollapse size={11} /> : <IconExpand size={11} />}
				/>
			</div>
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		minHeight: 0,
		flexDirection: "column",
		backgroundColor: color.background,
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
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
	},
	rightPane: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		backgroundColor: color.background,
	},
	splitBody: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	viewerPane: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	viewerColumn: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
	},
	diffHost: {
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	sidebarShell: {
		display: "flex",
		flexShrink: 0,
		flexDirection: "row",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.background,
	},
	sidebarResize: {
		width: controlSize._1,
		flexShrink: 0,
		cursor: "ew-resize",
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
			default: color.background,
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
	zenLayout: {
		position: "relative",
		display: "flex",
		minHeight: 0,
		flex: 1,
	},
	fullHeight: {
		height: "100%",
	},
	centerFull: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
	},
	centerPad: {
		paddingInline: controlSize._6,
	},
	topBar: {
		display: "flex",
		height: controlSize._10,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._3,
	},
	topBarLabel: {
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	spacer: {
		flex: 1,
	},
	emptySurface: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingInline: controlSize._5,
	},
	toolbarButton: {
		display: "flex",
		height: "100%",
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		":hover": {
			color: color.textSoft,
		},
	},
	toolbarButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	segmented: {
		display: "flex",
		height: controlSize._5,
		alignItems: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "0.375rem",
		backgroundColor: color.backgroundRaised,
	},
	segmentButton: {
		height: "100%",
		color: color.textMuted,
		fontSize: "0.5rem",
		fontWeight: font.weight_5,
		paddingInline: controlSize._2,
		transitionProperty: "background-color, color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.controlHover,
		},
		":hover": {
			color: color.textSoft,
		},
	},
	segmentButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	filePathLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_1,
	},
	diffStatsLabel: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		gap: controlSize._1,
	},
	addedText: {
		color: color.gitAdded,
	},
	deletedText: {
		color: color.gitDeleted,
	},
});
