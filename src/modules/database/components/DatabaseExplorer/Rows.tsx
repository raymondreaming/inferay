import type {
	DatabaseCell,
	DatabaseDirection,
	DatabaseId,
	DatabaseObject,
	DatabaseRows,
} from "@contracts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { setInputValue } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
	getDatabaseCell,
	getDatabaseRows,
} from "../../services/databaseApi.ts";
import { styles } from "./styles.ts";

export function Rows(props: {
	database: DatabaseId;
	object: DatabaseObject;
	revision: number;
}) {
	const [offset, setOffset] = createSignal(0);
	const [sort, setSort] = createSignal("");
	const [direction, setDirection] = createSignal<DatabaseDirection>("asc");
	const [column, setColumn] = createSignal(
		props.object.columns.find((c) => c.hidden !== 1)?.name ?? "",
	);
	const [draft, setDraft] = createSignal("");
	const [filter, setFilter] = createSignal<{
		column: string;
		value: string;
	} | null>(null);
	const [selection, setSelection] = createSignal<{
		column: string;
		key: string | null;
		preview: DatabaseCell;
	} | null>(null);
	const [cellOffset, setCellOffset] = createSignal(0);
	const columns = createMemo(() =>
		props.object.columns
			.filter((c) => c.hidden !== 1)
			.map((c) => ({ id: c.name, label: c.name })),
	);
	const query = createMemo(() => ({
		database: props.database,
		table: props.object.name,
		offset: offset(),
		limit: 50,
		sort: sort() || null,
		direction: direction(),
		column: filter()?.column ?? null,
		filter: filter()?.value ?? null,
	}));
	const rows = useQueryResource<DatabaseRows | null>(() => ({
		queryKey: ["database-rows", query(), props.revision],
		queryFn: ({ signal }) => getDatabaseRows(query(), signal),
		initialData: null,
		retry: false,
		gcTime: 0,
	}));
	const cell = useQueryResource<DatabaseCell | null>(() => ({
		queryKey: [
			"database-cell",
			props.database,
			props.object.name,
			selection()?.key,
			selection()?.column,
			cellOffset(),
			props.revision,
		],
		queryFn: ({ signal }) =>
			getDatabaseCell(
				{
					database: props.database,
					table: props.object.name,
					key: selection()!.key!,
					column: selection()!.column,
					offset: cellOffset(),
				},
				signal,
			),
		initialData: null,
		enabled: selection()?.key != null,
		retry: false,
		gcTime: 0,
	}));
	const value = createMemo(() =>
		selection()?.key != null ? cell.data : selection()?.preview,
	);
	const reset = () => {
		setOffset(0);
		setSelection(null);
	};
	return (
		<div {...stylex.attrs(styles.stack)}>
			<form
				{...stylex.attrs(styles.toolbar)}
				onSubmit={(event) => {
					event.preventDefault();
					setFilter(draft() ? { column: column(), value: draft() } : null);
					reset();
				}}
			>
				<DropdownButton
					label="Filter column"
					value={column()}
					options={columns()}
					onChange={setColumn}
				/>
				<TextInput
					aria-label="Contains text"
					placeholder="Contains text (case sensitive)"
					value={draft()}
					onInput={setInputValue.bind(null, setDraft)}
				/>
				<Button size="sm" type="submit">
					Filter
				</Button>
				<Show when={filter()}>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							setDraft("");
							setFilter(null);
							reset();
						}}
					>
						Clear filter
					</Button>
				</Show>
			</form>
			<p {...stylex.attrs(styles.muted)}>
				Click a column heading to sort and a cell to inspect its contents. Live
				writes may shift pages.
			</p>
			<Show when={rows.error}>
				<p role="alert" {...stylex.attrs(styles.error)}>
					{rows.error}
				</p>
			</Show>
			<Show when={rows.loading}>
				<p role="status">Loading rows…</p>
			</Show>
			<Show when={rows.data}>
				{(page) => (
					<>
						<div {...stylex.attrs(styles.scroller)}>
							<table
								{...stylex.attrs(styles.table)}
								aria-label={`${props.object.name} rows`}
							>
								<thead>
									<tr>
										<For each={page().columns} keyed={(name) => name}>
											{(name) => (
												<th
													aria-sort={
														sort() === name()
															? direction() === "asc"
																? "ascending"
																: "descending"
															: "none"
													}
												>
													<button
														type="button"
														{...stylex.attrs(styles.columnButton)}
														onClick={() => {
															setDirection(
																sort() === name() && direction() === "asc"
																	? "desc"
																	: "asc",
															);
															setSort(name());
															reset();
														}}
													>
														{name()}
														{sort() === name()
															? direction() === "asc"
																? " ↑"
																: " ↓"
															: ""}
													</button>
												</th>
											)}
										</For>
									</tr>
								</thead>
								<tbody>
									<For each={page().rows} keyed={(row) => row}>
										{(row) => (
											<tr>
												<For each={row().cells} keyed={(entry) => entry}>
													{(entry, index) => (
														<td>
															<button
																type="button"
																{...stylex.attrs(
																	styles.cellButton,
																	entry().kind === "null" && styles.muted,
																)}
																title={`Inspect ${page().columns[index()]} (${entry().kind})`}
																onClick={() => {
																	setSelection({
																		column: page().columns[index()],
																		key: row().key,
																		preview: entry(),
																	});
																	setCellOffset(0);
																}}
															>
																{entry().kind === "null"
																	? "NULL"
																	: entry().value === ""
																		? "(empty)"
																		: entry().value}
																{entry().truncated ? "…" : ""}
															</button>
														</td>
													)}
												</For>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
						<Show when={!page().rows.length}>
							<p>No matching rows.</p>
						</Show>
						<div {...stylex.attrs(styles.toolbar)}>
							<Button
								size="sm"
								disabled={offset() === 0 || rows.loading}
								onClick={() => {
									setOffset((n) => Math.max(0, n - 50));
									setSelection(null);
								}}
							>
								Previous
							</Button>
							<span>
								{page().rows.length
									? `${offset() + 1}–${offset() + page().rows.length}`
									: "0 rows"}
							</span>
							<Button
								size="sm"
								disabled={
									!page().hasMore || rows.loading || offset() >= 1000000
								}
								onClick={() => {
									setOffset((n) => n + 50);
									setSelection(null);
								}}
							>
								Next
							</Button>
						</div>
					</>
				)}
			</Show>
			<Show when={selection()}>
				{(selected) => (
					<section aria-label="Cell inspector" {...stylex.attrs(styles.card)}>
						<div {...stylex.attrs(styles.toolbar)}>
							<h3>{selected().column}</h3>
							<span {...stylex.attrs(styles.badge)}>
								{value()?.kind ?? selected().preview.kind}
							</span>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setSelection(null)}
							>
								Close
							</Button>
						</div>
						<Show when={cell.loading}>
							<p role="status">Loading contents…</p>
						</Show>
						<Show when={cell.error}>
							<p role="alert" {...stylex.attrs(styles.error)}>
								{cell.error}
							</p>
						</Show>
						<pre {...stylex.attrs(styles.code)}>
							{value()?.kind === "null" ? "NULL" : (value()?.value ?? "")}
						</pre>
						<Show
							when={selected().key !== null}
							fallback={
								<p {...stylex.attrs(styles.muted)}>
									This object has no accessible row key.{" "}
									{selected().preview.truncated
										? "Only a 512-unit preview is available."
										: "The full value fits in this preview."}
								</p>
							}
						>
							<p {...stylex.attrs(styles.muted)}>
								Offset {cellOffset()} ·{" "}
								{value()?.kind === "blob"
									? "bytes, shown as hex"
									: "characters"}
								. Each chunk reads the current row. Integers retain their exact
								decimal value.
							</p>
							<div {...stylex.attrs(styles.toolbar)}>
								<Button
									size="sm"
									disabled={cellOffset() === 0 || cell.loading}
									onClick={() => setCellOffset((n) => Math.max(0, n - 65536))}
								>
									Previous chunk
								</Button>
								<Button
									size="sm"
									disabled={!cell.data?.truncated || cell.loading}
									onClick={() => setCellOffset((n) => n + 65536)}
								>
									Next chunk
								</Button>
							</div>
						</Show>
					</section>
				)}
			</Show>
		</div>
	);
}
