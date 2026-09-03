import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "octane";
import type { CSSProperties } from "react";
import { iconSize } from "../../../design-system.ts";
import {
	buildMergeConflictLines,
	type DiffLine,
	type HunkDiff,
	shouldDisableDiffTokenization,
	summarizeHunkDiff,
} from "../../../modules/repository/useGitDiff.tsx";
import {
	alignDiffLines,
	buildInlineHunkLines,
	buildMarkdownContent,
	buildMinimapSegments,
	type MinimapSegment,
} from "../../../modules/workbench/diff/diff-lines.ts";
import {
	diffNavigationReducer,
	diffViewportReducer,
	INITIAL_DIFF_NAVIGATION_STATE,
	INITIAL_DIFF_VIEWPORT_STATE,
} from "../../../modules/workbench/diff/diff-navigation.ts";
import { MarkdownPreview } from "../../../modules/workbench/diff/MarkdownPreview.tsx";
import {
	type DiffScrollSource,
	useSplitDiffScroll,
} from "../../../modules/workbench/diff/useSplitDiffScroll.tsx";
import {
	type ShikiLineToken,
	type SyntaxHighlightTheme,
	useShikiHighlighter,
	useSyntaxHighlightTheme,
} from "../../../shared/hooks/useShikiHighlighter.tsx";
import { contentOf } from "../../../shared/lib/data.ts";
import { indexedValues } from "../../../shared/lib/indexed-values.ts";
import {
	activateOnEnterOrSpacePreventDefault,
	listenWindowEvent,
} from "../../../shared/lib/react-events.ts";
import { type Token, tokenizeLine } from "../../../shared/lib/syntax-tokens.ts";
import { LiquidSegmentedRail } from "../../../shared/ui/gooey/LiquidSegmentedRail.tsx";
import { IconButton } from "../../../shared/ui/IconButton.tsx";
import {
	IconChevronRight,
	IconGitBranch,
	IconLayoutGrid,
	IconX,
} from "../../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	effect,
	font,
	layer,
	motion,
	radius,
	shadow,
} from "../../../tokens.stylex.ts";
import { FileTypeIcon } from "../../explorer/FileTypeIcon.tsx";

export type DiffViewMode = "split" | "hunks";

interface DiffViewerProps {
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
	contentFontSize: 10, // Code content font size
	lineNumWidth: 36, // Line number column width
	signWidth: 12, // +/- sign column width
	lineNumColor: "rgba(255, 255, 255, 0.62)",
	addLineNumColor: "var(--color-git-added)",
	removeLineNumColor: "var(--color-git-deleted)",
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
type DiffRowStyle = CSSProperties & { "--hover-bg"?: string };
function roundToDevicePixel(value: number): number {
	const dpr = window.devicePixelRatio ?? 1;
	return Math.round(value * dpr) / dpr;
}

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
	highlightedTokens,
	isHighlighted,
	minWidth,
	hideGutter,
}: {
	clipContent?: boolean;
	line: DiffLine;
	ext: string;
	tokens: Token[] | null;
	highlightedTokens?: ShikiLineToken[];
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
				<span {...stylex.props(diffStyles.hunkText)}>{line.content}</span>
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
	const lineContent = highlightedTokens
		? indexedValues(highlightedTokens).map(({ index, value: tok }) => (
				<span
					key={`${index}-${tok.content}`}
					style={{
						backgroundColor: tok.bgColor,
						color: tok.color,
					}}
				>
					{tok.content}
				</span>
			))
		: tokens
			? tokens.map((tok, i) => (
					<span
						key={`${tok.type}-${i}-${tok.text}`}
						className={TOKEN_CLASSES[tok.type]}
					>
						{tok.text}
					</span>
				))
			: content;

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
					width: "100%",
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
					color: highlightedTokens ? undefined : "#f2f4f7",
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
	disable: boolean,
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
	minimapOldLines,
	verticalFollower = false,
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
		programmatic?: boolean,
	) => void;
	disableTokenize: boolean;
	showMinimap?: boolean;
	minimapOldLines?: DiffLine[];
	verticalFollower?: boolean;
	externalScrollTop?: number;
	externalScrollSource?: DiffScrollSource;
	side: "left" | "right" | "single";
	filePath?: string;
	highlightedChangeIdx?: number;
	changeLineMap?: Map<number, number>;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const [viewport, dispatchViewport] = useReducer(
		diffViewportReducer,
		INITIAL_DIFF_VIEWPORT_STATE,
	);
	const { scrollTop, viewHeight } = viewport;
	const rafRef = useRef<number>(0);
	const lastScrollRef = useRef({ left: 0, top: 0 });
	const lastAppliedScrollRef = useRef(-1);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		dispatchViewport({ type: "measure", height: el.clientHeight });
		const obs = new ResizeObserver((e) =>
			dispatchViewport({
				type: "measure",
				height:
					e[0]?.contentRect.height ?? INITIAL_DIFF_VIEWPORT_STATE.viewHeight,
			}),
		);
		obs.observe(el);
		return obs.disconnect.bind(obs);
	}, [scrollRef]);

	const handleScroll = useCallback(() => {
		if (!scrollRef.current) return;
		const { scrollTop: nextTop, scrollLeft: nextLeft } = scrollRef.current;
		onScroll?.(nextTop, nextLeft);
		if (rafRef.current) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = 0;
			if (!scrollRef.current) return;
			const { scrollTop: st, scrollLeft: sl } = scrollRef.current;
			const last = lastScrollRef.current;
			const topChanged = Math.abs(last.top - st) > 0.5;
			const leftChanged = Math.abs(last.left - sl) > 0.5;
			if (topChanged) {
				last.top = st;
				dispatchViewport({ type: "scroll", top: st });
			}
			if (leftChanged) last.left = sl;
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
		DIFF_CONFIG.lineNumWidth + DIFF_CONFIG.signWidth + maxLineLength * 9 + 48,
	);

	const start = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
	const end = Math.min(
		lines.length,
		Math.ceil((scrollTop + viewHeight) / LINE_H) + OVERSCAN,
	);
	const lineContents = useMemo(() => lines.map(contentOf), [lines]);
	const visibleRange = useMemo<[number, number]>(
		() => [start, end],
		[start, end],
	);
	const {
		ensureHighlightedRange,
		getHighlightedLineTokens,
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
			const maxScrollTop = Math.max(0, lines.length * LINE_H - viewHeight);
			const nextScrollTop = roundToDevicePixel(
				Math.min(Math.max(0, externalScrollTop), maxScrollTop),
			);
			const nextStart = Math.max(
				0,
				Math.floor(nextScrollTop / LINE_H) - OVERSCAN,
			);
			const nextEnd = Math.min(
				lines.length,
				Math.ceil((nextScrollTop + viewHeight) / LINE_H) + OVERSCAN,
			);
			ensureHighlightedRange(nextStart, nextEnd);
			scrollRef.current.scrollTop = nextScrollTop;
			lastScrollRef.current.top = nextScrollTop;
			dispatchViewport({ type: "scroll", top: nextScrollTop });
		}
	}, [
		ensureHighlightedRange,
		externalScrollTop,
		externalScrollSource,
		lines.length,
		scrollRef,
		side,
		viewHeight,
	]);

	const scrollToLine = useCallback(
		(lineIndex: number) => {
			if (!scrollRef.current) return;
			const maxScrollTop = Math.max(0, lines.length * LINE_H - viewHeight);
			const nextScrollTop = roundToDevicePixel(
				Math.min(
					Math.max(0, lineIndex * LINE_H - viewHeight / 2),
					maxScrollTop,
				),
			);
			const nextStart = Math.max(
				0,
				Math.floor(nextScrollTop / LINE_H) - OVERSCAN,
			);
			const nextEnd = Math.min(
				lines.length,
				Math.ceil((nextScrollTop + viewHeight) / LINE_H) + OVERSCAN,
			);
			ensureHighlightedRange(nextStart, nextEnd);
			scrollRef.current.scrollTop = nextScrollTop;
			lastScrollRef.current.top = nextScrollTop;
			dispatchViewport({ type: "scroll", top: nextScrollTop });
			onScroll?.(nextScrollTop, scrollRef.current.scrollLeft, true);
		},
		[scrollRef, viewHeight, lines.length, ensureHighlightedRange, onScroll],
	);

	const visibleRows = useMemo(() => {
		const rows: {
			line: DiffLine;
			tokens: Token[] | null;
			highlightedTokens?: ShikiLineToken[];
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
			const highlightedTokens = canUseShiki
				? getHighlightedLineTokens(i)
				: undefined;
			const useFallbackTokens = !canUseShiki;

			rows.push({
				line,
				tokens:
					line.type === "spacer" ||
					line.type === "hunk" ||
					highlightedTokens ||
					!useFallbackTokens
						? null
						: getTokens(line.content, ext, disableTokenize),
				highlightedTokens,
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
		getHighlightedLineTokens,
		filePath,
		changeLineMap,
		highlightedChangeIdx,
	]);

	const minimapSegments = useMemo(() => {
		if (!_showMinimap || lines.length === 0 || lines.length >= 3000)
			return null;
		return minimapOldLines
			? [
					...buildMinimapSegments(minimapOldLines, "left"),
					...buildMinimapSegments(lines, "right"),
				]
			: buildMinimapSegments(lines, "full");
	}, [lines, minimapOldLines, _showMinimap]);

	return (
		<div {...stylex.props(diffStyles.virtualRoot)}>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				data-diff-scroll-side={side}
				{...stylex.props(diffStyles.virtualScroller)}
				style={verticalFollower ? { overflowY: "hidden" } : undefined}
			>
				<div
					style={{
						height: total,
						position: "relative",
						minWidth: minContentWidth,
					}}
				>
					<div
						{...stylex.props(diffStyles.virtualOffsetLayer)}
						style={{
							transform: `translate3d(0, ${start * LINE_H}px, 0)`,
							minWidth: minContentWidth,
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
							({ line, tokens, highlightedTokens, key, isHighlighted }) => (
								<DiffRow
									key={key}
									line={line}
									ext={ext}
									tokens={tokens}
									highlightedTokens={highlightedTokens}
									isHighlighted={isHighlighted}
									minWidth={minContentWidth}
									hideGutter
								/>
							),
						)}
					</div>
				</div>
			</div>
			{minimapSegments && (
				<DiffMinimap
					lines={lines}
					segments={minimapSegments}
					scrollTop={scrollTop}
					viewHeight={viewHeight}
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
	externalScrollSource?: DiffScrollSource;
	externalScrollTop?: number;
	filePath?: string;
	highlightedChangeIdx?: number;
	newLines: DiffLine[];
	oldLines: DiffLine[];
	scrollRef: React.RefObject<HTMLDivElement | null>;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const lineCount = Math.max(oldLines.length, newLines.length);
	const alignedOldLines = useMemo(
		() => alignDiffLines(oldLines, lineCount),
		[lineCount, oldLines],
	);
	const alignedNewLines = useMemo(
		() => alignDiffLines(newLines, lineCount),
		[lineCount, newLines],
	);
	const {
		followerRef,
		followerScrollSource,
		followerScrollTop,
		syncFromMaster,
	} = useSplitDiffScroll(
		scrollRef,
		LINE_H,
		externalScrollTop,
		externalScrollSource,
	);

	return (
		<div {...stylex.props(diffStyles.splitPanels)}>
			<div {...stylex.props(diffStyles.splitPanel, diffStyles.splitPanelLeft)}>
				<VirtualPanel
					lines={alignedOldLines}
					ext={ext}
					scrollRef={followerRef}
					verticalFollower
					disableTokenize={disableTokenize}
					externalScrollTop={followerScrollTop}
					externalScrollSource={followerScrollSource}
					side="left"
					filePath={filePath}
					highlightedChangeIdx={highlightedChangeIdx}
					changeLineMap={changeLineMap}
					syntaxTheme={syntaxTheme}
				/>
			</div>
			<div {...stylex.props(diffStyles.splitPanel)}>
				<VirtualPanel
					lines={alignedNewLines}
					ext={ext}
					scrollRef={scrollRef}
					onScroll={syncFromMaster}
					disableTokenize={disableTokenize}
					showMinimap
					minimapOldLines={alignedOldLines}
					externalScrollTop={externalScrollTop}
					externalScrollSource={externalScrollSource}
					side="right"
					filePath={filePath}
					highlightedChangeIdx={highlightedChangeIdx}
					changeLineMap={changeLineMap}
					syntaxTheme={syntaxTheme}
				/>
			</div>
		</div>
	);
});

const DiffMinimap = memo(function DiffMinimap({
	lines,
	segments,
	scrollTop,
	viewHeight,
	totalHeight,
	onScrollTo,
}: {
	lines: DiffLine[];
	segments: MinimapSegment[];
	scrollTop: number;
	viewHeight: number;
	totalHeight: number;
	onScrollTo: (lineIndex: number) => void;
}) {
	const containerRef = useRef<HTMLButtonElement | null>(null);

	if (totalHeight <= 0 || lines.length === 0) {
		return (
			<button
				type="button"
				ref={containerRef}
				aria-label="Jump within diff"
				disabled
				{...stylex.props(diffStyles.minimap, diffStyles.minimapInteractive)}
			/>
		);
	}

	const thumbHeightRatio = Math.max(0, Math.min(1, viewHeight / totalHeight));
	const thumbTopRatio = Math.max(
		0,
		Math.min(scrollTop / totalHeight, 1 - thumbHeightRatio),
	);

	const handleClick = (e: MouseEvent) => {
		if (!containerRef.current || lines.length === 0) return;
		const rect = containerRef.current.getBoundingClientRect();
		if (rect.height <= 0) return;
		const y = e.clientY - rect.top;
		const lineIndex = Math.floor((y / rect.height) * lines.length);
		if (!Number.isFinite(lineIndex)) return;
		onScrollTo(Math.max(0, Math.min(lines.length - 1, lineIndex)));
	};
	const handleKeyboardJump = () => {
		if (lines.length === 0) return;
		onScrollTo(Math.floor(lines.length / 2));
	};

	return (
		<button
			type="button"
			ref={containerRef}
			aria-label="Jump within diff"
			{...stylex.props(diffStyles.minimap, diffStyles.minimapInteractive)}
			onClick={handleClick}
			onKeyDown={activateOnEnterOrSpacePreventDefault.bind(
				null,
				handleKeyboardJump,
			)}
		>
			{segments.map((seg) => (
				<div
					key={`${seg.side}:${seg.type}:${seg.startLine}:${seg.endLine}`}
					data-diff-minimap-change={`${seg.side}:${seg.type}`}
					{...stylex.props(
						diffStyles.minimapSegment,
						seg.type === "add"
							? diffStyles.minimapAdd
							: diffStyles.minimapDelete,
					)}
					style={{
						left: seg.side === "left" || seg.side === "full" ? 2 : undefined,
						right: seg.side === "right" || seg.side === "full" ? 2 : undefined,
						width: seg.side === "full" ? "auto" : undefined,
						top: `${(seg.startLine / lines.length) * 100}%`,
						height: `max(2px, ${((seg.endLine - seg.startLine) / lines.length) * 100}%)`,
					}}
				/>
			))}
			<div
				{...stylex.props(diffStyles.minimapThumb)}
				style={{
					top: `${thumbTopRatio * 100}%`,
					height: `${thumbHeightRatio * 100}%`,
					minHeight: 16,
				}}
			/>
		</button>
	);
});
export const DiffViewer = memo(function DiffViewer({
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
}: DiffViewerProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const rightRef = useRef<HTMLDivElement | null>(null);
	const [internalViewMode, setInternalViewMode] =
		useState<DiffViewMode>("split");
	const viewMode = controlledViewMode ?? internalViewMode;
	const setViewMode = onViewModeChange ?? setInternalViewMode;
	const [storedSyntaxTheme] = useSyntaxHighlightTheme();
	const syntaxTheme = controlledSyntaxTheme ?? storedSyntaxTheme;
	const [navigationState, dispatchNavigation] = useReducer(
		diffNavigationReducer,
		INITIAL_DIFF_NAVIGATION_STATE,
	);
	const { externalScrollSource, externalScrollTop, highlightedChangeIdx } =
		navigationState;
	const stats = useMemo(() => summarizeHunkDiff(diff), [diff]);
	const diffIdentity = `${filePath}:${staged ? "staged" : "unstaged"}`;

	useEffect(() => {
		void diffIdentity;
		dispatchNavigation({ type: "reset" });
	}, [diffIdentity]);

	const { changePositions, changeLineMap } = useMemo(() => {
		const positions: number[] = [];
		const lineMap = new Map<number, number>();

		let currentChangeIdx = -1;
		let inChange = false;

		if (viewMode === "hunks" && diff.compactLines) {
			for (let idx = 0; idx < diff.compactLines.length; idx++) {
				const line = diff.compactLines[idx];
				const isChanged = line?.type === "remove" || line?.type === "add";
				if (isChanged && !inChange) {
					currentChangeIdx++;
					positions.push(idx);
					inChange = true;
				} else if (!isChanged) {
					inChange = false;
				}
				if (isChanged) lineMap.set(idx, currentChangeIdx);
			}
			return { changePositions: positions, changeLineMap: lineMap };
		}

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
	}, [diff.compactLines, diff.oldLines, diff.newLines, viewMode]);

	const totalChanges = changePositions.length;
	const scrollToChangeIdx = useCallback(
		(changeIdx: number) => {
			if (changeIdx < 0 || changeIdx >= changePositions.length) return;
			const lineIdx = changePositions[changeIdx];
			if (lineIdx === undefined) return;
			const scrollPos = Math.max(0, (lineIdx - 5) * LINE_H);
			dispatchNavigation({
				type: "jumpToChange",
				changeIdx,
				top: scrollPos,
			});

			setTimeout(() => {
				dispatchNavigation({ type: "clearScroll" });
				setTimeout(() => dispatchNavigation({ type: "clearHighlight" }), 1500);
			}, 100);
		},
		[changePositions],
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
				idx !== -1 ? idx : dir === 1 ? 0 : changePositions.length - 1,
			);
		},
		[changePositions, scrollToChangeIdx],
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
			dispatchNavigation({
				type: "jumpToPosition",
				source: "all",
				top: scrollPos,
			});
			const resetTimer = setTimeout(() => {
				dispatchNavigation({ type: "clearScroll" });
			}, 100);
			return () => clearTimeout(resetTimer);
		}
	}, [scrollToChange, diff.newLines, diff.oldLines]);

	const ext = useMemo(() => {
		const p = filePath.split(".");
		return p.length > 1 ? p.pop()! : "";
	}, [filePath]);

	const statusMessage = useMemo(() => {
		if (diff.compactLines?.length === 1) {
			const line = diff.compactLines[0];
			if (
				line?.type === "context" &&
				/too large|cannot read/i.test(line.content)
			) {
				return line.content.trim();
			}
		}
		if (diff.oldLines.length !== 0 || diff.newLines.length !== 1) return null;
		const line = diff.newLines[0];
		if (!line || line.type !== "context") return null;
		const text = line.content.trim();
		return /too large|cannot read/i.test(text) ? text : null;
	}, [diff.compactLines, diff.newLines, diff.oldLines.length]);

	const oversizedMessage = useMemo(() => {
		const lines = diff.compactLines ?? [...diff.oldLines, ...diff.newLines];
		const totalLines = lines.length;
		if (totalLines > MAX_RENDERED_DIFF_LINES) {
			return `Diff is too large to render safely (${totalLines.toLocaleString()} lines). Use the Editor/agent to inspect this file in smaller chunks.`;
		}
		let longest = 0;
		for (const line of lines) {
			if (line.content.length > longest) longest = line.content.length;
		}
		if (longest > MAX_RENDERED_LINE_CHARS * 2) {
			return `Diff contains a very long line (${longest.toLocaleString()} characters). Rendering is limited to keep the app responsive.`;
		}
		return null;
	}, [diff.compactLines, diff.newLines, diff.oldLines]);

	const disableTokenize = useMemo(
		() => shouldDisableDiffTokenization(diff),
		[diff],
	);

	const renderMergeConflict = Boolean(diff.mergeConflictContent);

	const hunkLines = useMemo(() => {
		if (oversizedMessage) return [];
		if (diff.compactLines) return diff.compactLines;
		return buildInlineHunkLines(diff.oldLines, diff.newLines);
	}, [diff.compactLines, diff.oldLines, diff.newLines, oversizedMessage]);
	const splitOldLines = useMemo(
		() =>
			diff.isNew
				? diff.newLines.map(() => ({
						number: null,
						content: "",
						type: "spacer" as const,
					}))
				: diff.oldLines,
		[diff.isNew, diff.newLines, diff.oldLines],
	);
	if (loading) {
		return (
			<div {...stylex.props(diffStyles.centerState)}>
				<div {...stylex.props(diffStyles.centerInline)}>
					<div {...stylex.props(diffStyles.spinner)} />
					<span {...stylex.props(diffStyles.centerText)}>Loading diff…</span>
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

	const isMarkdown = !diff.compactLines && (ext === "md" || ext === "mdx");
	const markdownContent = isMarkdown ? buildMarkdownContent(diff.newLines) : "";

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
						oldLines={splitOldLines}
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
	const scrollRef = useRef<HTMLDivElement | null>(null);
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

const diffStyles = stylex.create({
	virtualRoot: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
		width: "100%",
		contain: "layout paint style",
	},
	virtualScroller: {
		flex: 1,
		minWidth: controlSize._0,
		overflow: "auto",
		overflowAnchor: "none",
		overscrollBehavior: "contain",
		scrollbarGutter: "stable",
		contain: "layout paint style",
	},
	splitPanels: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	splitPanel: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	splitPanelLeft: {
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
	},
	virtualOffsetLayer: {
		position: "absolute",
		top: controlSize._0,
		left: controlSize._0,
		right: controlSize._0,
		contain: "layout paint style",
		willChange: "transform",
	},
	minimap: {
		width: "16px",
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderSubtle,
		backgroundColor: color.transparent,
	},
	minimapInteractive: {
		appearance: "none",
		borderTopWidth: 0,
		borderRightWidth: 0,
		borderBottomWidth: 0,
		padding: controlSize._0,
		position: "relative",
		cursor: "pointer",
	},
	minimapSegment: {
		position: "absolute",
		width: "6px",
		borderRadius: radius.none,
	},
	minimapAdd: {
		backgroundColor: "var(--color-git-added)",
	},
	minimapDelete: {
		backgroundColor: "var(--color-git-deleted)",
	},
	minimapThumb: {
		position: "absolute",
		left: controlSize._0,
		right: controlSize._0,
		pointerEvents: "none",
		backgroundColor: color.surfaceWhite14,
	},
	singlePanel: {
		display: "flex",
		minHeight: controlSize._0,
		flex: 1,
		flexDirection: "column",
	},
	toolbar: {
		display: "flex",
		height: controlSize._10,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-end",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingInline: controlSize._3,
	},
	segmented: {
		position: "relative",
		isolation: "isolate",
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		boxShadow: shadow.controlDepth,
	},
	viewButton: {
		position: "relative",
		zIndex: layer.content,
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
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
	},
	viewButtonActive: {
		backgroundColor: color.transparent,
		backgroundImage: "none",
		boxShadow: shadow.none,
		color: color.textMain,
	},
	header: {
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingInline: controlSize._3,
	},
	pathDir: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontFamily: font.familyDiff,
		fontSize: font.size_2,
	},
	pathName: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontWeight: font.weightRegular,
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
	rotateHalfTurn: {
		transform: "rotate(180deg)",
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
		backgroundColor: color.transparent,
	},
	shellRelative: {
		position: "relative",
	},
	centerState: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: color.transparent,
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
		animationDuration: motion.durationLonger,
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
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	conflictBody: {
		minHeight: controlSize._0,
		flex: 1,
		display: "flex",
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	conflictActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.surfaceGlassStrong,
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
	hunkText: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	spacer: {
		backgroundColor: color.surfaceWhite02,
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
		left: controlSize._0,
		zIndex: layer.chrome,
		width: GUTTER_W,
		height: controlSize._0,
		backgroundColor: color.surfaceGlassStrong,
		pointerEvents: "none",
	},
	gutterBlock: {
		position: "absolute",
		left: controlSize._0,
		width: GUTTER_W,
		backgroundColor: color.surfaceGlassStrong,
	},
	gutterRow: {
		display: "flex",
		height: LINE_H,
		maxHeight: LINE_H,
		minHeight: LINE_H,
		overflow: "hidden",
		backgroundColor: color.surfaceGlassStrong,
	},
	content: {
		flex: 1,
		fontFamily: font.familyDiff,
		fontWeight: font.weight_5,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		minWidth: "max-content",
		paddingLeft: controlSize._2,
		paddingRight: controlSize._3,
		whiteSpace: "pre",
	},
});

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
	externalScrollSource?: DiffScrollSource;
	filePath?: string;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
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
				<LiquidSegmentedRail
					activeIndex={viewMode === "split" ? 0 : 1}
					itemCount={2}
					radius={8}
				/>
				<DiffViewButton
					active={viewMode === "split"}
					title="Full file diff"
					icon={<IconLayoutGrid size={iconSize.compact} />}
					onClick={() => onChange("split")}
				/>
				<DiffViewButton
					active={viewMode === "hunks"}
					title="Hunk view"
					icon={<IconGitBranch size={iconSize.compact} />}
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
	icon: unknown;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			{...stylex.props(
				diffStyles.viewButton,
				active && diffStyles.viewButtonActive,
			)}
		>
			{icon}
		</button>
	);
}

function DiffHeader({
	filePath,
	staged: _staged,
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
	const name = filePath.split("/").pop() || filePath;

	return (
		<div {...stylex.props(diffStyles.header)}>
			<FileTypeIcon path={filePath} size={iconSize.lg} />
			<span {...stylex.props(diffStyles.pathName)}>{name}</span>

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
							<IconChevronRight
								size={iconSize.sm}
								className={stylex.props(diffStyles.rotateHalfTurn).className}
							/>
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
							<IconChevronRight size={iconSize.sm} />
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
				<IconX size={iconSize.xs} />
			</IconButton>
		</div>
	);
}
