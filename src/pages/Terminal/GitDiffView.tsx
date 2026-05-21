import * as stylex from "@stylexjs/stylex";
import {
	type CSSProperties,
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MarkdownPreview } from "../../components/diff/MarkdownPreview.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import {
	IconChevronRight,
	IconGitBranch,
	IconLayoutGrid,
	IconX,
} from "../../components/ui/Icons.tsx";
import {
	buildMergeConflictLines,
	buildSplitDiffRows,
	type DiffLine,
	type HunkDiff,
	shouldDisableDiffTokenization,
	summarizeHunkDiff,
} from "../../features/git/useGitDiff.ts";
import {
	type SyntaxHighlightTheme,
	useShikiHighlighter,
	useSyntaxHighlightTheme,
} from "../../hooks/useShikiHighlighter.ts";
import { contentOf } from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { type Token, tokenizeLine } from "../../lib/syntax-tokens.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";

export type DiffViewMode = "split" | "hunks";

interface GitDiffViewProps {
	diff: HunkDiff;
	filePath: string;
	staged: boolean;
	loading: boolean;
	onClose: () => void;
	hideHeader?: boolean;
	viewMode?: DiffViewMode;
	onViewModeChange?: (viewMode: DiffViewMode) => void;
	hideToolbar?: boolean;
	scrollToChange?: number;
	syntaxTheme?: SyntaxHighlightTheme;
}

const TOKEN_CLASSES: Record<string, string> = {
	keyword: "text-syntax-keyword",
	string: "text-syntax-string",
	comment: "text-syntax-comment",
	number: "text-syntax-number",
	punctuation: "text-syntax-punctuation",
	tag: "text-syntax-tag",
	attr: "text-syntax-attr",
	default: "",
};
const DIFF_CONFIG = {
	lineHeight: 14, // Height of each line in pixels
	lineNumFontSize: 9, // Line number font size
	signFontSize: 10, // +/- sign font size
	contentFontSize: 9, // Code content font size
	lineNumWidth: 36, // Line number column width
	signWidth: 12, // +/- sign column width
	lineNumColor: "var(--color-inferay-muted-gray)",
	addLineNumColor:
		"color-mix(in srgb, var(--color-git-added) 72%, var(--color-inferay-muted-gray))",
	removeLineNumColor:
		"color-mix(in srgb, var(--color-git-deleted) 72%, var(--color-inferay-muted-gray))",
	addSignColor: "var(--color-git-added)",
	removeSignColor: "var(--color-git-deleted)",
	addBg: "color-mix(in srgb, var(--color-git-added) 12%, transparent)",
	addBgHover: "color-mix(in srgb, var(--color-git-added) 18%, transparent)",
	addBgHighlight: "color-mix(in srgb, var(--color-git-added) 28%, transparent)",
	removeBg: "color-mix(in srgb, var(--color-git-deleted) 12%, transparent)",
	removeBgHover:
		"color-mix(in srgb, var(--color-git-deleted) 18%, transparent)",
	removeBgHighlight:
		"color-mix(in srgb, var(--color-git-deleted) 28%, transparent)",
	overscan: 15, // Extra rows to render above/below viewport
};

const LINE_H = DIFF_CONFIG.lineHeight;
const GUTTER_W = DIFF_CONFIG.lineNumWidth + DIFF_CONFIG.signWidth;
const OVERSCAN = DIFF_CONFIG.overscan;
const MAX_RENDERED_DIFF_LINES = 12_000;
const MAX_RENDERED_LINE_CHARS = 4000;
const MAX_PANEL_CONTENT_WIDTH = 8000;
const INLINE_CONTEXT_LINES = 4;
type DiffRowStyle = CSSProperties & { "--hover-bg"?: string };

function roundToDevicePixel(value: number): number {
	const dpr = window.devicePixelRatio ?? 1;
	return Math.round(value * dpr) / dpr;
}

const diffStyles = stylex.create({
	virtualRoot: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		contain: "layout paint style",
	},
	virtualScroller: {
		flex: 1,
		overflow: "auto",
		overflowAnchor: "none",
		overscrollBehavior: "contain",
		scrollbarGutter: "stable",
		contain: "layout paint style",
	},
	minimap: {
		width: "16px",
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderSubtle,
		backgroundColor: color.background,
	},
	minimapInteractive: {
		position: "relative",
		cursor: "pointer",
	},
	minimapSegment: {
		position: "absolute",
		right: "3px",
		width: "9px",
		borderRadius: "2px",
	},
	minimapAdd: {
		backgroundColor: "color-mix(in srgb, var(--color-git-added) 92%, white)",
		boxShadow:
			"0 0 0 1px color-mix(in srgb, var(--color-git-added) 70%, white), 0 0 8px color-mix(in srgb, var(--color-git-added) 42%, transparent)",
	},
	minimapDelete: {
		backgroundColor: "color-mix(in srgb, var(--color-git-deleted) 92%, white)",
		boxShadow:
			"0 0 0 1px color-mix(in srgb, var(--color-git-deleted) 70%, white), 0 0 8px color-mix(in srgb, var(--color-git-deleted) 42%, transparent)",
	},
	minimapThumb: {
		position: "absolute",
		left: 0,
		right: 0,
		pointerEvents: "none",
		borderTopWidth: 1,
		borderBottomWidth: 1,
		borderTopStyle: "solid",
		borderBottomStyle: "solid",
		borderTopColor: "rgba(255, 255, 255, 0.2)",
		borderBottomColor: "rgba(255, 255, 255, 0.2)",
		backgroundColor: "rgba(255, 255, 255, 0.14)",
		boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.14)",
	},
	singlePanel: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
	},
	toolbar: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-end",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	segmented: {
		display: "flex",
		height: controlSize._5,
		alignItems: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
	},
	viewButton: {
		display: "flex",
		height: "100%",
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		transitionProperty: "background-color, color",
		transitionDuration: motion.durationFast,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	viewButtonActive: {
		backgroundColor: color.controlActive,
		color: color.textMain,
	},
	header: {
		display: "flex",
		height: controlSize._9,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingInline: controlSize._3,
	},
	pathDir: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontFamily: font.familyDiff,
		fontSize: font.size_2,
	},
	pathName: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontFamily: font.familyDiff,
		fontSize: font.size_2,
		fontWeight: 500,
	},
	stagedPill: {
		flexShrink: 0,
		borderRadius: radius.sm,
		backgroundColor: color.accentWash,
		color: color.accent,
		fontSize: font.size_0_5,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
	},
	stats: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		marginLeft: controlSize._2,
		fontSize: font.size_1,
	},
	addedText: {
		color: color.gitAdded,
	},
	deletedText: {
		color: color.gitDeleted,
	},
	headerSpacer: {
		flex: 1,
	},
	changeNav: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._0_5,
		marginRight: controlSize._2,
	},
	changeCount: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		paddingInline: controlSize._1,
	},
	shell: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		backgroundColor: color.background,
	},
	shellRelative: {
		position: "relative",
	},
	centerState: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: color.background,
	},
	centerInline: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	spinner: {
		width: font.size_3,
		height: font.size_3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.textMuted,
		borderTopColor: color.transparent,
		borderRadius: radius.pill,
		animationName: stylex.keyframes({
			to: {
				transform: "rotate(360deg)",
			},
		}),
		animationDuration: "800ms",
		animationTimingFunction: "linear",
		animationIterationCount: "infinite",
	},
	centerText: {
		color: color.textMuted,
		fontSize: font.size_4,
	},
	centerBody: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingInline: controlSize._6,
	},
	centerMessage: {
		maxWidth: "24rem",
		color: color.textMuted,
		fontSize: font.size_4,
		lineHeight: 1.55,
		textAlign: "center",
	},
	body: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	conflictBody: {
		minHeight: 0,
		flex: 1,
		display: "flex",
		flexDirection: "column",
		backgroundColor: color.background,
	},
	conflictActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.backgroundRaised,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	conflictActionButton: {
		height: controlSize._5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.background,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_1,
		paddingInline: controlSize._2,
	},
	imageBody: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		overflow: "auto",
		padding: controlSize._4,
	},
	image: {
		maxWidth: "100%",
		maxHeight: "100%",
		objectFit: "contain",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
	},
	markdownBody: {
		flex: 1,
		overflowY: "auto",
		padding: controlSize._6,
	},
	markdownInner: {
		maxWidth: "48rem",
		marginInline: "auto",
	},
	hunkSeparator: {
		alignItems: "center",
		backgroundColor: color.surfaceSubtle,
		borderBlockColor: color.borderSubtle,
		borderBlockStyle: "solid",
		borderBlockWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		height: LINE_H,
		lineHeight: `${LINE_H}px`,
		paddingInline: controlSize._2,
	},
	spacer: {
		backgroundColor: "rgba(255,255,255,0.02)",
		backgroundImage:
			"repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(255,255,255,0.02) 8px, rgba(255,255,255,0.02) 9px)",
		height: LINE_H,
	},
	row: {
		display: "flex",
		height: LINE_H,
		maxHeight: LINE_H,
		minHeight: LINE_H,
		position: "relative",
	},
	lineNumber: {
		borderRightColor: color.borderSubtle,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		flexShrink: 0,
		fontFamily: font.familyDiff,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		paddingRight: controlSize._1_5,
		textAlign: "right",
		userSelect: "none",
		width: DIFF_CONFIG.lineNumWidth,
	},
	sign: {
		flexShrink: 0,
		fontFamily: font.familyDiff,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		textAlign: "center",
		userSelect: "none",
		width: DIFF_CONFIG.signWidth,
	},
	gutterLayer: {
		position: "sticky",
		left: 0,
		zIndex: 2,
		width: GUTTER_W,
		height: 0,
		backgroundColor: color.background,
		pointerEvents: "none",
	},
	gutterBlock: {
		position: "absolute",
		left: 0,
		width: GUTTER_W,
		backgroundColor: color.surfaceInset,
	},
	gutterRow: {
		display: "flex",
		height: LINE_H,
		maxHeight: LINE_H,
		minHeight: LINE_H,
		overflow: "hidden",
		backgroundColor: color.surfaceInset,
	},
	content: {
		flex: 1,
		fontFamily: font.familyDiff,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		minWidth: "max-content",
		paddingLeft: controlSize._2,
		paddingRight: controlSize._3,
		whiteSpace: "pre",
	},
});

function getDiffRowBg(line: DiffLine, isHighlighted?: boolean) {
	const isAdd = line.type === "add";
	const isRemove = line.type === "remove";
	if (isHighlighted) {
		return isAdd
			? DIFF_CONFIG.addBgHighlight
			: isRemove
				? DIFF_CONFIG.removeBgHighlight
				: "color-mix(in srgb, var(--color-inferay-accent) 22%, transparent)";
	}
	return isAdd
		? DIFF_CONFIG.addBg
		: isRemove
			? DIFF_CONFIG.removeBg
			: "transparent";
}

const DiffRow = memo(function DiffRow({
	clipContent = false,
	line,
	tokens,
	highlightedHtml,
	isHighlighted,
	minWidth,
	hideGutter,
}: {
	clipContent?: boolean;
	line: DiffLine;
	ext: string;
	tokens: Token[] | null;
	highlightedHtml?: string;
	isHighlighted?: boolean;
	minWidth?: number;
	hideGutter?: boolean;
}) {
	if (line.type === "hunk") {
		return (
			<div
				{...stylex.props(diffStyles.hunkSeparator)}
				style={{
					minWidth: minWidth || "100%",
					paddingLeft: hideGutter ? GUTTER_W + 8 : undefined,
				}}
			>
				{line.content}
			</div>
		);
	}

	if (line.type === "spacer") {
		return (
			<div
				{...stylex.props(diffStyles.spacer)}
				style={{
					minWidth: minWidth || "100%",
				}}
			/>
		);
	}

	const isAdd = line.type === "add";
	const isRemove = line.type === "remove";
	const hoverBg = isAdd
		? DIFF_CONFIG.addBgHover
		: isRemove
			? DIFF_CONFIG.removeBgHover
			: undefined;
	const bgColor = getDiffRowBg(line, isHighlighted);

	const rowProps = stylex.props(diffStyles.row);
	const content =
		line.content.length > MAX_RENDERED_LINE_CHARS
			? `${line.content.slice(0, MAX_RENDERED_LINE_CHARS)} ... [line truncated for display]`
			: line.content;
	const lineContent = highlightedHtml ? (
		<span
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki returns escaped syntax-highlighted HTML.
			dangerouslySetInnerHTML={{ __html: highlightedHtml }}
			className="shiki-line"
		/>
	) : tokens ? (
		tokens.map((tok, i) => (
			<span
				key={`${tok.type}-${i}-${tok.text}`}
				className={TOKEN_CLASSES[tok.type]}
			>
				{tok.text}
			</span>
		))
	) : (
		content
	);

	return (
		<div
			{...rowProps}
			className={`diff-row ${rowProps.className ?? ""}`}
			style={
				{
					lineHeight: `${LINE_H}px`,
					backgroundColor: bgColor,
					boxShadow: isHighlighted
						? "inset 2px 0 0 var(--color-inferay-accent)"
						: undefined,
					minWidth: minWidth || "100%",
					paddingLeft: hideGutter ? GUTTER_W : undefined,
					width: clipContent ? "100%" : minWidth ? "max-content" : "100%",
					"--hover-bg": hoverBg,
				} as DiffRowStyle
			}
		>
			{!hideGutter && <DiffGutterCells line={line} />}

			<span
				{...stylex.props(diffStyles.content)}
				style={{
					fontSize: DIFF_CONFIG.contentFontSize,
					minWidth: clipContent ? 0 : undefined,
					color: highlightedHtml
						? undefined
						: "var(--color-inferay-soft-white)",
				}}
			>
				{lineContent}
			</span>
		</div>
	);
});

const DiffGutterCells = memo(function DiffGutterCells({
	line,
}: {
	line: DiffLine;
}) {
	const isAdd = line.type === "add";
	const isRemove = line.type === "remove";
	return (
		<>
			<span
				{...stylex.props(diffStyles.lineNumber)}
				style={{
					fontSize: DIFF_CONFIG.lineNumFontSize,
					color: isAdd
						? DIFF_CONFIG.addLineNumColor
						: isRemove
							? DIFF_CONFIG.removeLineNumColor
							: DIFF_CONFIG.lineNumColor,
				}}
			>
				{line.number ?? ""}
			</span>
			<span
				{...stylex.props(diffStyles.sign)}
				style={{
					fontSize: DIFF_CONFIG.signFontSize,
					color: isAdd
						? DIFF_CONFIG.addSignColor
						: isRemove
							? DIFF_CONFIG.removeSignColor
							: undefined,
				}}
			>
				{isAdd ? "+" : isRemove ? "-" : ""}
			</span>
		</>
	);
});

const DiffGutterRow = memo(function DiffGutterRow({
	line,
}: {
	line: DiffLine;
}) {
	if (line.type === "hunk" || line.type === "spacer") {
		return <div {...stylex.props(diffStyles.gutterRow)} />;
	}
	return (
		<div {...stylex.props(diffStyles.gutterRow)}>
			<DiffGutterCells line={line} />
		</div>
	);
});

const tokenCache = new Map<string, Token[]>();

function getTokens(
	content: string,
	ext: string,
	disable: boolean
): Token[] | null {
	if (disable || !content) return null;
	const key = `${ext}:${content}`;
	let tokens = tokenCache.get(key);
	if (!tokens) {
		tokens = tokenizeLine(content, ext);
		tokenCache.set(key, tokens);
		if (tokenCache.size > 3000) {
			const first = tokenCache.keys().next().value;
			if (first) tokenCache.delete(first);
		}
	}
	return tokens;
}

const VirtualPanel = memo(function VirtualPanel({
	lines,
	ext,
	scrollRef,
	onScroll,
	disableTokenize,
	showMinimap: _showMinimap = false,
	externalScrollTop,
	externalScrollSource,
	side,
	filePath,
	highlightedChangeIdx,
	changeLineMap,
	syntaxTheme,
}: {
	lines: DiffLine[];
	ext: string;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	onScroll?: (
		scrollTop: number,
		scrollLeft: number,
		programmatic?: boolean
	) => void;
	disableTokenize: boolean;
	showMinimap?: boolean;
	externalScrollTop?: number;
	externalScrollSource?: "left" | "right" | "all";
	side: "left" | "right" | "single";
	filePath?: string;
	highlightedChangeIdx?: number;
	changeLineMap?: Map<number, number>;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const [scrollTop, setScrollTop] = useState(0);
	const [viewH, setViewH] = useState(600);
	const rafRef = useRef<number>(0);
	const lastScrollRef = useRef({ left: 0, top: 0 });
	const lastAppliedScrollRef = useRef(-1);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		setViewH(el.clientHeight);
		const obs = new ResizeObserver((e) =>
			setViewH(e[0]?.contentRect.height ?? 600)
		);
		obs.observe(el);
		return obs.disconnect.bind(obs);
	}, [scrollRef]);

	const handleScroll = useCallback(() => {
		if (!scrollRef.current) return;
		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => {
			if (!scrollRef.current) return;
			const { scrollTop: st, scrollLeft: sl } = scrollRef.current;
			const last = lastScrollRef.current;
			const topChanged = Math.abs(last.top - st) > 0.5;
			const leftChanged = Math.abs(last.left - sl) > 0.5;
			if (topChanged) {
				last.top = st;
				setScrollTop(st);
			}
			if (leftChanged) last.left = sl;
			if (topChanged || leftChanged) onScroll?.(st, sl);
		});
	}, [scrollRef, onScroll]);

	useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

	const total = lines.length * LINE_H;
	const maxLineLength = useMemo(() => {
		let max = 0;
		for (const line of lines) {
			if (line.content && line.content.length > max) {
				max = line.content.length;
			}
		}
		return max;
	}, [lines]);
	const minContentWidth = Math.min(
		MAX_PANEL_CONTENT_WIDTH,
		DIFF_CONFIG.lineNumWidth + DIFF_CONFIG.signWidth + maxLineLength * 9 + 48
	);

	const start = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
	const end = Math.min(
		lines.length,
		Math.ceil((scrollTop + viewH) / LINE_H) + OVERSCAN
	);
	const lineContents = useMemo(() => lines.map(contentOf), [lines]);
	const visibleRange = useMemo<[number, number]>(
		() => [start, end],
		[start, end]
	);
	const {
		ensureHighlightedRange,
		getHighlightedLine,
		isReady: shikiReady,
		language: shikiLanguage,
	} = useShikiHighlighter({
		filePath: filePath ?? `file.${ext}`,
		lines: lineContents,
		visibleRange,
		theme: syntaxTheme,
		enabled: !disableTokenize && !!filePath,
	});

	useEffect(() => {
		if (externalScrollTop === undefined || externalScrollTop < 0) return;
		if (externalScrollSource === side) return;
		if (externalScrollTop === lastAppliedScrollRef.current) return;
		lastAppliedScrollRef.current = externalScrollTop;
		if (scrollRef.current) {
			const maxScrollTop = Math.max(0, lines.length * LINE_H - viewH);
			const nextScrollTop = roundToDevicePixel(
				Math.min(Math.max(0, externalScrollTop), maxScrollTop)
			);
			const nextStart = Math.max(
				0,
				Math.floor(nextScrollTop / LINE_H) - OVERSCAN
			);
			const nextEnd = Math.min(
				lines.length,
				Math.ceil((nextScrollTop + viewH) / LINE_H) + OVERSCAN
			);
			ensureHighlightedRange(nextStart, nextEnd);
			scrollRef.current.scrollTop = nextScrollTop;
			lastScrollRef.current.top = nextScrollTop;
			setScrollTop(nextScrollTop);
		}
	}, [
		ensureHighlightedRange,
		externalScrollTop,
		externalScrollSource,
		lines.length,
		scrollRef,
		side,
		viewH,
	]);

	const scrollToLine = useCallback(
		(lineIndex: number) => {
			if (!scrollRef.current) return;
			const maxScrollTop = Math.max(0, lines.length * LINE_H - viewH);
			const nextScrollTop = roundToDevicePixel(
				Math.min(Math.max(0, lineIndex * LINE_H - viewH / 2), maxScrollTop)
			);
			const nextStart = Math.max(
				0,
				Math.floor(nextScrollTop / LINE_H) - OVERSCAN
			);
			const nextEnd = Math.min(
				lines.length,
				Math.ceil((nextScrollTop + viewH) / LINE_H) + OVERSCAN
			);
			ensureHighlightedRange(nextStart, nextEnd);
			scrollRef.current.scrollTop = nextScrollTop;
			lastScrollRef.current.top = nextScrollTop;
			setScrollTop(nextScrollTop);
			onScroll?.(nextScrollTop, scrollRef.current.scrollLeft, true);
		},
		[scrollRef, viewH, lines.length, ensureHighlightedRange, onScroll]
	);

	const visibleRows = useMemo(() => {
		const rows: {
			line: DiffLine;
			tokens: Token[] | null;
			highlightedHtml?: string;
			key: number;
			isHighlighted: boolean;
		}[] = [];
		for (let i = start; i < end; i++) {
			const line = lines[i];
			if (!line) continue;

			const changeIdx = changeLineMap?.get(i);
			const isHighlighted =
				highlightedChangeIdx !== undefined &&
				changeIdx === highlightedChangeIdx;
			const canUseShiki =
				shikiReady && !disableTokenize && !!filePath && !!shikiLanguage;
			const highlightedHtml = canUseShiki ? getHighlightedLine(i) : undefined;
			const useFallbackTokens = !canUseShiki;

			rows.push({
				line,
				tokens:
					line.type === "spacer" ||
					line.type === "hunk" ||
					highlightedHtml ||
					!useFallbackTokens
						? null
						: getTokens(line.content, ext, disableTokenize),
				highlightedHtml,
				key: i,
				isHighlighted,
			});
		}
		return rows;
	}, [
		lines,
		start,
		end,
		ext,
		disableTokenize,
		shikiReady,
		shikiLanguage,
		getHighlightedLine,
		filePath,
		changeLineMap,
		highlightedChangeIdx,
	]);

	const minimapSegments = useMemo(() => {
		if (!_showMinimap || lines.length === 0 || lines.length >= 3000)
			return null;
		return buildMinimapSegments(lines);
	}, [lines, _showMinimap]);

	return (
		<div {...stylex.props(diffStyles.virtualRoot)}>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				{...stylex.props(diffStyles.virtualScroller)}
			>
				<div
					style={{
						height: total,
						position: "relative",
						minWidth: minContentWidth,
					}}
				>
					<div
						style={{
							position: "absolute",
							top: 0,
							transform: `translate3d(0, ${start * LINE_H}px, 0)`,
							left: 0,
							right: 0,
							minWidth: minContentWidth,
							contain: "layout paint style",
							willChange: "transform",
						}}
					>
						<div {...stylex.props(diffStyles.gutterLayer)}>
							<div {...stylex.props(diffStyles.gutterBlock)} style={{ top: 0 }}>
								{visibleRows.map(({ line, key }) => (
									<DiffGutterRow key={key} line={line} />
								))}
							</div>
						</div>
						{visibleRows.map(
							({ line, tokens, highlightedHtml, key, isHighlighted }) => (
								<DiffRow
									key={key}
									line={line}
									ext={ext}
									tokens={tokens}
									highlightedHtml={highlightedHtml}
									isHighlighted={isHighlighted}
									minWidth={minContentWidth}
									hideGutter
								/>
							)
						)}
					</div>
				</div>
			</div>
			{minimapSegments && (
				<DiffMinimap
					lines={lines}
					segments={minimapSegments}
					scrollTop={scrollTop}
					viewHeight={viewH}
					totalHeight={total}
					onScrollTo={scrollToLine}
				/>
			)}
		</div>
	);
});

const VirtualSplitPanel = memo(function VirtualSplitPanel({
	changeLineMap,
	disableTokenize,
	ext,
	externalScrollSource,
	externalScrollTop,
	filePath,
	highlightedChangeIdx,
	newLines,
	oldLines,
	scrollRef,
	syntaxTheme,
}: {
	changeLineMap?: Map<number, number>;
	disableTokenize: boolean;
	ext: string;
	externalScrollSource?: "left" | "right" | "all";
	externalScrollTop?: number;
	filePath?: string;
	highlightedChangeIdx?: number;
	newLines: DiffLine[];
	oldLines: DiffLine[];
	scrollRef: React.RefObject<HTMLDivElement | null>;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const [scrollTop, setScrollTop] = useState(0);
	const [viewH, setViewH] = useState(600);
	const rafRef = useRef<number>(0);
	const lastAppliedScrollRef = useRef(-1);
	const lineCount = Math.max(oldLines.length, newLines.length);
	const total = lineCount * LINE_H;

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		setViewH(el.clientHeight);
		const obs = new ResizeObserver((e) =>
			setViewH(e[0]?.contentRect.height ?? 600)
		);
		obs.observe(el);
		return obs.disconnect.bind(obs);
	}, [scrollRef]);

	const handleScroll = useCallback(() => {
		if (!scrollRef.current) return;
		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => {
			if (!scrollRef.current) return;
			setScrollTop(scrollRef.current.scrollTop);
		});
	}, [scrollRef]);

	useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

	useEffect(() => {
		if (externalScrollTop === undefined || externalScrollTop < 0) return;
		if (externalScrollSource === "left" || externalScrollSource === "right")
			return;
		if (externalScrollTop === lastAppliedScrollRef.current) return;
		lastAppliedScrollRef.current = externalScrollTop;
		if (!scrollRef.current) return;
		const maxScrollTop = Math.max(0, lineCount * LINE_H - viewH);
		const nextScrollTop = roundToDevicePixel(
			Math.min(Math.max(0, externalScrollTop), maxScrollTop)
		);
		scrollRef.current.scrollTop = nextScrollTop;
		setScrollTop(nextScrollTop);
	}, [externalScrollSource, externalScrollTop, lineCount, scrollRef, viewH]);

	const start = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
	const end = Math.min(
		lineCount,
		Math.ceil((scrollTop + viewH) / LINE_H) + OVERSCAN
	);
	const visibleRange = useMemo<[number, number]>(
		() => [start, end],
		[start, end]
	);
	const oldContents = useMemo(() => oldLines.map(contentOf), [oldLines]);
	const newContents = useMemo(() => newLines.map(contentOf), [newLines]);
	const oldHighlighter = useShikiHighlighter({
		filePath: filePath ?? `file.${ext}`,
		lines: oldContents,
		visibleRange,
		theme: syntaxTheme,
		enabled: !disableTokenize && !!filePath,
	});
	const newHighlighter = useShikiHighlighter({
		filePath: filePath ?? `file.${ext}`,
		lines: newContents,
		visibleRange,
		theme: syntaxTheme,
		enabled: !disableTokenize && !!filePath,
	});
	const minimapSegments = useMemo(
		() => (lineCount < 3000 ? buildMinimapSegments(newLines) : null),
		[newLines, lineCount]
	);
	const visibleRows = useMemo(
		() => buildSplitDiffRows(oldLines, newLines, changeLineMap, start, end),
		[oldLines, newLines, changeLineMap, start, end]
	);

	return (
		<div {...stylex.props(diffStyles.virtualRoot)}>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				{...stylex.props(diffStyles.virtualScroller)}
			>
				<div
					style={{
						height: total,
						minWidth: "100%",
						position: "relative",
					}}
				>
					<div
						style={{
							contain: "layout paint style",
							left: 0,
							minWidth: "100%",
							position: "absolute",
							right: 0,
							top: 0,
							transform: `translate3d(0, ${start * LINE_H}px, 0)`,
							willChange: "transform",
						}}
					>
						{visibleRows.map(
							({ changeIdx, hunkLine, index, newLine, oldLine }) => {
								const isHighlighted =
									highlightedChangeIdx !== undefined &&
									changeIdx === highlightedChangeIdx;
								if (hunkLine) {
									return (
										<div
											key={index}
											style={{
												height: LINE_H,
												minHeight: LINE_H,
												width: "100%",
											}}
										>
											<DiffRow
												clipContent
												line={hunkLine}
												ext={ext}
												tokens={null}
												isHighlighted={isHighlighted}
											/>
										</div>
									);
								}
								const oldHighlightedHtml =
									oldHighlighter.getHighlightedLine(index);
								const newHighlightedHtml =
									newHighlighter.getHighlightedLine(index);
								return (
									<div
										key={index}
										style={{
											display: "flex",
											height: LINE_H,
											minHeight: LINE_H,
											width: "100%",
										}}
									>
										<div
											style={{
												borderRight:
													"1px solid var(--color-inferay-gray-border)",
												flexBasis: 0,
												flexGrow: 1,
												flexShrink: 1,
												minWidth: 0,
											}}
										>
											<DiffRow
												clipContent
												line={oldLine}
												ext={ext}
												tokens={
													oldHighlightedHtml
														? null
														: getTokens(oldLine.content, ext, disableTokenize)
												}
												highlightedHtml={oldHighlightedHtml}
												isHighlighted={isHighlighted}
											/>
										</div>
										<div
											style={{
												flexBasis: 0,
												flexGrow: 1,
												flexShrink: 1,
												minWidth: 0,
											}}
										>
											<DiffRow
												clipContent
												line={newLine}
												ext={ext}
												tokens={
													newHighlightedHtml
														? null
														: getTokens(newLine.content, ext, disableTokenize)
												}
												highlightedHtml={newHighlightedHtml}
												isHighlighted={isHighlighted}
											/>
										</div>
									</div>
								);
							}
						)}
					</div>
				</div>
			</div>
			{minimapSegments && (
				<DiffMinimap
					lines={newLines}
					segments={minimapSegments}
					scrollTop={scrollTop}
					viewHeight={viewH}
					totalHeight={total}
					onScrollTo={(lineIndex) => {
						if (!scrollRef.current) return;
						scrollRef.current.scrollTop = Math.max(
							0,
							lineIndex * LINE_H - viewH / 2
						);
					}}
				/>
			)}
		</div>
	);
});

function buildMinimapSegments(
	lines: DiffLine[]
): { type: string; startLine: number; endLine: number }[] {
	const segments: { type: string; startLine: number; endLine: number }[] = [];
	let currentType = "";
	let startLine = 0;

	for (let i = 0; i < lines.length && segments.length < 100; i++) {
		const t = lines[i]?.type;
		const type = t === "add" || t === "remove" ? t : "";
		if (type !== currentType) {
			if (currentType)
				segments.push({ type: currentType, startLine, endLine: i });
			currentType = type;
			startLine = i;
		}
	}
	if (currentType && segments.length < 100) {
		segments.push({ type: currentType, startLine, endLine: lines.length });
	}
	return segments;
}

const DiffMinimap = memo(function DiffMinimap({
	lines,
	segments,
	scrollTop,
	viewHeight,
	totalHeight,
	onScrollTo,
}: {
	lines: DiffLine[];
	segments: { type: string; startLine: number; endLine: number }[];
	scrollTop: number;
	viewHeight: number;
	totalHeight: number;
	onScrollTo: (lineIndex: number) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(0);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		setContainerHeight(el.clientHeight);
		const obs = new ResizeObserver((e) =>
			setContainerHeight(e[0]?.contentRect.height ?? 0)
		);
		obs.observe(el);
		return obs.disconnect.bind(obs);
	}, []);

	if (totalHeight <= 0 || lines.length === 0 || containerHeight <= 0) {
		return <div ref={containerRef} {...stylex.props(diffStyles.minimap)} />;
	}

	const scale = containerHeight / totalHeight;
	const thumbHeight = Math.max(
		16,
		Math.min(viewHeight * scale, containerHeight)
	);
	const thumbTop = Math.max(
		0,
		Math.min(scrollTop * scale, containerHeight - thumbHeight)
	);
	const lineHeight = containerHeight / lines.length;

	const handleClick = (e: React.MouseEvent) => {
		if (!containerRef.current || containerHeight <= 0 || lines.length === 0)
			return;
		const rect = containerRef.current.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const lineIndex = Math.floor((y / containerHeight) * lines.length);
		if (!Number.isFinite(lineIndex)) return;
		onScrollTo(Math.max(0, Math.min(lines.length - 1, lineIndex)));
	};

	return (
		<div
			ref={containerRef}
			{...stylex.props(diffStyles.minimap, diffStyles.minimapInteractive)}
			onClick={handleClick}
		>
			{segments.map((seg, i) => (
				<div
					key={i}
					{...stylex.props(
						diffStyles.minimapSegment,
						seg.type === "add"
							? diffStyles.minimapAdd
							: diffStyles.minimapDelete
					)}
					style={{
						top: seg.startLine * lineHeight,
						height: Math.max(3, (seg.endLine - seg.startLine) * lineHeight),
					}}
				/>
			))}
			<div
				{...stylex.props(diffStyles.minimapThumb)}
				style={{ top: thumbTop, height: thumbHeight }}
			/>
		</div>
	);
});
export const GitDiffView = memo(function GitDiffView({
	diff,
	filePath,
	staged,
	loading,
	onClose,
	hideHeader = false,
	viewMode: controlledViewMode,
	onViewModeChange,
	hideToolbar = false,
	scrollToChange,
	syntaxTheme: controlledSyntaxTheme,
}: GitDiffViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const rightRef = useRef<HTMLDivElement>(null);
	const [internalViewMode, setInternalViewMode] =
		useState<DiffViewMode>("split");
	const viewMode = controlledViewMode ?? internalViewMode;
	const setViewMode = onViewModeChange ?? setInternalViewMode;
	const [storedSyntaxTheme] = useSyntaxHighlightTheme();
	const syntaxTheme = controlledSyntaxTheme ?? storedSyntaxTheme;
	const [externalScrollTop, setExternalScrollTop] = useState(-1);
	const [externalScrollSource, setExternalScrollSource] = useState<
		"left" | "right" | "all"
	>("all");
	const [highlightedChangeIdx, setHighlightedChangeIdx] = useState<
		number | undefined
	>();
	const stats = useMemo(() => summarizeHunkDiff(diff), [diff]);
	const diffIdentity = `${filePath}:${staged ? "staged" : "unstaged"}`;

	useEffect(() => {
		void diffIdentity;
		setExternalScrollSource("all");
		setExternalScrollTop(-1);
		setHighlightedChangeIdx(undefined);
	}, [diffIdentity]);

	const { changePositions, changeLineMap } = useMemo(() => {
		const positions: number[] = [];
		const lineMap = new Map<number, number>();

		let currentChangeIdx = -1;
		let inChange = false;

		const max = Math.max(diff.oldLines.length, diff.newLines.length);
		for (let idx = 0; idx < max; idx++) {
			const oldLine = diff.oldLines[idx];
			const newLine = diff.newLines[idx];
			const isChanged = oldLine?.type === "remove" || newLine?.type === "add";
			if (isChanged && !inChange) {
				currentChangeIdx++;
				positions.push(idx);
				inChange = true;
			} else if (!isChanged) {
				inChange = false;
			}
			if (isChanged) {
				lineMap.set(idx, currentChangeIdx);
			}
		}

		return { changePositions: positions, changeLineMap: lineMap };
	}, [diff.oldLines, diff.newLines]);

	const totalChanges = changePositions.length;
	const scrollToChangeIdx = useCallback(
		(changeIdx: number) => {
			if (changeIdx < 0 || changeIdx >= changePositions.length) return;
			const lineIdx = changePositions[changeIdx];
			if (lineIdx === undefined) return;
			const scrollPos = Math.max(0, (lineIdx - 5) * LINE_H);
			setExternalScrollTop(scrollPos);
			setHighlightedChangeIdx(changeIdx);

			setTimeout(() => {
				setExternalScrollTop(-1);
				setTimeout(() => setHighlightedChangeIdx(undefined), 1500);
			}, 100);
		},
		[changePositions]
	);
	const stepChange = useCallback(
		(dir: 1 | -1) => {
			if (changePositions.length === 0) return;
			const currentScroll = rightRef.current?.scrollTop ?? 0;
			const currentLine = Math.floor(currentScroll / LINE_H);
			const idx =
				dir === 1
					? changePositions.findIndex((pos) => pos > currentLine + 2)
					: (() => {
							for (let i = changePositions.length - 1; i >= 0; i--) {
								const p = changePositions[i];
								if (p !== undefined && p < currentLine - 2) return i;
							}
							return -1;
						})();
			scrollToChangeIdx(
				idx !== -1 ? idx : dir === 1 ? 0 : changePositions.length - 1
			);
		},
		[changePositions, scrollToChangeIdx]
	);
	const goToNextChange = useCallback(() => stepChange(1), [stepChange]);
	const goToPrevChange = useCallback(() => stepChange(-1), [stepChange]);
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
			if (!containerRef.current?.matches(":hover")) return;

			if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
				e.preventDefault();
				goToNextChange();
			} else if (e.key === "p" && !e.metaKey && !e.ctrlKey) {
				e.preventDefault();
				goToPrevChange();
			} else if (e.key === "j") {
				e.preventDefault();
				goToNextChange();
			} else if (e.key === "k") {
				e.preventDefault();
				goToPrevChange();
			}
		};

		return listenWindowEvent("keydown", handleKeyDown);
	}, [goToNextChange, goToPrevChange]);

	useEffect(() => {
		if (!scrollToChange) return;

		let lastChangeIdx = -1;
		for (let i = diff.newLines.length - 1; i >= 0; i--) {
			if (diff.newLines[i]?.type === "add") {
				lastChangeIdx = i;
				break;
			}
		}
		if (lastChangeIdx < 0) {
			for (let i = diff.oldLines.length - 1; i >= 0; i--) {
				if (diff.oldLines[i]?.type === "remove") {
					lastChangeIdx = i;
					break;
				}
			}
		}

		if (lastChangeIdx >= 0) {
			const scrollPos = Math.max(0, (lastChangeIdx - 10) * LINE_H);
			setExternalScrollSource("all");
			setExternalScrollTop(scrollPos);
			const resetTimer = setTimeout(() => {
				setExternalScrollTop(-1);
				setExternalScrollSource("all");
			}, 100);
			return () => clearTimeout(resetTimer);
		}
	}, [scrollToChange, diff.newLines, diff.oldLines]);

	const ext = useMemo(() => {
		const p = filePath.split(".");
		return p.length > 1 ? p.pop()! : "";
	}, [filePath]);

	const statusMessage = useMemo(() => {
		if (diff.oldLines.length !== 0 || diff.newLines.length !== 1) return null;
		const line = diff.newLines[0];
		if (!line || line.type !== "context") return null;
		const text = line.content.trim();
		return /too large|cannot read/i.test(text) ? text : null;
	}, [diff.newLines, diff.oldLines.length]);

	const oversizedMessage = useMemo(() => {
		const totalLines = diff.oldLines.length + diff.newLines.length;
		if (totalLines > MAX_RENDERED_DIFF_LINES) {
			return `Diff is too large to render safely (${totalLines.toLocaleString()} lines). Use the Editor/terminal to inspect this file in smaller chunks.`;
		}
		let longest = 0;
		for (const line of diff.oldLines) {
			if (line.content.length > longest) longest = line.content.length;
		}
		for (const line of diff.newLines) {
			if (line.content.length > longest) longest = line.content.length;
		}
		if (longest > MAX_RENDERED_LINE_CHARS * 2) {
			return `Diff contains a very long line (${longest.toLocaleString()} characters). Rendering is limited to keep the app responsive.`;
		}
		return null;
	}, [diff.newLines, diff.oldLines]);

	const disableTokenize = useMemo(
		() => shouldDisableDiffTokenization(diff),
		[diff]
	);

	const renderMergeConflict = Boolean(diff.mergeConflictContent);

	const hunkLines = useMemo(() => {
		if (oversizedMessage) return [];
		return buildInlineHunkLines(diff.oldLines, diff.newLines);
	}, [diff.oldLines, diff.newLines, oversizedMessage]);

	if (loading) {
		return (
			<div {...stylex.props(diffStyles.centerState)}>
				<div {...stylex.props(diffStyles.centerInline)}>
					<div {...stylex.props(diffStyles.spinner)} />
					<span {...stylex.props(diffStyles.centerText)}>Loading diff...</span>
				</div>
			</div>
		);
	}

	if (diff.isBinary) {
		return (
			<div {...stylex.props(diffStyles.shell)}>
				{!hideHeader && (
					<DiffHeader filePath={filePath} staged={staged} onClose={onClose} />
				)}
				<div {...stylex.props(diffStyles.imageBody)}>
					{diff.isImage && diff.imagePath ? (
						<img
							src={`/api/file?path=${encodeURIComponent(diff.imagePath)}`}
							alt={filePath}
							{...stylex.props(diffStyles.image)}
						/>
					) : (
						<span {...stylex.props(diffStyles.centerText)}>Binary file</span>
					)}
				</div>
			</div>
		);
	}

	const isMarkdown = ext === "md" || ext === "mdx";
	const markdownContent = isMarkdown
		? diff.newLines
				.filter((l) => l.type !== "hunk" && l.type !== "spacer")
				.map(contentOf)
				.join("\n")
		: "";

	if (renderMergeConflict && !isMarkdown) {
		return (
			<div
				ref={containerRef}
				{...stylex.props(diffStyles.shell, diffStyles.shellRelative)}
			>
				{!hideHeader && (
					<DiffHeader
						filePath={filePath}
						staged={staged}
						onClose={onClose}
						stats={stats}
						totalChanges={totalChanges}
						onPrevChange={goToPrevChange}
						onNextChange={goToNextChange}
					/>
				)}
				<MergeConflictPanel
					content={diff.mergeConflictContent ?? ""}
					disableTokenize={disableTokenize}
					ext={ext}
					filePath={filePath}
					syntaxTheme={syntaxTheme}
				/>
			</div>
		);
	}

	if (statusMessage) {
		return (
			<div {...stylex.props(diffStyles.shell)}>
				{!hideHeader && (
					<DiffHeader filePath={filePath} staged={staged} onClose={onClose} />
				)}
				<div {...stylex.props(diffStyles.centerBody)}>
					<p {...stylex.props(diffStyles.centerMessage)}>{statusMessage}</p>
				</div>
			</div>
		);
	}

	if (oversizedMessage) {
		return (
			<div {...stylex.props(diffStyles.shell)}>
				{!hideHeader && (
					<DiffHeader filePath={filePath} staged={staged} onClose={onClose} />
				)}
				<div {...stylex.props(diffStyles.centerBody)}>
					<p {...stylex.props(diffStyles.centerMessage)}>{oversizedMessage}</p>
				</div>
			</div>
		);
	}

	if (isMarkdown) {
		return (
			<div {...stylex.props(diffStyles.shell)}>
				{!hideHeader && (
					<DiffHeader filePath={filePath} staged={staged} onClose={onClose} />
				)}
				<div {...stylex.props(diffStyles.markdownBody)}>
					<div {...stylex.props(diffStyles.markdownInner)}>
						<MarkdownPreview content={markdownContent} />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			{...stylex.props(diffStyles.shell, diffStyles.shellRelative)}
		>
			{!hideHeader && (
				<DiffHeader
					filePath={filePath}
					staged={staged}
					onClose={onClose}
					stats={stats}
					totalChanges={totalChanges}
					onPrevChange={goToPrevChange}
					onNextChange={goToNextChange}
				/>
			)}
			{!hideToolbar && (
				<DiffViewToolbar viewMode={viewMode} onChange={setViewMode} />
			)}
			<div {...stylex.props(diffStyles.body)}>
				{viewMode === "split" ? (
					<VirtualSplitPanel
						key={`${diffIdentity}:split`}
						oldLines={
							diff.isNew
								? diff.newLines.map(() => ({
										number: null,
										content: "",
										type: "spacer" as const,
									}))
								: diff.oldLines
						}
						newLines={diff.newLines}
						ext={ext}
						scrollRef={rightRef}
						disableTokenize={disableTokenize}
						externalScrollTop={externalScrollTop}
						externalScrollSource={externalScrollSource}
						filePath={filePath}
						highlightedChangeIdx={highlightedChangeIdx}
						changeLineMap={changeLineMap}
						syntaxTheme={syntaxTheme}
					/>
				) : (
					<SinglePanel
						key={`${diffIdentity}:single`}
						lines={hunkLines}
						ext={ext}
						disableTokenize={disableTokenize}
						externalScrollTop={externalScrollTop}
						externalScrollSource={externalScrollSource}
						filePath={filePath}
						syntaxTheme={syntaxTheme}
					/>
				)}
			</div>
		</div>
	);
});

function buildStackedLines(
	oldLines: DiffLine[],
	newLines: DiffLine[],
	onlyChanges: boolean
): DiffLine[] {
	const result: DiffLine[] = [];
	const max = Math.max(oldLines.length, newLines.length);

	for (let index = 0; index < max; index++) {
		const oldLine = oldLines[index];
		const newLine = newLines[index];

		if (oldLine?.type === "hunk" || newLine?.type === "hunk") {
			result.push({ number: null, content: "", type: "hunk" });
			continue;
		}

		if (oldLine?.type === "context" && newLine?.type === "context") {
			if (!onlyChanges) result.push(newLine);
			continue;
		}

		if (oldLine && oldLine.type !== "spacer") {
			if (!onlyChanges || oldLine.type !== "context") result.push(oldLine);
		}
		if (newLine && newLine.type !== "spacer") {
			if (!onlyChanges || newLine.type !== "context") result.push(newLine);
		}
	}

	return result;
}

function buildInlineHunkLines(
	oldLines: DiffLine[],
	newLines: DiffLine[]
): DiffLine[] {
	const stacked = buildStackedLines(oldLines, newLines, false);
	const changedRows: number[] = [];

	for (let i = 0; i < stacked.length; i++) {
		const type = stacked[i]?.type;
		if (type === "add" || type === "remove") changedRows.push(i);
	}

	if (changedRows.length === 0) return stacked;

	const ranges: Array<{ start: number; end: number }> = [];
	for (const row of changedRows) {
		const start = Math.max(0, row - INLINE_CONTEXT_LINES);
		const end = Math.min(stacked.length - 1, row + INLINE_CONTEXT_LINES);
		const previous = ranges[ranges.length - 1];
		if (previous && start <= previous.end + INLINE_CONTEXT_LINES + 1) {
			previous.end = Math.max(previous.end, end);
		} else {
			ranges.push({ start, end });
		}
	}

	const result: DiffLine[] = [];
	for (let i = 0; i < ranges.length; i++) {
		const range = ranges[i]!;
		const rows = stacked.slice(range.start, range.end + 1);
		const previousEnd = i === 0 ? -1 : ranges[i - 1]!.end;
		const hiddenCount = range.start - previousEnd - 1;
		if (hiddenCount > 0) {
			result.push(createCollapsedContextLine(hiddenCount));
		}
		appendInlineRows(result, rows);
	}

	const finalRange = ranges[ranges.length - 1];
	if (finalRange) {
		const hiddenCount = stacked.length - finalRange.end - 1;
		if (hiddenCount > 0) {
			result.push(createCollapsedContextLine(hiddenCount));
		}
	}

	return result;
}

function createCollapsedContextLine(hiddenCount: number): DiffLine {
	return {
		number: null,
		content: `... ${hiddenCount.toLocaleString()} unchanged ${
			hiddenCount === 1 ? "line" : "lines"
		} hidden ...`,
		type: "hunk",
	};
}

function appendInlineRows(result: DiffLine[], rows: DiffLine[]) {
	let changedRun: DiffLine[] = [];
	const flushChangedRun = () => {
		if (changedRun.length === 0) return;
		result.push(...changedRun.filter((line) => line.type === "remove"));
		result.push(...changedRun.filter((line) => line.type === "add"));
		changedRun = [];
	};

	for (const row of rows) {
		if (row.type === "add" || row.type === "remove") {
			changedRun.push(row);
			continue;
		}
		flushChangedRun();
		result.push(row);
	}

	flushChangedRun();
}

function MergeConflictPanel({
	content,
	disableTokenize,
	ext,
	filePath,
	syntaxTheme,
}: {
	content: string;
	disableTokenize: boolean;
	ext: string;
	filePath: string;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const lines = useMemo(() => buildMergeConflictLines(content), [content]);
	return (
		<div {...stylex.props(diffStyles.conflictBody)}>
			<div {...stylex.props(diffStyles.conflictActions)}>
				<button
					type="button"
					{...stylex.props(diffStyles.conflictActionButton)}
				>
					Accept current change
				</button>
				<button
					type="button"
					{...stylex.props(diffStyles.conflictActionButton)}
				>
					Accept incoming change
				</button>
				<button
					type="button"
					{...stylex.props(diffStyles.conflictActionButton)}
				>
					Accept both
				</button>
			</div>
			<VirtualPanel
				lines={lines}
				ext={ext}
				scrollRef={scrollRef}
				disableTokenize={disableTokenize}
				showMinimap
				side="single"
				filePath={filePath}
				syntaxTheme={syntaxTheme}
			/>
		</div>
	);
}

function SinglePanel({
	lines,
	ext,
	disableTokenize,
	externalScrollTop,
	externalScrollSource,
	filePath,
	syntaxTheme,
}: {
	lines: DiffLine[];
	ext: string;
	disableTokenize: boolean;
	externalScrollTop?: number;
	externalScrollSource?: "left" | "right" | "all";
	filePath?: string;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	return (
		<div {...stylex.props(diffStyles.singlePanel)}>
			<VirtualPanel
				lines={lines}
				ext={ext}
				scrollRef={scrollRef}
				disableTokenize={disableTokenize}
				showMinimap
				externalScrollTop={externalScrollTop}
				externalScrollSource={externalScrollSource}
				side="single"
				filePath={filePath}
				syntaxTheme={syntaxTheme}
			/>
		</div>
	);
}

function DiffViewToolbar({
	viewMode,
	onChange,
}: {
	viewMode: DiffViewMode;
	onChange: (viewMode: DiffViewMode) => void;
}) {
	return (
		<div {...stylex.props(diffStyles.toolbar)}>
			<div {...stylex.props(diffStyles.segmented)}>
				<DiffViewButton
					active={viewMode === "split"}
					title="Split diff"
					icon={<IconLayoutGrid size={11} />}
					onClick={() => onChange("split")}
				/>
				<DiffViewButton
					active={viewMode === "hunks"}
					title="Hunk view"
					icon={<IconGitBranch size={11} />}
					onClick={() => onChange("hunks")}
				/>
			</div>
		</div>
	);
}

function DiffViewButton({
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
			title={title}
			onClick={onClick}
			{...stylex.props(
				diffStyles.viewButton,
				active && diffStyles.viewButtonActive
			)}
		>
			{icon}
		</button>
	);
}

function DiffHeader({
	filePath,
	staged,
	onClose,
	stats,
	totalChanges,
	onPrevChange,
	onNextChange,
}: {
	filePath: string;
	staged: boolean;
	onClose: () => void;
	stats?: { added: number; removed: number };
	totalChanges?: number;
	onPrevChange?: () => void;
	onNextChange?: () => void;
}) {
	const dir = filePath.includes("/")
		? filePath.slice(0, filePath.lastIndexOf("/") + 1)
		: "";
	const name = filePath.split("/").pop() || filePath;

	return (
		<div {...stylex.props(diffStyles.header)}>
			{dir && <span {...stylex.props(diffStyles.pathDir)}>{dir}</span>}
			<span {...stylex.props(diffStyles.pathName)}>{name}</span>
			{staged && <span {...stylex.props(diffStyles.stagedPill)}>staged</span>}

			{stats && (stats.added > 0 || stats.removed > 0) && (
				<div {...stylex.props(diffStyles.stats)}>
					{stats.added > 0 && (
						<span {...stylex.props(diffStyles.addedText)}>+{stats.added}</span>
					)}
					{stats.removed > 0 && (
						<span {...stylex.props(diffStyles.deletedText)}>
							−{stats.removed}
						</span>
					)}
				</div>
			)}

			<span {...stylex.props(diffStyles.headerSpacer)} />

			{totalChanges !== undefined &&
				totalChanges > 0 &&
				onPrevChange &&
				onNextChange && (
					<div {...stylex.props(diffStyles.changeNav)}>
						<IconButton
							type="button"
							onClick={onPrevChange}
							variant="ghost"
							size="xs"
							title="Previous change (k/p)"
						>
							<IconChevronRight size={10} className="rotate-180" />
						</IconButton>
						<span {...stylex.props(diffStyles.changeCount)}>
							{totalChanges}
						</span>
						<IconButton
							type="button"
							onClick={onNextChange}
							variant="ghost"
							size="xs"
							title="Next change (j/n)"
						>
							<IconChevronRight size={10} />
						</IconButton>
					</div>
				)}

			<IconButton
				type="button"
				onClick={onClose}
				variant="ghost"
				size="xs"
				title="Close diff"
			>
				<IconX size={9} />
			</IconButton>
		</div>
	);
}
