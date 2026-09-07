import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
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
								disabled={_props.isSaving}
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
						<button
							type="button"
							onClick={_props.onStartEditing}
							{...stylex.attrs(styles.button)}
						>
							<IconPencil size={iconSize.sm} /> Edit skill
						</button>
					)}
			</div>
			<div {...stylex.attrs(styles.body)}>
				<div {...stylex.attrs(styles.identity)}>
					{editing() ? (
						<input
							aria-label="Skill name"
							value={_props.formName}
							disabled={_props.isSaving}
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
							disabled={_props.isSaving}
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
							disabled={_props.isSaving}
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
							<button
								type="button"
								disabled={_props.isSaving}
								onClick={_props.onDelete}
								{...stylex.attrs(styles.button, styles.deleteButton)}
							>
								<IconTrash size={iconSize.sm} /> Delete skill
							</button>
						)}
				</div>
				<div {...stylex.attrs(styles.actions)}>
					{editing() ? (
						<>
							<button
								type="button"
								disabled={_props.isSaving}
								onClick={_props.onCancelEditing}
								{...stylex.attrs(styles.button)}
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={_props.isSaving}
								onClick={() => _props.onSave(_props.isEditing)}
								{...stylex.attrs(
									surfaceStyles.panel,
									styles.button,
									styles.saveButton,
								)}
							>
								<IconCheck size={iconSize.sm} />{" "}
								{_props.isSaving
									? "Saving…"
									: _props.isCreatingNew
										? "Create skill"
										: "Save changes"}
							</button>
						</>
					) : null}
				</div>
			</footer>
		</div>
	);
}
