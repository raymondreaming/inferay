import * as stylex from "@stylexjs/stylex";
import { createMemo, omit, Show } from "solid-js";
import type { HunkDiff } from "../../../../../../build/presentation/contracts/HunkDiff.ts";
import type { RefCell } from "../../../../../shared/lib/dom.tsx";
import {
	type DiffScrollSource,
	useSplitDiffScroll,
} from "../../hooks/useSplitDiffScroll.tsx";
import type { DiffViewMode } from "./index.tsx";
import { diffStyles, LINE_H } from "./styles.ts";
import { VirtualPanel } from "./VirtualPanel.tsx";
export const DiffPanels = function DiffPanels(_props: {
	diff: HunkDiff;
	mode: DiffViewMode | "conflict";
	scrollRef: RefCell<HTMLDivElement | null>;
	ext: string;
	filePath: string;
	disableTokenize: boolean;
	externalScrollTop?: number;
	externalScrollSource?: DiffScrollSource;
	highlightedRange?: readonly [number, number];
}) {
	const _source = useSplitDiffScroll(
		() => _props.scrollRef,
		() => LINE_H,
		() => omit(_props, "diff", "mode", "scrollRef").externalScrollTop,
		() => omit(_props, "diff", "mode", "scrollRef").externalScrollSource,
	);
	const metadata = createMemo(() => _props.diff.metadata);
	const conflict = createMemo(() => _props.mode === "conflict");
	const oldLines = createMemo(() =>
		_props.diff.isNew ? [] : _props.diff.oldLines,
	);
	const rowCount = createMemo(() =>
		Math.max(oldLines().length, _props.diff.newLines.length),
	);
	return (
		<>
			{
				<Show
					when={_props.mode === "split"}
					fallback={
						<div
							{...stylex.attrs(
								conflict() ? diffStyles.conflictBody : diffStyles.singlePanel,
							)}
						>
							{conflict() && (
								<div {...stylex.attrs(diffStyles.conflictActions)}>
									{[
										"Accept current change",
										"Accept incoming change",
										"Accept both",
									].map((label) => (
										<button
											type="button"
											{...stylex.attrs(diffStyles.conflictActionButton)}
										>
											{label}
										</button>
									))}
								</div>
							)}
							<VirtualPanel
								{...omit(_props, "diff", "mode", "scrollRef")}
								lines={
									(conflict()
										? _props.diff.conflictLines
										: (_props.diff.inlineLines ?? _props.diff.compactLines)) ??
									[]
								}
								maxLineChars={
									conflict()
										? metadata().maxConflictLineChars
										: metadata().maxInlineLineChars
								}
								minimapSegments={
									conflict()
										? metadata().conflictMinimap
										: metadata().inlineMinimap
								}
								scrollRef={_props.scrollRef}
								side="single"
								showMinimap
								externalScrollTop={
									conflict()
										? undefined
										: omit(_props, "diff", "mode", "scrollRef")
												.externalScrollTop
								}
								externalScrollSource={
									conflict()
										? undefined
										: omit(_props, "diff", "mode", "scrollRef")
												.externalScrollSource
								}
								highlightedRange={undefined}
							/>
						</div>
					}
				>
					<div {...stylex.attrs(diffStyles.splitPanels)}>
						<div
							{...stylex.attrs(
								diffStyles.splitPanel,
								diffStyles.splitPanelLeft,
							)}
						>
							<VirtualPanel
								{...omit(_props, "diff", "mode", "scrollRef")}
								rowCount={rowCount()}
								lines={oldLines()}
								maxLineChars={
									_props.diff.isNew ? 0 : metadata().maxOldLineChars
								}
								scrollRef={_source.followerRef}
								onScroll={_source.syncFromFollower}
								gutterLines={_props.diff.newLines}
								externalScrollTop={_source.followerScrollTop}
								externalScrollSource={_source.followerScrollSource}
								side="left"
							/>
						</div>
						<div {...stylex.attrs(diffStyles.splitPanel)}>
							<VirtualPanel
								{...omit(_props, "diff", "mode", "scrollRef")}
								rowCount={rowCount()}
								lines={_props.diff.newLines}
								maxLineChars={metadata().maxNewLineChars}
								scrollRef={_props.scrollRef}
								onScroll={_source.syncFromMaster}
								showGutter={false}
								showMinimap
								minimapSegments={metadata().splitMinimap}
								side="right"
							/>
						</div>
					</div>
				</Show>
			}
		</>
	);
};
