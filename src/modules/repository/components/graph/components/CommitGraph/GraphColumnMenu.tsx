import type { GitGraphRef } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { IconSearch, IconSettings } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { styles } from "./styles.ts";
import {
	type ColumnKey,
	type ColumnVisibility,
} from "./useCommitGraphState.tsx";
export function GraphColumnMenu(_props: {
	columns: ColumnVisibility;
	order: ColumnKey[];
	isColumnsOpen: boolean;
	onToggleColumnsMenu: () => void;
	onToggleColumn: (key: ColumnKey) => void;
	hiddenRefs: GitGraphRef[];
	onShowRef: (fullName: string) => void;
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
}) {
	const labels = createMemo<Record<ColumnKey, string>>(() => ({
		date: "Date",
		refs: "Branch",
		graph: "Graph",
		message: "Message",
		author: "Author",
		sha: "SHA",
	}));
	return (
		<div {...stylex.attrs(styles.columnMenuOverlay)}>
			<div {...stylex.attrs(styles.headerTools)}>
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
						<div {...stylex.attrs(surfaceStyles.overlay, styles.columnsMenu)}>
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
							{_props.order.map((key) => (
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
