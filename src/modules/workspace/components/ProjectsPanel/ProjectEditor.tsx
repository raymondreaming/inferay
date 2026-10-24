import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import {
	projects,
	saveProjectCommand,
	selectProject,
} from "../../hooks/useProjects.tsx";
import { editDefinition, type Project } from "../../model/projectFiles.ts";
import { InlineDirectoryPicker } from "../InlineDirectoryPicker/index.tsx";
import { RepositoryManager } from "./RepositoryManager.tsx";
import { styles } from "./styles.ts";
export function ProjectEditor(props: { project?: Project; close: () => void }) {
	const [confirmingArchive, setConfirmingArchive] = createSignal(false);
	const [archiveName, setArchiveName] = createSignal("");
	const [name, setName] = createSignal(props.project?.definition.name ?? "");
	const [description, setDescription] = createSignal(
		props.project?.definition.description ?? "",
	);
	const [instructions, setInstructions] = createSignal(
		props.project?.definition.instructions ?? "",
	);
	const [repositories, setRepositories] = createSignal<string[]>([]);
	const [managingRepositories, setManagingRepositories] = createSignal(false);
	async function submitProject(event: SubmitEvent) {
		event.preventDefault();
		if (confirmingArchive() || projects.busy() || !name().trim()) return;
		try {
			const existing =
				projects.list().find((p) => p.id === props.project?.id) ??
				props.project;
			const id = existing?.id ?? crypto.randomUUID();
			const selected = repositories().map((path) => ({
				id: crypto.randomUUID(),
				name: path.split("/").filter(Boolean).at(-1) ?? "Repository",
				path,
			}));
			await saveProjectCommand({
				type: "saveProject",
				expectedHash: existing?.sourceHash ?? null,
				definition: {
					schema: "inferay.project/1",
					id,
					name: name().trim(),
					description: description(),
					instructions: instructions(),
					archived: false,
					repositories:
						existing?.definition.repositories ??
						selected.map(({ id, name }) => ({ id, name, remote: null })),
				},
				repositoryPaths: Object.fromEntries(
					selected.map(({ id, path }) => [id, path]),
				),
			});
			await selectProject(id);
			props.close();
		} catch {}
	}
	return managingRepositories() && props.project ? (
		<RepositoryManager
			project={
				projects.list().find((p) => p.id === props.project!.id) ?? props.project
			}
			close={() => setManagingRepositories(false)}
		/>
	) : (
		<Modal
			label={props.project ? "Edit project" : "New project"}
			closeDisabled={projects.busy()}
			onClose={() => {
				if (!projects.busy()) props.close();
			}}
			class={stylex.attrs(styles.dialog).class}
		>
			<form
				onSubmit={(e) => void submitProject(e)}
				{...stylex.attrs(styles.form)}
			>
				<h2 {...stylex.attrs(styles.dialogTitle)}>
					{props.project ? "Edit project" : "New project"}
				</h2>
				<label {...stylex.attrs(styles.editorField)}>
					Name
					<TextInput
						autofocus
						placeholder="Project name"
						fullWidth
						required
						value={name()}
						onInput={(e) => setName(e.currentTarget.value)}
					/>
				</label>
				<label {...stylex.attrs(styles.editorField)}>
					Description (optional)
					<TextInput
						fullWidth
						value={description()}
						onInput={(e) => setDescription(e.currentTarget.value)}
					/>
				</label>
				{props.project ? (
					<div {...stylex.attrs(styles.row)}>
						<span {...stylex.attrs(styles.listText)}>
							Repositories ({props.project.definition.repositories.length})
						</span>
						<Button
							size="xs"
							variant="text"
							aria-label="Manage repositories"
							onClick={() => setManagingRepositories(true)}
						>
							Manage
						</Button>
					</div>
				) : (
					<fieldset {...stylex.attrs(styles.repositoryChoices)}>
						<legend>Repositories</legend>
						<InlineDirectoryPicker
							autoFocus={false}
							onSelectionChange={setRepositories}
						/>
					</fieldset>
				)}
				<details
					open={Boolean(props.project?.definition.instructions)}
					{...stylex.attrs(styles.editorDetails)}
				>
					<summary {...stylex.attrs(styles.editorSummary)}>
						Project instructions
					</summary>
					<textarea
						aria-label="Project instructions"
						placeholder="Guidance for agents working in this project…"
						value={instructions()}
						onInput={(e) => setInstructions(e.currentTarget.value)}
						{...stylex.attrs(styles.notes)}
					/>
				</details>
				{props.project ? (
					<details
						{...stylex.attrs(styles.editorDetails)}
						onToggle={(event) => {
							if (!event.currentTarget.open) {
								setConfirmingArchive(false);
								setArchiveName("");
							}
						}}
					>
						<summary {...stylex.attrs(styles.editorSummary)}>
							Archive project
						</summary>
						<section
							aria-label="Archive project"
							{...stylex.attrs(styles.editorArchive)}
						>
							<p {...stylex.attrs(styles.muted)}>
								Remove this project from your tabs and stop its automations.
								Repository files, resources, and conversations are preserved.
							</p>
							{confirmingArchive() ? (
								<>
									<label {...stylex.attrs(styles.editorField)}>
										Type {props.project.definition.name} to confirm
										<TextInput
											fullWidth
											aria-label="Project name to confirm archive"
											value={archiveName()}
											onInput={(e) => setArchiveName(e.currentTarget.value)}
										/>
									</label>
									<div {...stylex.attrs(styles.row)}>
										<Button
											size="sm"
											variant="danger"
											disabled={
												projects.busy() ||
												archiveName() !== props.project.definition.name
											}
											onClick={() => {
												const project = props.project;
												if (
													!project ||
													archiveName() !== project.definition.name
												)
													return;
												void saveProjectCommand(
													editDefinition(project, {
														...project.definition!,
														archived: true,
													}),
												)
													.then(async () => {
														await selectProject("");
														props.close();
													})
													.catch(() => {});
											}}
										>
											Confirm archive
										</Button>
										<Button
											size="sm"
											disabled={projects.busy()}
											onClick={() => {
												setConfirmingArchive(false);
												setArchiveName("");
											}}
										>
											Keep project
										</Button>
									</div>
								</>
							) : (
								<Button
									size="sm"
									variant="danger"
									onClick={() => setConfirmingArchive(true)}
								>
									Archive project
								</Button>
							)}
						</section>
					</details>
				) : null}
				{projects.error() ? <p role="alert">{projects.error()}</p> : null}
				<div {...stylex.attrs(styles.editorActions)}>
					<Button
						size="sm"
						variant="text"
						disabled={projects.busy()}
						onClick={props.close}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						type="submit"
						variant="primary"
						disabled={projects.busy() || confirmingArchive() || !name().trim()}
					>
						{projects.busy()
							? "Saving…"
							: props.project
								? "Save changes"
								: "Create project"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
