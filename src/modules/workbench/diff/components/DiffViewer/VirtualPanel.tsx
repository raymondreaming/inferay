import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, For, onSettled } from "solid-js";
import type { GitDiffLine } from "../../../../../../build/presentation/contracts/GitDiffLine.ts";
import type { MinimapSegment } from "../../../../../../build/presentation/contracts/MinimapSegment.ts";
import {
	type SyntaxToken,
	useSyntaxHighlight,
} from "../../../../../shared/hooks/useSyntaxHighlight.tsx";
import {
	assignRef,
	createReducer,
	domStyle,
	type RefCell,
} from "../../../../../shared/lib/dom.tsx";
import type { DiffScrollSource } from "../../hooks/useSplitDiffScroll.tsx";
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
export const VirtualPanel = function VirtualPanel(_props: {
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
	const [viewport, dispatchViewport] = createReducer(
		diffViewportReducer,
		INITIAL_DIFF_VIEWPORT_STATE,
	);
	const _source = createMemo(() => viewport());
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
		() => _props.scrollRef,
		(scrollRef) => {
			const el = scrollRef.current;
			if (!el) return;
			dispatchViewport({
				type: "measure",
				height: el.clientHeight,
			});
			const obs = new ResizeObserver((e) =>
				dispatchViewport({
					type: "measure",
					height:
						e[0]?.contentRect.height ?? INITIAL_DIFF_VIEWPORT_STATE.viewHeight,
				}),
			);
			obs.observe(el);
			return obs.disconnect.bind(obs);
		},
	);
	const handleScroll = () => {
		if (!_props.scrollRef.current) return;
		const { scrollTop: nextTop, scrollLeft: nextLeft } =
			_props.scrollRef.current;
		_props.onScroll?.(nextTop, nextLeft);
		if (rafRef.current) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = 0;
			if (!_props.scrollRef.current) return;
			const { scrollTop: st, scrollLeft: sl } = _props.scrollRef.current;
			const last = lastScrollRef.current;
			const topChanged = Math.abs(last.top - st) > 0.5;
			const leftChanged = Math.abs(last.left - sl) > 0.5;
			if (topChanged) {
				last.top = st;
				dispatchViewport({
					type: "scroll",
					top: st,
				});
			}
			if (leftChanged) last.left = sl;
		});
	};
	onSettled(() => () => cancelAnimationFrame(rafRef.current));
	const total = createMemo(
		() =>
			(_props.rowCount === undefined ? _props.lines.length : _props.rowCount) *
			LINE_H,
	);
	const minContentWidth = createMemo(() =>
		Math.min(
			MAX_PANEL_CONTENT_WIDTH,
			((_props.showGutter === undefined ? true : _props.showGutter)
				? GUTTER_W
				: SPLIT_RIGHT_INSET) +
				_props.maxLineChars * 9 +
				48,
		),
	);
	const start = createMemo(() =>
		Math.max(0, Math.floor(_source().scrollTop / LINE_H) - OVERSCAN),
	);
	const end = createMemo(() => {
		const _sourceValue = _source();
		return Math.min(
			_props.rowCount === undefined ? _props.lines.length : _props.rowCount,
			Math.ceil((_sourceValue.scrollTop + _sourceValue.viewHeight) / LINE_H) +
				OVERSCAN,
		);
	});
	const lineContents = createMemo(() =>
		_props.lines.map((line) => line.content),
	);
	const lineTypes = createMemo(() => _props.lines.map((line) => line.type));
	const _source2 = useSyntaxHighlight(() => ({
		filePath: _props.filePath ?? `file.${_props.ext}`,
		lines: lineContents(),
		lineTypes: lineTypes(),
		enabled: !_props.disableTokenize && !!_props.filePath,
	}));
	createEffect(
		() => ({
			top: _props.externalScrollTop,
			source: _props.externalScrollSource,
			rowCount: _props.rowCount ?? _props.lines.length,
			scrollRef: _props.scrollRef,
			side: _props.side,
			viewHeight: _source().viewHeight,
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
			dispatchViewport({ type: "scroll", top: nextScrollTop });
		},
	);
	const scrollToLine = (lineIndex: number) => {
		const _sourceValue2 = _source();
		if (!_props.scrollRef.current) return;
		const maxScrollTop = Math.max(
			0,
			(_props.rowCount === undefined ? _props.lines.length : _props.rowCount) *
				LINE_H -
				_sourceValue2.viewHeight,
		);
		const nextScrollTop = roundToDevicePixel(
			Math.min(
				Math.max(0, lineIndex * LINE_H - _sourceValue2.viewHeight / 2),
				maxScrollTop,
			),
		);
		_props.scrollRef.current.scrollTop = nextScrollTop;
		lastScrollRef.current.top = nextScrollTop;
		dispatchViewport({
			type: "scroll",
			top: nextScrollTop,
		});
		_props.onScroll?.(nextScrollTop, _props.scrollRef.current.scrollLeft, true);
	};
	const visibleRows = createMemo(() => {
		const rows: {
			line: GitDiffLine;
			highlightedTokens?: SyntaxToken[];
			key: number;
			isHighlighted: boolean;
		}[] = [];
		for (let i = start(); i < end(); i++) {
			const line: GitDiffLine = _props.lines[i] ?? {
				number: null,
				content: "",
				type: "spacer",
			};
			const isHighlighted =
				_props.highlightedRange !== undefined &&
				i >= _props.highlightedRange[0] &&
				i < _props.highlightedRange[1];
			const highlightedTokens =
				_source2.isReady &&
				!_props.disableTokenize &&
				_props.filePath &&
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
				ref={(_element) => assignRef(_props.scrollRef, _element)}
				onScroll={handleScroll}
				data-diff-scroll-side={_props.side}
				{...stylex.attrs(
					diffStyles.virtualScroller,
					_props.side !== "single" && diffStyles.splitScroller,
				)}
				style={domStyle(
					(
						_props.verticalFollower === undefined
							? false
							: _props.verticalFollower
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
						{(_props.showGutter === undefined ? true : _props.showGutter) ? (
							<div {...stylex.attrs(diffStyles.gutterLayer)}>
								<div
									{...stylex.attrs(diffStyles.gutterBlock)}
									style={domStyle(
										inlineStyles.getVirtualPanelGutterBlockStyle(),
									)}
								>
									{
										<For each={visibleRows()} keyed={(row) => row.key}>
											{(_props2) => (
												<DiffGutterRow
													line={
														_props2().line.type === "spacer" &&
														_props.gutterLines?.[_props2().key]?.type === "add"
															? _props.gutterLines[_props2().key]!
															: _props2().line
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
								{(_props3) => (
									<DiffRow
										line={_props3().line}
										highlightedTokens={_props3().highlightedTokens}
										isHighlighted={_props3().isHighlighted}
										minWidth={minContentWidth()}
										hideGutter
										gutterOffset={
											(
												_props.showGutter === undefined
													? true
													: _props.showGutter
											)
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
			{(_props.showMinimap === undefined ? false : _props.showMinimap) &&
				(_props.rowCount === undefined
					? _props.lines.length
					: _props.rowCount) > 0 &&
				(_props.rowCount === undefined
					? _props.lines.length
					: _props.rowCount) < 3000 &&
				_props.minimapSegments && (
					<DiffMinimap
						rowCount={
							_props.rowCount === undefined
								? _props.lines.length
								: _props.rowCount
						}
						segments={_props.minimapSegments}
						scrollTop={_source().scrollTop}
						viewHeight={_source().viewHeight}
						totalHeight={total()}
						onScrollTo={scrollToLine}
					/>
				)}
		</div>
	);
};
export const INITIAL_DIFF_VIEWPORT_STATE = {
	scrollTop: 0,
	viewHeight: 600,
};
export function diffViewportReducer(
	state: typeof INITIAL_DIFF_VIEWPORT_STATE,
	action:
		| {
				type: "measure";
				height: number;
		  }
		| {
				type: "scroll";
				top: number;
		  },
) {
	const field = action.type === "measure" ? "viewHeight" : "scrollTop";
	const value =
		action.type === "measure"
			? action.height || INITIAL_DIFF_VIEWPORT_STATE.viewHeight
			: action.top;
	return Math.abs(state[field] - value) > 0.5
		? {
				...state,
				[field]: value,
			}
		: state;
}
