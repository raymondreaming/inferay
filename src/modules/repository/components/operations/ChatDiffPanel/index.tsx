import { DiffViewer } from "@repository/components/diff/components/DiffViewer/index.tsx";
import { CommitGraph } from "@repository/components/graph/components/CommitGraph/index.tsx";
import type { useGitGraph } from "@repository/hooks/useGitGraph.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "solid-js";
import { GraphActionDialog } from "./GraphActionDialog.tsx";
import { OperationToast } from "./OperationToast.tsx";
import {
	RefOperationDialog,
	RepositoryOperationBar,
} from "./RefOperationDialog.tsx";
import { styles } from "./styles.ts";
import type { useGitOperations } from "./useGitOperations.tsx";
import { ViewerHeader } from "./ViewerHeader.tsx";

function gitGraphEmptyLabel(graph: ReturnType<typeof useGitGraph>): string {
	switch (graph.state) {
		case "unborn":
			return "This branch does not have its first commit yet";
		case "empty":
			return "This repository has no commits";
		case "nonRepository":
			return "The selected folder is not a Git repository";
		case "commandFailed":
			return graph.stateError || "Git history could not be read";
		default:
			return "No commits";
	}
}
export function ChatDiffPanel(
	props: ComponentProps<typeof ViewerHeader> & {
		readonly branch?: string;
		readonly repositoryKey?: string;
		readonly graph: ReturnType<typeof useGitGraph>;
		readonly operations: ReturnType<typeof useGitOperations>;
		readonly loading: boolean;
		readonly error?: string;
		readonly graphView: Pick<
			ComponentProps<typeof CommitGraph>,
			| "preferences"
			| "onPreferencesChange"
			| "selectedHash"
			| "selectedIds"
			| "onSelect"
			| "onOpenSelection"
			| "onCheckoutRef"
			| "onLoadMore"
		>;
		readonly graphError: string | null;
		readonly selectionAnnouncement: string;
		readonly startAtFirstChange: boolean;
	},
) {
	const operations = props.operations;
	return (
		<section {...stylex.attrs(styles.viewerPanel)}>
			<span role="status" aria-live="polite" {...stylex.attrs(styles.srStatus)}>
				{props.selectionAnnouncement}
			</span>
			{props.mainViewMode === "diff" ? <ViewerHeader {...props} /> : null}
			<div {...stylex.attrs(styles.viewerBody)}>
				{props.mainViewMode === "graph" ? (
					props.graph.loading &&
					props.graph.commits.length === 0 &&
					!props.graph.searchQuery ? (
						<div {...stylex.attrs(styles.viewerEmpty)}>Loading history…</div>
					) : props.graphError &&
					  props.graph.commits.length === 0 &&
					  !props.graph.searchQuery ? (
						<div {...stylex.attrs(styles.viewerEmpty)}>{props.graphError}</div>
					) : props.graph.commits.length === 0 && !props.graph.searchQuery ? (
						<div {...stylex.attrs(styles.viewerEmpty)}>
							{gitGraphEmptyLabel(props.graph)}
						</div>
					) : (
						<CommitGraph
							{...props.graphView}
							commits={props.graph.commits}
							onSearchChange={props.graph.setSearchQuery}
							searchActive={Boolean(props.graph.searchQuery)}
							searchQuery={props.graph.searchQuery}
							emptyLabel={
								props.graph.loading
									? "Searching history…"
									: (props.graphError ??
										props.graph.stateError ??
										"No matching commits")
							}
							rows={props.graph.rows}
							presentation={props.graph.presentation}
							worktrees={props.graph.worktrees}
							branch={props.branch}
							hasMore={props.graph.hasMore}
							loadingMore={props.graph.loading}
							repositoryKey={props.repositoryKey}
							onRefDrop={(source, target) => {
								operations.update({
									refOperationResult: null,
									pendingRefAction: { source, target },
								});
							}}
							onGraphAction={operations.requestGraphAction}
							onCompareWithWip={(itemId) => {
								const wip = props.graph.commits.find(
									(item) =>
										item.itemKind === "worktreeWip" && item.id === "wip",
								);
								if (!wip) return;
								props.graphView.onSelect?.(wip.id);
								props.graphView.onSelect?.(itemId, {
									additive: true,
									range: false,
								});
							}}
						/>
					)
				) : props.diff && props.file ? (
					<ErrorBoundary
						label="Diff viewer"
						contained
						resetKey={`${props.file.path}:${props.file.staged}`}
					>
						<DiffViewer
							diff={props.diff}
							filePath={props.file.path}
							staged={props.file.staged}
							viewMode={props.viewMode}
							startAtFirstChange={props.startAtFirstChange}
						/>
					</ErrorBoundary>
				) : !props.loading ? (
					<div {...stylex.attrs(styles.viewerEmpty)}>
						{props.error ?? "No diff available"}
					</div>
				) : null}
			</div>
		</section>
	);
}

export function GitOperationFeedback(props: {
	operations: ReturnType<typeof useGitOperations>;
	returnFocus: () => HTMLElement | null | undefined;
}) {
	const operations = props.operations;
	const { state } = operations;
	return (
		<>
			{
				<OperationToast
					phase={operations.operationModel().operationActivity.phase}
					message={
						state.graphActionRunning && operations.presentation()
							? `${operations.presentation()!.confirm} in progress…`
							: operations.operationModel().operationActivity.message
					}
				/>
			}
			{state.pendingRefAction ? (
				<RefOperationDialog
					returnFocus={props.returnFocus}
					operations={operations}
					pendingRefAction={state.pendingRefAction}
				/>
			) : null}
			{operations.dialogOpen() &&
			state.pendingGraphAction &&
			operations.presentation() ? (
				<GraphActionDialog
					returnFocus={props.returnFocus}
					operations={operations}
					pendingGraphActionPresentation={operations.presentation()!}
					pendingGraphAction={state.pendingGraphAction}
				/>
			) : null}
			{operations.operationModel().recoveryTitle && !state.pendingRefAction ? (
				<RepositoryOperationBar operations={operations} />
			) : null}
		</>
	);
}
