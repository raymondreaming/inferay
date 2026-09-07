import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import type { SkillFormState } from "../../../../../build/presentation/contracts/SkillFormState.ts";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import type { SkillsTarget } from "../../../../shared/lib/dom.tsx";
import { createReducer } from "../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import { IconPlus, IconX } from "../../../../shared/ui/Icons/index.tsx";
import { removeSkill, saveSkill, useSkills } from "../../hooks/useSkills.tsx";
import { SkillEditor } from "../SkillEditor/index.tsx";
import { BuiltInSkillNotice } from "./BuiltInSkillNotice.tsx";
import { SkillLibrary } from "./SkillLibrary.tsx";
import { styles } from "./styles.ts";

function formReducer(state: SkillFormState, patch: Partial<SkillFormState>) {
	return patch === INITIAL_FORM
		? INITIAL_FORM
		: {
				...state,
				...patch,
			};
}
export function SkillsDialog(_props: {
	target: SkillsTarget;
	onClose: () => void;
}) {
	const _source = useSkills();
	// Resolve the opening request once; subsequent library refreshes preserve edits.
	const initial = createMemo<
		{ selectedId: string | null; form: Partial<SkillFormState> } | undefined
	>((previous) => {
		if (previous || _source.loading) return previous;
		return rustProject("skillDialog", {
			target: _props.target,
			skills: _source.skills,
		});
	});
	const [selectedId, setSelectedId] = createSignal<string | null>(
		() => initial()?.selectedId ?? null,
	);
	const selectedSkill = createMemo(
		() => _source.skills.find((skill) => skill._id === selectedId()) ?? null,
	);
	const setSelectedSkill = (skill: Prompt | null) =>
		setSelectedId(skill?._id ?? null);
	const [filter, setFilter] = createSignal("all");
	const [search, setSearch] = createSignal("");
	const [form, setForm] = createSignal<SkillFormState>(() => ({
		...INITIAL_FORM,
		...initial()?.form,
	}));
	const formDispatch = (update: Parameters<typeof formReducer>[1]) =>
		setForm((current) => formReducer(current, update));
	const startEdit = (skill: Prompt) => {
		formDispatch(rustProject<Partial<SkillFormState>>("skillEdit", skill));
	};
	const dialogRef = {
		current: null,
	} as {
		current: HTMLDialogElement | null;
	};
	const original = createMemo(() =>
		form().isEditing ? selectedSkill() : null,
	);
	const dirty = createMemo(() =>
		rustProject<boolean>("skillDirty", {
			form: form(),
			original: original(),
		}),
	);
	const canLeave = () =>
		!form().isSaving && (!dirty() || confirm("Discard unsaved skill changes?"));
	const close = () => {
		if (canLeave()) _props.onClose();
	};
	onSettled(() => {
		const previousFocus = document.activeElement as HTMLElement | null;
		dialogRef.current?.showModal();
		return () => {
			previousFocus?.focus();
		};
	});
	const handleFormChange = (field: string, value: string) => {
		formDispatch({
			[field]: value,
		});
	};
	const cancelEdit = () => {
		if (!canLeave()) return;
		formDispatch(INITIAL_FORM);
	};
	const startCreate = () => {
		if (!canLeave()) return;
		setSelectedSkill(null);
		formDispatch({
			...INITIAL_FORM,
			isCreating: true,
		});
	};
	const selectSkill = (p: Prompt) => {
		if (!canLeave()) return;
		formDispatch(INITIAL_FORM);
		setSelectedSkill(p);
	};
	const duplicateSelected = () => {
		const _selectedSkillValue = selectedSkill();
		if (!_selectedSkillValue || !canLeave()) return;
		setSelectedId(null);
		formDispatch(
			rustProject<SkillFormState>("skillDuplicate", _selectedSkillValue),
		);
	};
	const handleSave = async (isInlineEdit = false) => {
		const _selectedSkillValue2 = selectedSkill(),
			_formValue = form();
		if (!(isInlineEdit && _selectedSkillValue2) && !_formValue.isCreating)
			return;
		formDispatch({
			isSaving: true,
			error: "",
		});
		try {
			const saved = await saveSkill(
				_formValue,
				isInlineEdit ? _selectedSkillValue2?._id : undefined,
			);
			setSelectedId(saved._id);
			formDispatch(
				isInlineEdit && _selectedSkillValue2
					? {
							isEditing: false,
						}
					: INITIAL_FORM,
			);
		} catch (e) {
			formDispatch({
				error: e instanceof Error ? e.message : "Failed to save",
			});
		} finally {
			formDispatch({
				isSaving: false,
			});
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
	const _source2 = useSkills(
		() => filter(),
		() => search(),
	);
	return (
		<dialog
			ref={(element) => (dialogRef.current = element)}
			aria-label="Skills"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onKeyDown={(event) => event.stopPropagation()}
			class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.dialog).class ?? ""}`}
		>
			<div {...stylex.attrs(styles.root)}>
				<button
					type="button"
					aria-label="Close skills"
					title="Close skills"
					onClick={close}
					{...stylex.attrs(styles.closeButton)}
				>
					<IconX size={iconSize.md} />
				</button>
				{(_source.error || _source2.error) && (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{_source.error || _source2.error}
					</p>
				)}
				<div {...stylex.attrs(styles.content)}>
					<SkillLibrary
						startCreate={startCreate}
						form={form()}
						search={search()}
						setSearch={setSearch}
						filter={filter()}
						setFilter={setFilter}
						filtered={_source2.skills}
						loading={_source.loading}
						filtering={_source2.loading}
						selectedId={selectedId()}
						selectSkill={selectSkill}
					/>
					{selectedSkill() || form().isCreating ? (
						<div {...stylex.attrs(styles.detailPane)}>
							{selectedSkill()?.isBuiltIn && !form().isCreating && (
								<BuiltInSkillNotice duplicateSelected={duplicateSelected} />
							)}
							<SkillEditor
								selectedSkill={selectedSkill()}
								isCreatingNew={form().isCreating}
								isEditing={form().isEditing}
								isSaving={form().isSaving}
								formCommand={form().command}
								formName={form().name}
								formDescription={form().description}
								formInstructions={form().promptTemplate}
								formError={form().error}
								onFormChange={handleFormChange}
								onStartEditing={() => {
									const _selectedSkillValue3 = selectedSkill();
									return (
										_selectedSkillValue3 && startEdit(_selectedSkillValue3)
									);
								}}
								onCancelEditing={cancelEdit}
								onSave={handleSave}
								onDelete={() => {
									const _selectedSkillValue4 = selectedSkill();
									if (_selectedSkillValue4)
										void handleDelete(_selectedSkillValue4);
								}}
							/>
						</div>
					) : (
						<div {...stylex.attrs(styles.editorEmpty)}>
							<h2 {...stylex.attrs(styles.emptyTitle)}>Select a skill</h2>
							<button
								type="button"
								onClick={startCreate}
								{...stylex.attrs(surfaceStyles.panel, styles.newButton)}
							>
								<IconPlus size={iconSize.sm} /> Create a skill
							</button>
							{form().error && (
								<p role="alert" {...stylex.attrs(styles.error)}>
									{form().error}
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
