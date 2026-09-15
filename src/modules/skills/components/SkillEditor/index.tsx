import type { SkillEditorView } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import {
	IconCheck,
	IconCode,
	IconPencil,
	IconTrash,
} from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

const fitToContent = (element: HTMLTextAreaElement) => {
	element.style.height = "auto";
	element.style.height = `${element.scrollHeight}px`;
};
export function SkillEditor(props: {
	view: SkillEditorView;
	onFormChange: (field: string, value: string) => void;
	onStartEditing: () => void;
	onCancelEditing: () => void;
	onSave: () => void;
	onDelete: () => void;
}) {
	return (
		<div {...stylex.attrs(styles.root)}>
			<div {...stylex.attrs(styles.toolbar)}>
				<div {...stylex.attrs(styles.commandGroup)}>
					<div {...stylex.attrs(styles.command)}>
						<span aria-hidden="true">/</span>
						{props.view.editing ? (
							<input
								aria-label="Skill command"
								value={props.view.form.command}
								onInput={(event) =>
									props.onFormChange("command", event.currentTarget.value)
								}
								placeholder="skill-command"
								disabled={props.view.busy}
								{...stylex.attrs(
									styles.field,
									styles.fieldEditable,
									styles.commandInput,
								)}
							/>
						) : (
							<span>{props.view.form.command}</span>
						)}
					</div>
					<span {...stylex.attrs(styles.badge)}>{props.view.badge}</span>
				</div>
				{props.view.canEdit && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={props.onStartEditing}
						disabled={props.view.busy}
					>
						<IconPencil size={iconSize.md} />
						<span>Edit skill</span>
					</Button>
				)}
			</div>
			<div {...stylex.attrs(styles.body)}>
				<div {...stylex.attrs(styles.identity)}>
					{props.view.editing ? (
						<input
							aria-label="Skill name"
							value={props.view.form.name}
							disabled={props.view.busy}
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
							{props.view.form.name}
						</h2>
					)}
					{props.view.editing ? (
						<textarea
							ref={(element) =>
								requestAnimationFrame(() => fitToContent(element))
							}
							aria-label="Skill description"
							value={props.view.form.description}
							rows={1}
							disabled={props.view.busy}
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
							{props.view.form.description}
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
					{props.view.editing ? (
						<textarea
							aria-label="Skill instructions"
							value={props.view.form.promptTemplate}
							disabled={props.view.busy}
							onInput={(event) => {
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
							{props.view.form.promptTemplate}
						</pre>
					)}
				</section>
				{props.view.form.error && (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{props.view.form.error}
					</p>
				)}
			</div>
			<footer {...stylex.attrs(styles.footer)}>
				<div>
					{props.view.canDelete && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={props.view.busy}
							onClick={props.onDelete}
							class={stylex.attrs(styles.deleteButton).class}
						>
							<IconTrash size={iconSize.md} />
							<span>{props.view.deleting ? "Deleting…" : "Delete skill"}</span>
						</Button>
					)}
				</div>
				<div {...stylex.attrs(styles.actions)}>
					{props.view.editing ? (
						<>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={props.view.busy}
								onClick={props.onCancelEditing}
							>
								Cancel
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={props.view.busy}
								onClick={props.onSave}
							>
								<IconCheck size={iconSize.md} />
								<span>{props.view.saveLabel}</span>
							</Button>
						</>
					) : null}
				</div>
			</footer>
		</div>
	);
}
