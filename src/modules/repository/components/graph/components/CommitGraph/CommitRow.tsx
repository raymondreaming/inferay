import type { GitGraphRef, GitWorktree, GraphCommit } from "@contracts";
import { runtimeGitGraphLaneColors } from "@design-system/styles.stylex.ts";
import { ariaValue, domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { CommitGraphCell } from "./CommitGraphCell.tsx";
import { CommitMessageCell } from "./CommitMessageCell.tsx";
import { CommitRefGutter } from "./CommitRefGutter.tsx";
import * as inlineStyles from "./styles.ts";
import { AVATAR_SIZE, styles } from "./styles.ts";
import {
	COLUMN_WIDTH,
	type ColumnKey,
	type ColumnWidths,
	GRAPH_PADDING,
	type GraphSelectionIntent,
	hexToRgba,
	ROW_HEIGHT,
	TOOLS_WIDTH,
} from "./useCommitGraphState.tsx";

const commitDateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "2-digit",
	day: "2-digit",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
});
function formatCommitDate(value: string, fallback: string) {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return fallback;
	return commitDateFormatter.format(parsed).replace(",", "");
}
export const CommitRow = function CommitRow(_props: {
	commit: GraphCommit;
	worktree?: GitWorktree;
	graphWidth: number;
	displayColumn: number;
	selected: boolean;
	onSelect?: (itemId: string, intent?: GraphSelectionIntent) => void;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenRefContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
	onOpenItemContextMenu?: (commit: GraphCommit, event: MouseEvent) => void;
	ghostRef?: GitGraphRef;
	hiddenRefNames: ReadonlySet<string>;
	pinnedRefNames: ReadonlySet<string>;
	historyMatch: boolean;
	visibleOrder: ColumnKey[];
	graphStart: number;
	widths: ColumnWidths;
	virtualTop: number;
	searchMatch: boolean;
	githubAvatar?: string | null;
	rowActive: boolean;
	onRowHover: (itemId: string | null) => void;
}) {
	const nodeLeft = createMemo(
		() =>
			GRAPH_PADDING +
			_props.displayColumn * COLUMN_WIDTH +
			COLUMN_WIDTH / 2 -
			AVATAR_SIZE / 2,
	);
	const nodeTop = createMemo(() => ROW_HEIGHT / 2 - AVATAR_SIZE / 2);
	const nodeCenter = createMemo(
		() =>
			GRAPH_PADDING + _props.displayColumn * COLUMN_WIDTH + COLUMN_WIDTH / 2,
	);
	const isWip = createMemo(() => _props.commit.itemKind === "worktreeWip");
	const isStash = createMemo(() => _props.commit.itemKind === "stash");
	const isMergeCommit = createMemo(
		() => !isWip() && !isStash() && _props.commit.parents.length > 1,
	);
	const visibleRefs = createMemo(() =>
		(isStash() ? [] : _props.commit.refs)
			.filter((ref) => !_props.hiddenRefNames.has(ref.fullName))
			.sort(
				(a, b) =>
					Number(_props.pinnedRefNames.has(b.fullName)) -
					Number(_props.pinnedRefNames.has(a.fullName)),
			),
	);
	const color = createMemo(
		() =>
			runtimeGitGraphLaneColors[
				Math.abs(_props.commit.colorIndex) % runtimeGitGraphLaneColors.length
			]!,
	);
	const hasRefs = createMemo(() => visibleRefs().length > 0);
	const visibleGhostRef = createMemo(() =>
		!isStash() &&
		_props.ghostRef &&
		!_props.hiddenRefNames.has(_props.ghostRef.fullName)
			? _props.ghostRef
			: undefined,
	);
	const showGhostRef = createMemo(
		() =>
			!hasRefs() &&
			!!visibleGhostRef() &&
			(_props.selected || _props.rowActive),
	);
	const fileCount = createMemo(
		() =>
			_props.commit.changeSummary?.files ??
			_props.worktree?.status?.files.length ??
			0,
	);
	const worktreeLabel = createMemo(
		() => _props.worktree?.branch ?? "detached HEAD",
	);
	const showWipRef = createMemo(
		() => isWip() && _props.worktree?.isCurrent === false,
	);
	const handleSelect = (intent?: GraphSelectionIntent) =>
		_props.onSelect?.(_props.commit.id, intent);
	const messageStart = createMemo(() => {
		let left = 0;
		for (const column of _props.visibleOrder) {
			if (column === "message") break;
			left += column === "graph" ? _props.graphWidth : _props.widths[column];
		}
		return left;
	});
	const nodeAnchoredWashLeft = createMemo(
		() => _props.graphStart + nodeCenter(),
	);
	return (
		<div
			role="option"
			aria-selected={ariaValue(_props.selected)}
			aria-label={ariaValue(
				isWip()
					? `Uncommitted changes on ${worktreeLabel()}, ${fileCount()} files`
					: `${_props.commit.message}, ${_props.commit.author}, ${formatCommitDate(_props.commit.committedAt, _props.commit.date)}, ${(visibleRefs().length ? visibleRefs() : visibleGhostRef() ? [visibleGhostRef()] : []).map((ref) => ref?.displayName ?? "").join(", ")}`,
			)}
			data-graph-item={_props.commit.id}
			data-graph-kind={_props.commit.itemKind}
			data-graph-column={_props.displayColumn}
			data-history-match={_props.historyMatch ? "true" : "false"}
			data-search-match={_props.searchMatch ? "true" : "false"}
			tabindex={0}
			onMouseEnter={() => _props.onRowHover(_props.commit.id)}
			onMouseLeave={() => _props.onRowHover(null)}
			{...stylex.attrs(styles.graphRow, styles.virtualRow)}
			style={domStyle({
				...inlineStyles.getCommitRowGraphRowStyle(
					ROW_HEIGHT,
					`translateY(${_props.virtualTop}px)`,
					_props.searchMatch && _props.historyMatch ? 1 : 0.22,
				),
			})}
			onClick={(event) =>
				handleSelect({
					additive: event.metaKey || event.ctrlKey,
					range: event.shiftKey,
				})
			}
			onContextMenu={(event) => {
				event.preventDefault();
				_props.onOpenItemContextMenu?.(_props.commit, event);
			}}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === " ") {
					event.preventDefault();
					return;
				}
				if (event.key !== "Enter") return;
				event.preventDefault();
				handleSelect();
			}}
		>
			{_props.visibleOrder.includes("graph") &&
				(!isWip() || _props.selected || _props.rowActive) && (
					<span
						aria-hidden="true"
						data-graph-row-wash="true"
						data-graph-row-hovered={_props.rowActive ? "true" : "false"}
						data-graph-row-selected={_props.selected ? "true" : "false"}
						{...stylex.attrs(styles.nodeAnchoredRowWash)}
						style={domStyle(
							inlineStyles.getCommitRowNodeAnchoredRowWashStyle(
								nodeAnchoredWashLeft(),
								0,
								ROW_HEIGHT,
								hexToRgba(
									color(),
									_props.selected || _props.rowActive ? 0.42 : 0.1,
								),
								_props.selected || _props.rowActive
									? `max(0px, calc(100% - ${nodeAnchoredWashLeft()}px))`
									: Math.max(0, messageStart() - nodeAnchoredWashLeft()),
							),
						)}
					/>
				)}
			{
				<For each={_props.visibleOrder} keyed={(row) => row}>
					{(column) => (
						<>
							{(() => {
								switch (column()) {
									case "date": {
										const date = isWip()
											? ""
											: formatCommitDate(
													_props.commit.committedAt,
													_props.commit.date,
												);
										return (
											<div
												title={date}
												{...stylex.attrs(styles.metaCell)}
												style={domStyle(
													inlineStyles.getCommitRowMetaCellStyle(
														_props.widths.date,
													),
												)}
											>
												{date}
											</div>
										);
									}
									case "refs":
										return (
											<CommitRefGutter
												width={_props.widths.refs}
												color={color()}
												commitId={_props.commit.id}
												worktreePath={_props.commit.worktreePath}
												worktreeLabel={worktreeLabel()}
												showWipRef={showWipRef()}
												refs={visibleRefs()}
												ghostRef={visibleGhostRef()}
												showGhostRef={showGhostRef()}
												onCheckoutRef={_props.onCheckoutRef}
												onRefDrop={_props.onRefDrop}
												onOpenRefContextMenu={_props.onOpenRefContextMenu}
											/>
										);
									case "graph":
										return (
											<CommitGraphCell
												color={color()}
												commit={_props.commit}
												graphWidth={_props.graphWidth}
												hasConnector={
													showWipRef() || hasRefs() || showGhostRef()
												}
												nodeCenter={nodeCenter()}
												nodeLeft={nodeLeft()}
												nodeTop={nodeTop()}
												isWip={isWip()}
												isMergeCommit={isMergeCommit()}
												isStash={isStash()}
												githubAvatar={_props.githubAvatar}
											/>
										);
									case "message":
										return (
											<CommitMessageCell
												commit={_props.commit}
												width={_props.widths.message}
												isWip={isWip()}
											/>
										);
									case "author":
										return (
											<div
												{...stylex.attrs(styles.authorCell)}
												style={domStyle(
													inlineStyles.getCommitRowAuthorCellStyle(
														_props.widths.author,
													),
												)}
											>
												<span {...stylex.attrs(styles.authorName)}>
													{isWip() ? "Workspace" : _props.commit.author}
												</span>
											</div>
										);
									case "sha":
										return (
											<div
												title={
													isWip() ? "Uncommitted changes" : _props.commit.hash
												}
												{...stylex.attrs(styles.shaCell)}
												style={domStyle(
													inlineStyles.getCommitRowShaCellStyle(
														_props.widths.sha,
													),
												)}
											>
												{isWip() ? "" : _props.commit.hash.slice(0, 7)}
											</div>
										);
								}
								return null;
							})()}
						</>
					)}
				</For>
			}
			<div
				{...stylex.attrs(styles.rowEndPad)}
				style={domStyle(inlineStyles.getCommitRowRowEndPadStyle(TOOLS_WIDTH))}
			/>
		</div>
	);
};
