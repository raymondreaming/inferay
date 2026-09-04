import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import { fetchJson } from "../../../../adapters/backend/http.ts";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../../adapters/storage/stored-values.ts";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../../../../app/model/theme.ts";
import { iconSize } from "../../../../design-system.ts";
import {
	shouldDisableSnippetHighlighting,
	useShikiHighlighter,
	useSyntaxHighlightTheme,
} from "../../../../shared/hooks/useShikiHighlighter.tsx";
import { indexedValues } from "../../../../shared/lib/indexed-values.ts";
import { IconCode, IconX } from "../../../../shared/ui/Icons.tsx";
import { color, controlSize, font, radius } from "../../../../tokens.stylex.ts";
import { FileTypeIcon } from "../../../explorer/components/FileTypeIcon.tsx";
import { FileSearch, type FileSearchResult } from "../../../explorer/index.ts";
import { WorkspaceDockHandle } from "../../components/WorkspaceDockHandle.tsx";

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

const SOURCE_LINE_HEIGHT = 14;
const SOURCE_OVERSCAN_LINES = 30;
const MAX_SOURCE_LINE_CHARS = 12_000;

function visibleLineContent(line: string) {
	if (line.length <= MAX_SOURCE_LINE_CHARS) return line || " ";
	return `${line.slice(0, MAX_SOURCE_LINE_CHARS)} … [line truncated]`;
}

const SourcePreview = memo(function SourcePreview({
	file,
}: {
	file: FileContentResponse;
}) {
	const [syntaxTheme] = useSyntaxHighlightTheme();
	const lines = useMemo(() => file.content.split("\n"), [file.content]);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState({ scrollTop: 0, height: 800 });
	const start = Math.max(
		0,
		Math.floor(viewport.scrollTop / SOURCE_LINE_HEIGHT) - SOURCE_OVERSCAN_LINES,
	);
	const end = Math.min(
		lines.length,
		Math.ceil((viewport.scrollTop + viewport.height) / SOURCE_LINE_HEIGHT) +
			SOURCE_OVERSCAN_LINES,
	);
	const syntaxEnabled = useMemo(
		() => !shouldDisableSnippetHighlighting(lines),
		[lines],
	);
	const { getHighlightedLineTokens, isReady, language } = useShikiHighlighter({
		filePath: file.path,
		lines,
		visibleRange: [start, Math.max(start, end - 1)],
		theme: syntaxTheme,
		enabled: syntaxEnabled,
	});
	const visibleLines = useMemo(
		() => lines.slice(start, end),
		[lines, start, end],
	);
	const minContentChars = useMemo(() => {
		let longest = 0;
		for (const line of lines) {
			longest = Math.max(longest, Math.min(line.length, MAX_SOURCE_LINE_CHARS));
			if (longest === MAX_SOURCE_LINE_CHARS) break;
		}
		return Math.max(80, longest + 8);
	}, [lines]);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		scroller.scrollTop = 0;
		setViewport({ scrollTop: 0, height: scroller.clientHeight || 800 });
		const observer = new ResizeObserver((entries) => {
			const height = entries[0]?.contentRect.height;
			if (!height) return;
			setViewport((current) =>
				current.height === height ? current : { ...current, height },
			);
		});
		observer.observe(scroller);
		return () => observer.disconnect();
	}, [file.path]);

	return (
		<div
			ref={scrollRef}
			onScroll={(event) =>
				setViewport((current) => ({
					...current,
					scrollTop: event.currentTarget.scrollTop,
				}))
			}
			{...stylex.props(styles.sourceScroll)}
		>
			<div
				{...stylex.props(styles.sourceCanvas)}
				style={{
					height: lines.length * SOURCE_LINE_HEIGHT + 16,
					minWidth: `max(100%, ${minContentChars}ch)`,
				}}
			>
				<div
					{...stylex.props(styles.sourceTable)}
					style={{
						transform: `translate3d(0, ${start * SOURCE_LINE_HEIGHT + 8}px, 0)`,
					}}
				>
					{indexedValues(visibleLines).map(({ index, value }) => {
						const absoluteIndex = start + index;
						const tokens =
							isReady && language && value.length <= MAX_SOURCE_LINE_CHARS
								? getHighlightedLineTokens(absoluteIndex)
								: undefined;
						return (
							<div key={absoluteIndex} {...stylex.props(styles.sourceLine)}>
								<span {...stylex.props(styles.lineNumber)}>
									{absoluteIndex + 1}
								</span>
								<span {...stylex.props(styles.sourceCode)}>
									{tokens?.length
										? tokens.map((token, tokenIndex) => (
												<span
													key={tokenIndex}
													style={{
														color: token.color,
														backgroundColor: token.bgColor,
													}}
												>
													{token.content}
												</span>
											))
										: visibleLineContent(value)}
								</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
});

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
		(result: FileSearchResult | null) => {
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

const styles = stylex.create({
	root: {
		display: "flex",
		width: "100%",
		maxWidth: "100%",
		height: "100%",
		flex: 1,
		minWidth: controlSize._0,
		minHeight: controlSize._0,
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
		minWidth: controlSize._0,
		paddingLeft: controlSize._2,
		paddingRight: controlSize._1,
	},
	fileTabs: {
		display: "flex",
		width: "auto",
		minWidth: controlSize._0,
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
		minWidth: controlSize._0,
		flex: 1,
		height: "100%",
		alignItems: "center",
		gap: controlSize._1_5,
		backgroundColor: color.transparent,
		color: "inherit",
	},
	fileTabName: {
		minWidth: controlSize._0,
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
		backgroundColor: { default: color.transparent, ":hover": color.dangerWash },
		color: { default: color.textMuted, ":hover": color.danger },
	},
	body: {
		position: "relative",
		display: "flex",
		width: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
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
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "auto",
		contain: "layout paint style",
	},
	sourceTable: {
		position: "absolute",
		top: controlSize._0,
		left: controlSize._0,
		width: "100%",
		minWidth: "100%",
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: "14px",
	},
	sourceCanvas: {
		position: "relative",
		width: "100%",
	},
	sourceLine: {
		display: "grid",
		height: controlSize._3_5,
		gridTemplateColumns: "36px minmax(0, 1fr)",
	},
	lineNumber: {
		position: "sticky",
		left: controlSize._0,
		paddingRight: controlSize._2,
		backgroundColor: color.background,
		color: color.textFaint,
		fontSize: font.size_1,
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
