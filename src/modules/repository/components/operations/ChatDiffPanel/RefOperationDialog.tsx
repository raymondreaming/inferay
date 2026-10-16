import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { Modal } from "@shared/ui/Modal/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { styles } from "./styles.ts";
import type { useGitOperations } from "./useGitOperations.tsx";

export function RefOperationDialog(props: {
	operations: ReturnType<typeof useGitOperations>;
	returnFocus: () => HTMLElement | null | undefined;
	pendingRefAction: NonNullable<
		ReturnType<typeof useGitOperations>["state"]["pendingRefAction"]
	>;
}) {
	const operations = props.operations;
	const { state } = operations;
	const preflightError = () =>
		operations.preflight.error
			? operations.preflight.error.message ||
				"Unable to check branch operations"
			: null;
	return (
		<Modal
			label={"Choose branch operation"}
			onClose={() => {
				if (!state.refOperationRunning)
					operations.update({ pendingRefAction: null });
			}}
			closeDisabled={state.refOperationRunning}
			returnFocus={props.returnFocus}
			class={stylex.attrs(styles.refActionDialog).class}
		>
			<strong {...stylex.attrs(styles.refActionTitle)}>
				Move branch history
			</strong>
			<p {...stylex.attrs(styles.refActionCopy)}>
				Source <code>{props.pendingRefAction.source}</code> → target{" "}
				<code>{props.pendingRefAction.target}</code>
			</p>
			{state.refOperationResult?.error || preflightError() ? (
				<p {...stylex.attrs(styles.refActionError)}>
					<strong>
						{state.refOperationResult?.errorLabel ?? "Git command failed"}:
					</strong>{" "}
					{state.refOperationResult?.error || preflightError()}
				</p>
			) : null}
			{operations.operationModel().conflictMessage ? (
				<p {...stylex.attrs(styles.refActionCopy)}>
					{operations.operationModel().conflictMessage}
				</p>
			) : null}
			{!operations.operationModel().conflictMessage &&
			operations.preflight.isFetching ? (
				<p {...stylex.attrs(styles.refActionCopy)}>
					Checking valid operations…
				</p>
			) : null}
			{operations.operationModel().blockedReason ? (
				<p {...stylex.attrs(styles.refActionError)}>
					{operations.operationModel().blockedReason}
				</p>
			) : null}
			<RefOperationButtons operations={operations} />
		</Modal>
	);
}

export function RepositoryOperationBar(props: {
	operations: ReturnType<typeof useGitOperations>;
}) {
	const operations = props.operations;
	return (
		<div
			role="status"
			{...stylex.attrs(surfaceStyles.overlay, styles.repositoryOperationBar)}
		>
			<div {...stylex.attrs(styles.repositoryOperationCopy)}>
				<strong>{operations.operationModel().recoveryTitle}</strong>
				<span>{operations.operationModel().recoveryMessage}</span>
			</div>
			<RefOperationButtons operations={operations} recovery />
		</div>
	);
}

function RefOperationButtons(props: {
	operations: ReturnType<typeof useGitOperations>;
	recovery?: boolean;
}) {
	const operations = props.operations;
	return (
		<div {...stylex.attrs(styles.refActionButtons)}>
			<For
				each={
					props.recovery
						? operations.operationModel().recoveryActions
						: operations.operationModel().actions
				}
				keyed={(row) => row.label}
			>
				{(action) => (
					<button
						type="button"
						disabled={operations.state.refOperationRunning || action().disabled}
						onClick={() =>
							action().operation
								? operations.runRefOperation(
										action().operation!,
										action().phase,
									)
								: operations.update({ pendingRefAction: null })
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
		</div>
	);
}
