import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useReducer, useRef, useState } from "octane";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import type { SkillFormState } from "../../../../../build/presentation/contracts/SkillFormState.ts";
import { project as rustProject } from "../../../../adapters/presentation/model.ts";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/model/appearance.ts";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import type { SkillsTarget } from "../../../../shared/lib/data.ts";
import { setInputValue } from "../../../../shared/lib/data.ts";
import {
	IconCopy,
	IconPlus,
	IconSearch,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import { removeSkill, saveSkill, useSkills } from "../../hooks/useSkills.tsx";
import { SkillEditor } from "../SkillEditor/index.tsx";
import { styles } from "./styles.ts";

function formReducer(state: SkillFormState, patch: Partial<SkillFormState>) {
	return patch === INITIAL_FORM ? INITIAL_FORM : { ...state, ...patch };
}

export function SkillsDialog({
	target,
	onClose,
}: {
	target: SkillsTarget;
	onClose: () => void;
}) {
	const { skills, loading, error } = useSkills();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selectedSkill =
		skills.find((skill) => skill._id === selectedId) ?? null;
	const setSelectedSkill = (skill: Prompt | null) =>
		setSelectedId(skill?._id ?? null);
	const [filter, setFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM);
	const startEdit = useCallback((skill: Prompt) => {
		formDispatch(skillFormForEdit(skill));
	}, []);
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const initialized = useRef(false);
	const original = form.isEditing ? selectedSkill : null;
	const dirty = isSkillFormDirty(form, original);
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
		const initial = initializeSkillDialog(target, skills);
		setSelectedId(initial.selectedId);
		formDispatch(initial.form);
	}, [loading, skills, target, startEdit]);

	const handleFormChange = useCallback((field: string, value: string) => {
		formDispatch({ [field]: value });
	}, []);

	const cancelEdit = () => {
		if (!canLeave()) return;
		formDispatch(INITIAL_FORM);
	};

	const startCreate = () => {
		if (!canLeave()) return;
		setSelectedSkill(null);
		formDispatch({ ...INITIAL_FORM, isCreating: true });
	};

	const selectSkill = (p: Prompt) => {
		if (!canLeave()) return;
		formDispatch(INITIAL_FORM);
		setSelectedSkill(p);
	};
	const duplicateSelected = () => {
		if (!selectedSkill || !canLeave()) return;
		setSelectedId(null);
		formDispatch(skillFormForDuplicate(selectedSkill));
	};

	const handleSave = async (isInlineEdit = false) => {
		formDispatch({ isSaving: true, error: "" });
		try {
			const saved = await saveSkillForm(form, selectedSkill, isInlineEdit);
			setSelectedId(saved.selectedId);
			formDispatch(saved.form);
		} catch (e) {
			formDispatch({
				error: e instanceof Error ? e.message : "Failed to save",
			});
		} finally {
			formDispatch({ isSaving: false });
		}
	};

	const handleDelete = async (p: Prompt) => {
		if (p.isBuiltIn || !confirm(`Delete /${p.command}?`)) return;
		try {
			await removeSkill(p._id);
			setSelectedId(null);
			formDispatch(INITIAL_FORM);
		} catch (error) {
			formDispatch({
				error:
					error instanceof Error ? error.message : "Failed to delete skill",
			});
		}
	};

	const {
		skills: filtered,
		loading: filtering,
		error: filterError,
	} = useSkills(filter, search);
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
				{(error || filterError) && (
					<p role="alert" {...stylex.props(styles.error)}>
						{error || filterError}
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
								</select>
								<span {...stylex.props(styles.count)}>{filtered.length}</span>
							</div>
						</div>
						<nav aria-label="Saved skills" {...stylex.props(styles.skillList)}>
							{filtered.length === 0 ? (
								<div {...stylex.props(styles.emptyList)}>
									<p>
										{loading || filtering
											? "Loading skills…"
											: "No skills found"}
									</p>
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

const INITIAL_FORM = rustProject<SkillFormState>("emptySkillForm", null);
export function skillFormForEdit(skill: Prompt): Partial<SkillFormState> {
	return rustProject("skillEdit", skill);
}
export function skillFormForDuplicate(skill: Prompt): SkillFormState {
	return rustProject("skillDuplicate", skill);
}
export function initializeSkillDialog(
	target: SkillsTarget,
	skills: Prompt[],
): { selectedId: string | null; form: Partial<SkillFormState> } {
	return rustProject("skillDialog", { target, skills });
}
export function isSkillFormDirty(
	form: SkillFormState,
	original: Prompt | null,
): boolean {
	return rustProject("skillDirty", { form, original });
}
export async function saveSkillForm(
	form: SkillFormState,
	selected: Prompt | null,
	inlineEdit: boolean,
) {
	const data = {
		name: form.name,
		command: form.command,
		description: form.description,
		promptTemplate: form.promptTemplate,
	};
	if (inlineEdit && selected) {
		await saveSkill(data, selected._id);
		return { selectedId: selected._id, form: { isEditing: false } };
	}
	if (form.isCreating) {
		const created = await saveSkill(data);
		return { selectedId: created._id, form: INITIAL_FORM };
	}
	return { selectedId: selected?._id ?? null, form: {} };
}
