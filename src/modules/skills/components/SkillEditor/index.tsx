import type { Prompt } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import {
	IconCheck,
	IconCode,
	IconPencil,
	IconTrash,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { styles } from "./styles.ts";

const fitToContent = (element: HTMLTextAreaElement) => {
	element.style.height = "auto";
	element.style.height = `${element.scrollHeight}px`;
};
export function SkillEditor(props: {
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
}) {
	const busy = () => props.isSaving || props.isDeleting;
	const editing = createMemo(() => props.isCreatingNew || props.isEditing);
	const instructions = createMemo(() =>
		editing()
			? props.formInstructions
			: (props.selectedSkill?.promptTemplate ?? ""),
	);
	const command = createMemo(() =>
		editing() ? props.formCommand : (props.selectedSkill?.command ?? ""),
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
								value={props.formCommand}
								onInput={(event) =>
									props.onFormChange(
										"command",
										event.currentTarget.value
											.toLowerCase()
											.replace(/[^a-z0-9-]/g, ""),
									)
								}
								placeholder="skill-command"
								disabled={busy()}
								{...stylex.attrs(
									styles.field,
									styles.fieldEditable,
									styles.commandInput,
								)}
							/>
						) : (
							<span>{command()}</span>
						)}
					</div>
					<span {...stylex.attrs(styles.badge)}>
						{props.isCreatingNew
							? "Draft"
							: props.selectedSkill?.isBuiltIn
								? "Built-in"
								: "Personal"}
					</span>
				</div>
				{!editing() &&
					props.selectedSkill &&
					!props.selectedSkill.isBuiltIn && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={props.onStartEditing}
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
							value={props.formName}
							disabled={busy()}
							onInput={(event) =>
								props.onFormChange("name", event.currentTarget.value)
							}
							placeholder="Give your skill a name"
							{...stylex.attrs(
								styles.field,
								styles.fieldEditable,
								styles.title,
							)}
						/>
					) : (
						<h2 {...stylex.attrs(styles.field, styles.title)}>
							{props.selectedSkill?.name}
						</h2>
					)}
					{editing() ? (
						<textarea
							ref={(element) =>
								requestAnimationFrame(() => fitToContent(element))
							}
							aria-label="Skill description"
							value={props.formDescription}
							rows={1}
							disabled={busy()}
							onInput={(event) => {
								fitToContent(event.currentTarget);
								props.onFormChange("description", event.currentTarget.value);
							}}
							placeholder="When should your agent use this skill?"
							{...stylex.attrs(
								styles.field,
								styles.fieldEditable,
								styles.description,
							)}
						/>
					) : (
						<p {...stylex.attrs(styles.field, styles.description)}>
							{props.selectedSkill?.description}
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
							ref={(element) =>
								requestAnimationFrame(() => fitToContent(element))
							}
							aria-label="Skill instructions"
							value={instructions()}
							disabled={busy()}
							onInput={(event) => {
								fitToContent(event.currentTarget);
								props.onFormChange("promptTemplate", event.currentTarget.value);
							}}
							spellcheck={false}
							placeholder={
								"Describe the workflow your agent should follow.\n\nInclude the steps, important constraints, and what a good result looks like."
							}
							{...stylex.attrs(
								styles.field,
								styles.fieldEditable,
								styles.instructions,
							)}
						/>
					) : (
						<pre {...stylex.attrs(styles.field, styles.instructions)}>
							{instructions()}
						</pre>
					)}
				</section>
				{props.formError && (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{props.formError}
					</p>
				)}
			</div>
			<footer {...stylex.attrs(styles.footer)}>
				<div>
					{props.selectedSkill &&
						!props.selectedSkill.isBuiltIn &&
						!props.isCreatingNew && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy()}
								onClick={props.onDelete}
								class={stylex.attrs(styles.deleteButton).class}
							>
								<IconTrash size={iconSize.md} />
								<span>{props.isDeleting ? "Deleting…" : "Delete skill"}</span>
							</Button>
						)}
				</div>
				<div {...stylex.attrs(styles.actions)}>
					{editing() ? (
						<>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy()}
								onClick={props.onCancelEditing}
							>
								Cancel
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={busy()}
								onClick={() => props.onSave(props.isEditing)}
							>
								<IconCheck size={iconSize.md} />
								<span>
									{props.isSaving
										? "Saving…"
										: props.isCreatingNew
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
