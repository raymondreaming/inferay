import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { TextInput } from "@shared/ui/TextInput/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import {
	projects,
	saveProjectCommand,
	selectProject,
} from "../../hooks/useProjects.tsx";
import { editDefinition, type Project } from "../../model/projectFiles.ts";
import { InlineDirectoryPicker } from "../InlineDirectoryPicker/index.tsx";
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
	const initialRepositories = props.project
		? (projects.catalog()?.repositoryPaths ?? [])
		: [];
	const [repositories, setRepositories] = createSignal(initialRepositories);
	const [findingRepositories, setFindingRepositories] = createSignal(false);
	const [addedFolders, setAddedFolders] = createSignal<string[]>([]);
	const choices = () => [
		...new Set([...initialRepositories, ...addedFolders()]),
	];
	async function submitProject(event: SubmitEvent) {
		event.preventDefault();
		if (confirmingArchive()) return;
		try {
			const existing = props.project;
			const id = existing?.id ?? crypto.randomUUID();
			const bindings = projects.catalog()?.repositoryBindings ?? {};
			const selectedRepositories = repositories().map((path) => ({
				path,
				repository: existing?.repositories.find(
					(repo) => bindings[repo.id] === path,
				) ?? {
					id: crypto.randomUUID(),
					name: path.split("/").filter(Boolean).at(-1) ?? "Repository",
					remote: null,
				},
			}));
			const saved = await saveProjectCommand({
				type: "saveDefinition",
				projectId: id,
				path: "project.json",
				expectedHash: existing?.file.sourceHash ?? null,
				content: JSON.stringify(
					{
						schema: "inferay.project/1",
						id,
						name: name(),
						description: description(),
						instructions: instructions(),
						archived: false,
						repositories: [
							...selectedRepositories.map((item) => item.repository),
							...(existing?.repositories.filter((repo) => !bindings[repo.id]) ??
								[]),
						],
					},
					null,
					2,
				),
			});
			if (!saved.sourceHash)
				throw new Error("Project save did not return a file hash");
			for (const { path, repository } of selectedRepositories) {
				await saveProjectCommand({
					type: "linkRepository",
					projectId: id,
					repositoryId: repository.id,
					expectedProjectHash: saved.sourceHash,
					path,
				});
			}
			await selectProject(id);
			props.close();
		} catch {}
	}
	return (
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
				<p {...stylex.attrs(styles.muted)}>
					A business, brand, idea, or codebase. Repositories are optional.
				</p>
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
				<fieldset {...stylex.attrs(styles.repositoryChoices)}>
					<legend>Repositories</legend>
					<p {...stylex.attrs(styles.muted)}>
						Choose the repositories that belong to this project. Chats start in
						the project folder and can work across these repositories. Files
						stay where they are.
					</p>
					{props.project ? (
						<div {...stylex.attrs(styles.repositoryChoiceList)}>
							<For each={choices()} keyed={(item) => item}>
								{(path) => (
									<label {...stylex.attrs(styles.row)}>
										<input
											type="checkbox"
											checked={repositories().includes(path())}
											onChange={(event) =>
												setRepositories((current) =>
													event.currentTarget.checked
														? [...current, path()]
														: current.filter((p) => p !== path()),
												)
											}
										/>
										<span {...stylex.attrs(styles.listText)}>
											<strong>
												{path().split("/").filter(Boolean).at(-1)}
											</strong>
											<span {...stylex.attrs(styles.muted)}>{path()}</span>
										</span>
									</label>
								)}
							</For>
						</div>
					) : null}
					{!props.project ? (
						<InlineDirectoryPicker
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
					) : findingRepositories() ? (
						<InlineDirectoryPicker
							multiSelect
							onSelect={(path) => {
								if (path) {
									setAddedFolders((current) => [
										...new Set([...current, path]),
									]);
									setRepositories((current) => [
										...new Set([...current, path]),
									]);
								}
								setFindingRepositories(false);
							}}
							onMultiSelect={(paths) => {
								setAddedFolders((current) => [
									...new Set([...current, ...paths]),
								]);
								setRepositories((current) => [
									...new Set([...current, ...paths]),
								]);
								setFindingRepositories(false);
							}}
							onCancel={() => setFindingRepositories(false)}
						/>
					) : (
						<Button size="sm" onClick={() => setFindingRepositories(true)}>
							Find repositories on this computer
						</Button>
					)}
				</fieldset>
				{projects.error() ? <p role="alert">{projects.error()}</p> : null}
				<div {...stylex.attrs(styles.row)}>
					<Button
						size="sm"
						type="submit"
						variant="primary"
						disabled={projects.busy() || confirmingArchive()}
					>
						Save project
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
