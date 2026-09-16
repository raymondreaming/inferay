import type {
	DiffNavigation,
	DiffNavigationAction,
	DiffViewMode,
	HunkDiff,
} from "@contracts";
import {
	assignRef,
	listenWindowEvent,
	type RefCell,
} from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
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
import { MarkdownPreview } from "../MarkdownPreview/index.tsx";
import { BinaryPreview } from "./BinaryPreview.tsx";
import { DiffHeader } from "./DiffHeader.tsx";
import { DiffPanels } from "./DiffPanels.tsx";
import { DiffViewToolbar } from "./DiffViewToolbar.tsx";
import { diffStyles, LINE_H } from "./styles.ts";

export const DiffViewer = function DiffViewer(props: {
	diff: HunkDiff;
	filePath: string;
	staged: boolean;
	onClose: () => void;
	hideHeader?: boolean;
	viewMode?: DiffViewMode;
	onViewModeChange?: (viewMode: DiffViewMode) => void;
	hideToolbar?: boolean;
	startAtFirstChange?: boolean;
}) {
	const containerRef: RefCell<HTMLDivElement | null> = { current: null };
	const rightRef: RefCell<HTMLDivElement | null> = { current: null };
	const pointerPositionRef: RefCell<{ x: number; y: number } | null> = {
		current: null,
	};
	const [pointerMoved, setPointerMoved] = createSignal(false);
	const [internalViewMode, setInternalViewMode] =
		createSignal<DiffViewMode>("split");
	const viewMode = createMemo(() => props.viewMode ?? internalViewMode());
	const setViewMode = createMemo(
		() => props.onViewModeChange ?? setInternalViewMode,
	);
	const diffIdentity = createMemo(
		() => `${props.filePath}:${props.staged ? "staged" : "unstaged"}`,
	);
	const [navigationState, setNavigationState] = createSignal<DiffNavigation>(
		() => {
			diffIdentity();
			return {};
		},
	);
	const dispatchNavigation = (action: DiffNavigationAction) =>
		setNavigationState(
			(state) =>
				project<DiffNavigation | null>("diffNavigation", { state, action }) ??
				state,
		);
	const _source = navigationState;
	const stats = createMemo(() => props.diff.metadata.stats);
	const viewer = createMemo(() => props.diff.viewer);
	const changeRanges = createMemo(() =>
		viewMode() === "hunks"
			? props.diff.metadata.inlineChangeRanges
			: props.diff.metadata.splitChangeRanges,
	);
	const totalChanges = createMemo(() => changeRanges().length);
	const firstChangeLine = createMemo(() => changeRanges()[0]?.[0]);
	let initialScrollIdentity: string | null = null;
	let initialScrollFrame = 0;
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
		const lineIdx = changeRanges()[changeIdx]?.[0];
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
	const stepChange = (direction: 1 | -1) => {
		// Jumps place the change five rows below the viewport top.
		const index = project<number | null>("nextDiffChange", {
			ranges: changeRanges(),
			line: Math.round((rightRef.current?.scrollTop ?? 0) / LINE_H) + 5,
			direction,
		});
		if (index !== null) scrollToChangeIdx(index);
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
				props.startAtFirstChange === undefined
					? false
					: props.startAtFirstChange,
				viewMode(),
			] as const,
		([identity, firstLine, startAtFirstChange, mode]) => {
			if (initialScrollFrame) {
				cancelAnimationFrame(initialScrollFrame);
				initialScrollFrame = 0;
			}
			if (!startAtFirstChange || mode !== "split") {
				initialScrollIdentity = null;
				return;
			}
			if (firstLine === undefined) return;
			const scrollIdentity = `${identity}:first-change`;
			if (initialScrollIdentity === scrollIdentity) return;
			const scrollTop = Math.max(0, (firstLine - 5) * LINE_H);
			initialScrollFrame = requestAnimationFrame(() => {
				initialScrollIdentity = scrollIdentity;
				initialScrollFrame = 0;
				const scrollers = containerRef.current?.querySelectorAll<HTMLElement>(
					"[data-diff-scroll-side]",
				);
				for (const scroller of scrollers ?? []) {
					scroller.scrollTop = scrollTop;
					scroller.dispatchEvent(new window.Event("scroll"));
				}
			});
			return () => {
				if (!initialScrollFrame) return;
				cancelAnimationFrame(initialScrollFrame);
				initialScrollFrame = 0;
			};
		},
	);
	const disableTokenize = createMemo(
		() => props.diff.metadata.tokenizationDisabled,
	);
	const bodyKind = createMemo(() =>
		props.diff.isBinary
			? "binary"
			: !viewer().conflict && viewer().message
				? "message"
				: viewer().markdown !== null
					? "markdown"
					: "panels",
	);
	const Panels = () => (
		<DiffPanels
			diff={props.diff}
			mode={viewer().conflict ? "conflict" : viewMode()}
			scrollRef={rightRef}
			ext={viewer().extension}
			filePath={props.filePath}
			disableTokenize={disableTokenize()}
			externalScrollTop={_source().scroll?.top}
			externalScrollSource={_source().scroll?.source}
			highlightedRange={
				_source().highlight === undefined
					? undefined
					: changeRanges()[_source().highlight!]
			}
		/>
	);
	const body = (
		<Switch
			fallback={
				<Show
					when={viewer().conflict}
					fallback={
						<>
							<Show when={!props.hideToolbar}>
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
				<BinaryPreview diff={props.diff} filePath={props.filePath} />
			</Match>
			<Match when={bodyKind() === "message"}>
				<div {...stylex.attrs(diffStyles.centerBody)}>
					<p {...stylex.attrs(diffStyles.centerMessage)}>{viewer().message}</p>
				</div>
			</Match>
			<Match when={bodyKind() === "markdown"}>
				<div {...stylex.attrs(diffStyles.markdownBody)}>
					<div {...stylex.attrs(diffStyles.markdownInner)}>
						<MarkdownPreview content={viewer().markdown!} />
					</div>
				</div>
			</Match>
		</Switch>
	);

	return (
		<div
			ref={(_element) => assignRef(containerRef, _element)}
			tabindex={-1}
			data-diff-pointer-moved={pointerMoved() ? "true" : undefined}
			onMouseMove={(event) => {
				if (pointerMoved()) return;
				const previous = pointerPositionRef.current;
				pointerPositionRef.current = { x: event.clientX, y: event.clientY };
				if (
					!previous ||
					(previous.x === event.clientX && previous.y === event.clientY)
				)
					return;
				setPointerMoved(true);
			}}
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
				viewer().navigable && diffStyles.shellRelative,
			)}
		>
			{!(props.hideHeader === undefined ? false : props.hideHeader) && (
				<DiffHeader
					filePath={props.filePath}
					staged={props.staged}
					onClose={props.onClose}
					{...(viewer().navigable
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
