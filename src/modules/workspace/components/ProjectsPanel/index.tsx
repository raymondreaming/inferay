import type { ProjectCommand, ProjectResource } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconFolder } from "@shared/ui/Icons/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, onSettled, Show } from "solid-js";
import {
	projects,
	refreshProjects,
	saveProjectCommand,
} from "../../hooks/useProjects.tsx";
import { AutomationWorkspace } from "./AutomationWorkspace.tsx";
import { LibraryToolbar } from "./LibraryToolbar.tsx";
import { MemoryPanel } from "./MemoryPanel/index.tsx";
import { ProjectEditor } from "./ProjectEditor.tsx";
import { ProjectFiles } from "./ProjectFiles.tsx";
import { ResourceEditor } from "./ResourceEditor.tsx";
import { ResourceFiles } from "./ResourceFiles.tsx";
import { styles } from "./styles.ts";

export function ProjectsPanel() {
	const [search, setSearch] = createSignal("");
	const [category, setCategory] = createSignal("all");
	const [creatingProject, setCreatingProject] = createSignal(false);
	const [resource, setResource] = createSignal<ProjectResource | "new" | null>(
		null,
	);

	const current = () =>
		projects.catalog()?.projects.find((p) => p.id === projects.selectedId());
	const resources = () =>
		projects.catalog()?.resources.filter((r) => !r.archived) ?? [];
	onSettled(() => {
		const timer = setInterval(() => {
			if (!document.hidden && !projects.busy()) void refreshProjects();
		}, 3000);
		return () => clearInterval(timer);
	});
	async function save(command: ProjectCommand) {
		await saveProjectCommand(command);
	}
	function act(command: ProjectCommand) {
		void save(command).catch(() => {});
	}

	return (
		<section
			aria-label="Project workspace"
			{...stylex.attrs(
				styles.main,
				projects.view() === "automations" && styles.automationMain,
			)}
		>
			{projects.error() && projects.view() !== "automations" ? (
				<p role="alert">{projects.error()}</p>
			) : null}
			{!projects.catalog() ? <p>Loading projects…</p> : null}
			{creatingProject() ? (
				<ProjectEditor
					close={() => {
						setCreatingProject(false);
					}}
				/>
			) : null}
			{!current() ? (
				<div {...stylex.attrs(styles.list)}>
					{projects.catalog() && !projects.list().some((p) => !p.archived) ? (
						<div {...stylex.attrs(styles.empty)}>
							<IconFolder size={28} />
							<strong>A home for your next idea</strong>
							<p>
								Create a project to bring chats, resources, and automations
								together.
							</p>
							<Button size="sm" onClick={() => setCreatingProject(true)}>
								Create your first project
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			{current() && ["resources", "tools"].includes(projects.view()) ? (
				<>
					<LibraryToolbar
						label={
							projects.view() === "tools" ? "Search Tools" : "Search Resources"
						}
						value={search()}
						onInput={setSearch}
					>
						<Button size="sm" onClick={() => setResource("new")}>
							{projects.view() === "tools" ? "Add tool" : "Add resource"}
						</Button>
					</LibraryToolbar>
					<Show when={resource()} keyed>
						{(r) => (
							<Modal
								label="Resource"
								onClose={() => setResource(null)}
								class={stylex.attrs(styles.dialog).class}
							>
								<ResourceEditor
									types={projects.catalog()?.resourceTypes ?? []}
									initialType={
										projects.view() === "tools" ? "inferay.tool" : undefined
									}
									projectId={projects.selectedId()}
									resource={r === "new" ? undefined : r}
									brands={resources().filter((v) => v.typeId === "brand.brand")}
									save={save}
									close={() => setResource(null)}
									busy={projects.busy()}
								/>
							</Modal>
						)}
					</Show>

					{projects.view() === "resources" && (
						<div {...stylex.attrs(styles.resourceCategories)}>
							{[
								["all", "All resources"],
								["brand.brand", "Brand"],
								["brand.mind", "Mind"],
								["brand.genome", "Genome"],
							].map(([id, label]) => (
								<Button
									size="sm"
									variant={category() === id ? "primary" : "ghost"}
									onClick={() => setCategory(id)}
								>
									{label}
								</Button>
							))}
						</div>
					)}
					{projects.view() === "resources" &&
						resources().filter(
							(r) => !["inferay.repository", "inferay.tool"].includes(r.typeId),
						).length === 0 && (
							<div {...stylex.attrs(styles.resourceEmpty)}>
								<strong>Your project’s reference library</strong>
								<p>
									Keep its purpose, voice, knowledge, and creative direction
									together.
								</p>
								<Button size="sm" onClick={() => setResource("new")}>
									Add your first resource
								</Button>
							</div>
						)}
					<div {...stylex.attrs(styles.libraryGrid)}>
						{resources()
							.filter(
								(r) =>
									projects.view() !== "resources" ||
									category() === "all" ||
									r.typeId === category(),
							)
							.filter((r) =>
								r.name.toLowerCase().includes(search().toLowerCase()),
							)
							.filter((r) =>
								projects.view() === "tools"
									? r.typeId === "inferay.tool"
									: !["inferay.repository", "inferay.tool"].includes(r.typeId),
							)
							.map((r) => (
								<article {...stylex.attrs(styles.card, styles.resourceCard)}>
									<button
										type="button"
										onClick={() => setResource(r)}
										{...stylex.attrs(styles.libraryCardTitle)}
									>
										{r.name}
									</button>
									<span {...stylex.attrs(styles.muted)}>
										{(
											{
												"brand.brand": "Brand",
												"brand.mind": "Mind",
												"brand.genome": "Genome",
												"inferay.tool": "Local tool",
												"inferay.repository": "Repository",
											} as Record<string, string>
										)[r.typeId] ?? r.typeId}{" "}
									</span>
									<div {...stylex.attrs(styles.row)}>
										<Button size="sm" onClick={() => setResource(r)}>
											Edit
										</Button>
										<Button
											size="sm"
											onClick={() =>
												act({
													type: "archiveResource",
													id: r.id,
													expectedRevision: r.revision,
												})
											}
										>
											Archive
										</Button>
									</div>
									<p {...stylex.attrs(styles.resourcePreview)}>
										{String(
											(r.body as Record<string, unknown>).description ??
												(r.body as Record<string, unknown>).instructions ??
												"",
										).slice(0, 180)}
									</p>
								</article>
							))}
					</div>
				</>
			) : null}
			{current() && projects.view() === "memory" ? (
				<MemoryPanel projectId={current()!.id} />
			) : null}
			{current() && ["files", "tools", "plugins"].includes(projects.view()) ? (
				<Show when={projects.view()} keyed>
					{(view) => (
						<>
							{view !== "plugins" ? (
								<ProjectFiles directory={current()!.directory} root={view} />
							) : null}
							<ResourceFiles mode={view as "files" | "tools" | "plugins"} />
						</>
					)}
				</Show>
			) : null}
			{current() && projects.view() === "automations" ? (
				<AutomationWorkspace />
			) : null}
		</section>
	);
}
