import * as stylex from "@octanejs/stylex";
import { useCallback, useEffect, useReducer, useRef, useState } from "octane";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import type { SkillFormState } from "../../../../../build/presentation/contracts/SkillFormState.ts";
import { project as rustProject } from "../../../../adapters/presentation/model.ts";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import type { SkillsTarget } from "../../../../shared/lib/data.ts";
import { IconPlus, IconX } from "../../../../shared/ui/Icons/index.tsx";
import { removeSkill, saveSkill, useSkills } from "../../hooks/useSkills.tsx";
import { SkillEditor } from "../SkillEditor/index.tsx";
import { BuiltInSkillNotice } from "./BuiltInSkillNotice.tsx";
import { SkillLibrary } from "./SkillLibrary.tsx";
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
		formDispatch(rustProject<Partial<SkillFormState>>("skillEdit", skill));
	}, []);
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const initialized = useRef(false);
	const original = form.isEditing ? selectedSkill : null;
	const dirty = rustProject<boolean>("skillDirty", { form, original });
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
		const initial = rustProject<{
			selectedId: string | null;
			form: Partial<SkillFormState>;
		}>("skillDialog", { target, skills });
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
		formDispatch(rustProject<SkillFormState>("skillDuplicate", selectedSkill));
	};

	const handleSave = async (isInlineEdit = false) => {
		if (!(isInlineEdit && selectedSkill) && !form.isCreating) return;
		formDispatch({ isSaving: true, error: "" });
		try {
			const saved = await saveSkill(
				form,
				isInlineEdit ? selectedSkill?._id : undefined,
			);
			setSelectedId(saved._id);
			formDispatch(
				isInlineEdit && selectedSkill ? { isEditing: false } : INITIAL_FORM,
			);
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
					<SkillLibrary
						startCreate={startCreate}
						form={form}
						search={search}
						setSearch={setSearch}
						filter={filter}
						setFilter={setFilter}
						filtered={filtered}
						loading={loading}
						filtering={filtering}
						selectedId={selectedId}
						selectSkill={selectSkill}
					/>
					{selectedSkill || form.isCreating ? (
						<div {...stylex.props(styles.detailPane)}>
							{selectedSkill?.isBuiltIn && !form.isCreating && (
								<BuiltInSkillNotice duplicateSelected={duplicateSelected} />
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
