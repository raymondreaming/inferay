import * as stylex from "@octanejs/stylex";
import { memo, useRef } from "octane";
import type { SyntaxHighlightTheme } from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import type { HunkDiff } from "../../../../repository/model/types.ts";
import { type DiffViewMode, LINE_H } from "../../../model/workbench-model.ts";
import {
	type DiffScrollSource,
	useSplitDiffScroll,
} from "../../hooks/useSplitDiffScroll.tsx";
import { diffStyles } from "./styles.ts";
import { VirtualPanel } from "./VirtualPanel.tsx";

export const DiffPanels = memo(function DiffPanels({
	diff,
	mode,
	scrollRef,
	...shared
}: {
	diff: HunkDiff;
	mode: DiffViewMode | "conflict";
	scrollRef: React.RefObject<HTMLDivElement | null>;
	ext: string;
	filePath: string;
	syntaxTheme: SyntaxHighlightTheme;
	disableTokenize: boolean;
	externalScrollTop?: number;
	externalScrollSource?: DiffScrollSource;
	highlightedRange?: readonly [number, number];
}) {
	const singleRef = useRef<HTMLDivElement | null>(null);
	const {
		followerRef,
		followerScrollSource,
		followerScrollTop,
		syncFromMaster,
	} = useSplitDiffScroll(
		scrollRef,
		LINE_H,
		shared.externalScrollTop,
		shared.externalScrollSource,
	);
	const metadata = diff.metadata;
	if (mode !== "split") {
		const conflict = mode === "conflict";
		return (
			<div
				{...stylex.props(
					conflict ? diffStyles.conflictBody : diffStyles.singlePanel,
				)}
			>
				{conflict && (
					<div {...stylex.props(diffStyles.conflictActions)}>
						{[
							"Accept current change",
							"Accept incoming change",
							"Accept both",
						].map((label) => (
							<button
								key={label}
								type="button"
								{...stylex.props(diffStyles.conflictActionButton)}
							>
								{label}
							</button>
						))}
					</div>
				)}
				<VirtualPanel
					{...shared}
					lines={
						(conflict
							? diff.conflictLines
							: (diff.inlineLines ?? diff.compactLines)) ?? []
					}
					maxLineChars={
						conflict
							? metadata?.maxConflictLineChars
							: metadata?.maxInlineLineChars
					}
					minimapSegments={
						conflict ? metadata?.conflictMinimap : metadata?.inlineMinimap
					}
					scrollRef={singleRef}
					side="single"
					showMinimap
					externalScrollTop={conflict ? undefined : shared.externalScrollTop}
					externalScrollSource={
						conflict ? undefined : shared.externalScrollSource
					}
					highlightedRange={undefined}
				/>
			</div>
		);
	}
	const oldLines = diff.isNew ? [] : diff.oldLines;
	const rowCount = Math.max(oldLines.length, diff.newLines.length);
	return (
		<div {...stylex.props(diffStyles.splitPanels)}>
			<div {...stylex.props(diffStyles.splitPanel, diffStyles.splitPanelLeft)}>
				<VirtualPanel
					{...shared}
					rowCount={rowCount}
					lines={oldLines}
					maxLineChars={diff.isNew ? 0 : metadata?.maxOldLineChars}
					scrollRef={followerRef}
					verticalFollower
					gutterLines={diff.newLines}
					externalScrollTop={followerScrollTop}
					externalScrollSource={followerScrollSource}
					side="left"
				/>
			</div>
			<div {...stylex.props(diffStyles.splitPanel)}>
				<VirtualPanel
					{...shared}
					rowCount={rowCount}
					lines={diff.newLines}
					maxLineChars={metadata?.maxNewLineChars}
					scrollRef={scrollRef}
					onScroll={syncFromMaster}
					showGutter={false}
					showMinimap
					minimapSegments={metadata?.splitMinimap}
					side="right"
				/>
			</div>
		</div>
	);
});
