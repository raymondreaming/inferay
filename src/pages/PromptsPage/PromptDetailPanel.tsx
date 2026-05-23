import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { IconPencil, IconTrash, IconX } from "../../components/ui/Icons.tsx";
import { measureTextHeight } from "../../lib/pretext-utils.ts";
import { setInputValue } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	font,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import {
	PROMPT_CATEGORIES,
	type Prompt,
} from "../../features/prompts/types.ts";

interface PromptDetailPanelProps {
	selectedPrompt: Prompt | null;
	isCreatingNew: boolean;
	isEditing: boolean;
	isSaving: boolean;
	formCommand: string;
	formName: string;
	formDescription: string;
	formPromptTemplate: string;
	formCategory: string;
	formTags: string;
	formError: string;
	onFormChange: (field: string, value: string) => void;
	onStartEditing: () => void;
	onCancelEditing: () => void;
	onSave: (isInlineEdit: boolean) => void;
	onDelete: () => void;
	onClose: () => void;
}

const MONO_FONT = '11px "Geist Mono", "SF Mono", Menlo, Consolas, monospace';

function AutoTextarea({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const ta = ref.current;
		if (!ta) return;
		const width = ta.clientWidth - 24;
		if (width > 0 && value) {
			const h = measureTextHeight(value, width, MONO_FONT, 18);
			ta.style.height = `${Math.min(Math.max(h + 24, 100), 300)}px`;
		} else {
			ta.style.height = "100px";
		}
	}, [value]);

	return (
		<textarea
			ref={ref}
			value={value}
			onChange={setInputValue.bind(null, onChange)}
			placeholder={placeholder}
			{...stylex.props(styles.templateTextarea)}
			style={{ minHeight: 100, maxHeight: 300 }}
		/>
	);
}

export function PromptDetailPanel({
	selectedPrompt,
	isCreatingNew,
	isEditing,
	isSaving,
	formCommand,
	formName,
	formDescription,
	formPromptTemplate,
	formCategory,
	formTags,
	formError,
	onFormChange,
	onStartEditing,
	onCancelEditing,
	onSave,
	onDelete,
	onClose,
}: PromptDetailPanelProps) {
	const isEditMode = isCreatingNew || isEditing;

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.header)}>
				<div {...stylex.props(styles.headerTitleRow)}>
					{isEditMode ? (
						<div {...stylex.props(styles.commandEditor)}>
							<span {...stylex.props(styles.commandSlash)}>/</span>
							<input
								type="text"
								value={formCommand}
								onChange={(e) =>
									onFormChange(
										"command",
										e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
									)
								}
								placeholder="command"
								{...stylex.props(styles.commandInput)}
							/>
						</div>
					) : selectedPrompt ? (
						<span {...stylex.props(styles.commandText)}>
							/{selectedPrompt.command}
						</span>
					) : null}
					{selectedPrompt?.isBuiltIn && !isCreatingNew && (
						<span {...stylex.props(styles.badge)}>built-in</span>
					)}
					{isCreatingNew && (
						<span {...stylex.props(styles.badge, styles.badgeStrong)}>new</span>
					)}
				</div>
				<div {...stylex.props(styles.headerActions)}>
					{isCreatingNew ? (
						<>
							<button
								type="button"
								onClick={onCancelEditing}
								{...stylex.props(styles.textButton)}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => onSave(false)}
								disabled={isSaving}
								{...stylex.props(styles.textButton, styles.primaryButton)}
							>
								{isSaving ? "..." : "Create"}
							</button>
						</>
					) : isEditing ? (
						<>
							<button
								type="button"
								onClick={onCancelEditing}
								{...stylex.props(styles.textButton)}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => onSave(true)}
								disabled={isSaving}
								{...stylex.props(styles.textButton, styles.primaryButton)}
							>
								{isSaving ? "..." : "Save"}
							</button>
						</>
					) : (
						<>
							{selectedPrompt && !selectedPrompt.isBuiltIn && (
								<button
									type="button"
									onClick={onStartEditing}
									{...stylex.props(styles.iconButton)}
								>
									<IconPencil size={12} />
								</button>
							)}
							{selectedPrompt && !selectedPrompt.isBuiltIn && (
								<button
									type="button"
									onClick={onDelete}
									{...stylex.props(styles.iconButton)}
								>
									<IconTrash size={12} />
								</button>
							)}
						</>
					)}
					<button
						type="button"
						onClick={onClose}
						{...stylex.props(styles.iconButton)}
					>
						<IconX size={12} />
					</button>
				</div>
			</div>

			<div {...stylex.props(styles.body)}>
				<div {...stylex.props(styles.formGrid)}>
					<div {...stylex.props(styles.flexField)}>
						<span {...stylex.props(styles.label)}>Name</span>
						{isEditMode ? (
							<input
								type="text"
								value={formName}
								onChange={(e) => onFormChange("name", e.target.value)}
								placeholder="Prompt name"
								{...stylex.props(styles.input)}
							/>
						) : (
							<p {...stylex.props(styles.readValue)}>{selectedPrompt?.name}</p>
						)}
					</div>
					<div {...stylex.props(styles.categoryField)}>
						<span {...stylex.props(styles.label)}>Category</span>
						{isEditMode ? (
							<select
								value={formCategory}
								onChange={(e) => onFormChange("category", e.target.value)}
								{...stylex.props(styles.input)}
							>
								{PROMPT_CATEGORIES.map((c) => (
									<option key={c.value} value={c.value}>
										{c.label}
									</option>
								))}
							</select>
						) : (
							<p {...stylex.props(styles.readValue, styles.readValueSoft)}>
								{selectedPrompt?.category}
							</p>
						)}
					</div>
				</div>

				<div>
					<span {...stylex.props(styles.label)}>Description</span>
					{isEditMode ? (
						<textarea
							value={formDescription}
							onChange={(e) => onFormChange("description", e.target.value)}
							rows={2}
							placeholder="What this prompt does"
							{...stylex.props(styles.input, styles.descriptionInput)}
						/>
					) : (
						<p {...stylex.props(styles.readDescription)}>
							{selectedPrompt?.description}
						</p>
					)}
				</div>

				<div>
					<span {...stylex.props(styles.label)}>
						Template
						{isEditMode && (
							<span {...stylex.props(styles.labelHint)}>
								use {"{args}"} for input
							</span>
						)}
					</span>
					{isEditMode ? (
						<AutoTextarea
							value={formPromptTemplate}
							onChange={(v) => onFormChange("promptTemplate", v)}
							placeholder="Enter prompt template..."
						/>
					) : (
						<div {...stylex.props(styles.templatePreview)}>
							{selectedPrompt?.promptTemplate}
						</div>
					)}
				</div>

				<div>
					<span {...stylex.props(styles.label)}>Tags</span>
					{isEditMode ? (
						<input
							type="text"
							value={formTags}
							onChange={(e) => onFormChange("tags", e.target.value)}
							placeholder="code, review, quality"
							{...stylex.props(styles.input)}
						/>
					) : selectedPrompt && selectedPrompt.tags.length > 0 ? (
						<div {...stylex.props(styles.tagList)}>
							{selectedPrompt.tags.map((tag) => (
								<span key={tag} {...stylex.props(styles.tag)}>
									{tag}
								</span>
							))}
						</div>
					) : (
						<p {...stylex.props(styles.emptyText)}>No tags</p>
					)}
				</div>

				{!isEditMode && selectedPrompt && (
					<p {...stylex.props(styles.usageText)}>
						{selectedPrompt.executionCount} uses
					</p>
				)}

				{formError && <p {...stylex.props(styles.errorText)}>{formError}</p>}
			</div>
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		overflow: "hidden",
		backgroundColor: color.background,
	},
	header: {
		display: "flex",
		height: controlSize._10,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._4,
	},
	headerTitleRow: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		minWidth: 0,
	},
	headerActions: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
	},
	commandEditor: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._0_5,
	},
	commandSlash: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	commandInput: {
		width: "6rem",
		borderWidth: 0,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		outline: shadow.none,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1_5,
		":focus": {
			boxShadow: `inset 0 0 0 1px ${color.textMuted}`,
		},
		"::placeholder": {
			color: color.textMuted,
		},
	},
	commandText: {
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	badge: {
		borderRadius: radius.sm,
		backgroundColor: color.surfaceSubtle,
		color: color.textMuted,
		fontSize: font.size_0,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
		opacity: 0.7,
	},
	badgeStrong: {
		backgroundColor: color.surfaceControl,
		opacity: 1,
	},
	textButton: {
		height: controlSize._6,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
		color: color.textMuted,
		fontSize: font.size_2,
		paddingInline: controlSize._2,
	},
	primaryButton: {
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		color: color.textMain,
	},
	iconButton: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceSubtle,
		},
		color: color.textMuted,
	},
	body: {
		flex: 1,
		overflowY: "auto",
		padding: controlSize._4,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
	},
	formGrid: {
		display: "flex",
		gap: controlSize._3,
	},
	flexField: {
		flex: 1,
		minWidth: 0,
	},
	categoryField: {
		width: "7rem",
	},
	label: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	labelHint: {
		marginLeft: controlSize._1,
		color: color.textMuted,
		fontWeight: 400,
		opacity: 0.55,
		textTransform: "none",
	},
	input: {
		width: "100%",
		marginTop: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.textMuted,
		},
		borderRadius: radius.md,
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_2,
		outline: "none",
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	descriptionInput: {
		resize: "none",
	},
	templateTextarea: {
		width: "100%",
		marginTop: controlSize._1,
		resize: "none",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.textMuted,
		},
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: "18px",
		outline: "none",
		padding: controlSize._3,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	readValue: {
		marginTop: controlSize._1,
		color: color.textMain,
		fontSize: font.size_2,
	},
	readValueSoft: {
		color: color.textSoft,
	},
	readDescription: {
		marginTop: controlSize._1,
		color: color.textSoft,
		fontSize: font.size_2,
		lineHeight: 1.6,
	},
	templatePreview: {
		maxHeight: "300px",
		marginTop: controlSize._1,
		overflowY: "auto",
		whiteSpace: "pre-wrap",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: "18px",
		padding: controlSize._3,
	},
	tagList: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._1,
		marginTop: controlSize._1,
	},
	tag: {
		borderRadius: radius.sm,
		backgroundColor: color.surfaceSubtle,
		color: color.textMuted,
		fontSize: font.size_1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
	},
	emptyText: {
		marginTop: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
		opacity: 0.45,
	},
	usageText: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		opacity: 0.45,
	},
	errorText: {
		color: color.danger,
		fontSize: font.size_2,
	},
});
