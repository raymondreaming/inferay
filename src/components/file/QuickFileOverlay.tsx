import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type React from "react";
import {
	useShikiSnippet,
	useSyntaxHighlightTheme,
} from "../../hooks/useShikiHighlighter.tsx";
import { fetchJson, postJson } from "../../lib/fetch-json.ts";
import { listenWindowEvent, setInputValue } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { IconCheck, IconCode, IconSearch, IconX } from "../ui/Icons.tsx";

type FileSearchResult = {
	name: string;
	path: string;
	isDir: boolean;
	cwd?: string;
};

type FileSearchResponse = {
	cwd: string;
	cwds?: string[];
	results: FileSearchResult[];
};

type FileContentResponse = {
	content: string;
	cwd: string;
	path: string;
	size: number;
	updatedAt: number;
};

const EDITOR_LINE_HEIGHT_PX = 20;

function fileName(path: string) {
	return path.split("/").pop() || path;
}

function parentPath(path: string) {
	const name = fileName(path);
	return path === name ? "" : path;
}

function resultDetail(result: FileSearchResult, hasMultipleCwds: boolean) {
	const path = parentPath(result.path);
	if (!hasMultipleCwds || !result.cwd) return path;
	const root = fileName(result.cwd);
	return path ? `${path} - ${root}` : root;
}

function escapeHtml(text: string) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/\x3c/g, "&lt;")
		.replace(/\x3e/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function SyntaxEditor({
	filePath,
	value,
	onInput,
	onKeyDown,
	editorRef,
}: {
	filePath: string;
	value: string;
	onInput: (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	editorRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
	const highlightRef = useRef<HTMLDivElement | null>(null);
	const [syntaxTheme] = useSyntaxHighlightTheme();
	const lines = useMemo(() => value.split("\n"), [value]);
	const { highlighted } = useShikiSnippet(lines, filePath, true, syntaxTheme);
	const syncScroll = useCallback(
		(event: UIEvent & { currentTarget: HTMLTextAreaElement }) => {
			if (!highlightRef.current) return;
			highlightRef.current.scrollTop = event.currentTarget.scrollTop;
			highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
		},
		[]
	);

	return (
		<div {...stylex.props(styles.syntaxEditorWrap)}>
			<div
				ref={highlightRef}
				aria-hidden="true"
				{...stylex.props(styles.syntaxLayer)}
			>
				{lines.map((line, lineIndex) => (
					<div key={lineIndex} {...stylex.props(styles.syntaxLine)}>
						<span {...stylex.props(styles.syntaxLineNumber)}>
							{lineIndex + 1}
						</span>
						<span
							{...stylex.props(styles.syntaxCode)}
							dangerouslySetInnerHTML={{
								__html: highlighted.get(lineIndex) ?? escapeHtml(line || " "),
							}}
						/>
					</div>
				))}
			</div>
			<textarea
				ref={editorRef}
				value={value}
				onInput={onInput}
				onKeyDown={onKeyDown}
				onScroll={syncScroll}
				wrap="off"
				spellCheck={false}
				{...stylex.props(styles.editor)}
			/>
		</div>
	);
}

export function QuickFileOverlay() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [cwdLabel, setCwdLabel] = useState("");
	const [results, setResults] = useState<FileSearchResult[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [activeFile, setActiveFile] = useState<FileContentResponse | null>(
		null
	);
	const [draft, setDraft] = useState("");
	const [saved, setSaved] = useState(false);
	const [saving, setSaving] = useState(false);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const editorRef = useRef<HTMLTextAreaElement | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const selected = results[selectedIndex] ?? null;
	const dirty = activeFile ? draft !== activeFile.content : false;

	const close = useCallback(() => {
		setOpen(false);
		setError(null);
		setActiveFile(null);
		setDraft("");
		setSaved(false);
	}, []);

	const openSearch = useCallback(() => {
		setOpen(true);
		setError(null);
		setSaved(false);
		setTimeout(() => searchInputRef.current?.focus(), 0);
	}, []);

	useEffect(() => {
		return listenWindowEvent("keydown", (event) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				openSearch();
			}
		});
	}, [openSearch]);

	useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			setLoading(true);
			const params = new URLSearchParams({
				q: query,
				limit: "50",
			});
			fetchJson<FileSearchResponse>(`/api/files/search?${params.toString()}`, {
				signal: controller.signal,
			})
				.then((data) => {
					setCwdLabel(
						data.cwds && data.cwds.length > 1
							? `${data.cwds.length} active directories`
							: data.cwd
					);
					setResults(data.results);
					setSelectedIndex(0);
					setError(null);
				})
				.catch((err) => {
					if (controller.signal.aborted) return;
					setError(err instanceof Error ? err.message : "Search failed");
				})
				.finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
		}, 90);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [open, query]);

	const openFile = useCallback(
		(file: FileSearchResult | null) => {
			if (!file || file.isDir) return;
			const fileCwd = file.cwd ?? cwdLabel;
			setLoading(true);
			fetchJson<FileContentResponse>(
				`/api/files/content?cwd=${encodeURIComponent(fileCwd)}&path=${encodeURIComponent(file.path)}`
			)
				.then((data) => {
					setActiveFile(data);
					setDraft(data.content);
					setError(null);
					setSaved(false);
					setTimeout(() => editorRef.current?.focus(), 0);
				})
				.catch((err) => {
					setError(err instanceof Error ? err.message : "File could not open");
				})
				.finally(() => setLoading(false));
		},
		[cwdLabel]
	);

	const saveFile = useCallback(
		async (shouldClose = false) => {
			if (!activeFile || saving) return;
			setSaving(true);
			setSaved(false);
			try {
				const data = await postJson<FileContentResponse>("/api/files/content", {
					content: draft,
					cwd: activeFile.cwd,
					path: activeFile.path,
				});
				setActiveFile({ ...data, content: draft });
				setSaved(true);
				if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
				saveTimerRef.current = setTimeout(() => setSaved(false), 1200);
				if (shouldClose) close();
			} catch (err) {
				setError(err instanceof Error ? err.message : "File could not save");
			} finally {
				setSaving(false);
			}
		},
		[activeFile, close, draft, saving]
	);

	useEffect(
		() => () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		},
		[]
	);

	const handleSearchKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((idx) =>
					results.length ? Math.min(results.length - 1, idx + 1) : 0
				);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex((idx) => (results.length ? Math.max(0, idx - 1) : 0));
			} else if (event.key === "Enter") {
				event.preventDefault();
				openFile(selected);
			}
		},
		[close, openFile, results.length, selected]
	);

	const handleEditorKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape" && !dirty) {
				event.preventDefault();
				close();
			} else if ((event.metaKey || event.ctrlKey) && event.key === "s") {
				event.preventDefault();
				void saveFile(false);
			}
		},
		[close, dirty, saveFile]
	);

	const fileRows = useMemo(() => {
		const cwdCount = new Set(
			results.map((result) => result.cwd).filter(Boolean)
		).size;
		const hasMultipleCwds = cwdCount > 1;
		return results.map((result, index) => {
			const active = index === selectedIndex;
			const opened =
				activeFile?.path === result.path && activeFile.cwd === result.cwd;
			const detail = resultDetail(result, hasMultipleCwds);
			return (
				<button
					key={`${result.cwd ?? ""}:${result.path}`}
					type="button"
					onMouseEnter={() => setSelectedIndex(index)}
					onClick={() => openFile(result)}
					disabled={result.isDir}
					{...stylex.props(
						styles.resultRow,
						active && styles.resultRowActive,
						opened && styles.resultRowOpen,
						result.isDir && styles.resultRowDisabled
					)}
				>
					<IconCode size={13} {...stylex.props(styles.resultIcon)} />
					<span {...stylex.props(styles.resultText)}>
						<span {...stylex.props(styles.resultName)}>
							{fileName(result.path)}
						</span>
						{detail && (
							<span {...stylex.props(styles.resultPath)}>{detail}</span>
						)}
					</span>
				</button>
			);
		});
	}, [activeFile?.cwd, activeFile?.path, openFile, results, selectedIndex]);

	if (!open) return null;

	return (
		<div
			{...stylex.props(styles.overlay)}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !dirty) close();
			}}
		>
			<section {...stylex.props(styles.workspacePanel)}>
				<div
					{...stylex.props(styles.searchPanel)}
					onKeyDown={handleSearchKeyDown}
				>
					<div {...stylex.props(styles.searchBar)}>
						<IconSearch size={15} {...stylex.props(styles.searchIcon)} />
						<div {...stylex.props(styles.searchInputStack)}>
							<input
								ref={searchInputRef}
								type="text"
								value={query}
								onInput={setInputValue.bind(null, setQuery)}
								placeholder="Search files"
								{...stylex.props(styles.searchInput)}
							/>
							<span {...stylex.props(styles.cwdLabel)}>{cwdLabel}</span>
						</div>
						<button
							type="button"
							onClick={close}
							{...stylex.props(styles.iconButton)}
							title="Close"
						>
							<IconX size={13} />
						</button>
					</div>
					<div {...stylex.props(styles.resultList)}>
						{fileRows}
						{!loading && results.length === 0 && (
							<div {...stylex.props(styles.emptyText)}>No files found</div>
						)}
					</div>
					<div {...stylex.props(styles.footer)}>
						<span>{results.length} results</span>
						<span>Arrow keys</span>
						<span>Enter opens</span>
					</div>
				</div>
				<div {...stylex.props(styles.editorPanel)}>
					{activeFile ? (
						<>
							<div {...stylex.props(styles.editorTopBar)}>
								<div {...stylex.props(styles.editorTitle)}>
									<span {...stylex.props(styles.editorFileName)}>
										{fileName(activeFile.path)}
									</span>
									<span {...stylex.props(styles.editorPath)}>
										{activeFile.path}
									</span>
								</div>
								<span {...stylex.props(styles.saveState)}>
									{saving ? "Saving" : saved ? "Saved" : dirty ? "Unsaved" : ""}
								</span>
								<button
									type="button"
									onClick={() => {
										setActiveFile(null);
										setDraft("");
									}}
									{...stylex.props(styles.secondaryButton)}
								>
									Close
								</button>
								<button
									type="button"
									onClick={() => void saveFile(true)}
									disabled={!dirty || saving}
									{...stylex.props(styles.primaryButton)}
								>
									<IconCheck size={12} />
									Save and close
								</button>
								<button
									type="button"
									onClick={() => void saveFile(false)}
									disabled={!dirty || saving}
									{...stylex.props(styles.primaryButton)}
								>
									Save
								</button>
							</div>
							<SyntaxEditor
								filePath={activeFile.path}
								value={draft}
								onInput={setInputValue.bind(null, setDraft)}
								onKeyDown={handleEditorKeyDown}
								editorRef={editorRef}
							/>
						</>
					) : (
						<div {...stylex.props(styles.emptyEditor)}>
							<IconCode size={18} />
							<span>Select a file to preview and edit</span>
						</div>
					)}
					{error && <div {...stylex.props(styles.errorText)}>{error}</div>}
				</div>
			</section>
		</div>
	);
}

const styles = stylex.create({
	overlay: {
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.72)",
		display: "flex",
		inset: 0,
		justifyContent: "center",
		padding: controlSize._6,
		position: "fixed",
		zIndex: 1000,
	},
	searchPanel: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-black) 94%, var(--color-inferay-dark-gray) 6%)",
		borderRightColor: color.borderSubtle,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		overflow: "hidden",
		width: "22rem",
	},
	workspacePanel: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-black) 96%, var(--color-inferay-dark-gray) 4%)",
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"0 24px 60px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.025)",
		display: "grid",
		gridTemplateColumns: "minmax(18rem, 22rem) minmax(0, 1fr)",
		height: "min(78vh, 46rem)",
		overflow: "hidden",
		width: "min(72rem, calc(100vw - 4rem))",
	},
	searchBar: {
		alignItems: "center",
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._2,
		minHeight: controlSize._12,
		paddingInline: controlSize._3,
	},
	searchInputStack: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: 0,
	},
	searchIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	searchInput: {
		backgroundColor: color.transparent,
		color: color.textMain,
		flex: 1,
		fontFamily: font.familyMono,
		fontSize: font.size_5,
		minWidth: 0,
		outline: "none",
	},
	cwdLabel: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	iconButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		borderRadius: radius.sm,
		color: color.textMuted,
		display: "flex",
		height: controlSize._7,
		justifyContent: "center",
		width: controlSize._7,
	},
	resultList: {
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		overflowY: "auto",
		paddingBlock: controlSize._1,
	},
	resultRow: {
		alignItems: "center",
		backgroundColor: color.transparent,
		color: color.textSoft,
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "1rem minmax(0, 1fr)",
		minHeight: controlSize._12,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
		textAlign: "left",
	},
	resultRowActive: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-accent) 10%, transparent)",
		color: color.textMain,
	},
	resultRowOpen: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-accent) 14%, transparent)",
	},
	resultRowDisabled: {
		opacity: 0.48,
	},
	resultIcon: {
		color: color.textMuted,
	},
	resultName: {
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	resultText: {
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
	},
	resultPath: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	footer: {
		alignItems: "center",
		borderTopColor: color.borderSubtle,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		gap: controlSize._3,
		justifyContent: "space-between",
		minHeight: controlSize._8,
		paddingInline: controlSize._3,
	},
	emptyText: {
		color: color.textMuted,
		fontSize: font.size_3,
		padding: controlSize._6,
		textAlign: "center",
	},
	errorText: {
		backgroundColor: color.dangerWash,
		borderTopColor: color.dangerBorder,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		color: color.danger,
		fontSize: font.size_2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	editorPanel: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-black) 97%, var(--color-inferay-dark-gray) 3%)",
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		overflow: "hidden",
	},
	editorTopBar: {
		alignItems: "center",
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._2,
		minHeight: controlSize._12,
		paddingInline: controlSize._3,
	},
	emptyEditor: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		flex: 1,
		flexDirection: "column",
		fontSize: font.size_3,
		gap: controlSize._2,
		justifyContent: "center",
	},
	editorTitle: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		minWidth: 0,
	},
	editorFileName: {
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	editorPath: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	saveState: {
		color: color.textMuted,
		fontSize: font.size_2,
		minWidth: controlSize._12,
		textAlign: "right",
	},
	secondaryButton: {
		backgroundColor: {
			default: color.surfaceInset,
			":hover": color.surfaceControl,
		},
		borderRadius: radius.sm,
		color: color.textSoft,
		fontSize: font.size_2,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	primaryButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.textMain,
			":hover": color.textSoft,
			":disabled": color.surfaceInset,
		},
		borderRadius: radius.sm,
		color: {
			default: color.background,
			":disabled": color.textMuted,
		},
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		gap: controlSize._1,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
	},
	syntaxEditorWrap: {
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-black) 98%, var(--color-inferay-dark-gray) 2%)",
		flex: 1,
		minHeight: 0,
		position: "relative",
	},
	syntaxLayer: {
		boxSizing: "border-box",
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		inset: 0,
		lineHeight: `${EDITOR_LINE_HEIGHT_PX}px`,
		overflow: "hidden",
		paddingBlock: controlSize._4,
		position: "absolute",
		tabSize: 2,
		whiteSpace: "pre",
		width: "100%",
	},
	syntaxLine: {
		display: "grid",
		gridTemplateColumns: "3rem minmax(0, 1fr)",
		height: `${EDITOR_LINE_HEIGHT_PX}px`,
	},
	syntaxLineNumber: {
		color: color.textFaint,
		fontSize: font.size_1,
		paddingInlineEnd: controlSize._2,
		textAlign: "right",
		userSelect: "none",
	},
	syntaxCode: {
		minWidth: 0,
		paddingInlineEnd: controlSize._4,
	},
	editor: {
		backgroundColor: color.transparent,
		borderWidth: 0,
		boxSizing: "border-box",
		caretColor: color.textSoft,
		color: "transparent",
		flex: 1,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		height: "100%",
		inset: 0,
		lineHeight: `${EDITOR_LINE_HEIGHT_PX}px`,
		outline: "none",
		overflow: "auto",
		paddingBlock: controlSize._4,
		paddingInlineEnd: controlSize._4,
		paddingInlineStart: "3rem",
		position: "absolute",
		resize: "none",
		tabSize: 2,
		textDecorationColor: color.textSoft,
		whiteSpace: "pre",
		width: "100%",
	},
});
