import type { DatabaseId, DatabaseInfo, DatabaseSchema } from "@contracts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { setInputValue } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
	getDatabaseOpenApi,
	getDatabaseSchema,
	listDatabases,
} from "../../services/databaseApi.ts";
import { Rows } from "./Rows.tsx";
import { Schema } from "./Schema.tsx";
import { styles } from "./styles.ts";

export function DatabaseExplorer() {
	const [database, setDatabase] = createSignal<DatabaseId>("projects");
	const [table, setTable] = createSignal("");
	const [search, setSearch] = createSignal("");
	const [view, setView] = createSignal("rows");
	const [revision, setRevision] = createSignal(0);
	const [contractError, setContractError] = createSignal("");
	const databases = useQueryResource<DatabaseInfo[]>(() => ({
		queryKey: ["databases"],
		queryFn: ({ signal }) => listDatabases(signal),
		initialData: [],
		retry: false,
	}));
	const info = createMemo(() =>
		databases.data.find((item) => item.id === database()),
	);
	const schema = useQueryResource<DatabaseSchema | null>(() => ({
		queryKey: ["database-schema", database(), revision()],
		queryFn: ({ signal }) => getDatabaseSchema(database(), signal),
		initialData: null,
		enabled: info()?.exists === true,
		retry: false,
		gcTime: 0,
	}));
	const objects = createMemo(
		() =>
			schema.data?.objects.filter((item) =>
				item.name.toLowerCase().includes(search().toLowerCase()),
			) ?? [],
	);
	const selected = createMemo(
		() => schema.data?.objects.find((item) => item.name === table()) ?? null,
	);
	const downloadContract = async () => {
		try {
			const spec = await getDatabaseOpenApi();
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = "inferay-openapi.json";
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			setContractError("");
		} catch (error) {
			setContractError(error instanceof Error ? error.message : String(error));
		}
	};
	return (
		<section aria-label="Database explorer" {...stylex.attrs(styles.root)}>
			<div {...stylex.attrs(styles.toolbar)}>
				<DropdownButton
					label="Database"
					value={database()}
					options={databases.data.map((item) => ({
						id: item.id,
						label: item.filename,
					}))}
					onChange={(id) => {
						setDatabase(id as DatabaseId);
						setTable("");
						setSearch("");
					}}
				/>
				<Button
					size="sm"
					onClick={() => {
						setRevision((n) => n + 1);
						void databases.refresh();
					}}
				>
					Refresh
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => void downloadContract()}
				>
					Download OpenAPI
				</Button>
				<span {...stylex.attrs(styles.badge)}>Read only</span>
			</div>
			<Show when={info()}>
				{(item) => (
					<div {...stylex.attrs(styles.description)}>
						<strong>{item().purpose}</strong>
						<p>{item().sourceOfTruth}</p>
						<p>Owner: {item().owner}</p>
					</div>
				)}
			</Show>
			<Show when={databases.error ?? schema.error ?? contractError()}>
				{(error) => (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{error()}
					</p>
				)}
			</Show>
			<Show when={databases.loading || schema.loading}>
				<p role="status">Loading database…</p>
			</Show>
			<Show when={info() && !info()!.exists}>
				<p>This store has not been created in this profile yet.</p>
			</Show>
			<Show when={schema.data}>
				{(data) => (
					<>
						<p {...stylex.attrs(styles.muted)}>
							SQLite {data().sqliteVersion} · Schema version{" "}
							{data().userVersion} · {data().journalMode.toUpperCase()} journal
							· {data().objects.length} tables and views
						</p>
						<div {...stylex.attrs(styles.layout)}>
							<aside {...stylex.attrs(styles.sidebar)}>
								<TextInput
									type="search"
									aria-label="Find table or view"
									placeholder="Find table or view"
									value={search()}
									onInput={setInputValue.bind(null, setSearch)}
								/>
								<nav
									aria-label="Database tables"
									{...stylex.attrs(styles.tableList)}
								>
									<For each={objects()} keyed={(object) => object.name}>
										{(object) => (
											<button
												type="button"
												aria-current={
													table() === object().name ? "page" : undefined
												}
												{...stylex.attrs(
													styles.tableButton,
													table() === object().name && styles.selected,
												)}
												onClick={() => setTable(object().name)}
											>
												<span>{object().name}</span>
												<small {...stylex.attrs(styles.muted)}>
													{object().kind}
												</small>
											</button>
										)}
									</For>
									<Show when={!objects().length}>
										<p>No matching tables.</p>
									</Show>
								</nav>
							</aside>
							<main {...stylex.attrs(styles.main)}>
								<Show
									when={selected()}
									fallback={
										<p>
											Select a table or view to inspect its data and schema.
										</p>
									}
									keyed
								>
									{(object) => (
										<>
											<div {...stylex.attrs(styles.toolbar)}>
												<h2 {...stylex.attrs(styles.heading)}>{object.name}</h2>
												<Button
													size="sm"
													variant={view() === "rows" ? "primary" : "ghost"}
													onClick={() => setView("rows")}
												>
													Rows
												</Button>
												<Button
													size="sm"
													variant={view() === "schema" ? "primary" : "ghost"}
													onClick={() => setView("schema")}
												>
													Schema
												</Button>
											</div>
											<Show
												when={view() === "rows"}
												fallback={
													<Schema
														object={object}
														triggers={data().triggers.filter(
															(t) => t.table === object.name,
														)}
														navigate={setTable}
													/>
												}
											>
												<Rows
													database={database()}
													object={object}
													revision={revision()}
												/>
											</Show>
										</>
									)}
								</Show>
							</main>
						</div>
					</>
				)}
			</Show>
		</section>
	);
}
