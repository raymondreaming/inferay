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
	isStagedChange,
	isUnstagedTrackedChange,
	isUntrackedChange,
	orderProjectGitFiles,
} from "../../features/git/git-file-utils.ts";
import { useGitChangeActions } from "../../features/git/useGitChangeActions.tsx";
import {
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
import { GitDiffView } from "../../pages/Agent/GitDiffView.tsx";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { DiffViewerBoundary } from "../diff/DiffViewerBoundary.tsx";
import { FileTypeIcon } from "../file/FileTypeIcon.tsx";
import {
	ChangeFileSidebar,
	CollapsedChangeFileSidebar,
	type SelectedFile,
} from "../git/ChangeFileSidebar.tsx";
import { IconX } from "../ui/Icons.tsx";
import { WorkspaceDockHandle } from "./WorkspaceDockHandle.tsx";
import {
	type FileContentResponse,
	WorkspaceFileViewer,
} from "./WorkspaceFileViewer.tsx";

const SIDEBAR_VISIBLE_KEY = "agent-workspace-changes-visible";
const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";
const DIFF_WIDTH_KEY_PREFIX = "agent-workspace-diff-width:";
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
	drag,
}: {
	readonly diff: ReturnType<typeof useGitDiff>["diff"];
	readonly file: SelectedFile;
	readonly loading: boolean;
	readonly onClose: () => void;
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
				<button
					type="button"
					onClick={onClose}
					title="Close change viewer"
					aria-label="Close change viewer"
					{...stylex.props(styles.viewerClose)}
				>
					<IconX size={8} />
				</button>
			</header>
			<div {...stylex.props(styles.viewerBody)}>
				{loading ? (
					<div {...stylex.props(styles.viewerEmpty)}>Loading change…</div>
				) : diff ? (
					<DiffViewerBoundary resetKey={`${file.path}:${file.staged}`}>
						<GitDiffView
							diff={diff}
							filePath={file.path}
							staged={file.staged}
							loading={false}
							onClose={onClose}
							hideHeader
							hideToolbar
							viewMode="hunks"
						/>
					</DiffViewerBoundary>
				) : (
					<div {...stylex.props(styles.viewerEmpty)}>No diff available</div>
				)}
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
	const setFileViewerOpen = useCallback(
		(value: StateValue<boolean>) => setPanelField("fileViewerOpen", value),
		[setPanelField],
	);
	const setFileViewerCwd = useCallback(
		(value: StateValue<string | null>) => setPanelField("fileViewerCwd", value),
		[setPanelField],
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
	const setFileRequest = useCallback(
		(value: StateValue<WorkspacePanelSession["fileRequest"]>) =>
			setPanelField("fileRequest", value),
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
	const staged = project?.files.filter(isStagedChange) ?? [];
	const modified = project?.files.filter(isUnstagedTrackedChange) ?? [];
	const untracked = project?.files.filter(isUntrackedChange) ?? [];
	const files = useMemo(() => orderProjectGitFiles(project), [project]);
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
	const diffRequest =
		active && diffViewerCwd && selectedFile
			? {
					cwd: diffViewerCwd,
					file: selectedFile.path,
					staged: selectedFile.staged,
				}
			: null;
	const { diff, loading: diffLoading } = useGitDiff(diffRequest);

	useEffect(() => {
		if (!selectedFile || !diffViewerProject) return;
		const current = diffViewerProject.files.find(
			(file) => file.path === selectedFile.path,
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
			setFileViewerCwd(detail.cwd);
			setFocusedAuxiliaryPanel({
				id: "workspace-file-viewer",
				cwd: detail.cwd,
			});
			setFileRequest({ path: detail.path, token: Date.now() });
			setFileViewerOpen(true);
		});
	}, [
		active,
		setFileRequest,
		setFileViewerCwd,
		setFileViewerOpen,
		setFocusedAuxiliaryPanel,
	]);

	const updateSidebarVisible = useCallback((visible: boolean) => {
		setSidebarVisible(visible);
		writeStoredValue(SIDEBAR_VISIBLE_KEY, visible ? "true" : "false");
	}, []);
	const setFileViewMode = useCallback((mode: "path" | "tree") => {
		setFileViewModeState(mode);
		saveGitFileViewMode(mode);
	}, []);
	const closeFileViewer = useCallback(() => {
		setFileViewerOpen(false);
		setFocusedAuxiliaryPanel((current) =>
			current?.id === "workspace-file-viewer" ? null : current,
		);
	}, [setFileViewerOpen, setFocusedAuxiliaryPanel]);
	const closeDiffViewer = useCallback(() => {
		setSelectedFile(null);
		setDiffViewerCwd(null);
		setFocusedAuxiliaryPanel((current) =>
			current?.id === "workspace-diff-viewer" ? null : current,
		);
	}, [setDiffViewerCwd, setFocusedAuxiliaryPanel, setSelectedFile]);
	const selectChangedFile = useCallback(
		(file: SelectedFile) => {
			if (!activeCwd) return;
			setDiffViewerCwd(activeCwd);
			setSelectedFile(file);
			setFocusedAuxiliaryPanel({
				id: "workspace-diff-viewer",
				cwd: activeCwd,
			});
		},
		[activeCwd, setDiffViewerCwd, setFocusedAuxiliaryPanel, setSelectedFile],
	);
	const focusChatWorkspace = useCallback(
		() => setFocusedAuxiliaryPanel(null),
		[setFocusedAuxiliaryPanel],
	);
	const handleResizeStart = useCallback(
		(event: MouseEvent) => {
			event.preventDefault();
			const releaseSelection = lockPointerSelection();
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
				setSidebarWidth(width);
			};
			const end = () => {
				releaseSelection();
				writeStoredValue(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
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
				setDiffWidth(width);
			};
			const end = (endEvent: PointerEvent) => {
				if (endEvent.pointerId !== pointerId) return;
				releaseSelection();
				writeStoredValue(
					`${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`,
					String(diffWidthRef.current),
				);
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
				{...stylex.props(styles.diffRail)}
				style={{ width: diffWidth }}
				onPointerDownCapture={() =>
					setFocusedAuxiliaryPanel({
						id: "workspace-diff-viewer",
						cwd: diffViewerCwd,
					})
				}
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
						onCollapse={() => updateSidebarVisible(false)}
					/>
				</>
			) : (
				<CollapsedChangeFileSidebar
					unstagedCount={modified.length + untracked.length}
					stagedCount={staged.length}
					onExpand={() => updateSidebarVisible(true)}
				/>
			)}
		</aside>
	);

	return { auxiliaryPanels, diffPanel, focusChatWorkspace, sidebar };
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
