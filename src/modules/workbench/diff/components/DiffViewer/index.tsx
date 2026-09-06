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
import { listenWindowEvent } from "../../../../../shared/lib/data.ts";
import type { HunkDiff } from "../../../../repository/model/types.ts";
import {
	type DiffViewMode,
	diffNavigationReducer,
	INITIAL_DIFF_NAVIGATION_STATE,
	LINE_H,
	MAX_RENDERED_LINE_CHARS,
} from "../../../model/workbench-model.ts";
import { MarkdownPreview } from "../MarkdownPreview/index.tsx";
import { DiffHeader } from "./DiffHeader.tsx";
import { DiffPanels } from "./DiffPanels.tsx";
import { DiffViewToolbar } from "./DiffViewToolbar.tsx";
import { diffStyles } from "./styles.ts";

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

const MAX_RENDERED_DIFF_LINES = 100_000;

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

	const changeRanges =
		viewMode === "hunks"
			? diff.metadata.inlineChangeRanges
			: diff.metadata.splitChangeRanges;

	const changePositions = useMemo(
		() => changeRanges.map(([start]) => start),
		[changeRanges],
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
		if (line?.type !== "context") return null;
		const text = line.content.trim();
		return /too large|cannot read/i.test(text) ? text : null;
	}, [diff.compactLines, diff.newLines, diff.oldLines.length]);

	const oversizedMessage = useMemo(() => {
		// Split panes share row positions; counting both sides rejects ordinary
		// large files even though only a viewport of rows is mounted.
		const totalLines =
			diff.compactLines?.length ??
			Math.max(diff.oldLines.length, diff.newLines.length);
		if (totalLines > MAX_RENDERED_DIFF_LINES) {
			return `Diff is too large to render safely (${totalLines.toLocaleString()} lines). Use the Editor/agent to inspect this file in smaller chunks.`;
		}
		const longest = Math.max(
			diff.metadata.maxOldLineChars,
			diff.metadata.maxNewLineChars,
			diff.metadata.maxInlineLineChars,
			diff.metadata.maxConflictLineChars,
		);
		if (longest > MAX_RENDERED_LINE_CHARS * 2) {
			return `Diff contains a very long line (${longest.toLocaleString()} characters). Rendering is limited to keep the app responsive.`;
		}
		return null;
	}, [diff.metadata, diff.compactLines, diff.newLines, diff.oldLines]);

	const disableTokenize = diff.metadata.tokenizationDisabled;

	const renderMergeConflict = Boolean(diff.mergeConflictContent);

	const isMarkdown = !diff.compactLines && (ext === "md" || ext === "mdx");
	const conflict = renderMergeConflict && !isMarkdown;
	const message = statusMessage ?? oversizedMessage;
	const navigable = !diff.isBinary && (conflict || (!message && !isMarkdown));
	let body: OctaneNode;
	if (diff.isBinary) {
		body = (
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
		);
	} else if (!conflict && message) {
		body = (
			<div {...stylex.props(diffStyles.centerBody)}>
				<p {...stylex.props(diffStyles.centerMessage)}>{message}</p>
			</div>
		);
	} else if (isMarkdown) {
		const content = diff.newLines
			.filter((line) => line.type !== "hunk" && line.type !== "spacer")
			.map((line) => line.content)
			.join("\n");
		body = (
			<div {...stylex.props(diffStyles.markdownBody)}>
				<div {...stylex.props(diffStyles.markdownInner)}>
					<MarkdownPreview content={content} />
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

export type { DiffViewMode } from "../../../model/workbench-model.ts";
