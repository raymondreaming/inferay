import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
	IconChevronDown,
	IconPlus,
	IconSearch,
} from "../../components/ui/Icons.tsx";
import { usePrompts } from "../../features/prompts/usePrompts.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { filterPrompts } from "../../features/prompts/prompt-utils.ts";
import {
	PROMPT_CATEGORIES,
	type Prompt,
} from "../../features/prompts/types.ts";
import { listenDocumentEvent, setInputValue } from "../../lib/react-events.ts";
import { PromptDetailPanel } from "./PromptDetailPanel.tsx";

interface FormState {
	name: string;
	command: string;
	description: string;
	promptTemplate: string;
	category: string;
	tags: string;
	error: string;
	isSaving: boolean;
	isEditing: boolean;
	isCreating: boolean;
}

type FormAction =
	| { type: "reset" }
	| { type: "setField"; field: string; value: string }
	| { type: "setError"; error: string }
	| { type: "startSaving" }
	| { type: "stopSaving" }
	| { type: "startEdit"; prompt: Prompt }
	| { type: "startCreate" }
	| { type: "cancelEdit" }
	| { type: "finishEdit" }
	| { type: "finishCreate" };

const INITIAL_FORM: FormState = {
	name: "",
	command: "",
	description: "",
	promptTemplate: "",
	category: "custom",
	tags: "",
	error: "",
	isSaving: false,
	isEditing: false,
	isCreating: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
	switch (action.type) {
		case "reset":
			return INITIAL_FORM;
		case "setField":
			return { ...state, [action.field]: action.value };
		case "setError":
			return { ...state, error: action.error };
		case "startSaving":
			return { ...state, isSaving: true, error: "" };
		case "stopSaving":
			return { ...state, isSaving: false };
		case "startEdit":
			return {
				...state,
				isEditing: true,
				name: action.prompt.name,
				command: action.prompt.command,
				description: action.prompt.description,
				promptTemplate: action.prompt.promptTemplate,
				category: action.prompt.category || "custom",
				tags: action.prompt.tags.join(", "),
				error: "",
			};
		case "startCreate":
			return { ...INITIAL_FORM, isCreating: true };
		case "cancelEdit":
			return INITIAL_FORM;
		case "finishEdit":
			return { ...state, isEditing: false };
		case "finishCreate":
			return INITIAL_FORM;
	}
}

export function PromptsPage() {
	const { prompts, createPrompt, updatePrompt, removePrompt } = usePrompts();
	const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
	const [filter, setFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM);

	const handleFormChange = useCallback((field: string, value: string) => {
		formDispatch({ type: "setField", field, value });
	}, []);

	const cancelEdit = useCallback(() => {
		formDispatch({ type: "cancelEdit" });
	}, []);

	const startEdit = useCallback((p: Prompt) => {
		formDispatch({ type: "startEdit", prompt: p });
	}, []);

	const startCreate = useCallback(() => {
		setSelectedPrompt(null);
		formDispatch({ type: "startCreate" });
	}, []);

	const selectPrompt = (p: Prompt) => {
		if (form.isEditing || form.isCreating) cancelEdit();
		setSelectedPrompt(p);
	};

	const handleSave = async (isInlineEdit = false) => {
		if (
			!form.name.trim() ||
			!form.command.trim() ||
			!form.promptTemplate.trim()
		) {
			formDispatch({
				type: "setError",
				error: "Name, command, and template are required",
			});
			return;
		}
		const cmd = form.command.trim().toLowerCase().replace(/^\//, "");
		if (!/^[a-z][a-z0-9-]*$/.test(cmd)) {
			formDispatch({
				type: "setError",
				error: "Command: letters, numbers, hyphens only",
			});
			return;
		}
		formDispatch({ type: "startSaving" });
		try {
			const data = {
				name: form.name.trim(),
				command: cmd,
				description: form.description.trim() || form.name.trim(),
				promptTemplate: form.promptTemplate.trim(),
				category: form.category,
				tags: form.tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
			};
			if (isInlineEdit && selectedPrompt) {
				await updatePrompt(selectedPrompt._id, data);
				formDispatch({ type: "finishEdit" });
			} else if (form.isCreating) {
				await createPrompt(data);
				formDispatch({ type: "finishCreate" });
			}
		} catch (e) {
			formDispatch({
				type: "setError",
				error: e instanceof Error ? e.message : "Failed to save",
			});
		} finally {
			formDispatch({ type: "stopSaving" });
		}
	};

	const handleDelete = async (p: Prompt) => {
		if (p.isBuiltIn || !confirm(`Delete /${p.command}?`)) return;
		try {
			await removePrompt(p._id);
		} catch {}
	};

	const filtered = filterPrompts(prompts, filter, search);

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.toolbar)}>
				<FilterDropdown filter={filter} onFilterChange={setFilter} />

				<div {...stylex.props(styles.searchWrap)}>
					<IconSearch size={12} {...stylex.props(styles.searchIcon)} />
					<input
						type="text"
						value={search}
						onChange={setInputValue.bind(null, setSearch)}
						placeholder="Search..."
						{...stylex.props(styles.searchInput)}
					/>
				</div>

				<span {...stylex.props(styles.countText)}>{filtered.length}</span>

				<span {...stylex.props(styles.spacer)} />

				<button
					type="button"
					onClick={startCreate}
					{...stylex.props(styles.newButton)}
				>
					<IconPlus size={10} />
					New
				</button>
			</div>

			<div {...stylex.props(styles.content)}>
				<div {...stylex.props(styles.listPane)}>
					{filtered.length === 0 ? (
						<div {...stylex.props(styles.emptyState)}>
							<div {...stylex.props(styles.emptyCopy)}>
								<p {...stylex.props(styles.emptyTitle)}>
									{search ? "No prompts found" : "No prompts yet"}
								</p>
								<p {...stylex.props(styles.emptyText)}>
									{search
										? "Try a different search"
										: "Create your first prompt"}
								</p>
							</div>
						</div>
					) : (
						<div
							{...stylex.props(
								styles.promptGrid,
								selectedPrompt || form.isCreating
									? styles.promptGridCompact
									: styles.promptGridWide
							)}
						>
							{filtered.map((prompt) => {
								const isActive = selectedPrompt?._id === prompt._id;
								return (
									<button
										type="button"
										key={prompt._id}
										onClick={() => selectPrompt(prompt)}
										{...stylex.props(
											styles.promptCard,
											isActive ? styles.promptCardActive : styles.promptCardIdle
										)}
									>
										<div {...stylex.props(styles.cardHeader)}>
											<span {...stylex.props(styles.commandText)}>
												/{prompt.command}
											</span>
											{prompt.isBuiltIn && (
												<span {...stylex.props(styles.cardBadge)}>
													built-in
												</span>
											)}
										</div>
										<p {...stylex.props(styles.promptName)}>{prompt.name}</p>
										<p {...stylex.props(styles.promptDescription)}>
											{prompt.description}
										</p>
										{prompt.executionCount > 0 && (
											<p {...stylex.props(styles.usageText)}>
												{prompt.executionCount} uses
											</p>
										)}
									</button>
								);
							})}
						</div>
					)}
				</div>

				{(selectedPrompt || form.isCreating) && (
					<div {...stylex.props(styles.detailPane)}>
						<PromptDetailPanel
							selectedPrompt={selectedPrompt}
							isCreatingNew={form.isCreating}
							isEditing={form.isEditing}
							isSaving={form.isSaving}
							formCommand={form.command}
							formName={form.name}
							formDescription={form.description}
							formPromptTemplate={form.promptTemplate}
							formCategory={form.category}
							formTags={form.tags}
							formError={form.error}
							onFormChange={handleFormChange}
							onStartEditing={() => selectedPrompt && startEdit(selectedPrompt)}
							onCancelEditing={cancelEdit}
							onSave={handleSave}
							onDelete={() => {
								if (selectedPrompt) {
									handleDelete(selectedPrompt);
									setSelectedPrompt(null);
									formDispatch({ type: "cancelEdit" });
								}
							}}
							onClose={() => {
								if (form.isEditing || form.isCreating) cancelEdit();
								setSelectedPrompt(null);
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

const FILTER_OPTIONS = [
	{ value: "all", label: "All prompts" },
	{ value: "builtin", label: "Built-in" },
	{ value: "custom", label: "Custom" },
	...PROMPT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

function FilterDropdown({
	filter,
	onFilterChange,
}: {
	filter: string;
	onFilterChange: (v: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		return listenDocumentEvent("mousedown", handler);
	}, [open]);

	const activeLabel =
		FILTER_OPTIONS.find((o) => o.value === filter)?.label || "All prompts";

	return (
		<div ref={ref} {...stylex.props(styles.filterRoot)}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				{...stylex.props(styles.filterButton)}
			>
				{activeLabel}
				<IconChevronDown
					size={8}
					{...stylex.props(styles.chevron, open && styles.chevronOpen)}
				/>
			</button>
			{open && (
				<div {...stylex.props(styles.filterMenu)}>
					{FILTER_OPTIONS.map((opt) => (
						<button
							type="button"
							key={opt.value}
							onClick={() => {
								onFilterChange(opt.value);
								setOpen(false);
							}}
							{...stylex.props(
								styles.filterOption,
								filter === opt.value
									? styles.filterOptionActive
									: styles.filterOptionIdle
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

const styles = stylex.create({
	root: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		backgroundColor: color.background,
	},
	toolbar: {
		display: "flex",
		height: "3rem",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingInline: controlSize._3,
	},
	searchWrap: {
		position: "relative",
	},
	searchIcon: {
		position: "absolute",
		left: controlSize._2,
		top: "50%",
		transform: "translateY(-50%)",
		color: color.textMuted,
		pointerEvents: "none",
	},
	searchInput: {
		width: "11rem",
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: 8,
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
		fontSize: font.size_2,
		outline: "none",
		paddingLeft: "1.75rem",
		paddingRight: controlSize._2,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	countText: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	spacer: {
		flex: 1,
	},
	newButton: {
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		paddingInline: controlSize._2_5,
		transitionProperty: "background-color, border-color, color",
		transitionDuration: motion.durationFast,
	},
	content: {
		display: "flex",
		flex: 1,
		minHeight: 0,
		overflow: "hidden",
	},
	listPane: {
		flex: 1,
		overflowY: "auto",
	},
	emptyState: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
	},
	emptyCopy: {
		textAlign: "center",
	},
	emptyTitle: {
		marginBottom: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_2,
	},
	emptyText: {
		color: color.textMuted,
		fontSize: font.size_1,
		opacity: 0.5,
	},
	promptGrid: {
		display: "grid",
		gap: controlSize._2,
		padding: controlSize._3,
	},
	promptGridWide: {
		gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
	},
	promptGridCompact: {
		gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
	},
	promptCard: {
		textAlign: "left",
		borderWidth: 1,
		borderStyle: "solid",
		borderRadius: radius.lg,
		padding: controlSize._3,
		transitionProperty: "background-color, border-color",
		transitionDuration: motion.durationFast,
	},
	promptCardIdle: {
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
	},
	promptCardActive: {
		borderColor: color.accentBorder,
		backgroundColor: color.surfaceSubtle,
	},
	cardHeader: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		marginBottom: controlSize._1_5,
	},
	commandText: {
		color: color.textMain,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	cardBadge: {
		borderRadius: radius.sm,
		backgroundColor: color.surfaceSubtle,
		color: color.textMuted,
		fontSize: font.size_0,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
		opacity: 0.55,
	},
	promptName: {
		marginBottom: controlSize._1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2,
	},
	promptDescription: {
		display: "-webkit-box",
		overflow: "hidden",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.55,
	},
	usageText: {
		marginTop: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_0_5,
		fontVariantNumeric: "tabular-nums",
		opacity: 0.45,
	},
	detailPane: {
		width: "420px",
		flexShrink: 0,
		overflowY: "auto",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.background,
	},
	filterRoot: {
		position: "relative",
	},
	filterButton: {
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		gap: controlSize._1_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		paddingInline: controlSize._2_5,
		transitionProperty: "background-color, border-color, color",
		transitionDuration: motion.durationFast,
	},
	chevron: {
		transitionProperty: "transform",
		transitionDuration: motion.durationFast,
	},
	chevronOpen: {
		transform: "rotate(180deg)",
	},
	filterMenu: {
		position: "absolute",
		zIndex: 50,
		left: 0,
		top: "100%",
		minWidth: "160px",
		marginTop: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		boxShadow: shadow.modal,
		padding: controlSize._1,
	},
	filterOption: {
		width: "100%",
		textAlign: "left",
		borderWidth: 0,
		borderRadius: radius.md,
		fontSize: font.size_2,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2_5,
		transitionProperty: "background-color, color",
		transitionDuration: motion.durationFast,
	},
	filterOptionIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceSubtle,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
	filterOptionActive: {
		backgroundColor: "rgba(255, 255, 255, 0.06)",
		color: color.textMain,
	},
});
