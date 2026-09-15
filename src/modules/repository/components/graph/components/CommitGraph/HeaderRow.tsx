import { domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import { ColumnResizeHandle } from "./ColumnResizeHandle.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import {
	COLUMN_WIDTH,
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	GRAPH_PADDING,
	TOOLS_WIDTH,
	TOP_PADDING,
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
			style={domStyle({
				...inlineStyles.getHeaderRowHeaderStyle(headerWidth()),
				height: TOP_PADDING,
			})}
		>
			{
				<For each={visibleOrder()} keyed={(row) => row}>
					{(column) => {
						return (
							<div
								data-graph-column-header={column()}
								title={`Drag to reorder ${labels()[column()].toLocaleLowerCase()}`}
								draggable="true"
								onDragStart={(event) => {
									event.dataTransfer?.setData(
										"application/x-inferay-graph-column",
										column(),
									);
								}}
								onDragOver={(event) => {
									if (
										Array.from(event.dataTransfer?.types ?? []).includes(
											"application/x-inferay-graph-column",
										)
									)
										event.preventDefault();
								}}
								onDrop={(event) => {
									const source = event.dataTransfer?.getData(
										"application/x-inferay-graph-column",
									) as ColumnKey;
									if (source && source !== column())
										_props.onMoveColumn(source, column());
								}}
								{...stylex.attrs(styles.headerCell, styles.draggableHeader)}
								style={domStyle({
									...inlineStyles.getHeaderRowHeaderCellStyle(
										columnWidth(column()) +
											(visibleOrder()[visibleOrder().indexOf(column()) + 1] ===
											"graph"
												? GRAPH_PADDING + COLUMN_WIDTH / 2
												: 0) -
											(column() === "graph"
												? GRAPH_PADDING + COLUMN_WIDTH / 2
												: 0),
									),
									marginLeft:
										column() === "graph" && visibleOrder()[0] === "graph"
											? GRAPH_PADDING + COLUMN_WIDTH / 2
											: 0,
								})}
							>
								<span
									{...stylex.attrs(
										styles.headerLabel,
										!hovered() && styles.headerLabelHidden,
									)}
								>
									{labels()[column()]}
								</span>
								<ColumnResizeHandle
									column={column()}
									visible={hovered()}
									onResizeStart={_props.onResizeStart}
								/>
							</div>
						);
					}}
				</For>
			}
		</div>
	);
}
