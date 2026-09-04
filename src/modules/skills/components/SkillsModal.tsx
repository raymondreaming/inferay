import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useReducer, useRef, useState } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../app/model/appearance.ts";
import {
	color,
	controlSize,
	font,
	iconSize,
	motion,
	radius,
	shadow,
	surfaceStyles,
} from "../../../design-system/styles.stylex.ts";
import { PromptDetailPanel } from "../../../modules/prompts/components/PromptDetailPanel.tsx";
import { usePrompts } from "../../../modules/prompts/hooks/usePrompts.tsx";
import {
	promptFormReducer as formReducer,
	INITIAL_PROMPT_FORM as INITIAL_FORM,
} from "../../../modules/prompts/model/prompt-form.ts";
import { filterPrompts } from "../../../modules/prompts/model/prompt-utils.ts";
import {
	PROMPT_CATEGORIES,
	type Prompt,
} from "../../../modules/prompts/model/types.ts";
import {
	listenWindowEvent,
	setInputValue,
} from "../../../shared/lib/react-events.ts";
import {
	IconCopy,
	IconPlus,
	IconSearch,
	IconX,
} from "../../../shared/ui/Icons.tsx";
import { OPEN_SKILLS_EVENT, type SkillsTarget } from "../model/skill-events.ts";

export function SkillsModalHost() {
	const [request, setRequest] = useState<{
		target: SkillsTarget;
		key: number;
	} | null>(null);
	useEffect(
		() =>
			listenWindowEvent(OPEN_SKILLS_EVENT, (event) => {
				const target = (event as CustomEvent<SkillsTarget>).detail;
				setRequest({ target: target ?? { mode: "browse" }, key: Date.now() });
			}),
		[],
	);
	return request ? (
		<SkillsDialog
			key={request.key}
			target={request.target}
			onClose={() => setRequest(null)}
		/>
	) : null;
}

function SkillsDialog({
	target,
	onClose,
}: {
	target: SkillsTarget;
	onClose: () => void;
}) {
	const { prompts, createPrompt, updatePrompt, removePrompt, loading, error } =
		usePrompts();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selectedPrompt =
		prompts.find((prompt) => prompt._id === selectedId) ?? null;
	const setSelectedPrompt = (prompt: Prompt | null) =>
		setSelectedId(prompt?._id ?? null);
	const [filter, setFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM);
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const initialized = useRef(false);
	const dirty =
		(form.isCreating || form.isEditing) &&
		(form.name !== (form.isEditing ? (selectedPrompt?.name ?? "") : "") ||
			form.command !==
				(form.isEditing ? (selectedPrompt?.command ?? "") : "") ||
			form.description !==
				(form.isEditing ? (selectedPrompt?.description ?? "") : "") ||
			form.promptTemplate !==
				(form.isEditing ? (selectedPrompt?.promptTemplate ?? "") : "") ||
			form.category !==
				(form.isEditing ? (selectedPrompt?.category ?? "custom") : "custom") ||
			form.tags !==
				(form.isEditing ? (selectedPrompt?.tags.join(", ") ?? "") : ""));
	const canLeave = () =>
		!form.isSaving && (!dirty || confirm("Discard unsaved skill changes?"));
	const close = () => {
		if (canLeave()) onClose();
	};
	useEffect(() => {
		const previousFocus = document.activeElement as HTMLElement | null;
		dialogRef.current?.showModal();
		return () => {
			previousFocus?.focus();
		};
	}, []);
	useEffect(() => {
		if (initialized.current || loading) return;
		initialized.current = true;
		if (target.mode === "create") formDispatch({ type: "startCreate" });
		if (target.mode === "browse" && prompts[0]) setSelectedId(prompts[0]._id);
		if (target.mode === "edit") {
			const prompt = prompts.find((item) => item._id === target.skillId);
			if (prompt) {
				setSelectedId(prompt._id);
				if (!prompt.isBuiltIn) formDispatch({ type: "startEdit", prompt });
			} else
				formDispatch({
					type: "setError",
					error: "This skill is no longer available.",
				});
		}
	}, [loading, prompts, target]);

	const handleFormChange = useCallback((field: string, value: string) => {
		formDispatch({ type: "setField", field, value });
	}, []);

	const cancelEdit = () => {
		if (!canLeave()) return;
		formDispatch({ type: "cancelEdit" });
	};

	const startEdit = useCallback((p: Prompt) => {
		formDispatch({ type: "startEdit", prompt: p });
	}, []);

	const startCreate = () => {
		if (!canLeave()) return;
		setSelectedPrompt(null);
		formDispatch({ type: "startCreate" });
	};

	const selectPrompt = (p: Prompt) => {
		if (!canLeave()) return;
		formDispatch({ type: "cancelEdit" });
		setSelectedPrompt(p);
	};
	const duplicateSelected = () => {
		if (!selectedPrompt || !canLeave()) return;
		const source = selectedPrompt;
		setSelectedId(null);
		formDispatch({ type: "startCreate" });
		for (const [field, value] of Object.entries({
			name: `${source.name} copy`,
			command: `${source.command}-custom`,
			description: source.description,
			promptTemplate: source.promptTemplate,
			category: source.category ?? "custom",
			tags: source.tags.join(", "),
		}))
			formDispatch({ type: "setField", field, value });
	};

	const handleSave = async (isInlineEdit = false) => {
		if (
			!form.name.trim() ||
			!form.command.trim() ||
			!form.promptTemplate.trim()
		) {
			formDispatch({
				type: "setError",
				error: "Name, command, and instructions are required",
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
				tags: form.tags.split(",").flatMap((tag) => {
					const trimmed = tag.trim();
					return trimmed ? [trimmed] : [];
				}),
			};
			if (isInlineEdit && selectedPrompt) {
				await updatePrompt(selectedPrompt._id, data);
				formDispatch({ type: "finishEdit" });
			} else if (form.isCreating) {
				const created = await createPrompt(data);
				setSelectedId(created._id);
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
			setSelectedId(null);
			formDispatch({ type: "cancelEdit" });
		} catch (error) {
			formDispatch({
				type: "setError",
				error:
					error instanceof Error ? error.message : "Failed to delete skill",
			});
		}
	};

	const filtered = filterPrompts(prompts, filter, search);
	return (
		<dialog
			ref={dialogRef}
			aria-label="Skills"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onKeyDown={(event) => event.stopPropagation()}
			className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.dialog).className ?? ""}`}
		>
			<div {...stylex.props(styles.root)}>
				<button
					type="button"
					aria-label="Close skills"
					title="Close skills"
					onClick={close}
					{...stylex.props(styles.closeButton)}
				>
					<IconX size={iconSize.md} />
				</button>
				{error && (
					<p role="alert" {...stylex.props(styles.error)}>
						{error}
					</p>
				)}
				<div {...stylex.props(styles.content)}>
					<aside aria-label="Skills library" {...stylex.props(styles.listPane)}>
						<div {...stylex.props(styles.libraryControls)}>
							<button
								type="button"
								onClick={startCreate}
								disabled={form.isSaving}
								{...stylex.props(
									surfaceStyles.panel,
									styles.newButton,
									styles.libraryNew,
								)}
							>
								<IconPlus size={iconSize.sm} /> New skill
							</button>
							<div {...stylex.props(styles.searchWrap)}>
								<IconSearch
									size={iconSize.md}
									{...stylex.props(styles.searchIcon)}
								/>
								<input
									type="search"
									value={search}
									onInput={setInputValue.bind(null, setSearch)}
									placeholder="Find a skill…"
									aria-label="Search skills"
									{...stylex.props(styles.searchInput)}
								/>
							</div>
							<div {...stylex.props(styles.libraryHeading)}>
								<select
									aria-label="Filter skills"
									value={filter}
									onChange={(event) => setFilter(event.currentTarget.value)}
									{...stylex.props(styles.filter)}
								>
									<option value="all">All skills</option>
									<option value="builtin">Built-in</option>
									<option value="custom">Personal</option>
									<optgroup label="Category">
										{PROMPT_CATEGORIES.filter(
											(category) => category.value !== "custom",
										).map((category) => (
											<option key={category.value} value={category.value}>
												{category.label}
											</option>
										))}
									</optgroup>
								</select>
								<span {...stylex.props(styles.count)}>{filtered.length}</span>
							</div>
						</div>
						<nav aria-label="Saved skills" {...stylex.props(styles.skillList)}>
							{filtered.length === 0 ? (
								<div {...stylex.props(styles.emptyList)}>
									<p>{loading ? "Loading skills…" : "No skills found"}</p>
									<span>
										{search
											? "Try another name or command."
											: "Create a skill to get started."}
									</span>
								</div>
							) : (
								filtered.map((prompt) => {
									const active = !form.isCreating && selectedId === prompt._id;
									return (
										<button
											type="button"
											key={prompt._id}
											onClick={() => selectPrompt(prompt)}
											aria-current={active ? "true" : undefined}
											title={prompt.description || prompt.name}
											{...stylex.props(
												styles.skillRow,
												active && surfaceStyles.panel,
												active && styles.skillRowActive,
											)}
										>
											<span
												aria-hidden="true"
												{...stylex.props(styles.skillGlyph)}
											>
												/
											</span>
											<span {...stylex.props(styles.skillCopy)}>
												<span {...stylex.props(styles.skillCommand)}>
													/{prompt.command}
												</span>
												<span {...stylex.props(styles.skillDescription)}>
													{prompt.description || prompt.name}
												</span>
											</span>
											{prompt.isBuiltIn && (
												<span {...stylex.props(styles.builtinLabel)}>
													Built-in
												</span>
											)}
										</button>
									);
								})
							)}
						</nav>
					</aside>
					{selectedPrompt || form.isCreating ? (
						<div {...stylex.props(styles.detailPane)}>
							{selectedPrompt?.isBuiltIn && !form.isCreating && (
								<div {...stylex.props(styles.builtInNotice)}>
									<span>Built-in workflow · Read-only</span>
									<button
										type="button"
										onClick={duplicateSelected}
										{...stylex.props(styles.copyButton)}
									>
										<IconCopy size={iconSize.sm} /> Make a copy
									</button>
								</div>
							)}
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
								onStartEditing={() =>
									selectedPrompt && startEdit(selectedPrompt)
								}
								onCancelEditing={cancelEdit}
								onSave={handleSave}
								onDelete={() => {
									if (selectedPrompt) void handleDelete(selectedPrompt);
								}}
							/>
						</div>
					) : (
						<div {...stylex.props(styles.editorEmpty)}>
							<h2 {...stylex.props(styles.emptyTitle)}>Select a skill</h2>
							<button
								type="button"
								onClick={startCreate}
								{...stylex.props(surfaceStyles.panel, styles.newButton)}
							>
								<IconPlus size={iconSize.sm} /> Create a skill
							</button>
							{form.error && (
								<p role="alert" {...stylex.props(styles.error)}>
									{form.error}
								</p>
							)}
						</div>
					)}
				</div>
			</div>
		</dialog>
	);
}

const styles = stylex.create({
	dialog: {
		position: "relative",
		margin: "auto",
		boxSizing: "border-box",
		backgroundColor: color.backgroundModal,
		color: color.textMain,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderStrong,
		borderRadius: radius._2xl,
		boxShadow: shadow.modal,
		width: "min(1080px, calc(100vw - 32px))",
		height: "min(780px, calc(100dvh - 48px))",
		maxWidth: "calc(100vw - 32px)",
		maxHeight: "calc(100dvh - 48px)",
		padding: 0,
		overflow: "hidden",
		"::backdrop": {
			backgroundColor: color.backgroundOverlay,
			backdropFilter: "blur(8px)",
		},
	},
	root: { display: "flex", height: "100%", flexDirection: "column" },
	brand: { display: "flex", alignItems: "center", gap: controlSize._3 },
	title: {
		margin: 0,
		fontSize: font.size_4,
		fontWeight: font.weight_6,
		letterSpacing: "-0.025em",
	},
	headerActions: { display: "flex", alignItems: "center", gap: controlSize._3 },
	closeButton: {
		position: "absolute",
		top: controlSize._3,
		right: controlSize._3,
		zIndex: 1,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: controlSize._8,
		height: controlSize._8,
		borderWidth: 0,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textMuted,
	},
	newButton: {
		display: "inline-flex",
		minHeight: controlSize._8,
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._1_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderControl,
		borderRadius: radius.lg,
		backgroundColor: {
			default: color.backgroundPanel,
			":hover": color.controlHover,
		},
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingInline: controlSize._3,
		whiteSpace: "nowrap",
		":disabled": { opacity: 0.5 },
	},
	content: {
		display: "flex",
		flexDirection: { default: "row", "@media (max-width: 700px)": "column" },
		flex: 1,
		minHeight: 0,
		overflow: "hidden",
	},
	listPane: {
		display: "flex",
		flexDirection: "column",
		width: { default: "270px", "@media (max-width: 700px)": "100%" },
		maxHeight: { default: "none", "@media (max-width: 700px)": "180px" },
		flexShrink: 0,
		minHeight: 0,
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
		backgroundColor: color.surfaceBlack14,
	},
	libraryNew: { width: "100%", marginBottom: controlSize._3 },
	libraryControls: {
		padding: controlSize._3,
		paddingRight: {
			default: controlSize._3,
			"@media (max-width: 700px)": controlSize._14,
		},
		paddingBottom: controlSize._1,
		flexShrink: 0,
	},
	searchWrap: { position: "relative" },
	searchIcon: {
		position: "absolute",
		left: controlSize._2_5,
		top: "50%",
		transform: "translateY(-50%)",
		color: color.textMuted,
		pointerEvents: "none",
	},
	searchInput: {
		width: "100%",
		height: controlSize._9,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.surfaceWhite02,
		color: color.textMain,
		fontSize: font.size_2,
		outline: "none",
		paddingLeft: controlSize._8,
		paddingRight: controlSize._2,
		":focus-visible": { borderColor: color.textMuted },
		"::placeholder": { color: color.textMuted },
	},
	libraryHeading: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		paddingBlock: controlSize._3,
		paddingInline: controlSize._1,
	},
	filter: {
		maxWidth: "85%",
		borderWidth: 0,
		backgroundColor: color.backgroundModal,
		color: color.textSoft,
		fontSize: font.size_1,
		cursor: "pointer",
	},
	count: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	skillList: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		paddingInline: controlSize._2,
		paddingBottom: controlSize._3,
		overflowY: "auto",
		flex: 1,
		minHeight: 0,
	},
	skillRow: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2_5,
		textAlign: "left",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.transparent,
		borderRadius: radius.lg,
		padding: controlSize._2_5,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite04,
		},
		transitionProperty: "background-color, border-color",
		transitionDuration: motion.durationFast,
		":focus-visible": {
			outline: `1px solid ${color.textSoft}`,
			outlineOffset: "-2px",
		},
	},
	skillRowActive: {
		borderColor: color.borderControl,
		backgroundColor: {
			default: color.backgroundPanel,
			":hover": color.backgroundPanel,
		},
	},
	skillCopy: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		minWidth: 0,
		flex: 1,
	},
	skillCommand: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	skillDescription: {
		color: color.textSoft,
		fontSize: font.size_1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	builtinLabel: {
		color: color.textMuted,
		fontSize: font.size_0_5,
		flexShrink: 0,
	},
	footerTitle: {
		display: "block",
		marginBottom: controlSize._1,
		color: color.textSoft,
		fontWeight: font.weight_5,
	},
	emptyList: {
		padding: controlSize._4,
		color: color.textSoft,
		fontSize: font.size_2,
		lineHeight: 1.8,
	},
	detailPane: {
		display: "flex",
		flexDirection: "column",
		flex: 1,
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	builtInNotice: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		flexWrap: "wrap",
		gap: controlSize._2,
		flexShrink: 0,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._6,
		paddingRight: controlSize._14,
		color: color.textSoft,
		fontSize: font.size_1,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
	},
	copyButton: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		color: color.textMain,
		backgroundColor: color.transparent,
		borderWidth: 0,
		borderRadius: radius.md,
		padding: controlSize._1,
		":hover": { backgroundColor: color.surfaceControl },
	},
	editorEmpty: {
		display: "flex",
		flex: 1,
		minWidth: 0,
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: controlSize._4,
		padding: controlSize._6,
		textAlign: "center",
	},
	emptyTitle: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_5,
		letterSpacing: "-0.035em",
		margin: 0,
	},
	error: {
		color: color.danger,
		fontSize: font.size_2,
		paddingInline: controlSize._4,
	},
});
