import type { DiffScrollSource, GitDiffLine, MinimapSegment } from "@contracts";
import {
	type SyntaxToken,
	useSyntaxHighlight,
} from "@shared/hooks/useSyntaxHighlight.tsx";
import { assignRef, domStyle, type RefCell } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
} from "solid-js";
import { DiffGutterRow } from "./DiffGutterRow.tsx";
import { DiffMinimap } from "./DiffMinimap.tsx";
import { DiffRow } from "./DiffRow.tsx";
import * as inlineStyles from "./styles.ts";
import { DIFF_CONFIG, diffStyles, GUTTER_W, LINE_H } from "./styles.ts";

const SPLIT_RIGHT_INSET = 12;
const OVERSCAN = DIFF_CONFIG.overscan;
const MAX_PANEL_CONTENT_WIDTH = 8000;
function roundToDevicePixel(value: number): number {
	const dpr = window.devicePixelRatio ?? 1;
	return Math.round(value * dpr) / dpr;
}
export const VirtualPanel = function VirtualPanel(props: {
	lines: GitDiffLine[];
	rowCount?: number;
	maxLineChars: number;
	ext: string;
	scrollRef: RefCell<HTMLDivElement | null>;
	onScroll?: (
		scrollTop: number,
		scrollLeft: number,
		programmatic?: boolean,
	) => void;
	disableTokenize: boolean;
	gutterLines?: GitDiffLine[];
	showGutter?: boolean;
	showMinimap?: boolean;
	minimapSegments?: MinimapSegment[];
	verticalFollower?: boolean;
	externalScrollTop?: number;
	externalScrollSource?: DiffScrollSource;
	side: "left" | "right" | "single";
	filePath?: string;
	highlightedRange?: readonly [number, number];
}) {
	const equals = (previous: number, next: number) =>
		!(Math.abs(previous - next) > 0.5);
	const [scrollTop, setScrollTop] = createSignal(0, { equals });
	const [viewHeight, setViewHeight] = createSignal(600, { equals });
	const rafRef = {
		current: 0,
	} as {
		current: number;
	};
	const lastScrollRef = {
		current: {
			left: 0,
			top: 0,
		},
	};
	createEffect(
		() => props.scrollRef,
		(scrollRef) => {
			const el = scrollRef.current;
			if (!el) return;
			setViewHeight(el.clientHeight || 600);
			const obs = new ResizeObserver(([entry]) =>
				setViewHeight(entry?.contentRect.height || 600),
			);
			obs.observe(el);
			return obs.disconnect.bind(obs);
		},
	);
	const handleScroll = () => {
		if (!props.scrollRef.current) return;
		const { scrollTop: nextTop, scrollLeft: nextLeft } =
			props.scrollRef.current;
		props.onScroll?.(nextTop, nextLeft);
		if (rafRef.current) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = 0;
			if (!props.scrollRef.current) return;
			const { scrollTop: st, scrollLeft: sl } = props.scrollRef.current;
			const last = lastScrollRef.current;
			const topChanged = Math.abs(last.top - st) > 0.5;
			const leftChanged = Math.abs(last.left - sl) > 0.5;
			if (topChanged) {
				last.top = st;
				setScrollTop(st);
			}
			if (leftChanged) last.left = sl;
		});
	};
	onSettled(() => () => cancelAnimationFrame(rafRef.current));
	const total = createMemo(
		() =>
			(props.rowCount === undefined ? props.lines.length : props.rowCount) *
			LINE_H,
	);
	const minContentWidth = createMemo(() =>
		Math.min(
			MAX_PANEL_CONTENT_WIDTH,
			((props.showGutter === undefined ? true : props.showGutter)
				? GUTTER_W
				: SPLIT_RIGHT_INSET) +
				props.maxLineChars * 9 +
				48,
		),
	);
	const start = createMemo(() =>
		Math.max(0, Math.floor(scrollTop() / LINE_H) - OVERSCAN),
	);
	const end = createMemo(() => {
		return Math.min(
			props.rowCount === undefined ? props.lines.length : props.rowCount,
			Math.ceil((scrollTop() + viewHeight()) / LINE_H) + OVERSCAN,
		);
	});
	const lineContents = createMemo(() =>
		props.lines.map((line) => line.content),
	);
	const lineTypes = createMemo(() => props.lines.map((line) => line.type));
	const _source2 = useSyntaxHighlight(() => ({
		filePath: props.filePath ?? `file.${props.ext}`,
		lines: lineContents(),
		lineTypes: lineTypes(),
		enabled: !props.disableTokenize && !!props.filePath,
	}));
	createEffect(
		() => ({
			top: props.externalScrollTop,
			source: props.externalScrollSource,
			rowCount: props.rowCount ?? props.lines.length,
			scrollRef: props.scrollRef,
			side: props.side,
			viewHeight: viewHeight(),
		}),
		({ top, source, rowCount, scrollRef, side, viewHeight }) => {
			const element = scrollRef.current;
			if (!element || top === undefined || top < 0 || source === side) return;
			const maxScrollTop = Math.max(0, rowCount * LINE_H - viewHeight);
			const nextScrollTop = roundToDevicePixel(Math.min(top, maxScrollTop));
			// Reapply the clamped target after a file or viewport size changes.
			if (element.scrollTop !== nextScrollTop)
				element.scrollTop = nextScrollTop;
			lastScrollRef.current.top = nextScrollTop;
			setScrollTop(nextScrollTop);
		},
	);
	const scrollToLine = (lineIndex: number) => {
		const height = viewHeight();
		if (!props.scrollRef.current) return;
		const maxScrollTop = Math.max(
			0,
			(props.rowCount === undefined ? props.lines.length : props.rowCount) *
				LINE_H -
				height,
		);
		const nextScrollTop = roundToDevicePixel(
			Math.min(Math.max(0, lineIndex * LINE_H - height / 2), maxScrollTop),
		);
		props.scrollRef.current.scrollTop = nextScrollTop;
		lastScrollRef.current.top = nextScrollTop;
		setScrollTop(nextScrollTop);
		props.onScroll?.(nextScrollTop, props.scrollRef.current.scrollLeft, true);
	};
	const visibleRows = createMemo(() => {
		const rows: {
			line: GitDiffLine;
			highlightedTokens?: SyntaxToken[];
			key: number;
			isHighlighted: boolean;
		}[] = [];
		for (let i = start(); i < end(); i++) {
			const line: GitDiffLine = props.lines[i] ?? {
				number: null,
				content: "",
				type: "spacer",
			};
			const isHighlighted =
				props.highlightedRange !== undefined &&
				i >= props.highlightedRange[0] &&
				i < props.highlightedRange[1];
			const highlightedTokens =
				_source2.isReady &&
				!props.disableTokenize &&
				props.filePath &&
				_source2.language
					? _source2.getLineTokens(i)
					: undefined;
			rows.push({
				line,
				highlightedTokens,
				key: i,
				isHighlighted,
			});
		}
		return rows;
	});
	return (
		<div {...stylex.attrs(diffStyles.virtualRoot)}>
			<div
				ref={(_element) => assignRef(props.scrollRef, _element)}
				onScroll={handleScroll}
				data-diff-scroll-side={props.side}
				{...stylex.attrs(
					diffStyles.virtualScroller,
					props.side !== "single" && diffStyles.splitScroller,
				)}
				style={domStyle(
					(
						props.verticalFollower === undefined
							? false
							: props.verticalFollower
					)
						? inlineStyles.getVirtualPanelVirtualScrollerStyle()
						: undefined,
				)}
			>
				<div
					style={domStyle(
						inlineStyles.getVirtualPanelDivStyle(total(), minContentWidth()),
					)}
				>
					<div
						{...stylex.attrs(diffStyles.virtualOffsetLayer)}
						style={domStyle(
							inlineStyles.getVirtualPanelVirtualOffsetLayerStyle(
								`translate3d(0, ${start() * LINE_H}px, 0)`,
								minContentWidth(),
							),
						)}
					>
						{(props.showGutter === undefined ? true : props.showGutter) ? (
							<div {...stylex.attrs(diffStyles.gutterLayer)}>
								<div
									{...stylex.attrs(diffStyles.gutterBlock)}
									style={domStyle(
										inlineStyles.getVirtualPanelGutterBlockStyle(),
									)}
								>
									{
										<For each={visibleRows()} keyed={(row) => row.key}>
											{(props2) => (
												<DiffGutterRow
													line={
														props2().line.type === "spacer" &&
														props.gutterLines?.[props2().key]?.type === "add"
															? props.gutterLines[props2().key]!
															: props2().line
													}
												/>
											)}
										</For>
									}
								</div>
							</div>
						) : null}
						{
							<For each={visibleRows()} keyed={(row) => row.key}>
								{(props3) => (
									<DiffRow
										line={props3().line}
										highlightedTokens={props3().highlightedTokens}
										syntaxPending={
											!props.disableTokenize &&
											!!props.filePath &&
											!_source2.isReady
										}
										isHighlighted={props3().isHighlighted}
										minWidth={minContentWidth()}
										hideGutter
										gutterOffset={
											(props.showGutter === undefined ? true : props.showGutter)
												? GUTTER_W
												: SPLIT_RIGHT_INSET
										}
									/>
								)}
							</For>
						}
					</div>
				</div>
			</div>
			{(props.showMinimap === undefined ? false : props.showMinimap) &&
				(props.rowCount === undefined ? props.lines.length : props.rowCount) >
					0 &&
				(props.rowCount === undefined ? props.lines.length : props.rowCount) <
					3000 &&
				props.minimapSegments && (
					<DiffMinimap
						rowCount={
							props.rowCount === undefined ? props.lines.length : props.rowCount
						}
						segments={props.minimapSegments}
						scrollTop={scrollTop()}
						viewHeight={viewHeight()}
						totalHeight={total()}
						onScrollTo={scrollToLine}
					/>
				)}
		</div>
	);
};
