import type { Prompt, SkillFormState } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import { APP_REGION_NO_DRAG_CLASS } from "../../../../app/hooks/useAppAppearance.tsx";
import {
	iconSize,
	surfaceStyles,
} from "../../../../design-system/styles.stylex.ts";
import type { SkillsTarget } from "../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
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
	// Solid batches signal writes; guard mutations synchronously within an event.
	let mutationPending = false;
	let disposed = false;
	onCleanup(() => {
		disposed = true;
	});
	const [deleting, setDeleting] = createSignal(false);
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
	const [search, setSearch] = createSignal("");
	const [form, setForm] = createSignal<SkillFormState>(() => ({
		...INITIAL_FORM,
		...initial()?.form,
	}));
	const formDispatch = (update: Parameters<typeof formReducer>[1]) =>
		setForm((current) => formReducer(current, update));
	const startEdit = (skill: Prompt) => {
		if (mutationPending || disposed) return;
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
		!mutationPending &&
		!disposed &&
		(!dirty() || confirm("Discard unsaved skill changes?"));
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
		if (mutationPending || disposed) return;
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
		if (mutationPending || disposed) return;
		const _selectedSkillValue2 = selectedSkill(),
			_formValue = form();
		if (!(isInlineEdit && _selectedSkillValue2) && !_formValue.isCreating)
			return;
		mutationPending = true;
		formDispatch({
			isSaving: true,
			error: "",
		});
		try {
			const saved = await saveSkill(
				_formValue,
				isInlineEdit ? _selectedSkillValue2?._id : undefined,
			);
			if (disposed) return;
			setSelectedId(saved._id);
			formDispatch(
				isInlineEdit && _selectedSkillValue2
					? {
							isEditing: false,
						}
					: INITIAL_FORM,
			);
		} catch (e) {
			if (disposed) return;
			formDispatch({
				error: e instanceof Error ? e.message : "Failed to save",
			});
		} finally {
			mutationPending = false;
			if (!disposed) formDispatch({ isSaving: false });
		}
	};
	const handleDelete = async (p: Prompt) => {
		if (
			mutationPending ||
			disposed ||
			p.isBuiltIn ||
			!confirm(`Delete /${p.command}?`)
		)
			return;
		mutationPending = true;
		setDeleting(true);
		formDispatch({ error: "" });
		try {
			await removeSkill(p._id);
			if (disposed) return;
			setSelectedId(null);
			formDispatch(INITIAL_FORM);
		} catch (error) {
			if (disposed) return;
			formDispatch({
				error:
					error instanceof Error ? error.message : "Failed to delete skill",
			});
		} finally {
			mutationPending = false;
			if (!disposed) setDeleting(false);
		}
	};
	const _source2 = useSkills(undefined, () => search());
	return (
		<dialog
			ref={(element) => (dialogRef.current = element)}
			aria-label="Skills"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onKeyDown={(event) => event.stopPropagation()}
			class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(surfaceStyles.overlay, styles.dialog).class ?? ""}`}
		>
			<div {...stylex.attrs(styles.root)}>
				<IconButton
					type="button"
					variant="ghost"
					size="sm"
					aria-label="Close skills"
					title="Close skills"
					onClick={close}
					disabled={form().isSaving || deleting()}
					class={stylex.attrs(styles.closeButton).class}
				>
					<IconX size={iconSize.md} />
				</IconButton>
				{(_source.error || _source2.error) && (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{_source.error || _source2.error}
					</p>
				)}
				<div {...stylex.attrs(styles.content)}>
					<SkillLibrary
						startCreate={startCreate}
						form={{
							isCreating: form().isCreating,
							isSaving: form().isSaving || deleting(),
						}}
						search={search()}
						setSearch={setSearch}
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
								isDeleting={deleting()}
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
							<p {...stylex.attrs(styles.emptyHint)}>
								Pick a skill from the library to read it, or start a new one.
							</p>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={startCreate}
							>
								<IconPlus size={iconSize.md} />
								<span>Create a skill</span>
							</Button>
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
