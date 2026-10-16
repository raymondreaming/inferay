import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";
import type { useGitOperations } from "./useGitOperations.tsx";

export function GraphActionDialog(props: {
	operations: ReturnType<typeof useGitOperations>;
	returnFocus: () => HTMLElement | null | undefined;
	pendingGraphAction: NonNullable<
		ReturnType<typeof useGitOperations>["state"]["pendingGraphAction"]
	>;
	pendingGraphActionPresentation: NonNullable<
		ReturnType<ReturnType<typeof useGitOperations>["presentation"]>
	>;
}) {
	const operations = props.operations;
	const { state } = operations;
	return (
		<Modal
			label={props.pendingGraphActionPresentation.title}
			onClose={() => {
				if (!state.graphActionRunning)
					operations.update({ pendingGraphAction: null });
			}}
			closeDisabled={state.graphActionRunning}
			returnFocus={props.returnFocus}
			class={stylex.attrs(styles.refActionDialog).class}
		>
			<strong {...stylex.attrs(styles.refActionTitle)}>
				{props.pendingGraphActionPresentation.title}
			</strong>
			<p {...stylex.attrs(styles.refActionCopy)}>
				{props.pendingGraphActionPresentation.copy}
				{props.pendingGraphAction.target ? (
					<>
						{" "}
						Target <code>{props.pendingGraphAction.target}</code>.
					</>
				) : null}
				{props.pendingGraphAction.targets?.length ? (
					<>
						{" "}
						Apply oldest to newest:{" "}
						{
							<For each={props.pendingGraphAction.targets} keyed={(row) => row}>
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
			{props.pendingGraphActionPresentation.needsName ? (
				<label {...stylex.attrs(styles.graphActionField)}>
					<span>
						{props.pendingGraphActionPresentation.nameLabel ?? "Name"}
					</span>
					<input
						value={state.graphActionName}
						onInput={(event) =>
							operations.update({ graphActionName: event.currentTarget.value })
						}
						{...stylex.attrs(styles.graphActionInput)}
					/>
				</label>
			) : null}
			{props.pendingGraphActionPresentation.messageLabel ? (
				<label {...stylex.attrs(styles.graphActionField)}>
					<span>{props.pendingGraphActionPresentation.messageLabel}</span>
					<textarea
						rows={2}
						value={state.graphActionMessage}
						onInput={(event) =>
							operations.update({
								graphActionMessage: event.currentTarget.value,
							})
						}
						{...stylex.attrs(styles.graphActionInput)}
					/>
				</label>
			) : null}
			{state.graphActionResult?.error ? (
				<p {...stylex.attrs(styles.refActionError)}>
					<strong>
						{state.graphActionResult.errorLabel ?? "Git command failed"}:
					</strong>{" "}
					{state.graphActionResult.error}
				</p>
			) : null}
			<div {...stylex.attrs(styles.refActionButtons)}>
				<button
					type="button"
					disabled={state.graphActionRunning}
					onClick={() => operations.update({ pendingGraphAction: null })}
					{...stylex.attrs(styles.refActionSecondary)}
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={
						state.graphActionRunning ||
						(props.pendingGraphActionPresentation.needsName &&
							!state.graphActionName.trim())
					}
					onClick={operations.runGraphAction}
					{...stylex.attrs(
						props.pendingGraphActionPresentation.danger
							? styles.graphActionDanger
							: styles.refActionPrimary,
					)}
				>
					{state.graphActionRunning
						? "Working…"
						: props.pendingGraphActionPresentation.confirm}
				</button>
			</div>
		</Modal>
	);
}
