import type { SkillDialogView, SkillSaveRequest } from "@contracts";
import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import {
	APP_REGION_NO_DRAG_CLASS,
	listenWindowEvent,
	OPEN_SKILLS_EVENT,
	queryClient,
	type SkillsTarget,
} from "@shared/lib/dom.tsx";
import { SkillDialogReplica } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconPlus, IconX } from "@shared/ui/Icons/index.tsx";
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

export function SkillsModalHost() {
	const [request, setRequest] = createSignal<{
		target: SkillsTarget;
		key: number;
	} | null>(null);
	onSettled(() => {
		return listenWindowEvent(OPEN_SKILLS_EVENT, (event) => {
			const target = (event as CustomEvent<SkillsTarget>).detail;
			setRequest({
				target: target ?? {
					mode: "browse",
				},
				key: Date.now(),
			});
		});
	});
	return (
		<Show when={request()} keyed>
			{(value) => (
				<SkillsDialog target={value.target} onClose={() => setRequest(null)} />
			)}
		</Show>
	);
}

export function SkillsDialog(_props: {
	target: SkillsTarget;
	onClose: () => void;
}) {
	const model = untrack(
		() => new SkillDialogReplica(JSON.stringify(_props.target)),
	);
	const query = useQuery(skillsQuery, () => queryClient);
	const [search, setSearch] = createSignal("");
	const [revision, setRevision] = createSignal(0);
	const read = (): SkillDialogView => JSON.parse(model.snapshot(search()));
	const view = createMemo(() => {
		void revision();
		return read();
	});
	const publish = () => setRevision((value) => value + 1);
	let disposed = false;
	let dialog: HTMLDialogElement | undefined;
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
	const canLeave = () => {
		if (disposed) return false;
		const current = read();
		return (
			!current.editor.busy &&
			(!current.dirty || confirm("Discard unsaved skill changes?"))
		);
	};
	const leave = (type: string, fields: Record<string, unknown> = {}) => {
		if (canLeave()) dispatch(type, fields);
	};
	const close = () => {
		if (canLeave()) _props.onClose();
	};
	onSettled(() => {
		const previousFocus = document.activeElement as HTMLElement | null;
		dialog?.showModal();
		return () => previousFocus?.focus();
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
	const handleDelete = async () => {
		if (disposed) return;
		const current = read();
		if (
			current.editor.busy ||
			!current.deleteConfirmation ||
			!confirm(current.deleteConfirmation)
		)
			return;
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
	};
	return (
		<dialog
			ref={(element) => (dialog = element)}
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
					disabled={view().editor.busy}
					class={stylex.attrs(styles.closeButton).class}
				>
					<IconX size={iconSize.md} />
				</IconButton>
				{query.error && (
					<p role="alert" {...stylex.attrs(styles.error)}>
						{query.error?.message}
					</p>
				)}
				<div {...stylex.attrs(styles.content)}>
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
		</dialog>
	);
}
