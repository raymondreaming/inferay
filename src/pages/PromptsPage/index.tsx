import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
	IconChevronDown,
	IconCopy,
	IconPlus,
	IconSlash,
} from "../../components/ui/Icons.tsx";
import {
	WorkspaceButton,
	WorkspaceContent,
	WorkspaceEmptyState,
	WorkspacePage,
	WorkspaceSearch,
	WorkspaceToolbar,
	WorkspaceToolbarSpacer,
} from "../../components/ui/WorkspacePage.tsx";
import { filterPrompts } from "../../features/prompts/prompt-utils.ts";
import {
	PROMPT_CATEGORIES,
	type Prompt,
} from "../../features/prompts/types.ts";
import { usePrompts } from "../../features/prompts/usePrompts.ts";
import {
	deletePromptQuickAction,
	loadQuickActions,
	savePromptAsQuickAction,
} from "../../features/quick-actions/quick-actions-store.ts";
import { listenDocumentEvent, setInputValue } from "../../lib/react-events.ts";
import {
	color,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
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

function derivePromptActionCommands(): Set<string> {
	return new Set(
		loadQuickActions()
			.flatMap((action) => action.tags)
			.filter((tag) => tag.startsWith("prompt:"))
			.map((tag) => tag.slice("prompt:".length))
	);
}

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
	const [actionStatus, setActionStatus] = useState<string | null>(null);
	const [promptActionCommands, setPromptActionCommands] = useState<Set<string>>(
		() => derivePromptActionCommands()
	);
	const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM);

	const handleFormChange = useCallback((field: string, value: string) => {
		formDispatch({ type: "setField", field, value });
	}, []);

	const cancelEdit = useCallback(() => {
		formDispatch({ type: "cancelEdit" });
	}, []);

	const startEdit = useCallback((p: Prompt) => {
		setActionStatus(null);
		formDispatch({ type: "startEdit", prompt: p });
	}, []);

	const startCreate = useCallback(() => {
		setSelectedPrompt(null);
		setActionStatus(null);
		formDispatch({ type: "startCreate" });
	}, []);

	const selectPrompt = (p: Prompt) => {
		if (form.isEditing || form.isCreating) cancelEdit();
		setActionStatus(null);
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
			} else if (form.isCreating || !selectedPrompt) {
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
		if (p.isBuiltIn || !confirm(`Delete /${p.command}?`)) return false;
		try {
			await removePrompt(p._id);
			return true;
		} catch {
			return false;
		}
	};

	const filtered = filterPrompts(prompts, filter, search);
	const createActionFromPrompt = (prompt: Prompt) => {
		const action = savePromptAsQuickAction(prompt);
		setPromptActionCommands(derivePromptActionCommands());
		setActionStatus(`Saved "${action.name}" as a runnable Action.`);
	};
	const removeActionFromPrompt = (prompt: Prompt) => {
		const removedCount = deletePromptQuickAction(prompt.command);
		setPromptActionCommands(derivePromptActionCommands());
		setActionStatus(
			removedCount > 0
				? `Removed /${prompt.command} from runnable Actions.`
				: `/${prompt.command} is not saved as an Action.`
		);
	};

	const isCreatingInSidebar =
		form.isCreating || (!selectedPrompt && !form.isEditing);

	return (
		<WorkspacePage>
			<WorkspaceToolbar>
				<FilterDropdown filter={filter} onFilterChange={setFilter} />

				<WorkspaceToolbarSpacer />
				<WorkspaceSearch
					width="md"
					value={search}
					onChange={setInputValue.bind(null, setSearch)}
					placeholder="Search prompts"
				/>
				<WorkspaceButton
					type="button"
					onClick={startCreate}
					variant="secondary"
				>
					<IconPlus size={10} />
					New
				</WorkspaceButton>
			</WorkspaceToolbar>

			<WorkspaceContent padding="none">
				<div {...stylex.props(styles.promptShell)}>
					<div {...stylex.props(styles.listPane)}>
						{filtered.length === 0 ? (
							<div {...stylex.props(styles.listEmpty)}>
								<WorkspaceEmptyState
									icon={<IconCopy size={16} />}
									title={search ? "No prompts found" : "No prompts yet"}
									description={
										search
											? "No local prompt matches this search or filter."
											: "Create a reusable prompt to add it here."
									}
									action={
										search ? null : (
											<WorkspaceButton
												type="button"
												onClick={startCreate}
												variant="primary"
											>
												<IconPlus size={10} />
												New Prompt
											</WorkspaceButton>
										)
									}
								/>
							</div>
						) : (
							<div {...stylex.props(styles.promptList)}>
								{filtered.map((prompt) => (
									<PromptItemRow
										key={prompt._id}
										prompt={prompt}
										selected={selectedPrompt?._id === prompt._id}
										isActionCreated={promptActionCommands.has(prompt.command)}
										onSelect={() => selectPrompt(prompt)}
									/>
								))}
							</div>
						)}
					</div>

					<div {...stylex.props(styles.detailPane)}>
						<PromptDetailPanel
							selectedPrompt={isCreatingInSidebar ? null : selectedPrompt}
							isCreatingNew={isCreatingInSidebar}
							isEditing={form.isEditing}
							isSaving={form.isSaving}
							formCommand={form.command}
							formName={form.name}
							formDescription={form.description}
							formPromptTemplate={form.promptTemplate}
							formCategory={form.category}
							formTags={form.tags}
							formError={form.error}
							isActionCreated={
								selectedPrompt
									? promptActionCommands.has(selectedPrompt.command)
									: false
							}
							onFormChange={handleFormChange}
							onStartEditing={() => selectedPrompt && startEdit(selectedPrompt)}
							onCreateAction={() =>
								selectedPrompt && createActionFromPrompt(selectedPrompt)
							}
							onRemoveAction={() =>
								selectedPrompt && removeActionFromPrompt(selectedPrompt)
							}
							onCancelEditing={cancelEdit}
							onSave={handleSave}
							onDelete={() => {
								if (selectedPrompt) {
									handleDelete(selectedPrompt).then((deleted) => {
										if (!deleted) return;
										setSelectedPrompt(null);
										formDispatch({ type: "cancelEdit" });
									});
								}
							}}
							onClose={() => {
								if (form.isEditing || form.isCreating) cancelEdit();
								setSelectedPrompt(null);
							}}
						/>
						{actionStatus ? (
							<div {...stylex.props(styles.detailStatus)}>{actionStatus}</div>
						) : null}
					</div>
				</div>
			</WorkspaceContent>
		</WorkspacePage>
	);
}

function PromptItemRow({
	prompt,
	selected,
	isActionCreated,
	onSelect,
}: {
	prompt: Prompt;
	selected: boolean;
	isActionCreated: boolean;
	onSelect: () => void;
}) {
	const status = isActionCreated
		? "action"
		: prompt.isBuiltIn
			? "built-in"
			: "custom";

	return (
		<button
			type="button"
			onClick={onSelect}
			{...stylex.props(styles.promptRow, selected && styles.promptRowSelected)}
		>
			<span {...stylex.props(styles.promptIcon)}>
				<IconSlash size={13} />
			</span>
			<span {...stylex.props(styles.promptMain)}>
				<span {...stylex.props(styles.promptTitleRow)}>
					<span {...stylex.props(styles.promptName)}>{prompt.name}</span>
					<span {...stylex.props(styles.commandText)}>/{prompt.command}</span>
				</span>
				<span {...stylex.props(styles.promptDescription)}>
					{prompt.description}
				</span>
				<span {...stylex.props(styles.promptMeta)}>
					{prompt.category || "custom"}
					<span {...stylex.props(styles.metaDivider)} />
					{prompt.executionCount > 0
						? `${prompt.executionCount} uses`
						: "No runs"}
					{prompt.tags.slice(0, 2).map((tag) => (
						<span key={tag} {...stylex.props(styles.promptTag)}>
							{tag}
						</span>
					))}
				</span>
			</span>
			<span
				{...stylex.props(
					styles.statusPill,
					isActionCreated
						? styles.statusAction
						: prompt.isBuiltIn
							? styles.statusBuiltIn
							: styles.statusCustom
				)}
			>
				<span {...stylex.props(styles.statusDot)} />
				{status}
			</span>
		</button>
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
	promptShell: {
		display: "grid",
		gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.1fr)",
		height: "100%",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
	},
	listPane: {
		minWidth: 0,
		overflowY: "auto",
	},
	listEmpty: {
		height: "100%",
		minHeight: "22rem",
		padding: controlSize._3,
	},
	promptList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	promptRow: {
		alignItems: "center",
		backgroundColor: {
			default: color.surfaceTranslucent,
			":hover": color.surfaceControl,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: shadow.none,
			":hover": shadow.selectedRing,
		},
		color: color.textMain,
		cursor: "pointer",
		display: "flex",
		gap: controlSize._2,
		minHeight: controlSize._12,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, box-shadow",
		transitionTimingFunction: motion.ease,
		width: "100%",
	},
	promptRowSelected: {
		backgroundColor: color.controlActive,
		borderColor: color.borderStrong,
	},
	promptIcon: {
		alignItems: "center",
		backgroundColor: color.surfaceControl,
		borderColor: color.borderSubtle,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		width: controlSize._6,
	},
	promptMain: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		gap: controlSize._0_5,
		minWidth: 0,
	},
	promptTitleRow: {
		alignItems: "baseline",
		display: "flex",
		gap: controlSize._2,
		minWidth: 0,
	},
	commandText: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	promptName: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		lineHeight: 1.25,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	promptDescription: {
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.35,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	promptMeta: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		gap: controlSize._1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	metaDivider: {
		backgroundColor: color.borderStrong,
		borderRadius: radius.pill,
		display: "inline-flex",
		flexShrink: 0,
		height: controlSize._0_5,
		width: controlSize._0_5,
	},
	promptTag: {
		backgroundColor: color.surfaceSubtle,
		borderRadius: radius.sm,
		color: color.textMuted,
		flexShrink: 0,
		fontSize: font.size_0,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1,
	},
	statusPill: {
		alignItems: "center",
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
		textTransform: "capitalize",
	},
	statusDot: {
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		height: controlSize._1,
		width: controlSize._1,
	},
	statusAction: {
		backgroundColor: color.accentWash,
		borderColor: color.accentBorder,
		color: color.accent,
	},
	statusBuiltIn: {
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		color: color.textSoft,
	},
	statusCustom: {
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		color: color.textMuted,
	},
	detailPane: {
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		minWidth: 0,
		overflow: "hidden",
	},
	detailStatus: {
		borderTopColor: color.border,
		borderTopStyle: "solid",
		borderTopWidth: 1,
		color: color.textMuted,
		flexShrink: 0,
		fontSize: font.size_1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._4,
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
		backgroundImage: effect.controlDepth,
		boxShadow: shadow.controlDepth,
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		paddingInline: controlSize._2_5,
		transitionProperty:
			"background-color, background-image, border-color, color, box-shadow",
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
		backgroundImage: effect.popoverDepth,
		boxShadow: shadow.modal,
		padding: controlSize._1,
	},
	filterOption: {
		width: "100%",
		textAlign: "left",
		borderWidth: 0,
		borderRadius: radius.md,
		fontSize: font.size_1,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		transitionProperty: "background-color, background-image, color",
		transitionDuration: motion.durationFast,
	},
	filterOptionIdle: {
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
	filterOptionActive: {
		backgroundColor: color.surfaceControl,
		backgroundImage: effect.controlDepthHover,
		color: color.textMain,
	},
});
