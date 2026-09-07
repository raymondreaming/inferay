import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useEffect, useRef, useState } from "octane";
import type { DocumentSession } from "../../../../../../build/presentation/contracts/DocumentSession.ts";
import type { FileContent } from "../../../../../../build/presentation/contracts/FileContent.ts";
import { fetchJson, postJson } from "../../../../../adapters/backend/http.ts";
import { APP_REGION_DRAG_CLASS } from "../../../../../app/hooks/useAppAppearance.tsx";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { IconCode, IconX } from "../../../../../shared/ui/Icons/index.tsx";
import { FileSearch } from "../../../../explorer/components/FileSearch/index.tsx";
import { WorkspaceDockHandle } from "../../../components/WorkspaceDockHandle/index.tsx";
import { DocumentTabs } from "./DocumentTabs.tsx";
import { SourcePreview } from "./SourcePreview.tsx";
import { styles } from "./styles.ts";

const fileViewerSessions = new Map<
	string,
	{
		readonly activePath: string | null;
		readonly openFiles: FileContent[];
	}
>();
const readDocument = (cwd: string, path: string) =>
	fetchJson<FileContent>(
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
	workspaceId,
	onSessionChange,
}: {
	readonly cwd: string;
	readonly sessionId?: string;
	readonly initialFile?: FileContent;
	readonly onClose: () => void;
	readonly onFileTabDragStart?: (
		event: PointerEvent,
		file: FileContent,
		completeMove: () => void,
	) => void;
	readonly draggable?: boolean;
	readonly onDragStart?: (event: PointerEvent) => void;
	readonly onDragEnd?: () => void;
	readonly openRequest?: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly workspaceId: string;
	readonly onSessionChange?: (
		sessionId: string,
		session: DocumentSession,
	) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const cachedSession = fileViewerSessions.get(sessionId);
	const [restoreRequest] = useState(() =>
		cachedSession
			? null
			: {
					workspaceId,
					sessionId,
					cwd,
					initialPath: initialFile?.path,
				},
	);
	const closedPaths = useRef(new Set<string>());
	const [openFiles, setOpenFiles] = useState<FileContent[]>(
		cachedSession?.openFiles ?? (initialFile ? [initialFile] : []),
	);
	const [activePath, setActivePath] = useState<string | null>(
		cachedSession?.activePath ?? initialFile?.path ?? null,
	);
	const [restoringSession, setRestoringSession] = useState(
		restoreRequest !== null,
	);
	const activeFile = openFiles.find((file) => file.path === activePath) ?? null;

	useEffect(() => {
		if (restoringSession) return;
		fileViewerSessions.set(sessionId, { activePath, openFiles });
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
		if (!restoreRequest) return;
		let cancelled = false;
		postJson<{ files: FileContent[]; activePath: string | null }>(
			"/api/workspace/documents",
			restoreRequest,
		)
			.then((restored) => {
				if (cancelled) return;
				// Keep tabs opened or closed while the snapshot was loading.
				const files = restored.files.filter(
					(file) => !closedPaths.current.has(file.path),
				);
				setOpenFiles((current) => [
					...files.map(
						(file) => current.find((open) => open.path === file.path) ?? file,
					),
					...current.filter(
						(open) => !files.some((file) => file.path === open.path),
					),
				]);
				setActivePath(
					(current) =>
						current ??
						(closedPaths.current.has(restored.activePath ?? "")
							? (files[0]?.path ?? null)
							: restored.activePath),
				);
				setRestoringSession(false);
			})
			.catch((error) => {
				if (!cancelled)
					setError(
						error instanceof Error ? error.message : "Files could not restore",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [restoreRequest]);

	const openFile = useCallback(
		({ path }: { path: string }) => {
			readDocument(cwd, path)
				.then((file) => {
					closedPaths.current.delete(file.path);
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
			closedPaths.current.add(path);
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
		(event: PointerEvent, file: FileContent) => {
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
				<DocumentTabs
					activePath={activePath}
					onFileTabDragStart={Boolean(onFileTabDragStart)}
					startFileTabDrag={startFileTabDrag}
					setActivePath={setActivePath}
					closeFile={closeFile}
					openFiles={openFiles}
				/>
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
