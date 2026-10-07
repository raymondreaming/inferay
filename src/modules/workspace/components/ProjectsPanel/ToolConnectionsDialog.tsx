import type { ToolConnection } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { saveProjectCommand } from "../../hooks/useProjects.tsx";
import { editDefinition, type ProjectTool } from "../../model/projectFiles.ts";
import { loadProjectConnections } from "../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function ToolConnectionsDialog(props: {
	tool: ProjectTool;
	close: () => void;
	saved: () => Promise<void>;
}) {
	let nextKey = 0;
	const initial = Object.entries(props.tool.connections ?? {}).map(
		([alias, binding]) => ({
			key: nextKey++,
			alias,
			binding,
		}),
	);
	const [rows, setRows] = createSignal(initial);
	const [pending, setPending] = createSignal(false);
	const [error, setError] = createSignal("");
	const dirty = () => JSON.stringify(rows()) !== JSON.stringify(initial);
	const connections = useBackgroundQuery(
		() => ({
			queryKey: ["project-connections", props.tool.file.projectId],
			queryFn: () => loadProjectConnections(props.tool.file.projectId),
		}),
		() => queryClient,
	);
	function change(key: number, binding: Partial<ToolConnection>) {
		setRows(
			rows().map((row) =>
				row.key === key
					? { ...row, binding: { ...row.binding, ...binding } }
					: row,
			),
		);
	}
	async function save() {
		if (pending()) return;
		setError("");
		if (new Set(rows().map((row) => row.alias)).size !== rows().length) {
			setError("Each connection needs a different alias.");
			return;
		}
		if (
			rows().some(
				(row) =>
					!connections.data?.connections.some(
						(connection) => connection.id === row.binding.id,
					),
			)
		) {
			setError("Choose a saved project connection for each alias.");
			return;
		}
		setPending(true);
		try {
			await saveProjectCommand(
				editDefinition(props.tool.file, {
					...props.tool.file.definition!,
					connections: Object.fromEntries(
						rows().map((row) => [row.alias, row.binding]),
					),
				}),
			);
			await props.saved();
			props.close();
		} catch (error) {
			setError(String(error));
		} finally {
			setPending(false);
		}
	}
	return (
		<Modal
			label={`${props.tool.name} connections`}
			onClose={props.close}
			closeDisabled={dirty() || pending()}
			class={stylex.attrs(styles.dialog).class}
		>
			<form
				{...stylex.attrs(styles.form)}
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<strong>{props.tool.name} · Connections</strong>
				<p {...stylex.attrs(styles.muted)}>
					Choose a saved key and the HTTPS destination this tool can request.
					Changed inputs require approval before schedules can run.
				</p>
				{(error() || connections.error) && (
					<p role="alert">{error() || String(connections.error)}</p>
				)}
				{connections.isPending && <p role="status">Loading connections…</p>}
				{connections.data?.connections.length === 0 && (
					<p {...stylex.attrs(styles.muted)}>
						Add a key in Plugins → Connections first.
					</p>
				)}
				<For each={rows()} keyed={(row) => row.key}>
					{(row) => (
						<div {...stylex.attrs(styles.formFields)}>
							<div {...stylex.attrs(styles.row)}>
								<strong>{row().alias || "New connection"}</strong>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={pending()}
									onClick={() =>
										setRows(rows().filter((item) => item.key !== row().key))
									}
								>
									Remove connection
								</Button>
							</div>
							<label>
								Alias
								<TextInput
									fullWidth
									required
									maxlength={64}
									pattern="[A-Z][A-Z0-9_]*"
									value={row().alias}
									disabled={pending()}
									onInput={(event) =>
										setRows(
											rows().map((item) =>
												item.key === row().key
													? { ...item, alias: event.currentTarget.value }
													: item,
											),
										)
									}
								/>
							</label>
							<div>
								<span {...stylex.attrs(styles.muted)}>Saved key</span>
								<DropdownButton
									label={`Saved key for ${row().alias}`}
									fullWidth
									value={row().binding.id}
									disabled={pending() || connections.isPending}
									placeholder="Choose a connection"
									options={(connections.data?.connections ?? []).map(
										(connection) => ({
											id: connection.id,
											label: connection.name,
										}),
									)}
									onChange={(id) => change(row().key, { id })}
								/>
							</div>
							<label>
								HTTPS base URL
								<TextInput
									fullWidth
									required
									type="url"
									placeholder="https://api.example.com/v1/"
									value={row().binding.baseUrl}
									disabled={pending()}
									onInput={(event) =>
										change(row().key, { baseUrl: event.currentTarget.value })
									}
								/>
							</label>
							<div {...stylex.attrs(styles.connectionHeaderFields)}>
								<label>
									Header
									<TextInput
										fullWidth
										required
										value={row().binding.header}
										disabled={pending()}
										onInput={(event) =>
											change(row().key, { header: event.currentTarget.value })
										}
									/>
								</label>
								<label>
									Key prefix
									<TextInput
										fullWidth
										value={row().binding.prefix}
										placeholder="Bearer "
										disabled={pending()}
										onInput={(event) =>
											change(row().key, { prefix: event.currentTarget.value })
										}
									/>
								</label>
							</div>
						</div>
					)}
				</For>
				<Button
					type="button"
					variant="ghost"
					disabled={
						pending() ||
						rows().length >= 16 ||
						!connections.data?.connections.length
					}
					onClick={() =>
						setRows([
							...rows(),
							{
								key: nextKey++,
								alias: "",
								binding: {
									id: "",
									baseUrl: "",
									header: "Authorization",
									prefix: "Bearer ",
								},
							},
						])
					}
				>
					Add connection
				</Button>
				<p {...stylex.attrs(styles.muted)}>
					GET requests only. The automation needs network permission. Inferay
					attaches the key; the tool receives a temporary request URL.
				</p>
				<div {...stylex.attrs(styles.row)}>
					<Button
						type="button"
						variant="ghost"
						disabled={pending()}
						onClick={props.close}
					>
						{dirty() ? "Discard changes" : "Cancel"}
					</Button>
					<Button
						type="submit"
						disabled={!dirty() || pending() || connections.isPending}
					>
						{pending() ? "Saving…" : "Save connections"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
