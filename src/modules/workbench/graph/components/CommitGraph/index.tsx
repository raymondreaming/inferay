import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import { toggleBoolean } from "../../../../../shared/lib/data.ts";
import { CommitGraphLinesLayer } from "../../../../../shared/ui/Icons/index.tsx";
import { CommitRow } from "./CommitRow.tsx";
import { HeaderRow } from "./HeaderRow.tsx";
import { RefContextMenu } from "./RefContextMenu.tsx";
import { RowContextMenu } from "./RowContextMenu.tsx";
import { ROW_HEIGHT } from "./shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import { TOP_PADDING, useCommitGraphState } from "./useCommitGraphState.tsx";

export const LINE_WIDTH = 2;

export function rowTop(row: number): number {
	return row * ROW_HEIGHT;
}

export function rowBottom(row: number): number {
	return (row + 1) * ROW_HEIGHT;
}

export const CommitGraph = memo(function CommitGraph(
	props: Parameters<typeof useCommitGraphState>[0],
) {
	const {
		commits,
		selectedHash,
		onSelect,
		branch,
		onCheckoutRef,
		onRefDrop,
		onLoadMore,
		onGraphAction,
		onCompareWithWip,
		emptyLabel,
		searchActive,
		selectedIds,
		className,
		embedded,
		hasMore,
		loadingMore,
		columns,
		widths,
		order,
		setHiddenRefs,
		soloRefs,
		setSoloRefs,
		pinnedRefs,
		setPinnedRefs,
		isColumnsOpen,
		setIsColumnsOpen,
		commitAvatars,
		selectedIdSet,
		hoveredRow,
		setHoveredRow,
		keyboardNavigationRef,
		mousePositionRef,
		handleRowHover,
		scrollerRef,
		query,
		setQuery,
		refContextMenu,
		setRefContextMenu,
		itemContextMenu,
		setItemContextMenu,
		worktreesByPath,
		containingBranches,
		hiddenRefDetails,
		defaultRemoteName,
		hiddenRefNames,
		pinnedRefNames,
		reachableHistory,
		displayGraphColumn,
		graphWidth,
		columnX,
		connectionPath,
		convergencePath,
		lineLayerStyle,
		tableWidth,
		matchingHashes,
		graphHeight,
		totalHeight,
		visibleStart,
		visibleEnd,
		toggleColumn,
		moveColumn,
		rememberScroll,
		openRefContextMenu,
		openItemContextMenu,
		navigateRows,
		startColumnResize,
		railSegments,
		convergences,
		transitions,
		truncatedSegments,
	} = useCommitGraphState(props);

	if (!commits.length) {
		const emptyProps = stylex.props(styles.emptyRoot);
		return (
			<div
				{...emptyProps}
				className={`${emptyProps.className ?? ""} ${className}`}
			>
				<p {...stylex.props(styles.emptyText)}>No commits</p>
			</div>
		);
	}

	const rootProps = stylex.props(styles.root, embedded && styles.embeddedRoot);
	return (
		<div
			ref={scrollerRef}
			{...rootProps}
			className={`${rootProps.className ?? ""} ${className}`}
			role="listbox"
			tabIndex={0}
			aria-label="Repository commit history"
			aria-keyshortcuts="ArrowUp ArrowDown ArrowRight Alt+ArrowUp Alt+ArrowDown"
			onScroll={(event) => {
				rememberScroll(
					event.currentTarget.scrollTop,
					event.currentTarget.scrollLeft,
				);
				const remaining =
					event.currentTarget.scrollHeight -
					event.currentTarget.scrollTop -
					event.currentTarget.clientHeight;
				if (
					hasMore &&
					!loadingMore &&
					onLoadMore &&
					remaining < ROW_HEIGHT * 16
				) {
					onLoadMore();
				}
			}}
			onWheel={(event) => {
				if (
					event.target instanceof Element &&
					event.target.closest('[role="menu"]')
				)
					return;
				if (event.cancelable) event.preventDefault();
				const scroller = event.currentTarget;
				if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
					scroller.scrollTop += event.deltaY;
				} else {
					scroller.scrollLeft += event.deltaX;
				}
				rememberScroll(scroller.scrollTop, scroller.scrollLeft);
			}}
			onMouseMove={(event) => {
				const previous = mousePositionRef.current;
				mousePositionRef.current = { x: event.clientX, y: event.clientY };
				if (previous?.x === event.clientX && previous.y === event.clientY)
					return;
				keyboardNavigationRef.current = false;
				const row =
					event.target instanceof Element
						? event.target.closest("[data-graph-item]")
						: null;
				setHoveredRow(row?.getAttribute("data-graph-item") ?? null);
			}}
			onMouseLeave={() => setHoveredRow(null)}
			onKeyDown={navigateRows}
		>
			<HeaderRow
				graphWidth={graphWidth}
				columns={columns}
				widths={widths}
				order={order}
				isColumnsOpen={isColumnsOpen}
				onToggleColumnsMenu={setIsColumnsOpen.bind(null, toggleBoolean)}
				onToggleColumn={toggleColumn}
				onMoveColumn={moveColumn}
				onResizeStart={startColumnResize}
				hiddenRefs={hiddenRefDetails}
				onShowRef={(fullName) =>
					setHiddenRefs((current) =>
						current.filter((value) => value !== fullName),
					)
				}
				query={query}
				onQueryChange={setQuery}
				matchCount={matchingHashes.size}
			/>

			{commits.length === 0 ? (
				<div role="status" style={inlineStyles.getCommitGraphDivStyle()}>
					{emptyLabel}
				</div>
			) : null}
			{/* Lines and nodes share the same origin below the header. */}
			<div
				{...stylex.props(styles.rowsLayer)}
				style={inlineStyles.getCommitGraphRowsLayerStyle(
					totalHeight,
					tableWidth,
				)}
			>
				<CommitGraphLinesLayer
					className={stylex.props(styles.linesLayer).className}
					width={graphWidth}
					height={graphHeight}
					style={lineLayerStyle}
					railSegments={railSegments}
					transitions={transitions}
					convergences={convergences}
					truncatedSegments={truncatedSegments}
					colX={columnX}
					rowTop={rowTop}
					rowBottom={rowBottom}
					buildConnection={connectionPath}
					buildConvergence={convergencePath}
					lineWidth={LINE_WIDTH}
				/>
				{commits.slice(visibleStart, visibleEnd).map((commit, visibleIndex) => {
					const logicalIndex = visibleStart + visibleIndex;
					return (
						<CommitRow
							key={commit.id}
							commit={commit}
							rowActive={hoveredRow === commit.id}
							onRowHover={handleRowHover}
							worktree={
								commit.worktreePath
									? worktreesByPath.get(commit.worktreePath)
									: undefined
							}
							graphWidth={graphWidth}
							displayColumn={displayGraphColumn(commit.column)}
							selected={
								selectedHash === commit.id || selectedIdSet.has(commit.id)
							}
							onSelect={onSelect}
							onCheckoutRef={onCheckoutRef}
							onRefDrop={onRefDrop}
							onOpenRefContextMenu={openRefContextMenu}
							onOpenItemContextMenu={openItemContextMenu}
							ghostRef={containingBranches.get(commit.id)}
							hiddenRefNames={hiddenRefNames}
							pinnedRefNames={pinnedRefNames}
							historyMatch={
								searchActive ||
								soloRefs.length === 0 ||
								reachableHistory.has(commit.id) ||
								reachableHistory.has(commit.hash)
							}
							columns={columns}
							widths={widths}
							order={order}
							virtualTop={TOP_PADDING + logicalIndex * ROW_HEIGHT}
							searchMatch={matchingHashes.has(commit.id)}
							githubAvatar={commitAvatars[commit.hash] ?? undefined}
						/>
					);
				})}
			</div>
			{hasMore ? (
				<button
					type="button"
					disabled={loadingMore}
					onClick={onLoadMore}
					{...stylex.props(styles.loadMore)}
				>
					{loadingMore ? "Loading older commits…" : "Load older commits"}
				</button>
			) : null}
			{refContextMenu ? (
				<RefContextMenu
					refContextMenu={refContextMenu}
					onCheckoutRef={onCheckoutRef}
					setRefContextMenu={setRefContextMenu}
					branch={branch}
					onRefDrop={onRefDrop}
					onGraphAction={onGraphAction}
					defaultRemoteName={defaultRemoteName}
					setSoloRefs={setSoloRefs}
					soloRefs={soloRefs}
					setPinnedRefs={setPinnedRefs}
					pinnedRefs={pinnedRefs}
					setHiddenRefs={setHiddenRefs}
				/>
			) : null}
			{itemContextMenu ? (
				<RowContextMenu
					itemContextMenu={itemContextMenu}
					onCompareWithWip={onCompareWithWip}
					setItemContextMenu={setItemContextMenu}
					selectedIds={selectedIds}
					commits={commits}
					onGraphAction={onGraphAction}
				/>
			) : null}
		</div>
	);
});

export type { GraphSelectionIntent } from "./shared.ts";
export type { GitGraphActionRequest } from "./useCommitGraphState.tsx";
