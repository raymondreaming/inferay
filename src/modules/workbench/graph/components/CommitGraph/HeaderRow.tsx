import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { GitGraphRef } from "../../../../../../build/presentation/contracts/GitGraphRef.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import {
	IconSearch,
	IconSettings,
} from "../../../../../shared/ui/Icons/index.tsx";
import { ColumnResizeHandle } from "./ColumnResizeHandle.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import {
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	TOOLS_WIDTH,
} from "./useCommitGraphState.tsx";
export function HeaderRow(_props: {
	graphWidth: number;
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	isColumnsOpen: boolean;
	onToggleColumnsMenu: () => void;
	onToggleColumn: (key: keyof ColumnVisibility) => void;
	onMoveColumn: (source: ColumnKey, target: ColumnKey) => void;
	onResizeStart: (column: keyof ColumnWidths, event: PointerEvent) => void;
	hiddenRefs: GitGraphRef[];
	onShowRef: (fullName: string) => void;
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
}) {
	const visible = (column: ColumnKey) =>
		column !== "author" && column !== "sha" && column !== "date"
			? true
			: _props.columns[column];
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
			{...stylex.attrs(styles.header)}
			style={domStyle(inlineStyles.getHeaderRowHeaderStyle(headerWidth()))}
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
								style={domStyle(
									inlineStyles.getHeaderRowHeaderCellStyle(
										columnWidth(column()),
									),
								)}
							>
								{labels()[column()]}
								<ColumnResizeHandle
									column={column()}
									onResizeStart={_props.onResizeStart}
								/>
							</div>
						);
					}}
				</For>
			}
			<div
				{...stylex.attrs(styles.headerTools)}
				style={domStyle(inlineStyles.getHeaderRowHeaderToolsStyle(TOOLS_WIDTH))}
			>
				<div {...stylex.attrs(styles.columnsMenuRoot)}>
					<button
						type="button"
						onClick={_props.onToggleColumnsMenu}
						aria-label="Graph columns and search"
						title="Graph columns and search"
						{...stylex.attrs(styles.columnsButton)}
					>
						<IconSettings size={11} />
					</button>
					{_props.isColumnsOpen ? (
						<div {...stylex.attrs(styles.columnsMenu)}>
							<label {...stylex.attrs(styles.searchRoot)}>
								<IconSearch size={11} />
								<input
									type="search"
									value={_props.query}
									onInput={(event) =>
										_props.onQueryChange(event.currentTarget.value)
									}
									placeholder="Search all branches"
									aria-label="Search commits"
									title="Search all branches using author:, committer:, message:, ref:, or sha:. Solo filtering resumes when search is cleared."
									{...stylex.attrs(styles.searchInput)}
								/>
								{_props.query ? (
									<span {...stylex.attrs(styles.searchCount)}>
										{_props.matchCount}
									</span>
								) : null}
							</label>
							{(["author", "sha", "date"] as const).map((key) => (
								<button
									type="button"
									onClick={() => _props.onToggleColumn(key)}
									{...stylex.attrs(styles.columnsMenuItem)}
								>
									{labels()[key]}
									<span {...stylex.attrs(styles.columnsState)}>
										{_props.columns[key] ? "On" : "Off"}
									</span>
								</button>
							))}
							{_props.hiddenRefs.length ? (
								<>
									<div {...stylex.attrs(styles.columnsMenuSection)}>
										Hidden refs
									</div>
									{
										<For each={_props.hiddenRefs} keyed={(row) => row.fullName}>
											{(ref) => (
												<button
													type="button"
													onClick={() => _props.onShowRef(ref().fullName)}
													{...stylex.attrs(styles.columnsMenuItem)}
												>
													<span {...stylex.attrs(styles.truncate)}>
														{ref().displayName}
													</span>
													<span {...stylex.attrs(styles.columnsState)}>
														Show
													</span>
												</button>
											)}
										</For>
									}
								</>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
