import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { assignRef, domStyle } from "../../../../../shared/lib/dom.tsx";
import { CommitGraphLinesLayer } from "./CommitGraphLinesLayer.tsx";
import { CommitRow } from "./CommitRow.tsx";
import { HeaderRow } from "./HeaderRow.tsx";
import { RefContextMenu } from "./RefContextMenu.tsx";
import { RowContextMenu } from "./RowContextMenu.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import {
	ROW_HEIGHT,
	TOP_PADDING,
	useCommitGraphState,
} from "./useCommitGraphState.tsx";
export const LINE_WIDTH = 2;
export const CommitGraph = function CommitGraph(
	props: ReturnType<Parameters<typeof useCommitGraphState>[0]>,
) {
	const view = useCommitGraphState(() => props);
	const rootProps = createMemo(() =>
		stylex.attrs(styles.root, view.embedded && styles.embeddedRoot),
	);
	return (
		<div
			ref={(_element) => assignRef(view.scrollerRef, _element)}
			{...rootProps()}
			class={`${rootProps().class ?? ""} ${view.class}`}
			role="listbox"
			tabindex={0}
			aria-label="Repository commit history"
			aria-keyshortcuts="ArrowUp ArrowDown ArrowRight Alt+ArrowUp Alt+ArrowDown"
			onScroll={(event) => {
				view.rememberScroll(
					event.currentTarget.scrollTop,
					event.currentTarget.scrollLeft,
				);
				const remaining =
					event.currentTarget.scrollHeight -
					event.currentTarget.scrollTop -
					event.currentTarget.clientHeight;
				if (
					view.hasMore &&
					!view.loadingMore &&
					view.onLoadMore &&
					remaining < ROW_HEIGHT * 16
				) {
					view.onLoadMore();
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
				view.rememberScroll(scroller.scrollTop, scroller.scrollLeft);
			}}
			onMouseMove={(event) => {
				const previous = view.mousePositionRef.current;
				view.mousePositionRef.current = {
					x: event.clientX,
					y: event.clientY,
				};
				if (previous?.x === event.clientX && previous.y === event.clientY)
					return;
				view.keyboardNavigationRef.current = false;
				const row =
					event.target instanceof Element
						? event.target.closest("[data-graph-item]")
						: null;
				view.setHoveredRow(row?.getAttribute("data-graph-item") ?? null);
			}}
			onMouseLeave={() => view.setHoveredRow(null)}
			onKeyDown={view.navigateRows}
		>
			<HeaderRow
				graphWidth={view.graphWidth}
				columns={view.columns}
				widths={view.widths}
				order={view.order}
				isColumnsOpen={view.isColumnsOpen}
				onToggleColumnsMenu={() => view.setIsColumnsOpen((open) => !open)}
				onToggleColumn={view.toggleColumn}
				onMoveColumn={view.moveColumn}
				onResizeStart={view.startColumnResize}
				hiddenRefs={view.hiddenRefDetails}
				onShowRef={(fullName) =>
					view.setHiddenRefs((current) =>
						current.filter((value) => value !== fullName),
					)
				}
				query={view.query ?? ""}
				onQueryChange={view.setQuery}
				matchCount={view.matchingHashes.size}
			/>

			{view.commits.length === 0 ? (
				<div
					role="status"
					style={domStyle(inlineStyles.getCommitGraphDivStyle())}
				>
					{view.emptyLabel}
				</div>
			) : null}
			{/* Lines and nodes share the same origin below the header. */}
			<div
				{...stylex.attrs(styles.rowsLayer)}
				style={domStyle(
					inlineStyles.getCommitGraphRowsLayerStyle(
						view.totalHeight,
						view.tableWidth,
					),
				)}
			>
				<CommitGraphLinesLayer
					class={stylex.attrs(styles.linesLayer).class}
					width={view.graphWidth}
					height={view.graphHeight}
					style={view.lineLayerStyle}
					lines={view.lines}
					lineWidth={LINE_WIDTH}
				/>
				{
					<For
						each={view.commits.slice(view.visibleStart, view.visibleEnd)}
						keyed={(row) => row.id}
					>
						{(commit, visibleIndex) => {
							const logicalIndex = createMemo(
								() => view.visibleStart + visibleIndex(),
							);
							return (
								<CommitRow
									commit={commit()}
									rowActive={view.hoveredRow === commit().id}
									onRowHover={view.handleRowHover}
									worktree={
										commit().worktreePath
											? view.worktreesByPath.get(commit().worktreePath!)
											: undefined
									}
									graphWidth={view.graphWidth}
									displayColumn={view.displayGraphColumn(commit().column)}
									selected={
										view.selectedHash === commit().id ||
										view.selectedIdSet.has(commit().id)
									}
									onSelect={view.onSelect}
									onCheckoutRef={view.onCheckoutRef}
									onRefDrop={view.onRefDrop}
									onOpenRefContextMenu={view.openRefContextMenu}
									onOpenItemContextMenu={view.openItemContextMenu}
									ghostRef={view.containingBranches.get(commit().id)}
									hiddenRefNames={view.hiddenRefNames}
									pinnedRefNames={view.pinnedRefNames}
									historyMatch={
										view.searchActive ||
										view.soloRefs.length === 0 ||
										view.reachableHistory.has(commit().id) ||
										view.reachableHistory.has(commit().hash)
									}
									visibleOrder={view.visibleOrder}
									graphStart={view.graphLeft}
									widths={view.widths}
									virtualTop={TOP_PADDING + logicalIndex() * ROW_HEIGHT}
									searchMatch={view.matchingHashes.has(commit().id)}
									githubAvatar={view.commitAvatars[commit().hash] ?? undefined}
								/>
							);
						}}
					</For>
				}
			</div>
			{view.hasMore ? (
				<button
					type="button"
					disabled={view.loadingMore}
					onClick={view.onLoadMore}
					{...stylex.attrs(styles.loadMore)}
				>
					{view.loadingMore ? "Loading older commits…" : "Load older commits"}
				</button>
			) : null}
			{view.refContextMenu ? (
				<RefContextMenu {...view} refContextMenu={view.refContextMenu} />
			) : null}
			{view.itemContextMenu ? (
				<RowContextMenu {...view} itemContextMenu={view.itemContextMenu} />
			) : null}
		</div>
	);
};
export type {
	GitGraphActionRequest,
	GraphSelectionIntent,
} from "./useCommitGraphState.tsx";
