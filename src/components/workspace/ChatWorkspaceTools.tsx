import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import {
	WORKSPACE_FILE_OPEN_EVENT,
	type WorkspaceFileOpenDetail,
} from "../../features/files/workspace-file-events.ts";
import {
	loadGitFileViewMode,
	saveGitFileViewMode,
} from "../../features/git/file-view-preference.ts";
import {
	getFileSelectionAfterToggle,
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderProjectGitFiles,
	resolveGitFileSelection,
} from "../../features/git/git-file-utils.ts";
import type { GitFileEntry } from "../../features/git/types.ts";
import { useGitChangeActions } from "../../features/git/useGitChangeActions.tsx";
import {
	type DiffRequest,
	summarizeHunkDiff,
	useGitDiff,
} from "../../features/git/useGitDiff.tsx";
import { useGitStatus } from "../../features/git/useGitStatus.tsx";
import { lockPointerSelection } from "../../lib/pointer-selection-lock.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import {
	readStoredJson,
	readStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import {
	type DiffViewMode,
	GitDiffView,
} from "../../pages/Agent/GitDiffView.tsx";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { DiffViewerBoundary } from "../diff/DiffViewerBoundary.tsx";
import { FileTypeIcon } from "../file/FileTypeIcon.tsx";
import {
	ChangeFileSidebar,
	CollapsedChangeFileSidebar,
	getAlphabeticalFileOrder,
	getTreeFileOrder,
	type SelectedFile,
} from "../git/ChangeFileSidebar.tsx";
import {
	IconCollapse,
	IconExpand,
	IconGitBranch,
	IconLayoutGrid,
	IconX,
} from "../ui/Icons.tsx";
import { WorkspaceDockHandle } from "./WorkspaceDockHandle.tsx";
import {
	type FileContentResponse,
	WorkspaceFileViewer,
} from "./WorkspaceFileViewer.tsx";

const SIDEBAR_VISIBLE_KEY = "agent-workspace-changes-visible";
const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";
const DIFF_WIDTH_KEY_PREFIX = "agent-workspace-diff-width:";
const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";
const MIN_SIDEBAR_WIDTH = 230;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_DIFF_WIDTH = 320;
const MAX_DIFF_WIDTH = 820;
const DEFAULT_DIFF_WIDTH = 560;
const MIN_WORKSPACE_CANVAS_WIDTH = 360;

function loadSidebarVisible() {
	return readStoredValue(SIDEBAR_VISIBLE_KEY) !== "false";
}

function loadSidebarWidth() {
	const stored = Number(readStoredValue(SIDEBAR_WIDTH_KEY));
	return Number.isFinite(stored)
		? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
		: DEFAULT_SIDEBAR_WIDTH;
}

function loadDiffWidth(workspaceId: string) {
	const stored = Number(
		readStoredValue(`${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`),
	);
	return Number.isFinite(stored)
		? Math.min(MAX_DIFF_WIDTH, Math.max(MIN_DIFF_WIDTH, stored))
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

type DetachedFilePanel = {
	readonly id: string;
	readonly cwd: string;
	readonly path: string;
	readonly initialFile?: FileContentResponse;
};

type WorkspacePanelSession = {
	readonly fileViewerOpen: boolean;
	readonly fileViewerCwd: string | null;
	readonly diffViewerCwd: string | null;
	readonly focusedAuxiliaryPanel: {
		readonly id: string;
		readonly cwd: string;
	} | null;
	readonly detachedFilePanels: DetachedFilePanel[];
	readonly fileRequest: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly selectedFile: SelectedFile | null;
};

type StateValue<T> = T | ((current: T) => T);

const workspacePanelSessions = new Map<string, WorkspacePanelSession>();
const WORKSPACE_PANEL_SESSION_KEY = "agent-workspace-panels:";

function emptyWorkspacePanelSession(): WorkspacePanelSession {
	return {
		fileViewerOpen: false,
		fileViewerCwd: null,
		diffViewerCwd: null,
		focusedAuxiliaryPanel: null,
		detachedFilePanels: [],
		fileRequest: null,
		selectedFile: null,
	};
}

function loadWorkspacePanelSession(workspaceId: string): WorkspacePanelSession {
	const cached = workspacePanelSessions.get(workspaceId);
	if (cached) return cached;
	const stored = readStoredJson<Partial<WorkspacePanelSession>>(
		`${WORKSPACE_PANEL_SESSION_KEY}${workspaceId}`,
		{},
	);
	const detachedFilePanels = Array.isArray(stored.detachedFilePanels)
		? stored.detachedFilePanels.filter(
				(panel): panel is DetachedFilePanel =>
					typeof panel?.id === "string" &&
					typeof panel.cwd === "string" &&
					typeof panel.path === "string",
			)
		: [];
	const session: WorkspacePanelSession = {
		...emptyWorkspacePanelSession(),
		fileViewerOpen: stored.fileViewerOpen === true,
		fileViewerCwd:
			typeof stored.fileViewerCwd === "string" ? stored.fileViewerCwd : null,
		diffViewerCwd:
			typeof stored.diffViewerCwd === "string" ? stored.diffViewerCwd : null,
		focusedAuxiliaryPanel:
			stored.focusedAuxiliaryPanel &&
			typeof stored.focusedAuxiliaryPanel.id === "string" &&
			typeof stored.focusedAuxiliaryPanel.cwd === "string"
				? stored.focusedAuxiliaryPanel
				: null,
		detachedFilePanels,
		fileRequest:
			stored.fileRequest && typeof stored.fileRequest.path === "string"
				? { path: stored.fileRequest.path, token: Date.now() }
				: null,
		selectedFile:
			stored.selectedFile && typeof stored.selectedFile.path === "string"
				? stored.selectedFile
				: null,
	};
	workspacePanelSessions.set(workspaceId, session);
	return session;
}

function persistWorkspacePanelSession(
	workspaceId: string,
	session: WorkspacePanelSession,
) {
	writeStoredJson(`${WORKSPACE_PANEL_SESSION_KEY}${workspaceId}`, {
		...session,
		detachedFilePanels: session.detachedFilePanels.map((panel) => ({
			id: panel.id,
			cwd: panel.cwd,
			path: panel.path,
		})),
	});
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

function ChatDiffPanel({
	diff,
	file,
	loading,
	onClose,
	viewMode,
	onViewModeChange,
	zenMode,
	onToggleZenMode,
	drag,
}: {
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly file: SelectedFile;
	readonly loading: boolean;
	readonly onClose: () => void;
	readonly viewMode: DiffViewMode;
	readonly onViewModeChange: (mode: DiffViewMode) => void;
	readonly zenMode: boolean;
	readonly onToggleZenMode: () => void;
	readonly drag?: DragProps;
}) {
	const stats = useMemo(() => summarizeHunkDiff(diff), [diff]);
	return (
		<section {...stylex.props(styles.viewerPanel)}>
			<header {...stylex.props(styles.viewerHeader)}>
				{drag ? <WorkspaceDockHandle {...drag} /> : null}
				<FileTypeIcon path={file.path} size={14} />
				<span {...stylex.props(styles.viewerTitle)}>
					{file.path.split("/").pop() ?? file.path}
				</span>
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
				<div {...stylex.props(styles.viewerModes)}>
					<button
						type="button"
						onPointerDown={(event) => {
							if (event.button === 0 && event.isPrimary)
								onViewModeChange("split");
						}}
						onClick={(event) => {
							if (event.detail === 0) onViewModeChange("split");
						}}
						title="Full file diff"
						aria-label="Full file diff"
						{...stylex.props(
							styles.viewerModeButton,
							viewMode === "split" && styles.viewerModeButtonActive,
						)}
					>
						<IconLayoutGrid size={11} />
					</button>
					<button
						type="button"
						onPointerDown={(event) => {
							if (event.button === 0 && event.isPrimary)
								onViewModeChange("hunks");
						}}
						onClick={(event) => {
							if (event.detail === 0) onViewModeChange("hunks");
						}}
						title="Hunk view"
						aria-label="Hunk view"
						{...stylex.props(
							styles.viewerModeButton,
							viewMode === "hunks" && styles.viewerModeButtonActive,
						)}
					>
						<IconGitBranch size={11} />
					</button>
					<button
						type="button"
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
						{zenMode ? <IconCollapse size={11} /> : <IconExpand size={11} />}
					</button>
				</div>
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) onClose();
					}}
					onClick={(event) => {
						if (event.detail === 0) onClose();
					}}
					title="Close change viewer"
					aria-label="Close change viewer"
					{...stylex.props(styles.viewerClose)}
				>
					<IconX size={8} />
				</button>
			</header>
			<div {...stylex.props(styles.viewerBody)}>
				{diff ? (
					<DiffViewerBoundary resetKey={`${file.path}:${file.staged}`}>
						<GitDiffView
							diff={diff}
							filePath={file.path}
							staged={file.staged}
							loading={false}
							onClose={onClose}
							hideHeader
							hideToolbar
							viewMode={viewMode}
							onViewModeChange={onViewModeChange}
						/>
					</DiffViewerBoundary>
				) : !loading ? (
					<div {...stylex.props(styles.viewerEmpty)}>No diff available</div>
				) : null}
			</div>
		</section>
	);
}

export function useChatWorkspaceTools({
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
		fileViewerOpen,
		fileViewerCwd,
		diffViewerCwd,
		focusedAuxiliaryPanel,
		detachedFilePanels,
		fileRequest,
		selectedFile,
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
	const [fileViewMode, setFileViewModeState] = useState(loadGitFileViewMode);
	const [sidebarVisible, setSidebarVisible] = useState(loadSidebarVisible);
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
	const [diffWidth, setDiffWidth] = useState(() => loadDiffWidth(workspaceId));
	const [diffViewMode, setDiffViewModeState] = useState(loadDiffViewMode);
	const [zenMode, setZenMode] = useState(false);
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
	const {
		projectMap,
		refetch,
		applyOptimistic,
		loaded: gitLoaded,
	} = useGitStatus(trackedCwds, { enabled: trackedCwds.length > 0 });
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
						file: selectedFile.path,
						staged: selectedFile.staged,
						view: diffViewMode === "split" ? "full" : "review",
					}
				: null,
		[active, diffViewMode, diffViewerCwd, selectedFile],
	);
	const { diff, loading: diffLoading } = useGitDiff(diffRequest);

	useEffect(() => {
		if (!selectedFile || !diffViewerProject) return;
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
	}, [diffViewerProject, selectedFile, setDiffViewerCwd, setSelectedFile]);
	useEffect(() => {
		if (!active) return;
		setSidebarVisible(loadSidebarVisible());
		setSidebarWidth(loadSidebarWidth());
	}, [active]);
	useEffect(() => {
		setDiffWidth(loadDiffWidth(workspaceId));
	}, [workspaceId]);
	useEffect(() => {
		if (!active) return;
		return listenWindowEvent(WORKSPACE_FILE_OPEN_EVENT, (event) => {
			const detail = (event as CustomEvent<WorkspaceFileOpenDetail>).detail;
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

	const updateSidebarVisible = useCallback((visible: boolean) => {
		setSidebarVisible(visible);
		writeStoredValue(SIDEBAR_VISIBLE_KEY, visible ? "true" : "false");
	}, []);
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
		updatePanelSession((current) => ({
			...current,
			selectedFile: null,
			diffViewerCwd: null,
			focusedAuxiliaryPanel:
				current.focusedAuxiliaryPanel?.id === "workspace-diff-viewer"
					? null
					: current.focusedAuxiliaryPanel,
		}));
	}, [updatePanelSession]);
	const selectChangedFile = useCallback(
		(file: GitFileEntry) => {
			if (!activeCwd) return;
			updatePanelSession((current) => ({
				...current,
				diffViewerCwd: activeCwd,
				selectedFile: { path: file.path, staged: file.staged },
				focusedAuxiliaryPanel: {
					id: "workspace-diff-viewer",
					cwd: activeCwd,
				},
			}));
		},
		[activeCwd, updatePanelSession],
	);
	const focusChatWorkspace = useCallback(
		() =>
			updatePanelSession((current) =>
				current.focusedAuxiliaryPanel
					? { ...current, focusedAuxiliaryPanel: null }
					: current,
			),
		[updatePanelSession],
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
	const handleDiffKeyboardNavigation = useCallback(
		(event: KeyboardEvent) => {
			if (
				focusedAuxiliaryPanel?.id !== "workspace-diff-viewer" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			)
				return;
			const target = event.target as HTMLElement;
			const isEditable =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;
			if (isEditable) return;

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
			cycleChangedFile,
			focusedAuxiliaryPanel?.id,
			keyboardFiles,
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
	const collapseSidebar = useCallback(
		() => updateSidebarVisible(false),
		[updateSidebarVisible],
	);
	const expandSidebar = useCallback(
		() => updateSidebarVisible(true),
		[updateSidebarVisible],
	);
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
			const reservedSidebarWidth = sidebarVisible ? sidebarWidth : 38;
			const availableWidth = Math.max(
				MIN_DIFF_WIDTH,
				workspaceWidth - reservedSidebarWidth - MIN_WORKSPACE_CANVAS_WIDTH,
			);
			const maximumWidth = Math.min(MAX_DIFF_WIDTH, availableWidth);
			const pointerId = event.pointerId;
			diffDragRef.current = {
				startX: event.clientX,
				startWidth: diffWidth,
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
					<WorkspaceFileViewer
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
					<WorkspaceFileViewer
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
		diffViewerCwd && selectedFile ? (
			<aside
				{...stylex.props(styles.diffRail, zenMode && styles.diffRailZen)}
				style={zenMode ? undefined : { width: diffWidth }}
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
					onClose={closeDiffViewer}
					viewMode={diffViewMode}
					onViewModeChange={setDiffViewMode}
					zenMode={zenMode}
					onToggleZenMode={toggleZenMode}
				/>
			</aside>
		) : null;

	const sidebar = (
		<aside
			{...stylex.props(styles.sidebarShell)}
			style={{ width: sidebarVisible ? sidebarWidth : 38 }}
		>
			{sidebarVisible ? (
				<>
					<button
						type="button"
						aria-label="Resize changes sidebar"
						onMouseDown={handleResizeStart}
						{...stylex.props(styles.resizeHandle)}
					/>
					<ChangeFileSidebar
						cwd={activeCwd}
						fileViewMode={fileViewMode}
						onFileViewModeChange={setFileViewMode}
						mainViewMode="diff"
						modified={modified}
						untracked={untracked}
						staged={staged}
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
						hasProject={!!project}
						projectLoading={!!activeCwd && !gitLoaded}
						selectedCommitHash={null}
						commitDetailsLoading={false}
						commitDetails={null}
						files={files}
						branch={project?.branch}
						commitMessage={commitMessage}
						onCommitMessageChange={setCommitMessage}
						onCommit={commit}
						isCommitting={isCommitting}
						amendMode={amendMode}
						onAmendModeChange={setAmendMode}
						showFileActions
						onCollapse={collapseSidebar}
					/>
				</>
			) : (
				<CollapsedChangeFileSidebar
					unstagedCount={modified.length + untracked.length}
					stagedCount={staged.length}
					onExpand={expandSidebar}
				/>
			)}
		</aside>
	);

	return { auxiliaryPanels, diffPanel, focusChatWorkspace, sidebar, zenMode };
}

const styles = stylex.create({
	sidebarShell: {
		position: "relative",
		display: "flex",
		height: "100%",
		minHeight: 0,
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.transparent,
	},
	diffRail: {
		position: "relative",
		display: "flex",
		minWidth: 320,
		height: "100%",
		minHeight: 0,
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.transparent,
		overflow: "visible",
	},
	diffRailZen: {
		minWidth: 0,
		flex: 1,
	},
	diffResizeHandle: {
		position: "absolute",
		zIndex: 30,
		top: 0,
		bottom: 0,
		left: -4,
		width: 8,
		borderWidth: 0,
		padding: 0,
		touchAction: "none",
		backgroundColor: { default: "transparent", ":hover": color.controlActive },
		cursor: "ew-resize",
	},
	resizeHandle: {
		position: "absolute",
		zIndex: 30,
		top: 0,
		bottom: 0,
		left: -3,
		width: 6,
		borderWidth: 0,
		backgroundColor: { default: "transparent", ":hover": color.controlActive },
		cursor: "ew-resize",
	},
	viewerPanel: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: 0,
		minHeight: 0,
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
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._3,
	},
	viewerTitle: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		color: color.textMain,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontWeight: 400,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	viewerStats: {
		display: "flex",
		flexShrink: 0,
		gap: controlSize._1_5,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	viewerModes: {
		display: "flex",
		flexShrink: 0,
		gap: 2,
		borderRadius: 6,
		backgroundColor: color.surfaceControl,
		padding: 2,
	},
	viewerModeButton: {
		display: "flex",
		width: controlSize._5,
		height: controlSize._5,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 4,
		backgroundColor: { default: "transparent", ":hover": color.controlHover },
		color: color.textMuted,
	},
	viewerModeButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	viewerAdded: { color: "#32e875" },
	viewerRemoved: { color: "#ff5252" },
	viewerAction: {
		display: "flex",
		height: controlSize._6,
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		color: color.textSoft,
		fontSize: font.size_1,
		paddingInline: controlSize._2,
	},
	viewerClose: {
		display: "flex",
		width: controlSize._5,
		height: controlSize._5,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: { default: "transparent", ":hover": color.dangerWash },
		color: { default: color.textMuted, ":hover": color.danger },
	},
	viewerBody: { minHeight: 0, flex: 1, overflow: "hidden" },
	viewerEmpty: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
