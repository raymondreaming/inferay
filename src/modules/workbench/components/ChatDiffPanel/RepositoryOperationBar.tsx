import * as stylex from "@octanejs/stylex";

import { styles } from "./styles.ts";

import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

type RepositoryOperationBarProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	| "repositoryOperation"
	| "resumableOperation"
	| "refOperationRunning"
	| "runRefOperation"
>;
export function RepositoryOperationBar({
	repositoryOperation,
	resumableOperation,
	refOperationRunning,
	runRefOperation,
}: RepositoryOperationBarProps) {
	return (
		<div role="status" {...stylex.props(styles.repositoryOperationBar)}>
			<div {...stylex.props(styles.repositoryOperationCopy)}>
				<strong>{repositoryOperation.kind} in progress</strong>
				<span>
					{repositoryOperation.conflicts.length
						? `${repositoryOperation.conflicts.length} conflicted ${repositoryOperation.conflicts.length === 1 ? "file" : "files"}`
						: "Ready to continue"}
				</span>
			</div>
			{resumableOperation ? (
				<div {...stylex.props(styles.refActionButtons)}>
					<button
						type="button"
						disabled={refOperationRunning}
						onClick={() => runRefOperation(resumableOperation, "abort")}
						{...stylex.props(styles.refActionSecondary)}
					>
						Abort
					</button>
					{resumableOperation !== "merge" ? (
						<button
							type="button"
							disabled={refOperationRunning}
							onClick={() => runRefOperation(resumableOperation, "skip")}
							{...stylex.props(styles.refActionSecondary)}
						>
							Skip
						</button>
					) : null}
					<button
						type="button"
						disabled={
							refOperationRunning || repositoryOperation.conflicts.length > 0
						}
						onClick={() => runRefOperation(resumableOperation, "continue")}
						{...stylex.props(styles.refActionPrimary)}
					>
						Continue
					</button>
				</div>
			) : null}
		</div>
	);
}
