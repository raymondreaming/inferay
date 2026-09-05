import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useReducer, useRef, useState } from "octane";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import { setInputValue } from "../../../../shared/lib/data.ts";
import {
	IconCopy,
	IconPlus,
	IconSearch,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { useSkills } from "../../hooks/useSkills.tsx";
import type { SkillsTarget } from "../../model/skill-library.ts";
import {
	filterSkills,
	skillFormReducer as formReducer,
	INITIAL_SKILL_FORM as INITIAL_FORM,
	SKILL_CATEGORIES,
	type Skill,
} from "../../model/skill-library.ts";
import { SkillEditor } from "../SkillEditor/index.tsx";
import { styles } from "./styles.ts";

export function SkillsDialog({
	target,
	onClose,
}: {
	target: SkillsTarget;
	onClose: () => void;
}) {
	const { skills, createSkill, updateSkill, removeSkill, loading, error } =
		useSkills(true);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selectedSkill =
		skills.find((skill) => skill._id === selectedId) ?? null;
	const setSelectedSkill = (skill: Skill | null) =>
		setSelectedId(skill?._id ?? null);
	const [filter, setFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM);
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const initialized = useRef(false);
	const dirty =
		(form.isCreating || form.isEditing) &&
		(form.name !== (form.isEditing ? (selectedSkill?.name ?? "") : "") ||
			form.command !== (form.isEditing ? (selectedSkill?.command ?? "") : "") ||
			form.description !==
				(form.isEditing ? (selectedSkill?.description ?? "") : "") ||
			form.promptTemplate !==
				(form.isEditing ? (selectedSkill?.promptTemplate ?? "") : "") ||
			form.category !==
				(form.isEditing ? (selectedSkill?.category ?? "custom") : "custom") ||
			form.tags !==
				(form.isEditing ? (selectedSkill?.tags.join(", ") ?? "") : ""));
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
		if (target.mode === "browse" && skills[0]) setSelectedId(skills[0]._id);
		if (target.mode === "edit") {
			const skill = skills.find((item) => item._id === target.skillId);
			if (skill) {
				setSelectedId(skill._id);
				if (!skill.isBuiltIn) formDispatch({ type: "startEdit", skill });
			} else
				formDispatch({
					type: "setError",
					error: "This skill is no longer available.",
				});
		}
	}, [loading, skills, target]);

	const handleFormChange = useCallback((field: string, value: string) => {
		formDispatch({ type: "setField", field, value });
	}, []);

	const cancelEdit = () => {
		if (!canLeave()) return;
		formDispatch({ type: "cancelEdit" });
	};

	const startEdit = useCallback((p: Skill) => {
		formDispatch({ type: "startEdit", skill: p });
	}, []);

	const startCreate = () => {
		if (!canLeave()) return;
		setSelectedSkill(null);
		formDispatch({ type: "startCreate" });
	};

	const selectSkill = (p: Skill) => {
		if (!canLeave()) return;
		formDispatch({ type: "cancelEdit" });
		setSelectedSkill(p);
	};
	const duplicateSelected = () => {
		if (!selectedSkill || !canLeave()) return;
		const source = selectedSkill;
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
			if (isInlineEdit && selectedSkill) {
				await updateSkill(selectedSkill._id, data);
				formDispatch({ type: "finishEdit" });
			} else if (form.isCreating) {
				const created = await createSkill(data);
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

	const handleDelete = async (p: Skill) => {
		if (p.isBuiltIn || !confirm(`Delete /${p.command}?`)) return;
		try {
			await removeSkill(p._id);
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

	const filtered = filterSkills(skills, filter, search);
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
										{SKILL_CATEGORIES.filter(
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
								filtered.map((skill) => {
									const active = !form.isCreating && selectedId === skill._id;
									return (
										<button
											type="button"
											key={skill._id}
											onClick={() => selectSkill(skill)}
											aria-current={active ? "true" : undefined}
											title={skill.description || skill.name}
											{...stylex.props(
												styles.skillRow,
												active && surfaceStyles.panel,
												active && styles.skillRowActive,
											)}
										>
											<span {...stylex.props(styles.skillCopy)}>
												<span {...stylex.props(styles.skillCommand)}>
													/{skill.command}
												</span>
												<span {...stylex.props(styles.skillDescription)}>
													{skill.description || skill.name}
												</span>
											</span>
											{skill.isBuiltIn && (
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
					{selectedSkill || form.isCreating ? (
						<div {...stylex.props(styles.detailPane)}>
							{selectedSkill?.isBuiltIn && !form.isCreating && (
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
							<SkillEditor
								selectedSkill={selectedSkill}
								isCreatingNew={form.isCreating}
								isEditing={form.isEditing}
								isSaving={form.isSaving}
								formCommand={form.command}
								formName={form.name}
								formDescription={form.description}
								formInstructions={form.promptTemplate}
								formCategory={form.category}
								formTags={form.tags}
								formError={form.error}
								onFormChange={handleFormChange}
								onStartEditing={() => selectedSkill && startEdit(selectedSkill)}
								onCancelEditing={cancelEdit}
								onSave={handleSave}
								onDelete={() => {
									if (selectedSkill) void handleDelete(selectedSkill);
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
