import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { Switch } from "@shared/ui/Switch/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import { projects, saveProjectCommand } from "../../hooks/useProjects.tsx";
import { LibraryToolbar } from "./LibraryToolbar.tsx";
import { styles } from "./styles.ts";

export function ResourceFiles(props: { mode: "files" | "tools" | "plugins" }) {
	const [open, setOpen] = createSignal(false);
	const [search, setSearch] = createSignal("");
	const [error, setError] = createSignal("");
	const [pluginPath, setPluginPath] = createSignal("");
	const [filePath, setFilePath] = createSignal(
		props.mode === "tools" ? "tools/main.py" : "files/note.md",
	);
	const [fileContent, setFileContent] = createSignal(
		props.mode === "tools"
			? "import json, sys\nprint(json.dumps({'message': 'Hello'}))\n"
			: "",
	);
	const plugins = () =>
		(projects.catalog()?.plugins ?? []).filter((plugin) =>
			plugin.name.toLowerCase().includes(search().toLowerCase()),
		);
	const label = () =>
		props.mode === "plugins"
			? "Install plugin"
			: props.mode === "tools"
				? "New script"
				: "New file";
	async function save(event: SubmitEvent) {
		event.preventDefault();
		setError("");
		try {
			await saveProjectCommand(
				props.mode === "plugins"
					? {
							type: "installPlugin",
							projectId: projects.selectedId(),
							path: pluginPath(),
						}
					: {
							type: "writeFile",
							projectId: projects.selectedId(),
							path: filePath(),
							content: fileContent(),
							expectedContent: null,
						},
			);
			await queryClient.invalidateQueries({ queryKey: ["project-files"] });
			setOpen(false);
		} catch (error) {
			setError(String(error));
		}
	}
	const add = () => {
		setError("");
		setOpen(true);
	};
	return (
		<>
			{props.mode === "plugins" ? (
				<>
					<LibraryToolbar
						label="Search Plugins"
						value={search()}
						onInput={setSearch}
					>
						<Button size="sm" onClick={add}>
							Install plugin
						</Button>
					</LibraryToolbar>
					<div {...stylex.attrs(styles.libraryGrid)}>
						{plugins().map((plugin) => (
							<article {...stylex.attrs(styles.card)}>
								<div {...stylex.attrs(styles.libraryToolbar)}>
									<strong {...stylex.attrs(styles.listText)}>
										{plugin.name}
									</strong>
									<Switch
										label={`Enable ${plugin.name}`}
										checked={plugin.enabled}
										disabled={projects.busy()}
										onChange={(enabled) => {
											void saveProjectCommand({
												type: "enablePlugin",
												id: plugin.id,
												enabled,
											}).catch(() => {});
										}}
									/>
								</div>
								<span {...stylex.attrs(styles.muted)}>
									Version {plugin.version} ·{" "}
									{plugin.enabled ? "Enabled" : "Disabled"}
								</span>
								<span title={plugin.directory} {...stylex.attrs(styles.muted)}>
									{plugin.directory}
								</span>
							</article>
						))}
					</div>
					{!plugins().length && (
						<div {...stylex.attrs(styles.empty)}>
							<strong>
								{search()
									? "No matching plugins"
									: "Add capabilities to this project"}
							</strong>
							<p>
								{search()
									? "Try another name."
									: "Install a local plugin to make its tools and resources available here."}
							</p>
						</div>
					)}
				</>
			) : (
				<Button size="sm" onClick={add}>
					{label()}
				</Button>
			)}
			<Show when={open()}>
				<Modal
					label={label()}
					closeDisabled={projects.busy()}
					onClose={() => {
						if (!projects.busy()) setOpen(false);
					}}
					class={stylex.attrs(styles.dialog).class}
				>
					<form
						onSubmit={(event) => void save(event)}
						{...stylex.attrs(styles.formFields)}
					>
						<h3>{label()}</h3>
						{props.mode === "plugins" ? (
							<label>
								Plugin folder
								<TextInput
									fullWidth
									required
									placeholder="/path/to/plugin"
									value={pluginPath()}
									onInput={(event) => setPluginPath(event.currentTarget.value)}
								/>
								<p {...stylex.attrs(styles.muted)}>
									Choose a local folder containing plugin.json.
								</p>
							</label>
						) : (
							<>
								<label>
									File name
									<TextInput
										fullWidth
										required
										value={filePath()}
										onInput={(event) => setFilePath(event.currentTarget.value)}
									/>
								</label>
								<textarea
									aria-label="File contents"
									placeholder="Start writing…"
									value={fileContent()}
									onInput={(event) => setFileContent(event.currentTarget.value)}
									{...stylex.attrs(styles.code)}
								/>
							</>
						)}
						{error() && <p role="alert">{error()}</p>}
						<div {...stylex.attrs(styles.row)}>
							<Button
								size="sm"
								disabled={projects.busy()}
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="primary"
								type="submit"
								disabled={projects.busy()}
							>
								{props.mode === "plugins" ? "Install plugin" : "Create file"}
							</Button>
						</div>
					</form>
				</Modal>
			</Show>
		</>
	);
}
