import * as stylex from "@octanejs/stylex";
import {
	memo,
	type OctaneNode,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "octane";
import type { HunkDiff } from "../../../../../../build/presentation/contracts/HunkDiff.ts";
import { project as rustProject } from "../../../../../adapters/presentation/model.ts";
import { listenWindowEvent } from "../../../../../shared/lib/data.ts";
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

export const DiffViewer = memo(function DiffViewer({
	diff,
	filePath,
	staged,
	onClose,
	hideHeader = false,
	viewMode: controlledViewMode,
	onViewModeChange,
	hideToolbar = false,
	startAtFirstChange = false,
}: DiffViewerProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const rightRef = useRef<HTMLDivElement | null>(null);
	const [internalViewMode, setInternalViewMode] =
		useState<DiffViewMode>("split");
	const viewMode = controlledViewMode ?? internalViewMode;
	const setViewMode = onViewModeChange ?? setInternalViewMode;
	const [navigationState, dispatchNavigation] = useReducer(
		diffNavigationReducer,
		INITIAL_DIFF_NAVIGATION_STATE,
	);
	const { externalScrollSource, externalScrollTop, highlightedChangeIdx } =
		navigationState;
	const stats = diff.metadata.stats;
	const diffIdentity = `${filePath}:${staged ? "staged" : "unstaged"}`;

	useEffect(() => {
		void diffIdentity;
		dispatchNavigation({ type: "reset" });
	}, [diffIdentity]);

	const {
		changeRanges,
		changePositions,
		extension: ext,
		conflict,
		message,
		isMarkdown,
		markdownContent,
		navigable,
	} = useMemo(
		() => buildDiffViewerModel(diff, filePath, viewMode),
		[diff, filePath, viewMode],
	);
	const totalChanges = changePositions.length;
	const firstChangeLine = changePositions[0];
	const initialScrollIdentityRef = useRef<string | null>(null);
	const initialScrollFrameRef = useRef(0);
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
		if (initialScrollFrameRef.current) {
			cancelAnimationFrame(initialScrollFrameRef.current);
			initialScrollFrameRef.current = 0;
		}
		if (!startAtFirstChange || viewMode !== "split") {
			initialScrollIdentityRef.current = null;
			return;
		}
		if (firstChangeLine === undefined) return;
		const scrollIdentity = `${diffIdentity}:first-change`;
		if (initialScrollIdentityRef.current === scrollIdentity) return;
		initialScrollIdentityRef.current = scrollIdentity;
		const scrollTop = Math.max(0, (firstChangeLine - 5) * LINE_H);
		initialScrollFrameRef.current = requestAnimationFrame(() => {
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
	}, [diffIdentity, firstChangeLine, startAtFirstChange, viewMode]);

	const disableTokenize = diff.metadata.tokenizationDisabled;
	let body: OctaneNode;
	if (diff.isBinary) {
		body = <BinaryPreview diff={diff} filePath={filePath} />;
	} else if (!conflict && message) {
		body = (
			<div {...stylex.props(diffStyles.centerBody)}>
				<p {...stylex.props(diffStyles.centerMessage)}>{message}</p>
			</div>
		);
	} else if (isMarkdown) {
		body = (
			<div {...stylex.props(diffStyles.markdownBody)}>
				<div {...stylex.props(diffStyles.markdownInner)}>
					<MarkdownPreview content={markdownContent} />
				</div>
			</div>
		);
	} else {
		const mode = conflict ? "conflict" : viewMode;
		const panels = (
			<DiffPanels
				key={`${diffIdentity}:${mode}`}
				diff={diff}
				mode={mode}
				scrollRef={rightRef}
				ext={ext}
				filePath={filePath}
				disableTokenize={disableTokenize}
				externalScrollTop={externalScrollTop}
				externalScrollSource={externalScrollSource}
				highlightedRange={
					highlightedChangeIdx === undefined
						? undefined
						: changeRanges[highlightedChangeIdx]
				}
			/>
		);
		body = conflict ? (
			panels
		) : (
			<>
				{!hideToolbar && (
					<DiffViewToolbar viewMode={viewMode} onChange={setViewMode} />
				)}
				<div {...stylex.props(diffStyles.body)}>{panels}</div>
			</>
		);
	}
	return (
		<div
			ref={navigable ? containerRef : undefined}
			{...stylex.props(diffStyles.shell, navigable && diffStyles.shellRelative)}
		>
			{!hideHeader && (
				<DiffHeader
					filePath={filePath}
					staged={staged}
					onClose={onClose}
					{...(navigable
						? {
								stats,
								totalChanges,
								onPrevChange: goToPrevChange,
								onNextChange: goToNextChange,
							}
						: {})}
				/>
			)}
			{body}
		</div>
	);
});

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
		value ? { type: value.type, content: value.content } : undefined;
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
		| { type: "clearHighlight" | "clearScroll" | "reset" }
		| { type: "jumpToChange"; changeIdx: number; top: number }
		| { type: "jumpToPosition"; source: DiffScrollSource; top: number },
): DiffNavigationState {
	let next: DiffNavigationState;
	switch (action.type) {
		case "clearHighlight":
			next = { ...state, highlightedChangeIdx: undefined };
			break;
		case "clearScroll":
			next = { ...state, externalScrollTop: -1, externalScrollSource: "all" };
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
