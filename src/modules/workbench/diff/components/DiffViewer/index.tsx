import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	Match,
	onSettled,
	Show,
	Switch,
} from "solid-js";
import type { HunkDiff } from "../../../../../../build/presentation/contracts/HunkDiff.ts";
import {
	assignRef,
	listenWindowEvent,
} from "../../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../../shared/lib/native.tsx";
import type { DiffScrollSource } from "../../hooks/useSplitDiffScroll.tsx";
import { MarkdownPreview } from "../MarkdownPreview/index.tsx";
import { BinaryPreview } from "./BinaryPreview.tsx";
import { DiffHeader } from "./DiffHeader.tsx";
import { DiffPanels } from "./DiffPanels.tsx";
import { DiffViewToolbar } from "./DiffViewToolbar.tsx";
import { diffStyles, LINE_H } from "./styles.ts";

interface DiffViewerProps {
	diff: HunkDiff;
	filePath: string;
	staged: boolean;
	onClose: () => void;
	hideHeader?: boolean;
	viewMode?: DiffViewMode;
	onViewModeChange?: (viewMode: DiffViewMode) => void;
	hideToolbar?: boolean;
	startAtFirstChange?: boolean;
}
export const DiffViewer = function DiffViewer(_props: DiffViewerProps) {
	const containerRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const rightRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [internalViewMode, setInternalViewMode] =
		createSignal<DiffViewMode>("split");
	const viewMode = createMemo(() => _props.viewMode ?? internalViewMode());
	const setViewMode = createMemo(
		() => _props.onViewModeChange ?? setInternalViewMode,
	);
	const diffIdentity = createMemo(
		() => `${_props.filePath}:${_props.staged ? "staged" : "unstaged"}`,
	);
	const [navigationState, setNavigationState] =
		createSignal<DiffNavigationState>(() => {
			diffIdentity();
			return INITIAL_DIFF_NAVIGATION_STATE;
		});
	const dispatchNavigation = (
		action: Parameters<typeof diffNavigationReducer>[1],
	) => setNavigationState((current) => diffNavigationReducer(current, action));
	const _source = navigationState;
	const stats = createMemo(() => _props.diff.metadata.stats);
	const _source2 = createMemo(() =>
		buildDiffViewerModel(_props.diff, _props.filePath, viewMode()),
	);
	const totalChanges = createMemo(() => _source2().changePositions.length);
	const firstChangeLine = createMemo(() => _source2().changePositions[0]);
	const initialScrollIdentityRef = {
		current: null,
	} as {
		current: string | null;
	};
	const initialScrollFrameRef = {
		current: 0,
	};
	let clearScrollTimer: ReturnType<typeof setTimeout> | undefined;
	let clearHighlightTimer: ReturnType<typeof setTimeout> | undefined;
	const cancelNavigationTimers = () => {
		clearTimeout(clearScrollTimer);
		clearTimeout(clearHighlightTimer);
		clearScrollTimer = undefined;
		clearHighlightTimer = undefined;
	};
	createEffect(
		() => [diffIdentity(), viewMode()] as const,
		() => {
			cancelNavigationTimers();
			return cancelNavigationTimers;
		},
	);
	const scrollToChangeIdx = (changeIdx: number) => {
		const _source2Value = _source2();
		if (changeIdx < 0 || changeIdx >= _source2Value.changePositions.length)
			return;
		const lineIdx = _source2Value.changePositions[changeIdx];
		if (lineIdx === undefined) return;
		cancelNavigationTimers();
		const scrollPos = Math.max(0, (lineIdx - 5) * LINE_H);
		dispatchNavigation({
			type: "jumpToChange",
			changeIdx,
			top: scrollPos,
		});
		clearScrollTimer = setTimeout(() => {
			clearScrollTimer = undefined;
			dispatchNavigation({
				type: "clearScroll",
			});
			clearHighlightTimer = setTimeout(() => {
				clearHighlightTimer = undefined;
				dispatchNavigation({ type: "clearHighlight" });
			}, 1500);
		}, 100);
	};
	const stepChange = (dir: 1 | -1) => {
		const _source2Value3 = _source2();
		if (_source2Value3.changePositions.length === 0) return;
		const currentScroll = rightRef.current?.scrollTop ?? 0;
		// Jumps place the change five rows below the viewport top.
		const currentLine = Math.round(currentScroll / LINE_H) + 5;
		const idx =
			dir === 1
				? _source2Value3.changePositions.findIndex((pos) => pos > currentLine)
				: (() => {
						const _source2Value2 = _source2();
						for (
							let i = _source2Value2.changePositions.length - 1;
							i >= 0;
							i--
						) {
							const p = _source2Value2.changePositions[i];
							if (p !== undefined && p < currentLine) return i;
						}
						return -1;
					})();
		scrollToChangeIdx(
			idx !== -1
				? idx
				: dir === 1
					? 0
					: _source2Value3.changePositions.length - 1,
		);
	};
	const goToNextChange = () => stepChange(1);
	const goToPrevChange = () => stepChange(-1);
	onSettled(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (
				e.defaultPrevented ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey ||
				target.isContentEditable ||
				target.closest("input, textarea, select, [role='textbox']")
			)
				return;
			const container = containerRef.current;
			if (
				!container ||
				(!container.contains(document.activeElement) &&
					!container.matches(":hover"))
			)
				return;
			if (e.key === " ") {
				if (target.closest("button, a, [role='button']")) return;
				e.preventDefault();
				goToNextChange();
				return;
			}
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
	});
	createEffect(
		() =>
			[
				diffIdentity(),
				firstChangeLine(),
				_props.startAtFirstChange === undefined
					? false
					: _props.startAtFirstChange,
				viewMode(),
			] as const,
		([identity, firstLine, startAtFirstChange, mode]) => {
			if (initialScrollFrameRef.current) {
				cancelAnimationFrame(initialScrollFrameRef.current);
				initialScrollFrameRef.current = 0;
			}
			if (!startAtFirstChange || mode !== "split") {
				initialScrollIdentityRef.current = null;
				return;
			}
			if (firstLine === undefined) return;
			const scrollIdentity = `${identity}:first-change`;
			if (initialScrollIdentityRef.current === scrollIdentity) return;
			const scrollTop = Math.max(0, (firstLine - 5) * LINE_H);
			initialScrollFrameRef.current = requestAnimationFrame(() => {
				initialScrollIdentityRef.current = scrollIdentity;
				initialScrollFrameRef.current = 0;
				const scrollers = containerRef.current?.querySelectorAll<HTMLElement>(
					"[data-diff-scroll-side]",
				);
				for (const scroller of scrollers ?? []) {
					scroller.scrollTop = scrollTop;
					scroller.dispatchEvent(new window.Event("scroll"));
				}
			});
			return () => {
				if (!initialScrollFrameRef.current) return;
				cancelAnimationFrame(initialScrollFrameRef.current);
				initialScrollFrameRef.current = 0;
			};
		},
	);
	const disableTokenize = createMemo(
		() => _props.diff.metadata.tokenizationDisabled,
	);
	const bodyKind = createMemo(() =>
		_props.diff.isBinary
			? "binary"
			: !_source2().conflict && _source2().message
				? "message"
				: _source2().isMarkdown
					? "markdown"
					: "panels",
	);
	const Panels = () => (
		<DiffPanels
			diff={_props.diff}
			mode={_source2().conflict ? "conflict" : viewMode()}
			scrollRef={rightRef}
			ext={_source2().extension}
			filePath={_props.filePath}
			disableTokenize={disableTokenize()}
			externalScrollTop={_source().externalScrollTop}
			externalScrollSource={_source().externalScrollSource}
			highlightedRange={
				_source().highlightedChangeIdx === undefined
					? undefined
					: _source2().changeRanges[_source().highlightedChangeIdx!]
			}
		/>
	);
	const body = (
		<Switch
			fallback={
				<Show
					when={_source2().conflict}
					fallback={
						<>
							<Show when={!_props.hideToolbar}>
								<DiffViewToolbar
									viewMode={viewMode()}
									onChange={setViewMode()}
								/>
							</Show>
							<div {...stylex.attrs(diffStyles.body)}>
								<Panels />
							</div>
						</>
					}
				>
					<Panels />
				</Show>
			}
		>
			<Match when={bodyKind() === "binary"}>
				<BinaryPreview diff={_props.diff} filePath={_props.filePath} />
			</Match>
			<Match when={bodyKind() === "message"}>
				<div {...stylex.attrs(diffStyles.centerBody)}>
					<p {...stylex.attrs(diffStyles.centerMessage)}>
						{_source2().message}
					</p>
				</div>
			</Match>
			<Match when={bodyKind() === "markdown"}>
				<div {...stylex.attrs(diffStyles.markdownBody)}>
					<div {...stylex.attrs(diffStyles.markdownInner)}>
						<MarkdownPreview content={_source2().markdownContent} />
					</div>
				</div>
			</Match>
		</Switch>
	);

	return (
		<div
			ref={(_element) => assignRef(containerRef, _element)}
			tabindex={-1}
			onPointerDown={(event) => {
				const target = event.target as HTMLElement;
				if (
					!target.isContentEditable &&
					!target.closest("button, a, input, textarea, select")
				)
					containerRef.current?.focus({ preventScroll: true });
			}}
			{...stylex.attrs(
				diffStyles.shell,
				_source2().navigable && diffStyles.shellRelative,
			)}
		>
			{!(_props.hideHeader === undefined ? false : _props.hideHeader) && (
				<DiffHeader
					filePath={_props.filePath}
					staged={_props.staged}
					onClose={_props.onClose}
					{...(_source2().navigable
						? {
								stats: stats(),
								totalChanges: totalChanges(),
								onPrevChange: goToPrevChange,
								onNextChange: goToNextChange,
							}
						: {})}
				/>
			)}
			{body}
		</div>
	);
};
export type DiffViewMode = "split" | "hunks";
export const MAX_RENDERED_LINE_CHARS = 4000;
export function buildDiffViewerModel(
	diff: HunkDiff,
	filePath: string,
	viewMode: DiffViewMode,
): {
	changeRanges: Array<[number, number]>;
	changePositions: number[];
	extension: string;
	conflict: boolean;
	message: string | null;
	isMarkdown: boolean;
	markdownContent: string;
	navigable: boolean;
} {
	const metadata = diff.metadata;
	// Send presentation facts, not the highlighted line arrays already held by
	// the renderer. Only Markdown needs text to assemble its preview document.
	const line = (value: HunkDiff["newLines"][number] | undefined) =>
		value
			? {
					type: value.type,
					content: value.content,
				}
			: undefined;
	return rustProject("diffViewer", {
		filePath,
		viewMode,
		diff: {
			isBinary: diff.isBinary,
			hasConflict: !!diff.mergeConflictContent,
			oldLineCount: diff.oldLines.length,
			newLineCount: diff.newLines.length,
			compactLineCount: diff.compactLines?.length,
			firstCompactLine:
				diff.compactLines?.length === 1
					? line(diff.compactLines[0])
					: undefined,
			firstNewLine:
				diff.oldLines.length === 0 && diff.newLines.length === 1
					? line(diff.newLines[0])
					: undefined,
			newLines:
				/\.mdx?$/.test(filePath) && !diff.compactLines
					? diff.newLines.map(line)
					: undefined,
			metadata: {
				maxOldLineChars: metadata.maxOldLineChars,
				maxNewLineChars: metadata.maxNewLineChars,
				maxInlineLineChars: metadata.maxInlineLineChars,
				maxConflictLineChars: metadata.maxConflictLineChars,
				splitChangeRanges:
					viewMode === "split" ? metadata.splitChangeRanges : undefined,
				inlineChangeRanges:
					viewMode === "hunks" ? metadata.inlineChangeRanges : undefined,
			},
		},
	});
}
type DiffNavigationState = {
	externalScrollSource: DiffScrollSource;
	externalScrollTop: number;
	highlightedChangeIdx: number | undefined;
};
export const INITIAL_DIFF_NAVIGATION_STATE = {
	externalScrollSource: "all",
	externalScrollTop: -1,
	highlightedChangeIdx: undefined,
} satisfies DiffNavigationState;
export function diffNavigationReducer(
	state: DiffNavigationState,
	action:
		| {
				type: "clearHighlight" | "clearScroll" | "reset";
		  }
		| {
				type: "jumpToChange";
				changeIdx: number;
				top: number;
		  }
		| {
				type: "jumpToPosition";
				source: DiffScrollSource;
				top: number;
		  },
): DiffNavigationState {
	let next: DiffNavigationState;
	switch (action.type) {
		case "clearHighlight":
			next = {
				...state,
				highlightedChangeIdx: undefined,
			};
			break;
		case "clearScroll":
			next = {
				...state,
				externalScrollTop: -1,
				externalScrollSource: "all",
			};
			break;
		case "jumpToChange":
			return {
				externalScrollSource: "all",
				externalScrollTop: action.top,
				highlightedChangeIdx: action.changeIdx,
			};
		case "jumpToPosition":
			return {
				...state,
				externalScrollSource: action.source,
				externalScrollTop: action.top,
			};
		case "reset":
			next = INITIAL_DIFF_NAVIGATION_STATE;
			break;
	}
	return state.externalScrollSource === next.externalScrollSource &&
		state.externalScrollTop === next.externalScrollTop &&
		state.highlightedChangeIdx === next.highlightedChangeIdx
		? state
		: next;
}
