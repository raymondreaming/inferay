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
import {
	type SyntaxHighlightTheme,
	useSyntaxHighlightTheme,
} from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import { listenWindowEvent } from "../../../../../shared/lib/react-events.ts";
import type { HunkDiff } from "../../../../repository/model/types.ts";
import {
	diffNavigationReducer,
	INITIAL_DIFF_NAVIGATION_STATE,
} from "../../model/diff-navigation.ts";
import { MarkdownPreview } from "../MarkdownPreview/index.tsx";
import { DiffHeader } from "./DiffHeader.tsx";
import { DiffViewToolbar } from "./DiffViewToolbar.tsx";
import { MergeConflictPanel } from "./MergeConflictPanel.tsx";
import { SinglePanel } from "./SinglePanel.tsx";
import {
	type DiffViewMode,
	LINE_H,
	MAX_RENDERED_LINE_CHARS,
} from "./shared.ts";
import { diffStyles } from "./styles.ts";
import { VirtualSplitPanel } from "./VirtualSplitPanel.tsx";

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
	startAtFirstChange?: boolean;
	syntaxTheme?: SyntaxHighlightTheme;
}

const MAX_RENDERED_DIFF_LINES = 100_000;

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
	startAtFirstChange = false,
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
	const stats = diff?.metadata?.stats ?? {
		added: 0,
		removed: 0,
		hunks: 0,
		lines: 0,
	};
	const diffIdentity = `${filePath}:${staged ? "staged" : "unstaged"}`;

	useEffect(() => {
		void diffIdentity;
		dispatchNavigation({ type: "reset" });
	}, [diffIdentity]);

	const { changePositions, changeLineMap } = useMemo(() => {
		const positions: number[] = [];
		const lineMap = new Map<number, number>();

		const ranges =
			viewMode === "hunks"
				? diff.metadata?.inlineChangeRanges
				: diff.metadata?.splitChangeRanges;
		if (ranges) {
			for (const [change, [start, end]] of ranges.entries()) {
				positions.push(start);
				for (let row = start; row < end; row++) lineMap.set(row, change);
			}
			return { changePositions: positions, changeLineMap: lineMap };
		}

		// Compatibility for responses created before native navigation metadata.
		const inline =
			viewMode === "hunks"
				? (diff.inlineLines ?? diff.compactLines)
				: undefined;
		const count =
			inline?.length ?? Math.max(diff.oldLines.length, diff.newLines.length);
		let inChange = false;
		for (let row = 0; row < count; row++) {
			const changed = inline
				? inline[row]?.type === "remove" || inline[row]?.type === "add"
				: diff.oldLines[row]?.type === "remove" ||
					diff.newLines[row]?.type === "add";
			if (changed && !inChange) positions.push(row);
			if (changed) lineMap.set(row, positions.length - 1);
			inChange = changed;
		}

		return { changePositions: positions, changeLineMap: lineMap };
	}, [
		diff.metadata,
		diff.inlineLines,
		diff.compactLines,
		diff.oldLines,
		diff.newLines,
		viewMode,
	]);

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
		if (!line || line.type !== "context") return null;
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
		let longest = diff.metadata
			? Math.max(
					diff.metadata.maxOldLineChars,
					diff.metadata.maxNewLineChars,
					diff.metadata.maxInlineLineChars ?? 0,
					diff.metadata.maxConflictLineChars ?? 0,
				)
			: 0;
		if (
			!diff.metadata ||
			(diff.compactLines && diff.metadata.maxInlineLineChars === undefined)
		)
			for (const lines of diff.compactLines
				? [diff.compactLines]
				: [diff.oldLines, diff.newLines]) {
				for (const line of lines)
					longest = Math.max(longest, line.content.length);
			}
		if (longest > MAX_RENDERED_LINE_CHARS * 2) {
			return `Diff contains a very long line (${longest.toLocaleString()} characters). Rendering is limited to keep the app responsive.`;
		}
		return null;
	}, [diff.metadata, diff.compactLines, diff.newLines, diff.oldLines]);

	const disableTokenize = diff.metadata?.tokenizationDisabled ?? true;

	const renderMergeConflict = Boolean(diff.mergeConflictContent);

	const hunkLines = useMemo(() => {
		if (oversizedMessage) return [];
		return diff.inlineLines ?? diff.compactLines ?? [];
	}, [diff.inlineLines, diff.compactLines, oversizedMessage]);
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
	const markdownContent = isMarkdown
		? diff.newLines
				.filter((line) => line.type !== "hunk" && line.type !== "spacer")
				.map((line) => line.content)
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
					minimapSegments={diff.metadata?.conflictMinimap}
					lines={diff.conflictLines ?? []}
					maxLineChars={diff.metadata?.maxConflictLineChars}
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
						minimapSegments={diff.metadata?.splitMinimap}
						key={`${diffIdentity}:split`}
						oldLines={diff.isNew ? [] : diff.oldLines}
						newLines={diff.newLines}
						maxOldLineChars={diff.isNew ? 0 : diff.metadata?.maxOldLineChars}
						maxNewLineChars={diff.metadata?.maxNewLineChars}
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
						minimapSegments={diff.metadata?.inlineMinimap}
						key={`${diffIdentity}:single`}
						lines={hunkLines}
						maxLineChars={diff.metadata?.maxInlineLineChars}
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

export type { DiffViewMode } from "./shared.ts";
