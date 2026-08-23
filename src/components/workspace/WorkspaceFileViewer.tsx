import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useEffect, useMemo, useState } from "octane";
import {
	useShikiSnippet,
	useSyntaxHighlightTheme,
} from "../../hooks/useShikiHighlighter.tsx";
import { fetchJson } from "../../lib/fetch-json.ts";
import { indexedValues } from "../../lib/indexed-values.ts";
import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";
import { FileTypeIcon } from "../file/FileTypeIcon.tsx";
import {
	WorkspaceFileSearch,
	type WorkspaceFileSearchResult,
} from "../file/WorkspaceFileSearch.tsx";
import { IconCode, IconX } from "../ui/Icons.tsx";
import { WorkspaceDockHandle } from "./WorkspaceDockHandle.tsx";

export type FileContentResponse = {
	readonly content: string;
	readonly cwd: string;
	readonly path: string;
	readonly size: number;
	readonly updatedAt: number;
};

function fileName(path: string) {
	return path.split("/").pop() || path;
}

type FileViewerSession = {
	readonly activePath: string | null;
	readonly openFiles: FileContentResponse[];
};

type PersistedFileViewerSession = {
	readonly cwd: string;
	readonly activePath: string | null;
	readonly paths: string[];
};

const fileViewerSessions = new Map<string, FileViewerSession>();

function fileViewerStorageKey(sessionId: string) {
	return `agent-workspace-files:${sessionId}`;
}

function readPersistedFileViewerSession(
	sessionId: string,
	cwd: string,
): PersistedFileViewerSession | null {
	const stored = readStoredJson<PersistedFileViewerSession | null>(
		fileViewerStorageKey(sessionId),
		null,
	);
	if (!stored || stored.cwd !== cwd || !Array.isArray(stored.paths))
		return null;
	return {
		cwd,
		activePath:
			typeof stored.activePath === "string" ? stored.activePath : null,
		paths: stored.paths.filter(
			(path, index, paths) =>
				typeof path === "string" && !!path && paths.indexOf(path) === index,
		),
	};
}

function escapeHtml(text: string) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/\x3c/g, "&lt;")
		.replace(/\x3e/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

const SourcePreview = memo(function SourcePreview({
	file,
}: {
	file: FileContentResponse;
}) {
	const [syntaxTheme] = useSyntaxHighlightTheme();
	const lines = useMemo(() => file.content.split("\n"), [file.content]);
	const { highlighted } = useShikiSnippet(lines, file.path, true, syntaxTheme);
	return (
		<div {...stylex.props(styles.sourceScroll)}>
			<div {...stylex.props(styles.sourceTable)}>
				{indexedValues(lines).map(({ index, value }) => (
					<div key={index} {...stylex.props(styles.sourceLine)}>
						<span {...stylex.props(styles.lineNumber)}>{index + 1}</span>
						<span
							{...stylex.props(styles.sourceCode)}
							dangerouslySetInnerHTML={{
								__html: highlighted.get(index) ?? escapeHtml(value || " "),
							}}
						/>
					</div>
				))}
			</div>
		</div>
	);
});

export const WorkspaceFileViewer = memo(function WorkspaceFileViewer({
	cwd,
	sessionId = cwd,
	initialFile,
	onClose,
	onFileTabDragStart,
	draggable,
	onDragStart,
	onDragEnd,
	openRequest,
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
}) {
	const [, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cachedSession = fileViewerSessions.get(sessionId);
	const [persistedSession] = useState(() =>
		cachedSession ? null : readPersistedFileViewerSession(sessionId, cwd),
	);
	const pathsToRestore = useMemo(
		() =>
			(persistedSession?.paths ?? []).filter(
				(path) => path !== initialFile?.path,
			),
		[initialFile?.path, persistedSession],
	);
	const [openFiles, setOpenFiles] = useState<FileContentResponse[]>(
		cachedSession?.openFiles ?? (initialFile ? [initialFile] : []),
	);
	const [activePath, setActivePath] = useState<string | null>(
		cachedSession?.activePath ??
			persistedSession?.activePath ??
			initialFile?.path ??
			null,
	);
	const [restoringSession, setRestoringSession] = useState(
		pathsToRestore.length > 0,
	);
	const activeFile = openFiles.find((file) => file.path === activePath) ?? null;

	useEffect(() => {
		fileViewerSessions.set(sessionId, { activePath, openFiles });
		if (restoringSession) return;
		writeStoredJson<PersistedFileViewerSession>(
			fileViewerStorageKey(sessionId),
			{
				cwd,
				activePath,
				paths: openFiles.map((file) => file.path),
			},
		);
	}, [activePath, cwd, openFiles, restoringSession, sessionId]);

	useEffect(() => {
		if (pathsToRestore.length === 0) return;
		let cancelled = false;
		Promise.all(
			pathsToRestore.map((path) => {
				const params = new URLSearchParams({ cwd, path });
				return fetchJson<FileContentResponse>(
					`/api/files/content?${params}`,
				).catch(() => null);
			}),
		).then((restoredFiles) => {
			if (cancelled) return;
			const available = restoredFiles.filter(
				(file): file is FileContentResponse => file !== null,
			);
			setOpenFiles((current) => {
				const byPath = new Map(
					[...current, ...available].map((file) => [file.path, file]),
				);
				return (persistedSession?.paths ?? [])
					.map((path) => byPath.get(path))
					.filter((file): file is FileContentResponse => !!file);
			});
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
	}, [cwd, initialFile, pathsToRestore, persistedSession?.paths]);

	const openFile = useCallback(
		(result: WorkspaceFileSearchResult | null) => {
			if (!result) return;
			setLoading(true);
			const params = new URLSearchParams({ cwd, path: result.path });
			fetchJson<FileContentResponse>(`/api/files/content?${params}`)
				.then((file) => {
					setOpenFiles((current) => {
						const existingIndex = current.findIndex(
							(openFile) => openFile.path === file.path,
						);
						if (existingIndex < 0) return [...current, file];
						return current.map((openFile, index) =>
							index === existingIndex ? file : openFile,
						);
					});
					setActivePath(file.path);
					setError(null);
				})
				.catch((nextError) => {
					setError(
						nextError instanceof Error
							? nextError.message
							: "File could not open",
					);
				})
				.finally(() => setLoading(false));
		},
		[cwd],
	);
	useEffect(() => {
		if (!openRequest) return;
		openFile({
			isDir: false,
			name: fileName(openRequest.path),
			path: openRequest.path,
		});
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
			<header {...stylex.props(styles.header)}>
				<WorkspaceDockHandle
					draggable={draggable}
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
				/>
				<div {...stylex.props(styles.fileTabs)}>
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
										onClick={() => setActivePath(file.path)}
										{...stylex.props(styles.fileTabSelect)}
									>
										<FileTypeIcon path={file.path} size={13} />
										<span {...stylex.props(styles.fileTabName)}>
											{fileName(file.path)}
										</span>
									</button>
									<button
										type="button"
										aria-label={`Close ${fileName(file.path)}`}
										onClick={(event) => {
											event.stopPropagation();
											closeFile(file.path);
										}}
										{...stylex.props(styles.fileTabClose)}
									>
										<IconX size={8} />
									</button>
								</div>
							))
						: null}
				</div>
				<WorkspaceFileSearch cwd={cwd} onSelect={openFile} placement="panel" />
				<button
					type="button"
					onClick={onClose}
					title="Close file viewer"
					aria-label="Close file viewer"
					{...stylex.props(styles.iconButton)}
				>
					<IconX size={8} />
				</button>
			</header>

			<div {...stylex.props(styles.body)}>
				{activeFile ? (
					<SourcePreview file={activeFile} />
				) : (
					<div {...stylex.props(styles.emptyState)}>
						<IconCode size={18} />
						<span>Search above to open a file.</span>
					</div>
				)}
			</div>
			{error ? <div {...stylex.props(styles.error)}>{error}</div> : null}
		</section>
	);
});

const styles = stylex.create({
	root: {
		display: "flex",
		width: "100%",
		maxWidth: "100%",
		height: "100%",
		flex: 1,
		minWidth: 0,
		minHeight: 0,
		flexDirection: "column",
		overflow: "hidden",
		backgroundColor: color.transparent,
	},
	header: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
		minWidth: 0,
		paddingLeft: controlSize._2,
		paddingRight: controlSize._1,
	},
	fileTabs: {
		display: "flex",
		width: "auto",
		minWidth: 0,
		height: "100%",
		flex: 1,
		alignItems: "stretch",
		overflowX: "auto",
		overflowY: "hidden",
	},
	fileTab: {
		display: "flex",
		minWidth: 92,
		maxWidth: 180,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
		backgroundColor: color.transparent,
		color: { default: color.textMuted, ":hover": color.textMain },
		paddingInline: controlSize._2,
		cursor: "grab",
	},
	fileTabActive: {
		backgroundColor: color.surfaceControl,
		color: color.textMain,
	},
	fileTabSelect: {
		display: "flex",
		minWidth: 0,
		flex: 1,
		height: "100%",
		alignItems: "center",
		gap: controlSize._1_5,
		backgroundColor: color.transparent,
		color: "inherit",
	},
	fileTabName: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
	},
	fileTabClose: {
		display: "flex",
		width: controlSize._4,
		height: controlSize._4,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	iconButton: {
		display: "flex",
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		backgroundColor: { default: "transparent", ":hover": color.dangerWash },
		color: { default: color.textMuted, ":hover": color.danger },
	},
	body: {
		position: "relative",
		display: "flex",
		width: "100%",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	emptyState: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "column",
		gap: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
		textAlign: "center",
	},
	sourceScroll: {
		flex: 1,
		minWidth: 0,
		minHeight: 0,
		overflow: "auto",
		contain: "layout paint style",
	},
	sourceTable: {
		width: "max-content",
		minWidth: "100%",
		paddingBlock: controlSize._2,
		fontFamily: font.familyMono,
		fontSize: 9,
		lineHeight: "14px",
	},
	sourceLine: {
		display: "grid",
		gridTemplateColumns: "36px minmax(0, 1fr)",
		contentVisibility: "auto",
		containIntrinsicSize: "auto 14px",
	},
	lineNumber: {
		position: "sticky",
		left: 0,
		paddingRight: controlSize._2,
		backgroundColor: color.surfaceGlass,
		color: color.textFaint,
		fontSize: 9,
		textAlign: "right",
		userSelect: "none",
	},
	sourceCode: { paddingRight: controlSize._5, whiteSpace: "pre" },
	error: {
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.dangerBorder,
		backgroundColor: color.dangerWash,
		color: color.danger,
		fontSize: font.size_1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
});
