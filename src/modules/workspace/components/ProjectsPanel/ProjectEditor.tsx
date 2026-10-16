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
	const [name, setName] = createSignal(props.project?.name ?? "");
	const [description, setDescription] = createSignal(
		props.project?.description ?? "",
	);
	const [instructions, setInstructions] = createSignal(
		props.project?.instructions ?? "",
	);
	const [repositories, setRepositories] = createSignal<string[]>([]);
	const [managingRepositories, setManagingRepositories] = createSignal(false);
	async function submitProject(event: SubmitEvent) {
		event.preventDefault();
		if (confirmingArchive()) return;
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
				expectedHash: existing?.file.sourceHash ?? null,
				definition: {
					schema: "inferay.project/1",
					id,
					name: name(),
					description: description(),
					instructions: instructions(),
					archived: false,
					repositories:
						existing?.repositories ??
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
			onClose={() => {
				if (!projects.busy()) props.close();
			}}
			class={stylex.attrs(styles.dialog).class}
		>
			<form
				onSubmit={(e) => void submitProject(e)}
				{...stylex.attrs(styles.form)}
			>
				<strong>{props.project ? "Edit project" : "Create a project"}</strong>
				<label>
					Name
					<TextInput
						fullWidth
						required
						value={name()}
						onInput={(e) => setName(e.currentTarget.value)}
					/>
				</label>
				<label>
					Description
					<TextInput
						fullWidth
						value={description()}
						onInput={(e) => setDescription(e.currentTarget.value)}
					/>
				</label>
				<label>
					Project instructions
					<textarea
						value={instructions()}
						onInput={(e) => setInstructions(e.currentTarget.value)}
						{...stylex.attrs(styles.notes)}
					/>
				</label>
				{props.project ? (
					<Button size="sm" onClick={() => setManagingRepositories(true)}>
						Manage repositories
					</Button>
				) : (
					<fieldset {...stylex.attrs(styles.repositoryChoices)}>
						<legend>Repositories</legend>
						<InlineDirectoryPicker
							stableHeight
							multiSelect
							showStartButton={false}
							onSelectionChange={setRepositories}
							onSelect={(path) => {
								if (path)
									setRepositories((current) => [
										...new Set([...current, path]),
									]);
							}}
						/>
					</fieldset>
				)}
				{projects.error() ? <p role="alert">{projects.error()}</p> : null}
				<div {...stylex.attrs(styles.row)}>
					<Button
						size="sm"
						type="submit"
						variant="primary"
						disabled={projects.busy() || confirmingArchive()}
					>
						{props.project ? "Save project" : "Create project"}
					</Button>
					<Button size="sm" onClick={props.close}>
						Cancel
					</Button>
				</div>
				{props.project ? (
					<section aria-label="Archive project" {...stylex.attrs(styles.card)}>
						<strong>Archive project</strong>
						<p {...stylex.attrs(styles.muted)}>
							Remove this project from your tabs and stop its automations.
							Repository files, resources, and conversations are preserved.
						</p>
						{confirmingArchive() ? (
							<>
								<label>
									Type {props.project.name} to confirm
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
											projects.busy() || archiveName() !== props.project.name
										}
										onClick={() => {
											const project = props.project;
											if (!project || archiveName() !== project.name) return;
											void saveProjectCommand(
												editDefinition(project.file, {
													...project.file.definition!,
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
				) : null}
			</form>
		</Modal>
	);
}
