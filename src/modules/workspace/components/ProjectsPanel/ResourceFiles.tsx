import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import {
	projects,
	refreshProjects,
	saveProjectCommand,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { pluginName } from "../../model/projectFiles.ts";
import { importPluginLibrary } from "../../services/projectsApi.ts";
import { LibraryToolbar } from "./LibraryToolbar.tsx";
import { PluginContentsSummary } from "./PluginContentsSummary.tsx";
import { PluginLibraryDialog } from "./PluginLibraryDialog.tsx";
import { droppedPluginFiles } from "./pluginImport.ts";
import { styles } from "./styles.ts";

export function ResourceFiles() {
	const [dragging, setDragging] = createSignal(false);
	const [libraryTarget, setLibraryTarget] = createSignal<{
		projectId: string;
		path: string;
	} | null>(null);
	const library = () =>
		projects
			.catalog()
			?.plugins.find(
				(plugin) =>
					plugin.file.sourcePath === libraryTarget()?.path &&
					plugin.file.projectId === libraryTarget()?.projectId,
			);
	const [search, setSearch] = createSignal("");
	const [error, setError] = createSignal("");
	const [importing, setImporting] = createSignal(false);
	let picker: HTMLInputElement | undefined;
	async function importFolder(files: File[]) {
		if (!files.length || importing()) return;
		const projectId = projects.selectedId();
		setImporting(true);
		setError("");
		try {
			const slug = files[0].webkitRelativePath.split("/")[0];
			if (
				!slug ||
				files.some((file) => !file.webkitRelativePath.startsWith(`${slug}/`))
			)
				throw new Error("Choose one folder to import as a draft library.");
			if (
				files.length > 1000 ||
				files.reduce((size, file) => size + file.size, 0) > 50_000_000
			)
				throw new Error("Plugin exceeds the 1,000 entry or 50 MB limit.");
			await importPluginLibrary(
				projectId,
				slug,
				files.map((file) => ({
					path: file.webkitRelativePath.slice(slug.length + 1),
					file,
				})),
			);
			await refreshProjects(projectId);
		} catch (error) {
			setError(String(error));
		} finally {
			setImporting(false);
		}
	}
	const plugins = () =>
		(projects.catalog()?.plugins ?? []).filter((plugin) =>
			`${pluginName(plugin)} ${plugin.file.definition?.description ?? ""} ${plugin.file.sourcePath}`
				.toLowerCase()
				.includes(search().toLowerCase()),
		);
	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- File drop region also exposes a keyboard-accessible folder picker.
		<section
			aria-label="Plugin libraries"
			onDragOver={(event) => {
				if (event.dataTransfer?.types.includes("Files")) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
					setDragging(true);
				}
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					setDragging(false);
			}}
			onDrop={async (event) => {
				event.preventDefault();
				setDragging(false);
				if (!event.dataTransfer || importing()) return;
				const projectId = projects.selectedId();
				const intake = droppedPluginFiles(event.dataTransfer);
				setImporting(true);
				setError("");
				try {
					const { name, files } = await intake;
					if (!files.length)
						throw new Error("Drop a folder or files to create a library.");
					await importPluginLibrary(projectId, name, files);
					await refreshProjects(projectId);
				} catch (error) {
					setError(String(error));
				} finally {
					setImporting(false);
				}
			}}
		>
			{dragging() && (
				<p role="status" {...stylex.attrs(styles.empty)}>
					Drop files or a folder to create a draft plugin library
				</p>
			)}
			<Show when={library()} keyed>
				{(value) => (
					<PluginLibraryDialog
						plugin={value}
						close={() => setLibraryTarget(null)}
					/>
				)}
			</Show>
			<input
				hidden
				type="file"
				multiple
				ref={(element) => {
					picker = element;
					element.setAttribute("webkitdirectory", "");
				}}
				onChange={(event) => {
					void importFolder(Array.from(event.currentTarget.files ?? []));
					event.currentTarget.value = "";
				}}
			/>
			<LibraryToolbar
				label="Search Plugins"
				value={search()}
				onInput={setSearch}
			>
				<Button
					size="sm"
					disabled={importing()}
					onClick={() => picker?.click()}
				>
					{importing() ? "Importing…" : "Import folder"}
				</Button>
			</LibraryToolbar>
			{error() && <p role="alert">{error()}</p>}
			<div {...stylex.attrs(styles.libraryGrid)}>
				{plugins().map((plugin) => {
					const automations = () =>
						(projects.catalog()?.automations ?? []).filter(
							(item) =>
								item.file.sourcePath.startsWith(
									plugin.file.sourcePath.replace(/plugin\.json$/, ""),
								) && !item.archived,
						);
					const tools = () =>
						(projects.catalog()?.tools ?? []).filter((item) =>
							item.file.sourcePath.startsWith(
								plugin.file.sourcePath.replace(/plugin\.json$/, ""),
							),
						);
					return (
						<article {...stylex.attrs(styles.card)}>
							<strong {...stylex.attrs(styles.listText)}>
								{pluginName(plugin)}
							</strong>
							<span {...stylex.attrs(styles.muted)}>
								{plugin.file.definition && (
									<>Version {plugin.file.definition.version} · </>
								)}
								{plugin.file.error
									? "Needs repair"
									: (plugin.approvedAt !== null && !plugin.approvedHash) ||
											automations().some((item) => item.inputsChanged)
										? "Changed · Review required"
										: automations().some((item) => item.enabled)
											? "Running on schedule"
											: automations().length
												? "Schedules off"
												: "Reusable library"}
							</span>
							<p {...stylex.attrs(styles.resourcePreview)}>
								{plugin.file.definition?.description}
							</p>
							{plugin.file.error && (
								<p role="alert" {...stylex.attrs(styles.muted)}>
									{plugin.file.error}
								</p>
							)}
							<PluginContentsSummary id={plugin.file.id} />
							{tools().map((tool) => (
								<span {...stylex.attrs(styles.muted)}>{tool.name}</span>
							))}
							<span {...stylex.attrs(styles.muted)}>
								Permissions:{" "}
								{plugin.file.definition?.may.join(", ") ||
									(plugin.file.definition
										? "None declared"
										: "Manifest needs repair")}
							</span>
							<Button
								size="sm"
								disabled={projects.busy()}
								onClick={() =>
									setLibraryTarget({
										projectId: plugin.file.projectId,
										path: plugin.file.sourcePath,
									})
								}
							>
								Open library
							</Button>
							{automations().some((item) => item.enabled) && (
								<Button
									size="sm"
									variant="ghost"
									disabled={projects.busy()}
									onClick={() =>
										void saveProjectCommand({
											type: "disablePlugin",
											id: plugin.file.id,
										}).catch((error) => setError(String(error)))
									}
								>
									Turn off schedules
								</Button>
							)}
							{automations().length > 0 && (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => showProjectView("automations")}
								>
									Used by:{" "}
									{automations()
										.map((automation) => automation.name)
										.join(", ")}
								</Button>
							)}
						</article>
					);
				})}
			</div>
			{!plugins().length && (
				<div {...stylex.attrs(styles.empty)}>
					<strong>
						{search() ? "No matching plugins" : "Build a capability in chat"}
					</strong>
					<p>
						Ask an agent to build reusable scripts, a toolkit, or an
						integration—or import a folder of existing code and assets for chat
						to organize.
					</p>
				</div>
			)}
		</section>
	);
}
