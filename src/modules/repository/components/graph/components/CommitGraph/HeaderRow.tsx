import { createPointerResize, px } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import { ColumnResizeHandle } from "./ColumnResizeHandle.tsx";
import { styles } from "./styles.ts";
import {
	COLUMN_WIDTH,
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	GRAPH_PADDING,
	ROW_HEIGHT,
	TOOLS_WIDTH,
} from "./useCommitGraphState.tsx";
export function HeaderRow(_props: {
	graphWidth: number;
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	onMoveColumn: (source: ColumnKey, target: ColumnKey) => void;
	onResizeStart: (column: keyof ColumnWidths, event: PointerEvent) => void;
}) {
	const [hovered, setHovered] = createSignal(false);
	const trackReorder = createPointerResize();
	const visible = (column: ColumnKey) => _props.columns[column];
	const labels = createMemo<Record<ColumnKey, string>>(() => ({
		date: "Date",
		refs: "Branch",
		graph: "Graph",
		message: "Message",
		author: "Author",
		sha: "SHA",
	}));
	const columnWidth = (column: ColumnKey) =>
		column === "graph" ? _props.graphWidth : _props.widths[column];
	const visibleOrder = createMemo(() => _props.order.filter(visible));
	const headerWidth = createMemo(
		() =>
			visibleOrder().reduce((total, column) => total + columnWidth(column), 0) +
			TOOLS_WIDTH,
	);
	return (
		<div
			data-graph-header="true"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			{...stylex.attrs(styles.header)}
			style={{
				width: px(headerWidth()),
				height: px(ROW_HEIGHT),
			}}
		>
			{
				<For each={visibleOrder()} keyed={(row) => row}>
					{(column) => {
						return (
							<div
								data-graph-column-header={column()}
								title={`Drag to reorder ${labels()[column()].toLocaleLowerCase()}`}
								onPointerDown={(event) => {
									if (event.button !== 0) return;
									event.preventDefault();
									const parent = event.currentTarget.parentElement;
									const source = column();
									const startX = event.clientX;
									let target: ColumnKey | null = null;
									trackReorder(
										event.pointerId,
										(move) => {
											if (Math.abs(move.clientX - startX) < 4) return;
											const cell = document
												.elementFromPoint(move.clientX, move.clientY)
												?.closest<HTMLElement>("[data-graph-column-header]");
											target =
												cell && parent?.contains(cell)
													? (cell.dataset.graphColumnHeader as ColumnKey)
													: null;
										},
										() => {
											if (target && target !== source)
												_props.onMoveColumn(source, target);
										},
									);
								}}
								{...stylex.attrs(styles.headerCell, styles.draggableHeader)}
								style={{
									width: px(
										columnWidth(column()) +
											(visibleOrder()[visibleOrder().indexOf(column()) + 1] ===
											"graph"
												? GRAPH_PADDING + COLUMN_WIDTH / 2
												: 0) -
											(column() === "graph"
												? GRAPH_PADDING + COLUMN_WIDTH / 2
												: 0),
									),
									"margin-left":
										column() === "graph" && visibleOrder()[0] === "graph"
											? px(GRAPH_PADDING + COLUMN_WIDTH / 2)
											: 0,
								}}
							>
								<span {...stylex.attrs(styles.headerLabel)}>
									{labels()[column()]}
								</span>
								{
									<ColumnResizeHandle
										column={column()}
										visible={hovered()}
										onResizeStart={_props.onResizeStart}
									/>
								}
							</div>
						);
					}}
				</For>
			}
		</div>
	);
}
