import type { DatabaseObject, DatabaseTrigger } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import { styles } from "./styles.ts";

export function Schema(props: {
	object: DatabaseObject;
	triggers: DatabaseTrigger[];
	navigate: (table: string) => void;
}) {
	return (
		<div {...stylex.attrs(styles.stack)}>
			<p {...stylex.attrs(styles.muted)}>
				{props.object.kind} ·{" "}
				{props.object.withoutRowid
					? "WITHOUT ROWID"
					: props.object.kind === "view"
						? "View"
						: "Rowid table"}{" "}
				· {props.object.strict ? "STRICT" : "Flexible SQLite typing"}
			</p>
			<div {...stylex.attrs(styles.scroller)}>
				<table {...stylex.attrs(styles.table)}>
					<thead>
						<tr>
							<th {...stylex.attrs(styles.schemaCell)}>Column</th>
							<th {...stylex.attrs(styles.schemaCell)}>Declared type</th>
							<th {...stylex.attrs(styles.schemaCell)}>NOT NULL</th>
							<th {...stylex.attrs(styles.schemaCell)}>Primary key position</th>
							<th {...stylex.attrs(styles.schemaCell)}>Default</th>
							<th {...stylex.attrs(styles.schemaCell)}>Storage</th>
						</tr>
					</thead>
					<tbody>
						<For each={props.object.columns} keyed={(c) => c.name}>
							{(column) => (
								<tr>
									<td {...stylex.attrs(styles.schemaCell)}>{column().name}</td>
									<td {...stylex.attrs(styles.schemaCell)}>
										{column().declaredType || "untyped"}
									</td>
									<td {...stylex.attrs(styles.schemaCell)}>
										{column().notNull ? "Yes" : "No"}
									</td>
									<td {...stylex.attrs(styles.schemaCell)}>
										{column().primaryKeyPosition || "—"}
									</td>
									<td {...stylex.attrs(styles.schemaCell)}>
										{column().defaultValue ?? "—"}
									</td>
									<td {...stylex.attrs(styles.schemaCell)}>
										{[
											"ordinary",
											"hidden",
											"generated (virtual)",
											"generated (stored)",
										][column().hidden] ?? column().hidden}
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
			<h3>Foreign keys</h3>
			<Show
				when={props.object.foreignKeys.length}
				fallback={
					<p {...stylex.attrs(styles.muted)}>
						No declared foreign keys. Application references may still exist.
					</p>
				}
			>
				<For
					each={props.object.foreignKeys}
					keyed={(key) => `${key.id}:${key.sequence}`}
				>
					{(key) => (
						<p>
							<code>{key().from}</code> →{" "}
							<Button
								variant="text"
								size="sm"
								onClick={() => props.navigate(key().table)}
							>
								{key().table}.{key().to ?? "primary key"}
							</Button>{" "}
							· group {key().id}, position {key().sequence} · update{" "}
							{key().onUpdate} · delete {key().onDelete} · match{" "}
							{key().matchRule}
						</p>
					)}
				</For>
			</Show>
			<h3>Indexes</h3>
			<Show
				when={props.object.indexes.length}
				fallback={<p {...stylex.attrs(styles.muted)}>No indexes.</p>}
			>
				<For each={props.object.indexes} keyed={(index) => index.name}>
					{(index) => (
						<div {...stylex.attrs(styles.card)}>
							<strong>{index().name}</strong>
							<p>
								{index().unique ? "Unique" : "Non-unique"} · origin{" "}
								{index().origin} · {index().partial ? "partial" : "full"}
							</p>
							<For each={index().columns} keyed={(c) => c.sequence}>
								{(column) => (
									<p>
										{column().name ??
											(column().columnId === -2
												? "expression (see SQL)"
												: "rowid")}{" "}
										· {column().descending ? "DESC" : "ASC"} ·{" "}
										{column().collation} · {column().key ? "key" : "auxiliary"}
									</p>
								)}
							</For>
							<pre {...stylex.attrs(styles.code)}>
								{index().sql ?? "Implicit SQLite index"}
							</pre>
						</div>
					)}
				</For>
			</Show>
			<h3>Definition</h3>
			<pre {...stylex.attrs(styles.code)}>
				{props.object.sql ??
					"Internal SQLite object; no CREATE statement stored."}
			</pre>
			<h3>Triggers</h3>
			<Show
				when={props.triggers.length}
				fallback={<p {...stylex.attrs(styles.muted)}>No triggers.</p>}
			>
				<For each={props.triggers} keyed={(t) => t.name}>
					{(trigger) => (
						<div>
							<strong>{trigger().name}</strong>
							<pre {...stylex.attrs(styles.code)}>{trigger().sql}</pre>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}
