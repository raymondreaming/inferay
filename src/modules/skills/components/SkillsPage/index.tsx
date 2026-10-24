import type { SkillDialogView, SkillSaveRequest } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import type { SkillsTarget } from "@shared/lib/dom.tsx";
import { SkillDialogReplica } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconPlus } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onSettled,
	Show,
	untrack,
} from "solid-js";
import {
	removeSkill,
	saveSkill,
	skillsQuery,
} from "../../services/skillsApi.ts";
import { SkillEditor } from "../SkillEditor/index.tsx";
import { BuiltInSkillNotice } from "./BuiltInSkillNotice.tsx";
import { SkillLibrary } from "./SkillLibrary.tsx";
import { styles } from "./styles.ts";

export function SkillsPage(_props: {
	target: SkillsTarget;
	setLeaveGuard: (guard: ((proceed: () => void) => void) | null) => void;
}) {
	const model = untrack(
		() => new SkillDialogReplica(JSON.stringify(_props.target)),
	);
	const query = useQuery(skillsQuery);
	const [search, setSearch] = createSignal("");
	const [confirmation, setConfirmation] = createSignal<{
		message: string;
		label: string;
		run: () => void;
	} | null>(null);
	const [revision, setRevision] = createSignal(0);
	const read = (): SkillDialogView => JSON.parse(model.snapshot(search()));
	const view = createMemo(() => {
		void revision();
		return read();
	});
	const publish = () => setRevision((value) => value + 1);
	let disposed = false;
	onCleanup(() => {
		disposed = true;
		model.free();
	});
	createEffect(
		() => ({ library: query.data, pending: query.isPending }),
		({ library, pending }) => {
			if (!pending) {
				model.receive(JSON.stringify(library ?? []));
				publish();
			}
		},
	);
	const dispatch = (type: string, fields: Record<string, unknown> = {}) => {
		if (disposed) return;
		model.dispatch(JSON.stringify({ type, ...fields }));
		publish();
	};
	const guardLeave = (proceed: () => void) => {
		if (disposed || read().editor.busy) return;
		if (read().dirty) {
			setConfirmation({
				message: "You have unsaved skill changes.",
				label: "Discard changes",
				run: proceed,
			});
		} else proceed();
	};
	const leave = (type: string, fields: Record<string, unknown> = {}) => {
		guardLeave(() => dispatch(type, fields));
	};
	onSettled(() => {
		_props.setLeaveGuard(guardLeave);
		return () => _props.setLeaveGuard(null);
	});
	const handleSave = async () => {
		if (disposed) return;
		const serialized = model.save_request();
		publish();
		if (!serialized) return;
		const request: SkillSaveRequest = JSON.parse(serialized);
		try {
			const saved = await saveSkill(request.body, request.id ?? undefined);
			dispatch("saved", { id: saved._id });
		} catch (error) {
			dispatch("failed", {
				message: error instanceof Error ? error.message : "Failed to save",
			});
		}
	};
	const handleDelete = () => {
		if (disposed) return;
		const current = read();
		if (current.editor.busy || !current.deleteConfirmation) return;
		setConfirmation({
			message: current.deleteConfirmation,
			label: "Delete skill",
			run: async () => {
				const id = model.delete_request();
				publish();
				if (!id) return;
				try {
					await removeSkill(id);
					dispatch("deleted");
				} catch (error) {
					dispatch("failed", {
						message:
							error instanceof Error ? error.message : "Failed to delete skill",
					});
				}
			},
		});
	};
	return (
		<div {...stylex.attrs(styles.root)}>
			<Show when={confirmation()} keyed>
				{(pending) => (
					<div role="alert" {...stylex.attrs(styles.confirmation)}>
						<span>{pending.message}</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setConfirmation(null)}
						>
							Keep editing
						</Button>
						<Button
							variant="danger"
							size="sm"
							onClick={() => {
								setConfirmation(null);
								pending.run();
							}}
						>
							{pending.label}
						</Button>
					</div>
				)}
			</Show>
			{query.error && (
				<p role="alert" {...stylex.attrs(styles.error)}>
					{query.error?.message}
				</p>
			)}
			<div inert={!!confirmation()} {...stylex.attrs(styles.content)}>
				<SkillLibrary
					startCreate={() => leave("create")}
					busy={view().editor.busy}
					search={search()}
					setSearch={setSearch}
					rows={view().rows}
					loading={query.isPending}
					selectSkill={(id) => leave("select", { id })}
				/>
				{view().showEditor ? (
					<div {...stylex.attrs(styles.detailPane)}>
						{view().builtIn && (
							<BuiltInSkillNotice
								duplicateSelected={() => leave("duplicate")}
							/>
						)}
						<SkillEditor
							view={view().editor}
							onFormChange={(field, value) =>
								dispatch("field", { field, value })
							}
							onStartEditing={() => dispatch("edit")}
							onCancelEditing={() => leave("cancel")}
							onSave={handleSave}
							onDelete={handleDelete}
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
							onClick={() => leave("create")}
						>
							<IconPlus size={iconSize.md} />
							<span>Create a skill</span>
						</Button>
						{view().editor.form.error && (
							<p role="alert" {...stylex.attrs(styles.error)}>
								{view().editor.form.error}
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
