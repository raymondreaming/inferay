import * as stylex from "@octanejs/stylex";
import {
	IconSearch,
	IconSettings,
} from "../../../../../shared/ui/Icons/index.tsx";
import type { GitGraphRef } from "../../../../repository/hooks/useGitGraph";
import { ColumnResizeHandle } from "./ColumnResizeHandle.tsx";
import {
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	TOOLS_WIDTH,
} from "./shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function HeaderRow({
	graphWidth,
	columns,
	widths,
	order,
	isColumnsOpen,
	onToggleColumnsMenu,
	onToggleColumn,
	onMoveColumn,
	onResizeStart,
	hiddenRefs,
	onShowRef,
	query,
	onQueryChange,
	matchCount,
}: {
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
			: columns[column];
	const labels: Record<ColumnKey, string> = {
		date: "Date",
		refs: "Branch",
		graph: "Graph",
		message: "Message",
		author: "Author",
		sha: "SHA",
	};
	const columnWidth = (column: ColumnKey) =>
		column === "graph" ? graphWidth : widths[column];
	const visibleOrder = order.filter(visible);
	const headerWidth =
		visibleOrder.reduce((total, column) => total + columnWidth(column), 0) +
		TOOLS_WIDTH;
	return (
		<div
			data-graph-header="true"
			{...stylex.props(styles.header)}
			style={inlineStyles.getHeaderRowHeaderStyle(headerWidth)}
		>
			{visibleOrder.map((column) => (
				<div
					key={column}
					data-graph-column-header={column}
					title={`Drag to reorder ${labels[column].toLocaleLowerCase()}`}
					draggable
					onDragStart={(event) => {
						event.dataTransfer?.setData(
							"application/x-inferay-graph-column",
							column,
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
						if (source && source !== column) onMoveColumn(source, column);
					}}
					{...stylex.props(styles.headerCell, styles.draggableHeader)}
					style={inlineStyles.getHeaderRowHeaderCellStyle(columnWidth(column))}
				>
					{labels[column]}
					<ColumnResizeHandle column={column} onResizeStart={onResizeStart} />
				</div>
			))}
			<div
				{...stylex.props(styles.headerTools)}
				style={inlineStyles.getHeaderRowHeaderToolsStyle(TOOLS_WIDTH)}
			>
				<div {...stylex.props(styles.columnsMenuRoot)}>
					<button
						type="button"
						onClick={onToggleColumnsMenu}
						aria-label="Graph columns and search"
						title="Graph columns and search"
						{...stylex.props(styles.columnsButton)}
					>
						<IconSettings size={11} />
					</button>
					{isColumnsOpen ? (
						<div {...stylex.props(styles.columnsMenu)}>
							<label {...stylex.props(styles.searchRoot)}>
								<IconSearch size={11} />
								<input
									type="search"
									value={query}
									onInput={(event) => onQueryChange(event.currentTarget.value)}
									placeholder="Search all branches"
									aria-label="Search commits"
									title="Search all branches using author:, committer:, message:, ref:, or sha:. Solo filtering resumes when search is cleared."
									{...stylex.props(styles.searchInput)}
								/>
								{query ? (
									<span {...stylex.props(styles.searchCount)}>
										{matchCount}
									</span>
								) : null}
							</label>
							{(["author", "sha", "date"] as const).map((key) => (
								<button
									key={key}
									type="button"
									onClick={() => onToggleColumn(key)}
									{...stylex.props(styles.columnsMenuItem)}
								>
									{labels[key]}
									<span {...stylex.props(styles.columnsState)}>
										{columns[key] ? "On" : "Off"}
									</span>
								</button>
							))}
							{hiddenRefs.length ? (
								<>
									<div {...stylex.props(styles.columnsMenuSection)}>
										Hidden refs
									</div>
									{hiddenRefs.map((ref) => (
										<button
											key={ref.fullName}
											type="button"
											onClick={() => onShowRef(ref.fullName)}
											{...stylex.props(styles.columnsMenuItem)}
										>
											<span {...stylex.props(styles.truncate)}>
												{ref.displayName}
											</span>
											<span {...stylex.props(styles.columnsState)}>Show</span>
										</button>
									))}
								</>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
