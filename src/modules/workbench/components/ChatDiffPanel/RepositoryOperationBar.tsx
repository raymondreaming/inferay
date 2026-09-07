import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

type RepositoryOperationBarProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	"operationModel" | "refOperationRunning" | "runRefOperation"
>;
export function RepositoryOperationBar(_props: RepositoryOperationBarProps) {
	return (
		<div role="status" {...stylex.attrs(styles.repositoryOperationBar)}>
			<div {...stylex.attrs(styles.repositoryOperationCopy)}>
				<strong>{_props.operationModel.recoveryTitle}</strong>
				<span>{_props.operationModel.recoveryMessage}</span>
			</div>
			<div {...stylex.attrs(styles.refActionButtons)}>
				{
					<For
						each={_props.operationModel.recoveryActions}
						keyed={(row) => row.label}
					>
						{(action) => (
							<button
								type="button"
								disabled={_props.refOperationRunning || action().disabled}
								onClick={() =>
									action().operation &&
									_props.runRefOperation(action().operation!, action().phase)
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
	);
}
