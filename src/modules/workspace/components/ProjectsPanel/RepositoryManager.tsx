import type { RepositoryChange } from "@contracts";
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
		projects
			.catalog()
			?.automations.find((a) => a.file.definition.id === editingAutomation());
	const [relinking, setRelinking] = createSignal<string | null>(null);
	const saving = projects.busy;
	const [status, setStatus] = createSignal("");
	const [error, setError] = createSignal("");
	const bindings = () => {
		const all = projects.catalog()?.repositoryBindings ?? {};
		return Object.fromEntries(
			props.project.definition.repositories.flatMap((r) =>
				all[r.id] ? [[r.id, all[r.id]!]] : [],
			),
		);
	};
	const usedBy = (id: string) => projects.catalog()?.repositoryUsers[id] ?? [];
	const save = async (change: RepositoryChange, message: string) => {
		if (saving()) return;
		setStatus("Saving…");
		setError("");
		try {
			await saveProjectCommand({
				type: "editRepository",
				projectId: props.project.id,
				expectedHash: props.project.sourceHash!,
				change,
			});
			setStatus(message);
			setRelinking(null);
		} catch (e) {
			setStatus("");
			setError(String(e));
		}
	};
	const add = (path: string | null) => {
		if (path)
			void save(
				relinking()
					? { kind: "relink", id: relinking()!, path }
					: { kind: "add", path },
				relinking() ? "Folder updated" : "Repository added",
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
					save={async (command) => {
						await saveProjectCommand(command);
					}}
					close={() => setEditingAutomation(null)}
					busy={projects.busy()}
				/>
			) : (
				<div {...stylex.attrs(styles.repositoryManager)}>
					<strong>Manage repositories</strong>
					{props.project.definition.repositories.length > 0 ? (
						<div {...stylex.attrs(styles.repositoryChoiceList)}>
							<For
								each={props.project.definition.repositories}
								keyed={(r) => r.id}
							>
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
														keyed={(a) => a.automationId ?? a.name}
													>
														{(a) => (
															<Button
																size="sm"
																variant="ghost"
																disabled={!a().automationId}
																onClick={() =>
																	setEditingAutomation(a().automationId)
																}
															>
																{a().name}
																{a().automationId ? " ↗" : " · Tool"}
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
													? "Remove this repository from its automations and tools first"
													: "Unlink from this project; files stay on disk"
											}
											onClick={() =>
												void save(
													{ kind: "remove", id: repository().id },
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
								? `Folder for ${props.project.definition.repositories.find((r) => r.id === relinking())?.name}`
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
