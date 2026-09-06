import * as stylex from "@octanejs/stylex";

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
	const actions: Array<{
		label: string;
		run: () => void;
		primary?: boolean;
		show?: boolean;
	}> = refOperationResult?.conflicts.length
		? [
				{
					label: "Abort",
					run: () => runRefOperation(refOperationResult.operation, "abort"),
				},
				{
					label: "Skip commit",
					show: refOperationResult.operation !== "merge",
					run: () => runRefOperation(refOperationResult.operation, "skip"),
				},
				{
					label: "Continue",
					primary: true,
					run: () => runRefOperation(refOperationResult.operation, "continue"),
				},
			]
		: [
				{ label: "Cancel", run: () => setPendingRefAction(null) },
				{
					label: "Rebase source onto target",
					show: !!refOperationPreflight?.canRebase,
					run: () => runRefOperation("rebase"),
				},
				{
					label: "Fast-forward target",
					show: !!refOperationPreflight?.canFastForward,
					run: () => runRefOperation("fastForward"),
				},
				{
					label: "Merge source into target",
					show: !!refOperationPreflight?.canMerge,
					primary: true,
					run: () => runRefOperation("merge"),
				},
			];
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
				{refOperationResult?.conflicts.length ? (
					<p {...stylex.props(styles.refActionCopy)}>
						Resolve {refOperationResult.conflicts.length} conflicted file
						{refOperationResult.conflicts.length === 1 ? "" : "s"}, then
						continue or abort.
					</p>
				) : null}
				{!refOperationResult?.conflicts.length && refPreflightRunning ? (
					<p {...stylex.props(styles.refActionCopy)}>
						Checking valid operations…
					</p>
				) : null}
				{!refOperationResult?.conflicts.length &&
				refOperationPreflight &&
				!refOperationPreflight.canMerge &&
				!refOperationPreflight.canRebase ? (
					<p {...stylex.props(styles.refActionError)}>
						{refOperationPreflight.reasons.join("../../hooks/. ")}
					</p>
				) : null}
				<div {...stylex.props(styles.refActionButtons)}>
					{actions
						.filter((action) => action.show !== false)
						.map((action) => (
							<button
								key={action.label}
								type="button"
								disabled={refOperationRunning}
								onClick={action.run}
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
