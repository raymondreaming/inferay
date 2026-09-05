import * as stylex from "@octanejs/stylex";
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
import { SKILL_CATEGORIES, type Skill } from "../../model/skill-library.ts";
import { styles } from "./styles.ts";

interface SkillEditorProps {
	selectedSkill: Skill | null;
	isCreatingNew: boolean;
	isEditing: boolean;
	isSaving: boolean;
	formCommand: string;
	formName: string;
	formDescription: string;
	formInstructions: string;
	formCategory: string;
	formTags: string;
	formError: string;
	onFormChange: (field: string, value: string) => void;
	onStartEditing: () => void;
	onCancelEditing: () => void;
	onSave: (isInlineEdit: boolean) => void;
	onDelete: () => void;
}

export function SkillEditor({
	selectedSkill,
	isCreatingNew,
	isEditing,
	isSaving,
	formCommand,
	formName,
	formDescription,
	formInstructions,
	formCategory,
	formTags,
	formError,
	onFormChange,
	onStartEditing,
	onCancelEditing,
	onSave,
	onDelete,
}: SkillEditorProps) {
	const editing = isCreatingNew || isEditing;
	const instructions = editing
		? formInstructions
		: (selectedSkill?.promptTemplate ?? "");
	const command = editing ? formCommand : (selectedSkill?.command ?? "");
	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.toolbar)}>
				<div {...stylex.props(styles.commandGroup)}>
					<div {...stylex.props(styles.command)}>
						<span aria-hidden="true">/</span>
						{editing ? (
							<input
								aria-label="Skill command"
								value={formCommand}
								onInput={(event) =>
									onFormChange(
										"command",
										event.currentTarget.value
											.toLowerCase()
											.replace(/[^a-z0-9-]/g, ""),
									)
								}
								placeholder="skill-command"
								disabled={isSaving}
								{...stylex.props(styles.commandInput)}
							/>
						) : (
							<span>{command}</span>
						)}
					</div>
					<span {...stylex.props(styles.badge)}>
						{isCreatingNew
							? "Draft"
							: selectedSkill?.isBuiltIn
								? "Built-in"
								: "Personal"}
					</span>
				</div>
				{!editing && selectedSkill && !selectedSkill.isBuiltIn && (
					<button
						type="button"
						onClick={onStartEditing}
						{...stylex.props(styles.button)}
					>
						<IconPencil size={iconSize.sm} /> Edit skill
					</button>
				)}
			</div>
			<div {...stylex.props(styles.body)}>
				<div {...stylex.props(styles.identity)}>
					{editing ? (
						<input
							aria-label="Skill name"
							value={formName}
							disabled={isSaving}
							onInput={(event) =>
								onFormChange("name", event.currentTarget.value)
							}
							placeholder="Give your skill a name"
							{...stylex.props(styles.title, styles.titleInput)}
						/>
					) : (
						<h2 {...stylex.props(styles.title)}>{selectedSkill?.name}</h2>
					)}
					{editing ? (
						<textarea
							aria-label="Skill description"
							value={formDescription}
							rows={2}
							disabled={isSaving}
							onInput={(event) =>
								onFormChange("description", event.currentTarget.value)
							}
							placeholder="When should your agent use this skill?"
							{...stylex.props(styles.description, styles.descriptionInput)}
						/>
					) : (
						<p {...stylex.props(styles.description)}>
							{selectedSkill?.description}
						</p>
					)}
				</div>
				<section
					aria-label="Workflow instructions"
					{...stylex.props(styles.document)}
				>
					<div {...stylex.props(styles.documentHeader)}>
						<span {...stylex.props(styles.documentTitle)}>
							<IconCode size={iconSize.md} /> Instructions
						</span>
						<span {...stylex.props(styles.meta)}>Markdown</span>
					</div>
					{editing ? (
						<textarea
							aria-label="Skill instructions"
							value={instructions}
							disabled={isSaving}
							onInput={(event) =>
								onFormChange("promptTemplate", event.currentTarget.value)
							}
							spellCheck={false}
							placeholder={
								"Describe the workflow your agent should follow.\n\nInclude the steps, important constraints, and what a good result looks like."
							}
							{...stylex.props(styles.instructions, styles.editor)}
						/>
					) : (
						<pre {...stylex.props(styles.instructions)}>{instructions}</pre>
					)}
				</section>
				<details
					key={selectedSkill?._id ?? "new"}
					{...stylex.props(styles.details)}
				>
					<summary {...stylex.props(styles.detailsSummary)}>
						Category & tags
					</summary>
					<div {...stylex.props(styles.fields)}>
						<div {...stylex.props(styles.field)}>
							Category
							{editing ? (
								<select
									aria-label="Skill category"
									value={formCategory}
									disabled={isSaving}
									onChange={(event) =>
										onFormChange("category", event.currentTarget.value)
									}
									{...stylex.props(styles.input)}
								>
									{SKILL_CATEGORIES.map((category) => (
										<option key={category.value} value={category.value}>
											{category.label}
										</option>
									))}
								</select>
							) : (
								<span {...stylex.props(styles.fieldValue)}>
									{selectedSkill?.category || "Custom"}
								</span>
							)}
						</div>
						<div {...stylex.props(styles.field, styles.tagsField)}>
							Tags
							{editing ? (
								<input
									aria-label="Skill tags"
									value={formTags}
									disabled={isSaving}
									onInput={(event) =>
										onFormChange("tags", event.currentTarget.value)
									}
									placeholder="e.g. writing, review"
									{...stylex.props(styles.input)}
								/>
							) : (
								<span {...stylex.props(styles.fieldValue)}>
									{selectedSkill?.tags.join(" · ") || "No tags"}
								</span>
							)}
						</div>
					</div>
				</details>
				{formError && (
					<p role="alert" {...stylex.props(styles.error)}>
						{formError}
					</p>
				)}
			</div>
			<footer {...stylex.props(styles.footer)}>
				<div>
					{selectedSkill && !selectedSkill.isBuiltIn && !isCreatingNew && (
						<button
							type="button"
							disabled={isSaving}
							onClick={onDelete}
							{...stylex.props(styles.button, styles.deleteButton)}
						>
							<IconTrash size={iconSize.sm} /> Delete skill
						</button>
					)}
				</div>
				<div {...stylex.props(styles.actions)}>
					{editing ? (
						<>
							<button
								type="button"
								disabled={isSaving}
								onClick={onCancelEditing}
								{...stylex.props(styles.button)}
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={isSaving}
								onClick={() => onSave(isEditing)}
								{...stylex.props(
									surfaceStyles.panel,
									styles.button,
									styles.saveButton,
								)}
							>
								<IconCheck size={iconSize.sm} />{" "}
								{isSaving
									? "Saving…"
									: isCreatingNew
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
