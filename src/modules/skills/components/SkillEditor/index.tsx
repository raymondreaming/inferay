import type { Prompt } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import {
	IconCheck,
	IconCode,
	IconPencil,
	IconTrash,
} from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

interface SkillEditorProps {
	selectedSkill: Prompt | null;
	isCreatingNew: boolean;
	isEditing: boolean;
	isSaving: boolean;
	isDeleting: boolean;
	formCommand: string;
	formName: string;
	formDescription: string;
	formInstructions: string;
	formError: string;
	onFormChange: (field: string, value: string) => void;
	onStartEditing: () => void;
	onCancelEditing: () => void;
	onSave: (isInlineEdit: boolean) => void;
	onDelete: () => void;
}
export function SkillEditor(_props: SkillEditorProps) {
	const busy = () => _props.isSaving || _props.isDeleting;
	const editing = createMemo(() => _props.isCreatingNew || _props.isEditing);
	const instructions = createMemo(() =>
		editing()
			? _props.formInstructions
			: (_props.selectedSkill?.promptTemplate ?? ""),
	);
	const command = createMemo(() =>
		editing() ? _props.formCommand : (_props.selectedSkill?.command ?? ""),
	);
	return (
		<div {...stylex.attrs(styles.root)}>
			<div {...stylex.attrs(styles.toolbar)}>
				<div {...stylex.attrs(styles.commandGroup)}>
					<div {...stylex.attrs(styles.command)}>
						<span aria-hidden="true">/</span>
						{editing() ? (
							<input
								aria-label="Skill command"
								value={_props.formCommand}
								onInput={(event) =>
									_props.onFormChange(
										"command",
										event.currentTarget.value
											.toLowerCase()
											.replace(/[^a-z0-9-]/g, ""),
									)
								}
								placeholder="skill-command"
								disabled={busy()}
								{...stylex.attrs(styles.commandInput)}
							/>
						) : (
							<span>{command()}</span>
						)}
					</div>
					<span {...stylex.attrs(styles.badge)}>
						{_props.isCreatingNew
							? "Draft"
							: _props.selectedSkill?.isBuiltIn
								? "Built-in"
								: "Personal"}
					</span>
				</div>
				{!editing() &&
					_props.selectedSkill &&
					!_props.selectedSkill.isBuiltIn && (
						<Button
							liquid={false}
							type="button"
							variant="ghost"
							size="sm"
							onClick={_props.onStartEditing}
							disabled={busy()}
						>
							<IconPencil size={iconSize.md} />
							<span>Edit skill</span>
						</Button>
					)}
			</div>
			<div {...stylex.attrs(styles.body)}>
				<div {...stylex.attrs(styles.identity)}>
					{editing() ? (
						<input
							aria-label="Skill name"
							value={_props.formName}
							disabled={busy()}
							onInput={(event) =>
								_props.onFormChange("name", event.currentTarget.value)
							}
							placeholder="Give your skill a name"
							{...stylex.attrs(styles.title, styles.titleInput)}
						/>
					) : (
						<h2 {...stylex.attrs(styles.title)}>
							{_props.selectedSkill?.name}
						</h2>
					)}
					{editing() ? (
						<textarea
							aria-label="Skill description"
							value={_props.formDescription}
							rows={2}
							disabled={busy()}
							onInput={(event) =>
								_props.onFormChange("description", event.currentTarget.value)
							}
							placeholder="When should your agent use this skill?"
							{...stylex.attrs(styles.description, styles.descriptionInput)}
						/>
					) : (
						<p {...stylex.attrs(styles.description)}>
							{_props.selectedSkill?.description}
						</p>
					)}
				</div>
				<section
					aria-label="Workflow instructions"
					{...stylex.attrs(styles.document)}
				>
					<div {...stylex.attrs(styles.documentHeader)}>
						<span {...stylex.attrs(styles.documentTitle)}>
							<IconCode size={iconSize.md} /> Instructions
						</span>
						<span {...stylex.attrs(styles.meta)}>Markdown</span>
					</div>
					{editing() ? (
						<textarea
							aria-label="Skill instructions"
							value={instructions()}
							disabled={busy()}
							onInput={(event) =>
								_props.onFormChange("promptTemplate", event.currentTarget.value)
							}
							spellcheck={false}
							placeholder={
								"Describe the workflow your agent should follow.\n\nInclude the steps, important constraints, and what a good result looks like."
							}
							{...stylex.attrs(styles.instructions, styles.editor)}
						/>
					) : (
						<pre {...stylex.attrs(styles.instructions)}>{instructions()}</pre>
					)}
				</section>
				{_props.formError && (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{_props.formError}
					</p>
				)}
			</div>
			<footer {...stylex.attrs(styles.footer)}>
				<div>
					{_props.selectedSkill &&
						!_props.selectedSkill.isBuiltIn &&
						!_props.isCreatingNew && (
							<Button
								liquid={false}
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy()}
								onClick={_props.onDelete}
								class={stylex.attrs(styles.deleteButton).class}
							>
								<IconTrash size={iconSize.md} />
								<span>{_props.isDeleting ? "Deleting…" : "Delete skill"}</span>
							</Button>
						)}
				</div>
				<div {...stylex.attrs(styles.actions)}>
					{editing() ? (
						<>
							<Button
								liquid={false}
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy()}
								onClick={_props.onCancelEditing}
							>
								Cancel
							</Button>
							<Button
								liquid={false}
								type="button"
								variant="secondary"
								size="sm"
								disabled={busy()}
								onClick={() => _props.onSave(_props.isEditing)}
							>
								<IconCheck size={iconSize.md} />
								<span>
									{_props.isSaving
										? "Saving…"
										: _props.isCreatingNew
											? "Create skill"
											: "Save changes"}
								</span>
							</Button>
						</>
					) : null}
				</div>
			</footer>
		</div>
	);
}
