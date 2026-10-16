import type { DiffScrollSource, DiffViewMode, HunkDiff } from "@contracts";
import type { RefCell } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit, Show } from "solid-js";
import { diffStyles } from "./styles.ts";
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
	const followerRef: RefCell<HTMLDivElement | null> = { current: null };
	// A mirrored scroll event may arrive after the user already moved the other
	// pane again. Consume that acknowledgement instead of bouncing it back.
	const mirrored = new WeakMap<HTMLDivElement, number>();
	const sync = (
		source: HTMLDivElement | null,
		target: HTMLDivElement | null,
		top: number,
	) => {
		if (!source || !target) return;
		const expected = mirrored.get(source);
		mirrored.delete(source);
		if (expected !== undefined && Math.abs(expected - top) <= 0.5) return;
		if (Math.abs(target.scrollTop - top) > 0.5) {
			target.scrollTop = top;
			mirrored.set(target, target.scrollTop);
		}
	};

	const metadata = createMemo(() => _props.diff.metadata);
	const conflict = createMemo(() => _props.mode === "conflict");
	const fullWidthSplit = createMemo(
		() => _props.mode === "split" && _props.diff.viewer.fullWidth,
	);
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
					when={_props.mode === "split" && !fullWidthSplit()}
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
										: fullWidthSplit()
											? _props.diff.isNew
												? _props.diff.newLines
												: _props.diff.oldLines
											: (_props.diff.inlineLines ??
												_props.diff.compactLines)) ?? []
								}
								maxLineChars={
									conflict()
										? metadata().maxConflictLineChars
										: fullWidthSplit()
											? _props.diff.isNew
												? metadata().maxNewLineChars
												: metadata().maxOldLineChars
											: metadata().maxInlineLineChars
								}
								minimapSegments={
									conflict()
										? metadata().conflictMinimap
										: fullWidthSplit()
											? metadata().splitMinimap
											: metadata().inlineMinimap
								}
								scrollRef={_props.scrollRef}
								side="single"
								showMinimap
								externalScrollTop={
									conflict() ? undefined : _props.externalScrollTop
								}
								externalScrollSource={
									conflict() ? undefined : _props.externalScrollSource
								}
								highlightedRange={
									fullWidthSplit() ? _props.highlightedRange : undefined
								}
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
								scrollRef={followerRef}
								onScroll={(top) =>
									sync(followerRef.current, _props.scrollRef.current, top)
								}
								gutterLines={_props.diff.newLines}
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
								onScroll={(top) =>
									sync(_props.scrollRef.current, followerRef.current, top)
								}
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
