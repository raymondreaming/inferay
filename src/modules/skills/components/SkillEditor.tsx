import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	iconSize,
	radius,
	surfaceStyles,
} from "../../../design-system/styles.stylex.ts";
import {
	IconCheck,
	IconCode,
	IconPencil,
	IconTrash,
} from "../../../shared/ui/Icons.tsx";
import { SKILL_CATEGORIES, type Skill } from "../model/skill-library.ts";

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

const styles = stylex.create({
	root: {
		display: "flex",
		flex: 1,
		minHeight: 0,
		flexDirection: "column",
		overflow: "hidden",
	},
	toolbar: {
		display: "flex",
		minHeight: "58px",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._3,
		paddingInline: controlSize._4,
		paddingRight: controlSize._12,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
	},
	commandGroup: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._3,
		minWidth: 0,
	},
	command: {
		display: "flex",
		alignItems: "center",
		minWidth: 0,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		overflowWrap: "anywhere",
	},
	commandInput: {
		width: "min(13rem, 24vw)",
		minWidth: 0,
		padding: controlSize._1,
		backgroundColor: color.transparent,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		color: color.textMain,
		outline: "none",
		":focus-visible": { boxShadow: `0 1px 0 ${color.textSoft}` },
		"::placeholder": { color: color.textMuted },
	},
	badge: {
		fontSize: font.size_1,
		color: color.textSoft,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		paddingInline: controlSize._1_5,
		paddingBlock: controlSize._0_5,
	},
	body: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		flex: 1,
		minHeight: 0,
		overflowY: "auto",
		padding: {
			default: controlSize._6,
			"@media (max-width: 700px)": controlSize._4,
		},
	},
	identity: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		flexShrink: 0,
	},
	title: {
		margin: 0,
		width: "100%",
		color: color.textMain,
		fontSize: "20px",
		lineHeight: 1.3,
		fontWeight: font.weight_5,
		letterSpacing: "-0.035em",
		overflowWrap: "anywhere",
	},
	titleInput: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.transparent,
		outline: "none",
		padding: controlSize._2,
		":focus-visible": { boxShadow: `0 1px 0 ${color.borderStrong}` },
		"::placeholder": { color: color.textSoft },
	},
	description: {
		margin: 0,
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.6,
		overflowWrap: "anywhere",
	},
	descriptionInput: {
		width: "100%",
		padding: controlSize._2,
		resize: "vertical",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.transparent,
		outline: "none",
		minHeight: "42px",
		":focus-visible": { boxShadow: `0 1px 0 ${color.borderStrong}` },
		"::placeholder": { color: color.textMuted },
	},
	document: {
		display: "flex",
		flexDirection: "column",
		flex: "1 0 auto",
		minHeight: "280px",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.xl,
		overflow: "hidden",
		backgroundColor: color.background,
	},
	documentHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: controlSize._3,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.surfaceWhite02,
	},
	documentTitle: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	meta: {
		fontSize: font.size_1,
		color: color.textMuted,
		fontWeight: font.weightRegular,
	},
	instructions: {
		flex: 1,
		margin: 0,
		minHeight: "210px",
		width: "100%",
		padding: controlSize._4,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: 1.8,
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
	},
	editor: {
		resize: "vertical",
		borderWidth: 0,
		backgroundColor: color.transparent,
		color: color.textMain,
		outline: "none",
		":focus-visible": { boxShadow: `inset 0 0 0 1px ${color.borderStrong}` },
		"::placeholder": { color: color.textMuted },
	},
	details: {
		flexShrink: 0,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		paddingTop: controlSize._3,
	},
	detailsSummary: {
		cursor: "pointer",
		color: color.textSoft,
		fontSize: font.size_2,
	},
	fields: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._4,
		marginTop: controlSize._3,
	},
	field: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		color: color.textSoft,
		fontSize: font.size_2,
	},
	tagsField: { flex: 1, minWidth: "140px" },
	fieldValue: { color: color.textMain },
	input: {
		width: "100%",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundModal,
		color: color.textMain,
		padding: controlSize._2,
		outline: "none",
		":focus-visible": { borderColor: color.textSoft },
	},
	footer: {
		display: "flex",
		minHeight: "64px",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		flexWrap: "wrap",
		gap: controlSize._2,
		paddingBlock: controlSize._3,
		paddingInline: controlSize._6,
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
	},
	actions: { display: "flex", gap: controlSize._2 },
	button: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1_5,
		minHeight: controlSize._8,
		paddingInline: controlSize._3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.transparent,
		borderRadius: radius.lg,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		":disabled": { opacity: 0.5 },
		":focus-visible": { outline: `1px solid ${color.textSoft}` },
	},
	saveButton: {
		backgroundColor: {
			default: color.backgroundPanel,
			":hover": color.controlHover,
		},
		borderColor: color.borderControl,
		color: color.textMain,
		fontWeight: font.weight_5,
	},
	deleteButton: {
		borderColor: color.border,
		":hover": { color: color.danger },
	},
	error: { color: color.danger, fontSize: font.size_2 },
});
