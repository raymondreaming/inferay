import * as stylex from "@octanejs/stylex";

import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";
import { gitOperationErrorLabel } from "./useChatDiffPanelState.tsx";

type GraphActionDialogProps = Pick<
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
	pendingGraphAction: NonNullable<
		ReturnType<typeof useChatDiffPanelState>["pendingGraphAction"]
	>;
} & {
	pendingGraphActionPresentation: NonNullable<
		ReturnType<typeof useChatDiffPanelState>["pendingGraphActionPresentation"]
	>;
};
export function GraphActionDialog({
	pendingGraphActionPresentation,
	graphActionRunning,
	setPendingGraphAction,
	pendingGraphAction,
	graphActionName,
	setGraphActionName,
	graphActionMessage,
	setGraphActionMessage,
	graphActionResult,
	runGraphAction,
}: GraphActionDialogProps) {
	return (
		<div {...stylex.props(styles.refActionOverlay)}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={pendingGraphActionPresentation.title}
				{...stylex.props(styles.refActionDialog)}
				onKeyDown={(event) => {
					if (event.key === "Escape" && !graphActionRunning) {
						setPendingGraphAction(null);
					}
				}}
			>
				<strong {...stylex.props(styles.refActionTitle)}>
					{pendingGraphActionPresentation.title}
				</strong>
				<p {...stylex.props(styles.refActionCopy)}>
					{pendingGraphActionPresentation.copy}
					{pendingGraphAction.target ? (
						<>
							{" "}
							Target <code>{pendingGraphAction.target}</code>.
						</>
					) : null}
					{pendingGraphAction.targets?.length ? (
						<>
							{" "}
							Apply oldest to newest:{" "}
							{pendingGraphAction.targets.map((target, index) => (
								<code key={target}>
									{index ? " → " : ""}
									{target.slice(0, 7)}
								</code>
							))}
						</>
					) : null}
				</p>
				{pendingGraphActionPresentation.needsName ? (
					<label {...stylex.props(styles.graphActionField)}>
						<span>{pendingGraphActionPresentation.nameLabel ?? "Name"}</span>
						<input
							value={graphActionName}
							onInput={(event) => setGraphActionName(event.currentTarget.value)}
							{...stylex.props(styles.graphActionInput)}
						/>
					</label>
				) : null}
				{pendingGraphActionPresentation.messageLabel ? (
					<label {...stylex.props(styles.graphActionField)}>
						<span>{pendingGraphActionPresentation.messageLabel}</span>
						<textarea
							rows={2}
							value={graphActionMessage}
							onInput={(event) =>
								setGraphActionMessage(event.currentTarget.value)
							}
							{...stylex.props(styles.graphActionInput)}
						/>
					</label>
				) : null}
				{graphActionResult?.error ? (
					<p {...stylex.props(styles.refActionError)}>
						<strong>
							{gitOperationErrorLabel(graphActionResult.errorKind)}:
						</strong>{" "}
						{graphActionResult.error}
					</p>
				) : null}
				<div {...stylex.props(styles.refActionButtons)}>
					<button
						type="button"
						disabled={graphActionRunning}
						onClick={() => setPendingGraphAction(null)}
						{...stylex.props(styles.refActionSecondary)}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={
							graphActionRunning ||
							(pendingGraphActionPresentation.needsName &&
								!graphActionName.trim())
						}
						onClick={runGraphAction}
						{...stylex.props(
							pendingGraphActionPresentation.danger
								? styles.graphActionDanger
								: styles.refActionPrimary,
						)}
					>
						{graphActionRunning
							? "Working…"
							: pendingGraphActionPresentation.confirm}
					</button>
				</div>
			</div>
		</div>
	);
}
