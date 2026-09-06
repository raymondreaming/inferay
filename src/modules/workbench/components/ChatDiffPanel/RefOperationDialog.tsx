import * as stylex from "@octanejs/stylex";

import type { GitInteractiveRebaseStep } from "../../../repository/model/types.ts";

import { styles } from "./styles.ts";
import type { useChatDiffPanelState } from "./useChatDiffPanelState.tsx";

type RefOperationDialogProps = Pick<
	ReturnType<typeof useChatDiffPanelState>,
	| "interactiveRebaseOpen"
	| "refOperationResult"
	| "interactiveRebasePlan"
	| "interactiveRebaseCommits"
	| "moveRebaseRow"
	| "setInteractiveRebasePlan"
	| "refPreflightError"
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
	refPreflightError,
	refPreflightRunning,
	refOperationPreflight,
	refOperationRunning,
	runRefOperation,
	setInteractiveRebaseOpen,
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
		: interactiveRebaseOpen
			? [
					{ label: "Back", run: () => setInteractiveRebaseOpen(false) },
					{
						label: refOperationRunning
							? "Rebasing…"
							: "Start interactive rebase",
						primary: true,
						run: () => runRefOperation("interactiveRebase"),
					},
				]
			: [
					{ label: "Cancel", run: () => setPendingRefAction(null) },
					{
						label: "Interactive rebase…",
						show: !!refOperationPreflight?.canInteractiveRebase,
						run: () => setInteractiveRebaseOpen(true),
					},
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
	const updateStep = (
		index: number,
		patch: Partial<GitInteractiveRebaseStep>,
	) =>
		setInteractiveRebasePlan((current) =>
			current.map((step, position) =>
				position === index ? { ...step, ...patch } : step,
			),
		);
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
													updateStep(index, {
														action: event.currentTarget
															.value as GitInteractiveRebaseStep["action"],
													})
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
													updateStep(index, {
														message: event.currentTarget.value,
													})
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
