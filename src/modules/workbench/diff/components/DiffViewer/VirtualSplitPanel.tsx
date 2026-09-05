import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type { SyntaxHighlightTheme } from "../../../../../shared/hooks/useShikiHighlighter.tsx";
import type {
	DiffLine,
	DiffMinimapSegment as MinimapSegment,
} from "../../../../repository/model/types.ts";
import {
	type DiffScrollSource,
	useSplitDiffScroll,
} from "../../hooks/useSplitDiffScroll.tsx";
import { LINE_H } from "./shared.ts";
import { diffStyles } from "./styles.ts";
import { VirtualPanel } from "./VirtualPanel.tsx";

export const VirtualSplitPanel = memo(function VirtualSplitPanel({
	changeLineMap,
	disableTokenize,
	ext,
	externalScrollSource,
	externalScrollTop,
	filePath,
	highlightedChangeIdx,
	minimapSegments,
	newLines,
	oldLines,
	maxOldLineChars,
	maxNewLineChars,
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
	minimapSegments?: MinimapSegment[];
	newLines: DiffLine[];
	oldLines: DiffLine[];
	maxOldLineChars?: number;
	maxNewLineChars?: number;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	syntaxTheme: SyntaxHighlightTheme;
}) {
	const lineCount = Math.max(oldLines.length, newLines.length);
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
					rowCount={lineCount}
					lines={oldLines}
					maxLineChars={maxOldLineChars}
					ext={ext}
					scrollRef={followerRef}
					verticalFollower
					disableTokenize={disableTokenize}
					gutterLines={newLines}
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
					rowCount={lineCount}
					lines={newLines}
					maxLineChars={maxNewLineChars}
					ext={ext}
					scrollRef={scrollRef}
					onScroll={syncFromMaster}
					disableTokenize={disableTokenize}
					showGutter={false}
					showMinimap
					minimapSegments={minimapSegments}
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
