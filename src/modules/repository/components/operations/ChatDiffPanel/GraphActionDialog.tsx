import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

export function GraphActionDialog(
	_props: Pick<
		ReturnType<typeof useChatDiffPanelState>,
		| "graphActionRunning"
		| "setPendingGraphAction"
		| "graphActionName"
		| "setGraphActionName"
		| "graphActionMessage"
		| "setGraphActionMessage"
		| "graphActionResult"
		| "runGraphAction"
	> & {
		returnFocus: () => HTMLElement | null | undefined;
		pendingGraphAction: NonNullable<
			ReturnType<typeof useChatDiffPanelState>["pendingGraphAction"]
		>;
	} & {
		pendingGraphActionPresentation: NonNullable<
			ReturnType<typeof useChatDiffPanelState>["pendingGraphActionPresentation"]
		>;
	},
) {
	return (
		<Modal
			label={_props.pendingGraphActionPresentation.title}
			onClose={() => {
				if (!_props.graphActionRunning) _props.setPendingGraphAction(null);
			}}
			closeDisabled={_props.graphActionRunning}
			returnFocus={_props.returnFocus}
			class={stylex.attrs(styles.refActionDialog).class}
		>
			<strong {...stylex.attrs(styles.refActionTitle)}>
				{_props.pendingGraphActionPresentation.title}
			</strong>
			<p {...stylex.attrs(styles.refActionCopy)}>
				{_props.pendingGraphActionPresentation.copy}
				{_props.pendingGraphAction.target ? (
					<>
						{" "}
						Target <code>{_props.pendingGraphAction.target}</code>.
					</>
				) : null}
				{_props.pendingGraphAction.targets?.length ? (
					<>
						{" "}
						Apply oldest to newest:{" "}
						{
							<For
								each={_props.pendingGraphAction.targets}
								keyed={(row) => row}
							>
								{(target, index) => (
									<code>
										{index() ? " → " : ""}
										{target().slice(0, 7)}
									</code>
								)}
							</For>
						}
					</>
				) : null}
			</p>
			{_props.pendingGraphActionPresentation.needsName ? (
				<label {...stylex.attrs(styles.graphActionField)}>
					<span>
						{_props.pendingGraphActionPresentation.nameLabel ?? "Name"}
					</span>
					<input
						value={_props.graphActionName}
						onInput={(event) =>
							_props.setGraphActionName(event.currentTarget.value)
						}
						{...stylex.attrs(styles.graphActionInput)}
					/>
				</label>
			) : null}
			{_props.pendingGraphActionPresentation.messageLabel ? (
				<label {...stylex.attrs(styles.graphActionField)}>
					<span>{_props.pendingGraphActionPresentation.messageLabel}</span>
					<textarea
						rows={2}
						value={_props.graphActionMessage}
						onInput={(event) =>
							_props.setGraphActionMessage(event.currentTarget.value)
						}
						{...stylex.attrs(styles.graphActionInput)}
					/>
				</label>
			) : null}
			{_props.graphActionResult?.error ? (
				<p {...stylex.attrs(styles.refActionError)}>
					<strong>
						{_props.graphActionResult.errorLabel ?? "Git command failed"}:
					</strong>{" "}
					{_props.graphActionResult.error}
				</p>
			) : null}
			<div {...stylex.attrs(styles.refActionButtons)}>
				<button
					type="button"
					disabled={_props.graphActionRunning}
					onClick={() => _props.setPendingGraphAction(null)}
					{...stylex.attrs(styles.refActionSecondary)}
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={
						_props.graphActionRunning ||
						(_props.pendingGraphActionPresentation.needsName &&
							!_props.graphActionName.trim())
					}
					onClick={_props.runGraphAction}
					{...stylex.attrs(
						_props.pendingGraphActionPresentation.danger
							? styles.graphActionDanger
							: styles.refActionPrimary,
					)}
				>
					{_props.graphActionRunning
						? "Working…"
						: _props.pendingGraphActionPresentation.confirm}
				</button>
			</div>
		</Modal>
	);
}
