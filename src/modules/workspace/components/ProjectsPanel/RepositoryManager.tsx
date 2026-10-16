import { Button } from "@shared/ui/Button/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import { projects, saveProjectCommand } from "../../hooks/useProjects.tsx";
import type { Project } from "../../model/projectFiles.ts";
import { InlineDirectoryPicker } from "../InlineDirectoryPicker/index.tsx";
import { AutomationEditor } from "./AutomationEditor.tsx";
import { styles } from "./styles.ts";

export function RepositoryManager(props: {
	project: Project;
	close: () => void;
}) {
	const [editingAutomation, setEditingAutomation] = createSignal<string | null>(
		null,
	);
	const automation = () =>
		projects.catalog()?.automations.find((a) => a.id === editingAutomation());
	const [relinking, setRelinking] = createSignal<string | null>(null);
	const saving = projects.busy;
	const [status, setStatus] = createSignal("");
	const [error, setError] = createSignal("");
	const bindings = () => {
		const all = projects.catalog()?.repositoryBindings ?? {};
		return Object.fromEntries(
			props.project.repositories.flatMap((r) =>
				all[r.id] ? [[r.id, all[r.id]!]] : [],
			),
		);
	};
	const usedBy = (id: string) =>
		(projects.catalog()?.automations ?? []).filter((a) => {
			const execution = a.execution;
			return (
				execution.kind === "agent" &&
				(execution.repositories.includes(id) ||
					(execution.workingDirectory.base === "repository" &&
						execution.workingDirectory.id === id))
			);
		});
	const save = async (
		repositories: Project["repositories"],
		paths: Record<string, string>,
		message: string,
	) => {
		if (saving()) return;
		setStatus("Saving…");
		setError("");
		const current = props.project;
		try {
			await saveProjectCommand({
				type: "saveProject",
				definition: { ...current.file.definition!, repositories },
				expectedHash: current.file.sourceHash,
				repositoryPaths: paths,
			});
			setStatus(message);
			return true;
		} catch (e) {
			setStatus("");
			setError(e instanceof Error ? e.message : String(e));
			return false;
		}
	};
	const add = (path: string | null) => {
		if (!path || saving()) return;
		const target = relinking();
		if (target) {
			void save(
				props.project.repositories,
				{ [target]: path },
				"Folder updated",
			).then((saved) => {
				if (saved) setRelinking(null);
			});
			return;
		}
		if (Object.values(bindings()).includes(path)) return;
		const id = crypto.randomUUID();
		const name = path.split("/").filter(Boolean).at(-1) ?? "Repository";
		const repositories = props.project.repositories;
		void save(
			repositories.some((r) => r.id === id)
				? repositories
				: [...repositories, { id, name, remote: null }],
			{ [id]: path },
			`Added ${name}`,
		);
	};
	return (
		<Modal
			label="Manage repositories"
			closeDisabled={saving()}
			onClose={() =>
				editingAutomation() ? setEditingAutomation(null) : props.close()
			}
			class={
				stylex.attrs(
					editingAutomation() ? styles.dialog : styles.repositoryDialog,
				).class
			}
		>
			{automation() ? (
				<AutomationEditor
					automation={automation()!}
					projectId={props.project.id}
					resources={projects.catalog()?.resources ?? []}
					save={async (command) => {
						await saveProjectCommand(command);
					}}
					close={() => setEditingAutomation(null)}
					busy={projects.busy()}
				/>
			) : (
				<div {...stylex.attrs(styles.repositoryManager)}>
					<strong>Manage repositories</strong>
					{props.project.repositories.length > 0 ? (
						<div {...stylex.attrs(styles.repositoryChoiceList)}>
							<For each={props.project.repositories} keyed={(r) => r.id}>
								{(repository) => (
									<div {...stylex.attrs(styles.row)}>
										<span {...stylex.attrs(styles.listText)}>
											<strong>{repository().name}</strong>
											<span {...stylex.attrs(styles.muted)}>
												{bindings()[repository().id] ??
													"Folder not linked on this computer"}
											</span>
											{usedBy(repository().id).length ? (
												<span {...stylex.attrs(styles.muted)}>
													<For
														each={usedBy(repository().id)}
														keyed={(a) => a.id}
													>
														{(a) => (
															<Button
																size="sm"
																variant="ghost"
																onClick={() => setEditingAutomation(a().id)}
															>
																{a().name} ↗
															</Button>
														)}
													</For>
												</span>
											) : null}
										</span>
										<Button
											size="sm"
											variant="ghost"
											disabled={saving()}
											onClick={() => setRelinking(repository().id)}
										>
											Change folder
										</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={saving() || usedBy(repository().id).length > 0}
											aria-label={`Remove ${repository().name} from project`}
											title={
												usedBy(repository().id).length
													? "Remove this repository from its automations first"
													: "Unlink from this project; files stay on disk"
											}
											onClick={() =>
												void save(
													props.project.repositories.filter(
														(r) => r.id !== repository().id,
													),
													{},
													`Removed ${repository().name}`,
												)
											}
										>
											Remove
										</Button>
									</div>
								)}
							</For>
						</div>
					) : null}
					<fieldset
						disabled={saving()}
						{...stylex.attrs(styles.repositoryChoices)}
					>
						<legend>
							{relinking()
								? `Folder for ${props.project.repositories.find((r) => r.id === relinking())?.name}`
								: "Add repository"}
						</legend>
						{relinking() ? (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setRelinking(null)}
							>
								Cancel
							</Button>
						) : null}
						<InlineDirectoryPicker
							stableHeight
							excludePaths={relinking() ? [] : Object.values(bindings())}
							onSelect={add}
						/>
					</fieldset>
					<div {...stylex.attrs(styles.repositoryManagerActions)}>
						<span
							role={error() ? "alert" : "status"}
							{...stylex.attrs(styles.repositoryError)}
						>
							{error() || status()}
						</span>
					</div>
				</div>
			)}
		</Modal>
	);
}
