import * as stylex from "@octanejs/stylex";
import { project } from "../../../../adapters/presentation/model.ts";

import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

type RefOperationDialogProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	| "refOperationResult"
	| "refPreflightError"
	| "refPreflightRunning"
	| "refOperationPreflight"
	| "refOperationRunning"
	| "runRefOperation"
	| "setPendingRefAction"
> & {
	pendingRefAction: NonNullable<
		ReturnType<typeof useChatDiffPanelState>["pendingRefAction"]
	>;
};
export function RefOperationDialog({
	pendingRefAction,
	refOperationResult,
	refPreflightError,
	refPreflightRunning,
	refOperationPreflight,
	refOperationRunning,
	runRefOperation,
	setPendingRefAction,
}: RefOperationDialogProps) {
	const model = project<{
		actions: Array<{
			label: string;
			operation: Parameters<typeof runRefOperation>[0] | null;
			phase: Parameters<typeof runRefOperation>[1];
			primary: boolean;
		}>;
		conflictMessage: string | null;
		blockedReason: string | null;
	}>("refOperationDialog", {
		result: refOperationResult,
		preflight: refOperationPreflight,
	});

	return (
		<div {...stylex.props(styles.refActionOverlay)}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Choose branch operation"
				{...stylex.props(styles.refActionDialog)}
			>
				<strong {...stylex.props(styles.refActionTitle)}>
					Move branch history
				</strong>
				<p {...stylex.props(styles.refActionCopy)}>
					Source <code>{pendingRefAction.source}</code> → target{" "}
					<code>{pendingRefAction.target}</code>
				</p>
				{refOperationResult?.error || refPreflightError ? (
					<p {...stylex.props(styles.refActionError)}>
						<strong>
							{refOperationResult?.errorLabel ?? "Git command failed"}:
						</strong>{" "}
						{refOperationResult?.error || refPreflightError}
					</p>
				) : null}
				{model.conflictMessage ? (
					<p {...stylex.props(styles.refActionCopy)}>{model.conflictMessage}</p>
				) : null}
				{!model.conflictMessage && refPreflightRunning ? (
					<p {...stylex.props(styles.refActionCopy)}>
						Checking valid operations…
					</p>
				) : null}
				{model.blockedReason ? (
					<p {...stylex.props(styles.refActionError)}>{model.blockedReason}</p>
				) : null}
				<div {...stylex.props(styles.refActionButtons)}>
					{model.actions.map((action) => (
						<button
							key={action.label}
							type="button"
							disabled={refOperationRunning}
							onClick={() =>
								action.operation
									? runRefOperation(action.operation, action.phase)
									: setPendingRefAction(null)
							}
							{...stylex.props(
								action.primary
									? styles.refActionPrimary
									: styles.refActionSecondary,
							)}
						>
							{action.label}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
