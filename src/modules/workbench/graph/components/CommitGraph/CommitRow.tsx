import * as stylex from "@octanejs/stylex";
import { memo, useCallback } from "octane";
import type {
	GitGraphRef,
	GitWorktree,
	GraphNode,
} from "../../../../repository/hooks/useGitGraph.tsx";
import {
	AVATAR_SIZE,
	COLUMN_WIDTH,
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	GRAPH_PADDING,
	type GraphSelectionIntent,
	hexToRgba,
	ROW_HEIGHT,
	refPresentationLabel,
	TOOLS_WIDTH,
} from "../../model/graph-model.ts";
import { AuthorAvatar } from "./AuthorAvatar.tsx";
import { MergeNode } from "./MergeNode.tsx";
import { RefBadge } from "./RefBadge.tsx";
import { RefBadges } from "./RefBadges.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

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
export const CommitRow = memo(function CommitRow({
	commit,
	worktree,
	graphWidth,
	displayColumn,
	selected,
	onSelect,
	onCheckoutRef,
	onRefDrop,
	onOpenRefContextMenu,
	onOpenItemContextMenu,
	ghostRef,
	hiddenRefNames,
	pinnedRefNames,
	historyMatch,
	columns,
	widths,
	order,
	virtualTop,
	searchMatch,
	githubAvatar,
	rowActive,
	onRowHover,
}: {
	commit: GraphNode;
	worktree?: GitWorktree;
	graphWidth: number;
	displayColumn: number;
	selected: boolean;
	onSelect?: (itemId: string, intent?: GraphSelectionIntent) => void;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenRefContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
	onOpenItemContextMenu?: (commit: GraphNode, event: MouseEvent) => void;
	ghostRef?: GitGraphRef;
	hiddenRefNames: ReadonlySet<string>;
	pinnedRefNames: ReadonlySet<string>;
	historyMatch: boolean;
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	virtualTop: number;
	searchMatch: boolean;
	githubAvatar?: string | null;
	rowActive: boolean;
	onRowHover: (itemId: string | null) => void;
}) {
	const nodeLeft =
		GRAPH_PADDING +
		displayColumn * COLUMN_WIDTH +
		COLUMN_WIDTH / 2 -
		AVATAR_SIZE / 2;
	const nodeTop = ROW_HEIGHT / 2 - AVATAR_SIZE / 2;
	const nodeCenter =
		GRAPH_PADDING + displayColumn * COLUMN_WIDTH + COLUMN_WIDTH / 2;
	const isWip = commit.itemKind === "worktreeWip";
	const isStash = commit.itemKind === "stash";
	const isMergeCommit = !isWip && !isStash && commit.parents.length > 1;
	const syntheticStashRef: GitGraphRef | null = isStash
		? {
				fullName: commit.stashName ?? "refs/stash",
				displayName: commit.stashName ?? "stash",
				kind: "stash",
				target: commit.hash,
				isHead: false,
			}
		: null;
	const allRefs =
		syntheticStashRef && !commit.refs.some((ref) => ref.kind === "stash")
			? [syntheticStashRef, ...commit.refs]
			: commit.refs;
	const visibleRefs = allRefs
		.filter((ref) => !hiddenRefNames.has(ref.fullName))
		.sort(
			(a, b) =>
				Number(pinnedRefNames.has(b.fullName)) -
				Number(pinnedRefNames.has(a.fullName)),
		);
	const hasRefs = visibleRefs.length > 0;
	const visibleGhostRef =
		ghostRef && !hiddenRefNames.has(ghostRef.fullName) ? ghostRef : undefined;
	const showGhostRef = !hasRefs && !!visibleGhostRef && (selected || rowActive);
	const fileCount = worktree?.status?.files.length ?? 0;
	const worktreeLabel = worktree?.branch ?? "detached HEAD";
	const showWipRef = isWip && worktree?.isCurrent === false;
	const handleSelect = useCallback(
		(intent?: GraphSelectionIntent) => onSelect?.(commit.id, intent),
		[commit.id, onSelect],
	);
	const visibleOrder = order.filter(
		(column) =>
			(column !== "date" || columns.date) &&
			(column !== "author" || columns.author) &&
			(column !== "sha" || columns.sha),
	);
	const graphOrderIndex = visibleOrder.indexOf("graph");
	const graphStart = visibleOrder
		.slice(0, graphOrderIndex)
		.reduce(
			(total, column) =>
				total + (column === "graph" ? graphWidth : widths[column]),
			0,
		);
	const nodeAnchoredWashLeft = graphStart + nodeCenter;
	return (
		<div
			role="option"
			aria-selected={selected}
			aria-label={
				isWip
					? `Uncommitted changes on ${worktreeLabel}, ${fileCount} files`
					: `${commit.message}, ${commit.author}, ${formatCommitDate(commit.committedAt, commit.date)}, ${(visibleRefs.length ? visibleRefs : visibleGhostRef ? [visibleGhostRef] : []).map((ref) => ref.displayName).join(", ")}`
			}
			data-graph-item={commit.id}
			data-graph-kind={commit.itemKind}
			data-graph-column={displayColumn}
			data-history-match={historyMatch ? "true" : "false"}
			data-search-match={searchMatch ? "true" : "false"}
			tabIndex={0}
			onMouseEnter={() => onRowHover(commit.id)}
			onMouseLeave={() => onRowHover(null)}
			{...stylex.props(styles.graphRow, styles.virtualRow)}
			style={inlineStyles.getCommitRowGraphRowStyle(
				ROW_HEIGHT,
				`translateY(${virtualTop}px)`,
				searchMatch && historyMatch ? 1 : 0.22,
			)}
			onClick={(event) =>
				handleSelect({
					additive: event.metaKey || event.ctrlKey,
					range: event.shiftKey,
				})
			}
			onContextMenu={(event) => {
				event.preventDefault();
				onOpenItemContextMenu?.(commit, event);
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				handleSelect();
			}}
		>
			<span
				aria-hidden="true"
				data-graph-row-wash="true"
				data-graph-row-hovered={rowActive ? "true" : "false"}
				data-graph-row-selected={selected ? "true" : "false"}
				{...stylex.props(styles.nodeAnchoredRowWash)}
				style={inlineStyles.getCommitRowNodeAnchoredRowWashStyle(
					nodeAnchoredWashLeft,
					nodeTop,
					AVATAR_SIZE,
					hexToRgba(commit.color, selected || rowActive ? 0.42 : 0.1),
				)}
			/>
			{visibleOrder.map((column) => {
				switch (column) {
					case "date": {
						const date = isWip
							? ""
							: formatCommitDate(commit.committedAt, commit.date);
						return (
							<div
								key={column}
								title={date}
								{...stylex.props(styles.metaCell)}
								style={inlineStyles.getCommitRowMetaCellStyle(widths.date)}
							>
								{date}
							</div>
						);
					}
					case "refs":
						return (
							<div
								key={column}
								{...stylex.props(styles.refGutter)}
								style={inlineStyles.getCommitRowRefGutterStyle(widths.refs)}
							>
								{showWipRef ? (
									<RefBadge
										label={worktreeLabel}
										fullName={commit.id}
										color={commit.color}
										kind="localBranch"
										worktreePath={commit.worktreePath}
									/>
								) : hasRefs ? (
									<RefBadges
										refs={visibleRefs}
										color={commit.color}
										onCheckout={onCheckoutRef}
										onRefDrop={onRefDrop}
										onOpenContextMenu={onOpenRefContextMenu}
									/>
								) : showGhostRef && visibleGhostRef ? (
									<RefBadge
										label={refPresentationLabel(visibleGhostRef)}
										fullName={visibleGhostRef.fullName}
										color={commit.color}
										kind={visibleGhostRef.kind}
										onCheckout={onCheckoutRef}
										onRefDrop={onRefDrop}
										ghost
									/>
								) : null}
								{showWipRef || hasRefs || showGhostRef ? (
									<span
										aria-hidden="true"
										{...stylex.props(styles.refConnector)}
										style={inlineStyles.getCommitRowRefConnectorStyle(
											commit.color,
										)}
									/>
								) : null}
							</div>
						);
					case "graph":
						return (
							<div
								key={column}
								{...stylex.props(styles.graphCell)}
								style={inlineStyles.getCommitRowGraphCellStyle(graphWidth)}
							>
								{showWipRef || hasRefs || showGhostRef ? (
									<span
										aria-hidden="true"
										{...stylex.props(styles.refToNodeConnector)}
										style={inlineStyles.getCommitRowRefToNodeConnectorStyle(
											nodeCenter,
											commit.color,
										)}
									/>
								) : null}
								{isWip ? (
									<span
										aria-hidden="true"
										{...stylex.props(styles.wipNode)}
										style={inlineStyles.getCommitRowWipNodeStyle(
											nodeLeft,
											nodeTop,
											commit.color,
										)}
									/>
								) : isMergeCommit ? (
									<MergeNode
										color={commit.color}
										left={nodeLeft}
										top={nodeTop}
									/>
								) : (
									<AuthorAvatar
										name={commit.author}
										email={commit.authorEmail}
										githubAvatar={githubAvatar}
										color={commit.color}
										left={nodeLeft}
										top={nodeTop}
										stash={isStash}
									/>
								)}
							</div>
						);
					case "message":
						return (
							<div
								key={column}
								{...stylex.props(styles.messageCell)}
								style={inlineStyles.getCommitRowMessageCellStyle(
									widths.message,
									`1px solid ${commit.color}`,
								)}
							>
								<span
									{...stylex.props(styles.commitMessage)}
									style={inlineStyles.getCommitRowCommitMessageStyle(
										commit.body ? "64%" : "100%",
									)}
								>
									{isWip
										? showWipRef
											? `// WIP ${worktreeLabel}`
											: "// WIP"
										: commit.message}
								</span>
								{!isWip && commit.body ? (
									<span {...stylex.props(styles.commitBody)}>
										— {commit.body.replace(/\s+/g, " ")}
									</span>
								) : null}
								{isWip ? (
									<span {...stylex.props(styles.fileCount)}>
										{fileCount} file{fileCount === 1 ? "" : "s"}
									</span>
								) : null}
							</div>
						);
					case "author":
						return (
							<div
								key={column}
								{...stylex.props(styles.authorCell)}
								style={inlineStyles.getCommitRowAuthorCellStyle(widths.author)}
							>
								<span {...stylex.props(styles.authorName)}>
									{isWip ? "Workspace" : commit.author}
								</span>
							</div>
						);
					case "sha":
						return (
							<div
								key={column}
								title={isWip ? "Uncommitted changes" : commit.hash}
								{...stylex.props(styles.shaCell)}
								style={inlineStyles.getCommitRowShaCellStyle(widths.sha)}
							>
								{isWip ? "" : commit.hash.slice(0, 7)}
							</div>
						);
				}
				return null;
			})}
			<div
				{...stylex.props(styles.rowEndPad)}
				style={inlineStyles.getCommitRowRowEndPadStyle(TOOLS_WIDTH)}
			/>
		</div>
	);
});
