import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "octane";
import {
	type ShikiLineToken,
	type SyntaxHighlightTheme,
	useShikiHighlighter,
} from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import {
	contentOf,
	type Token,
	tokenizeLine,
} from "../../../../../shared/lib/data.ts";
import type {
	DiffLine,
	DiffMinimapSegment as MinimapSegment,
} from "../../../../repository/model/types.ts";
import {
	DIFF_CONFIG,
	diffViewportReducer,
	GUTTER_W,
	INITIAL_DIFF_VIEWPORT_STATE,
	LINE_H,
} from "../../../model/workbench-model.ts";
import type { DiffScrollSource } from "../../hooks/useSplitDiffScroll.tsx";
import { DiffGutterRow } from "./DiffGutterRow.tsx";
import { DiffMinimap } from "./DiffMinimap.tsx";
import { DiffRow } from "./DiffRow.tsx";
import * as inlineStyles from "./styles.ts";
import { diffStyles } from "./styles.ts";

const SPLIT_RIGHT_INSET = 12;

const OVERSCAN = DIFF_CONFIG.overscan;

const MAX_PANEL_CONTENT_WIDTH = 8000;

function roundToDevicePixel(value: number): number {
	const dpr = window.devicePixelRatio ?? 1;
	return Math.round(value * dpr) / dpr;
}

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

export const VirtualPanel = memo(function VirtualPanel({
	lines,
	rowCount = lines.length,
	maxLineChars,
	ext,
	scrollRef,
	onScroll,
	disableTokenize,
	gutterLines,
	showGutter = true,
	showMinimap: _showMinimap = false,
	minimapSegments,
	verticalFollower = false,
	externalScrollTop,
	externalScrollSource,
	side,
	filePath,
	highlightedRange,
	syntaxTheme,
}: {
	lines: DiffLine[];
	rowCount?: number;
	maxLineChars?: number;
	ext: string;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	onScroll?: (
		scrollTop: number,
		scrollLeft: number,
		programmatic?: boolean,
	) => void;
	disableTokenize: boolean;
	gutterLines?: DiffLine[];
	showGutter?: boolean;
	showMinimap?: boolean;
	minimapSegments?: MinimapSegment[];
	verticalFollower?: boolean;
	externalScrollTop?: number;
	externalScrollSource?: DiffScrollSource;
	side: "left" | "right" | "single";
	filePath?: string;
	highlightedRange?: readonly [number, number];
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

	const total = rowCount * LINE_H;
	const maxLineLength = useMemo(() => {
		if (maxLineChars !== undefined) return maxLineChars;
		let max = 0;
		for (const line of lines) {
			if (line.content && line.content.length > max) {
				max = line.content.length;
			}
		}
		return max;
	}, [lines, maxLineChars]);
	const minContentWidth = Math.min(
		MAX_PANEL_CONTENT_WIDTH,
		(showGutter ? GUTTER_W : SPLIT_RIGHT_INSET) + maxLineLength * 9 + 48,
	);

	const start = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
	const end = Math.min(
		rowCount,
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
		revision: shikiRevision,
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
			const maxScrollTop = Math.max(0, rowCount * LINE_H - viewHeight);
			const nextScrollTop = roundToDevicePixel(
				Math.min(Math.max(0, externalScrollTop), maxScrollTop),
			);
			const nextStart = Math.max(
				0,
				Math.floor(nextScrollTop / LINE_H) - OVERSCAN,
			);
			const nextEnd = Math.min(
				rowCount,
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
		rowCount,
		scrollRef,
		side,
		viewHeight,
	]);

	const scrollToLine = useCallback(
		(lineIndex: number) => {
			if (!scrollRef.current) return;
			const maxScrollTop = Math.max(0, rowCount * LINE_H - viewHeight);
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
				rowCount,
				Math.ceil((nextScrollTop + viewHeight) / LINE_H) + OVERSCAN,
			);
			ensureHighlightedRange(nextStart, nextEnd);
			scrollRef.current.scrollTop = nextScrollTop;
			lastScrollRef.current.top = nextScrollTop;
			dispatchViewport({ type: "scroll", top: nextScrollTop });
			onScroll?.(nextScrollTop, scrollRef.current.scrollLeft, true);
		},
		[scrollRef, viewHeight, rowCount, ensureHighlightedRange, onScroll],
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
			const line: DiffLine = lines[i] ?? {
				number: null,
				content: "",
				type: "spacer",
			};

			const isHighlighted =
				highlightedRange !== undefined &&
				i >= highlightedRange[0] &&
				i < highlightedRange[1];
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
		rowCount,
		start,
		end,
		ext,
		disableTokenize,
		shikiReady,
		shikiRevision,
		shikiLanguage,
		getHighlightedLineTokens,
		filePath,
		highlightedRange,
	]);

	return (
		<div {...stylex.props(diffStyles.virtualRoot)}>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				data-diff-scroll-side={side}
				{...stylex.props(diffStyles.virtualScroller)}
				style={
					verticalFollower
						? inlineStyles.getVirtualPanelVirtualScrollerStyle()
						: undefined
				}
			>
				<div
					style={inlineStyles.getVirtualPanelDivStyle(total, minContentWidth)}
				>
					<div
						{...stylex.props(diffStyles.virtualOffsetLayer)}
						style={inlineStyles.getVirtualPanelVirtualOffsetLayerStyle(
							`translate3d(0, ${start * LINE_H}px, 0)`,
							minContentWidth,
						)}
					>
						{showGutter ? (
							<div {...stylex.props(diffStyles.gutterLayer)}>
								<div
									{...stylex.props(diffStyles.gutterBlock)}
									style={inlineStyles.getVirtualPanelGutterBlockStyle()}
								>
									{visibleRows.map(({ line, key }) => (
										<DiffGutterRow
											key={key}
											line={
												line.type === "spacer" &&
												gutterLines?.[key]?.type === "add"
													? gutterLines[key]!
													: line
											}
										/>
									))}
								</div>
							</div>
						) : null}
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
									gutterOffset={showGutter ? GUTTER_W : SPLIT_RIGHT_INSET}
								/>
							),
						)}
					</div>
				</div>
			</div>
			{_showMinimap && rowCount > 0 && rowCount < 3000 && minimapSegments && (
				<DiffMinimap
					rowCount={rowCount}
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
