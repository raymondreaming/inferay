import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

export function RefOperationDialog(
	_props: Pick<
		ReturnType<typeof useChatDiffPanelState>,
		| "refOperationResult"
		| "refPreflightError"
		| "refPreflightRunning"
		| "operationModel"
		| "refOperationRunning"
		| "runRefOperation"
		| "setPendingRefAction"
	> & {
		returnFocus: () => HTMLElement | null | undefined;
		pendingRefAction: NonNullable<
			ReturnType<typeof useChatDiffPanelState>["pendingRefAction"]
		>;
	},
) {
	return (
		<Modal
			label={"Choose branch operation"}
			onClose={() => {
				if (!_props.refOperationRunning) _props.setPendingRefAction(null);
			}}
			closeDisabled={_props.refOperationRunning}
			returnFocus={_props.returnFocus}
			class={stylex.attrs(styles.refActionDialog).class}
		>
			<strong {...stylex.attrs(styles.refActionTitle)}>
				Move branch history
			</strong>
			<p {...stylex.attrs(styles.refActionCopy)}>
				Source <code>{_props.pendingRefAction.source}</code> → target{" "}
				<code>{_props.pendingRefAction.target}</code>
			</p>
			{_props.refOperationResult?.error || _props.refPreflightError ? (
				<p {...stylex.attrs(styles.refActionError)}>
					<strong>
						{_props.refOperationResult?.errorLabel ?? "Git command failed"}:
					</strong>{" "}
					{_props.refOperationResult?.error || _props.refPreflightError}
				</p>
			) : null}
			{_props.operationModel.conflictMessage ? (
				<p {...stylex.attrs(styles.refActionCopy)}>
					{_props.operationModel.conflictMessage}
				</p>
			) : null}
			{!_props.operationModel.conflictMessage && _props.refPreflightRunning ? (
				<p {...stylex.attrs(styles.refActionCopy)}>
					Checking valid operations…
				</p>
			) : null}
			{_props.operationModel.blockedReason ? (
				<p {...stylex.attrs(styles.refActionError)}>
					{_props.operationModel.blockedReason}
				</p>
			) : null}
			<div {...stylex.attrs(styles.refActionButtons)}>
				{
					<For each={_props.operationModel.actions} keyed={(row) => row.label}>
						{(action) => (
							<button
								type="button"
								disabled={_props.refOperationRunning}
								onClick={() =>
									action().operation
										? _props.runRefOperation(
												action().operation!,
												action().phase,
											)
										: _props.setPendingRefAction(null)
								}
								{...stylex.attrs(
									action().primary
										? styles.refActionPrimary
										: styles.refActionSecondary,
								)}
							>
								{action().label}
							</button>
						)}
					</For>
				}
			</div>
		</Modal>
	);
}
