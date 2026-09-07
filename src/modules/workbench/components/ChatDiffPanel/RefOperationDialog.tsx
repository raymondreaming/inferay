import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

type RefOperationDialogProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	| "refOperationResult"
	| "refPreflightError"
	| "refPreflightRunning"
	| "operationModel"
	| "refOperationRunning"
	| "runRefOperation"
	| "setPendingRefAction"
> & {
	pendingRefAction: NonNullable<
		ReturnType<typeof useChatDiffPanelState>["pendingRefAction"]
	>;
};
export function RefOperationDialog(_props: RefOperationDialogProps) {
	return (
		<div {...stylex.attrs(styles.refActionOverlay)}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Choose branch operation"
				{...stylex.attrs(styles.refActionDialog)}
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
				{!_props.operationModel.conflictMessage &&
				_props.refPreflightRunning ? (
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
						<For
							each={_props.operationModel.actions}
							keyed={(row) => row.label}
						>
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
			</div>
		</div>
	);
}
