import * as stylex from "@octanejs/stylex";

import type { GitInteractiveRebaseStep } from "../../../repository/model/types.ts";

import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";
import { gitOperationErrorLabel } from "./useChatDiffPanelState.tsx";

type RefOperationDialogProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	| "interactiveRebaseOpen"
	| "refOperationResult"
	| "interactiveRebasePlan"
	| "interactiveRebaseCommits"
	| "moveRebaseRow"
	| "setInteractiveRebasePlan"
	| "refPreflightRunning"
	| "refOperationPreflight"
	| "refOperationRunning"
	| "runRefOperation"
	| "setInteractiveRebaseOpen"
	| "setPendingRefAction"
> & {
	pendingRefAction: NonNullable<
		ReturnType<typeof useChatDiffPanelState>["pendingRefAction"]
	>;
};
export function RefOperationDialog({
	interactiveRebaseOpen,
	pendingRefAction,
	refOperationResult,
	interactiveRebasePlan,
	interactiveRebaseCommits,
	moveRebaseRow,
	setInteractiveRebasePlan,
	refPreflightRunning,
	refOperationPreflight,
	refOperationRunning,
	runRefOperation,
	setInteractiveRebaseOpen,
	setPendingRefAction,
}: RefOperationDialogProps) {
	return (
		<div {...stylex.props(styles.refActionOverlay)}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Choose branch operation"
				{...stylex.props(styles.refActionDialog)}
			>
				<strong {...stylex.props(styles.refActionTitle)}>
					{interactiveRebaseOpen ? "Interactive rebase" : "Move branch history"}
				</strong>
				<p {...stylex.props(styles.refActionCopy)}>
					Source <code>{pendingRefAction.source}</code> → target{" "}
					<code>{pendingRefAction.target}</code>
				</p>
				{interactiveRebaseOpen && !refOperationResult?.conflicts.length ? (
					<>
						<p {...stylex.props(styles.refActionCopy)}>
							Oldest commit first. Drag rows or use the arrow buttons to
							reorder, then choose Pick, Reword, Squash, or Drop.
						</p>
						<div {...stylex.props(styles.rebasePlan)}>
							{interactiveRebasePlan.map((step, index) => {
								const commit = interactiveRebaseCommits.get(step.hash);
								return (
									<div
										key={step.hash}
										draggable
										onDragStart={(event) => {
											event.dataTransfer?.setData(
												"application/x-inferay-rebase-step",
												String(index),
											);
										}}
										onDragOver={(event) => event.preventDefault()}
										onDrop={(event) => {
											const payload = event.dataTransfer?.getData(
												"application/x-inferay-rebase-step",
											);
											if (!payload) return;
											const from = Number(payload);
											if (Number.isInteger(from)) {
												moveRebaseRow(from, index);
											}
										}}
										{...stylex.props(styles.rebasePlanRow)}
									>
										<div {...stylex.props(styles.rebasePlanControls)}>
											<select
												value={step.action}
												onChange={(event) =>
													setInteractiveRebasePlan((current) =>
														current.map((row, rowIndex) =>
															rowIndex === index
																? {
																		...row,
																		action: event.currentTarget
																			.value as GitInteractiveRebaseStep["action"],
																	}
																: row,
														),
													)
												}
												aria-label={`Action for ${step.hash.slice(0, 7)}`}
												{...stylex.props(styles.rebaseActionSelect)}
											>
												<option value="pick">Pick</option>
												<option value="reword">Reword</option>
												<option value="squash">Squash</option>
												<option value="drop">Drop</option>
											</select>
											<button
												type="button"
												disabled={index === 0}
												onClick={() => moveRebaseRow(index, index - 1)}
												aria-label={`Move ${step.hash.slice(0, 7)} earlier`}
												{...stylex.props(styles.rebaseMoveButton)}
											>
												↑
											</button>
											<button
												type="button"
												disabled={index === interactiveRebasePlan.length - 1}
												onClick={() => moveRebaseRow(index, index + 1)}
												aria-label={`Move ${step.hash.slice(0, 7)} later`}
												{...stylex.props(styles.rebaseMoveButton)}
											>
												↓
											</button>
											<code {...stylex.props(styles.rebaseSha)}>
												{step.hash.slice(0, 7)}
											</code>
											<span {...stylex.props(styles.rebaseSubject)}>
												{commit?.message ?? step.message}
											</span>
										</div>
										{step.action === "reword" ? (
											<input
												value={step.message ?? ""}
												onInput={(event) =>
													setInteractiveRebasePlan((current) =>
														current.map((row, rowIndex) =>
															rowIndex === index
																? {
																		...row,
																		message: event.currentTarget.value,
																	}
																: row,
														),
													)
												}
												aria-label={`New message for ${step.hash.slice(0, 7)}`}
												{...stylex.props(styles.graphActionInput)}
											/>
										) : null}
									</div>
								);
							})}
						</div>
					</>
				) : null}
				{refOperationResult?.error ? (
					<p {...stylex.props(styles.refActionError)}>
						<strong>
							{gitOperationErrorLabel(refOperationResult.errorKind)}:
						</strong>{" "}
						{refOperationResult.error}
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
					{refOperationResult?.conflicts.length ? (
						<>
							<button
								type="button"
								disabled={refOperationRunning}
								onClick={() =>
									runRefOperation(refOperationResult.operation, "abort")
								}
								{...stylex.props(styles.refActionSecondary)}
							>
								Abort
							</button>
							{refOperationResult.operation !== "merge" ? (
								<button
									type="button"
									disabled={refOperationRunning}
									onClick={() =>
										runRefOperation(refOperationResult.operation, "skip")
									}
									{...stylex.props(styles.refActionSecondary)}
								>
									Skip commit
								</button>
							) : null}
							<button
								type="button"
								disabled={refOperationRunning}
								onClick={() =>
									runRefOperation(refOperationResult.operation, "continue")
								}
								{...stylex.props(styles.refActionPrimary)}
							>
								Continue
							</button>
						</>
					) : interactiveRebaseOpen ? (
						<>
							<button
								type="button"
								disabled={refOperationRunning}
								onClick={() => setInteractiveRebaseOpen(false)}
								{...stylex.props(styles.refActionSecondary)}
							>
								Back
							</button>
							<button
								type="button"
								disabled={refOperationRunning}
								onClick={() => runRefOperation("interactiveRebase")}
								{...stylex.props(styles.refActionPrimary)}
							>
								{refOperationRunning ? "Rebasing…" : "Start interactive rebase"}
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								disabled={refOperationRunning}
								onClick={() => setPendingRefAction(null)}
								{...stylex.props(styles.refActionSecondary)}
							>
								Cancel
							</button>
							{refOperationPreflight?.canInteractiveRebase ? (
								<button
									type="button"
									disabled={refOperationRunning}
									onClick={() => setInteractiveRebaseOpen(true)}
									{...stylex.props(styles.refActionSecondary)}
								>
									Interactive rebase…
								</button>
							) : null}
							{refOperationPreflight?.canRebase ? (
								<button
									type="button"
									disabled={refOperationRunning}
									onClick={() => runRefOperation("rebase")}
									{...stylex.props(styles.refActionSecondary)}
								>
									Rebase source onto target
								</button>
							) : null}
							{refOperationPreflight?.canFastForward ? (
								<button
									type="button"
									disabled={refOperationRunning}
									onClick={() => runRefOperation("fastForward")}
									{...stylex.props(styles.refActionSecondary)}
								>
									Fast-forward target
								</button>
							) : null}
							{refOperationPreflight?.canMerge ? (
								<button
									type="button"
									disabled={refOperationRunning}
									onClick={() => runRefOperation("merge")}
									{...stylex.props(styles.refActionPrimary)}
								>
									Merge source into target
								</button>
							) : null}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
