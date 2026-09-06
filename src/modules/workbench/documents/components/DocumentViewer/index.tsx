import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useEffect, useMemo, useState } from "octane";
import { fetchJson } from "../../../../../adapters/backend/http.ts";
import { readStoredJson } from "../../../../../adapters/storage/stored-values.ts";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../../../app/model/appearance.ts";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { basename as fileName } from "../../../../../shared/lib/data.ts";
import { IconCode, IconX } from "../../../../../shared/ui/Icons/index.tsx";
import { FileSearch } from "../../../../explorer/components/FileSearch/index.tsx";
import { FileTypeIcon } from "../../../../explorer/components/FileTypeIcon/index.tsx";
import { WorkspaceDockHandle } from "../../../components/WorkspaceDockHandle/index.tsx";
import type {
	FileContentResponse,
	GitWorkspaceDocumentSession,
} from "../../../model/workbench-model.ts";
import { SourcePreview } from "./SourcePreview.tsx";
import { styles } from "./styles.ts";

const fileViewerSessions = new Map<
	string,
	{
		readonly activePath: string | null;
		readonly openFiles: FileContentResponse[];
	}
>();
const readDocument = (cwd: string, path: string) =>
	fetchJson<FileContentResponse>(
		`/api/files/content?${new URLSearchParams({ cwd, path })}`,
	);

export const DocumentViewer = memo(function DocumentViewer({
	cwd,
	sessionId = cwd,
	initialFile,
	onClose,
	onFileTabDragStart,
	draggable,
	onDragStart,
	onDragEnd,
	openRequest,
	persistedSession,
	onSessionChange,
}: {
	readonly cwd: string;
	readonly sessionId?: string;
	readonly initialFile?: FileContentResponse;
	readonly onClose: () => void;
	readonly onFileTabDragStart?: (
		event: PointerEvent,
		file: FileContentResponse,
		completeMove: () => void,
	) => void;
	readonly draggable?: boolean;
	readonly onDragStart?: (event: PointerEvent) => void;
	readonly onDragEnd?: () => void;
	readonly openRequest?: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly persistedSession?: GitWorkspaceDocumentSession;
	readonly onSessionChange?: (
		sessionId: string,
		session: GitWorkspaceDocumentSession,
	) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const cachedSession = fileViewerSessions.get(sessionId);
	const [restoredSession] = useState(() => {
		if (cachedSession) return null;
		const saved =
			persistedSession ??
			readStoredJson<GitWorkspaceDocumentSession | null>(
				`agent-workspace-files:${sessionId}`,
				null,
			);
		if (saved?.cwd !== cwd || !Array.isArray(saved.paths)) return null;
		const paths = saved.paths.filter(
			(path, index) =>
				typeof path === "string" &&
				!!path &&
				saved.paths.indexOf(path) === index,
		);
		return {
			cwd,
			paths,
			activePath:
				typeof saved.activePath === "string" && paths.includes(saved.activePath)
					? saved.activePath
					: null,
		};
	});
	const pathsToRestore = useMemo(
		() =>
			(restoredSession?.paths ?? []).filter(
				(path) => path !== initialFile?.path,
			),
		[initialFile?.path, restoredSession],
	);
	const [openFiles, setOpenFiles] = useState<FileContentResponse[]>(
		cachedSession?.openFiles ?? (initialFile ? [initialFile] : []),
	);
	const [activePath, setActivePath] = useState<string | null>(
		cachedSession?.activePath ??
			restoredSession?.activePath ??
			initialFile?.path ??
			null,
	);
	const [restoringSession, setRestoringSession] = useState(
		pathsToRestore.length > 0,
	);
	const activeFile = openFiles.find((file) => file.path === activePath) ?? null;

	useEffect(() => {
		fileViewerSessions.set(sessionId, { activePath, openFiles });
		if (!restoringSession)
			onSessionChange?.(sessionId, {
				cwd,
				activePath,
				paths: openFiles.map((file) => file.path),
			});
	}, [
		activePath,
		cwd,
		onSessionChange,
		openFiles,
		restoringSession,
		sessionId,
	]);

	useEffect(() => {
		if (pathsToRestore.length === 0) return;
		let cancelled = false;
		Promise.all(
			pathsToRestore.map((path) => readDocument(cwd, path).catch(() => null)),
		).then((files) => {
			if (cancelled) return;
			const available = files.filter(
				(file): file is FileContentResponse => file !== null,
			);
			setOpenFiles((current) =>
				(restoredSession?.paths ?? [])
					.map((path) =>
						[...current, ...available].find((file) => file.path === path),
					)
					.filter((file): file is FileContentResponse => !!file),
			);
			const availablePaths = new Set([
				...(initialFile ? [initialFile.path] : []),
				...available.map((file) => file.path),
			]);
			setActivePath((current) =>
				current && availablePaths.has(current)
					? current
					: (available[0]?.path ?? initialFile?.path ?? null),
			);
			setRestoringSession(false);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd, initialFile, pathsToRestore, restoredSession]);

	const openFile = useCallback(
		({ path }: { path: string }) => {
			readDocument(cwd, path)
				.then((file) => {
					setOpenFiles((current) =>
						current.some((open) => open.path === file.path)
							? current.map((open) => (open.path === file.path ? file : open))
							: [...current, file],
					);
					setActivePath(file.path);
					setError(null);
				})
				.catch((nextError) => {
					setError(
						nextError instanceof Error
							? nextError.message
							: "File could not open",
					);
				});
		},
		[cwd],
	);
	useEffect(() => {
		if (openRequest) openFile(openRequest);
	}, [openFile, openRequest]);
	const closeFile = useCallback(
		(path: string) => {
			const index = openFiles.findIndex((file) => file.path === path);
			const next = openFiles.filter((file) => file.path !== path);
			setOpenFiles(next);
			if (activePath === path) {
				setActivePath(next[Math.min(index, next.length - 1)]?.path ?? null);
			}
		},
		[activePath, openFiles],
	);
	const startFileTabDrag = useCallback(
		(event: PointerEvent, file: FileContentResponse) => {
			if (!onFileTabDragStart) return;
			if ((event.target as HTMLElement).closest("button")) return;
			event.stopPropagation();
			onFileTabDragStart(event, file, () => {
				closeFile(file.path);
				if (openFiles.length === 1) onClose();
			});
		},
		[closeFile, onClose, onFileTabDragStart, openFiles.length],
	);

	return (
		<section {...stylex.props(styles.root)}>
			<header
				{...stylex.props(styles.header)}
				className={`${APP_REGION_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
			>
				<WorkspaceDockHandle
					draggable={draggable}
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
				/>
				<div
					{...stylex.props(styles.fileTabs)}
					className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.fileTabs).className ?? ""}`}
				>
					{openFiles.length > 0
						? openFiles.map((file) => (
								<div
									key={file.path}
									data-workspace-dock-drag-source={
										onFileTabDragStart ? "true" : undefined
									}
									onPointerDown={(event) => startFileTabDrag(event, file)}
									{...stylex.props(
										styles.fileTab,
										file.path === activePath && styles.fileTabActive,
									)}
								>
									<button
										type="button"
										onPointerDown={(event) => {
											if (event.button === 0 && event.isPrimary)
												setActivePath(file.path);
										}}
										onClick={(event) => {
											if (event.detail === 0) setActivePath(file.path);
										}}
										{...stylex.props(styles.fileTabSelect)}
									>
										<FileTypeIcon path={file.path} size={iconSize._2md} />
										<span {...stylex.props(styles.fileTabName)}>
											{fileName(file.path)}
										</span>
									</button>
									<button
										type="button"
										aria-label={`Close ${fileName(file.path)}`}
										onPointerDown={(event) => {
											event.stopPropagation();
											if (event.button === 0 && event.isPrimary)
												closeFile(file.path);
										}}
										onClick={(event) => {
											event.stopPropagation();
											if (event.detail === 0) closeFile(file.path);
										}}
										{...stylex.props(styles.fileTabClose)}
									>
										<IconX size={iconSize.xs} />
									</button>
								</div>
							))
						: null}
				</div>
				<FileSearch cwd={cwd} onSelect={openFile} placement="panel" />
				<button
					type="button"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary) onClose();
					}}
					onClick={(event) => {
						if (event.detail === 0) onClose();
					}}
					title="Close file viewer"
					aria-label="Close file viewer"
					{...stylex.props(styles.iconButton)}
				>
					<IconX size={iconSize.xs} />
				</button>
			</header>

			<div {...stylex.props(styles.body)}>
				{activeFile ? (
					<SourcePreview file={activeFile} />
				) : (
					<div {...stylex.props(styles.emptyState)}>
						<IconCode size={iconSize._2xl} />
						<span>Search above to open a file.</span>
					</div>
				)}
			</div>
			{error ? <div {...stylex.props(styles.error)}>{error}</div> : null}
		</section>
	);
});
